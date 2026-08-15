import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { TranslateService } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { WizardHotspot } from '../../tour-wizard.model';
import {
  hotspotToWorld,
  isWithinCanvas,
  projectToScreen,
} from '../hotspot-projection';

/**
 * Quanto tempo o dedo fica parado antes de o ponto soltar e passar a segui-lo.
 *
 * 320ms é o valor do handoff, e é um bom valor: abaixo de ~250ms o toque comum
 * começa a virar arraste por acidente; acima de ~400ms o gesto parece travado.
 */
const LONG_PRESS_MS = 320;

/**
 * Folga antes de considerar que o dedo saiu do lugar e o gesto não é
 * long-press.
 *
 * Maior que os 6px do viewer de propósito: aqui o dedo já está parado esperando
 * um tempo, e o tremor de quem segura o telefone com uma mão só é maior do que
 * o de quem toca e solta.
 */
const LONG_PRESS_SLOP_PX = 8;

/** Pressão em curso sobre um pin, antes de virar arraste ou clique. */
interface Pressao {
  hotspotId: string;
  x: number;
  y: number;
  deToque: boolean;
}

/**
 * Camada de pins HTML sobre o canvas do viewer (tarefa B2).
 *
 * DONO: Frente B.
 *
 * Os pins são `<button>` de verdade, e não sprites do three.js, por dois
 * motivos que puxam para o mesmo lado: o design pede pílula com blur, texto
 * com ellipsis e anel pulsante — coisas de CSS —, e a a11y pede algo que o
 * teclado alcance e o leitor de tela anuncie. Sprite em canvas não é nenhum
 * dos dois.
 *
 * O preço é ter de reposicionar tudo a cada frame, já que quem manda na
 * posição é a câmera do three.js. Daí o desenho abaixo: o `@for` cria e destrói
 * nós só quando a lista de hotspots muda, e o laço de frame não toca em
 * estado do Angular — só escreve `transform` direto no elemento.
 *
 * SEM ESTILO de propósito: §8 do plano manda provar a projeção antes de
 * estilizar qualquer pin. A aparência entra depois, com os tokens.
 */
@Component({
  selector: 'app-hotspot-overlay',
  standalone: true,
  template: `
    @for (hotspot of hotspots(); track hotspot.id; let i = $index) {
      <button
        type="button"
        class="tw-pin"
        [class.is-orphan]="!hotspot.target"
        [class.is-dragging]="draggingId() === hotspot.id"
        [attr.data-hotspot-id]="hotspot.id"
        [attr.aria-label]="ariaLabel(hotspot, i)"
        (pointerdown)="onPointerDown(hotspot.id, $event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp()"
        (pointercancel)="onPointerCancel()"
        (contextmenu)="$event.preventDefault()"
        (click)="onClick(hotspot.id)">
        <!--
          O rótulo visível cai no número quando o ponto ainda não tem nome; o
          aria-label acima carrega a descrição inteira, porque "3" sozinho não
          diz nada a quem não vê a foto.
        -->
        <span aria-hidden="true">{{ hotspot.label || i + 1 }}</span>
      </button>
    }
  `,
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        /* A camada não intercepta o arrasto do panorama; só os pins o fazem. */
        pointer-events: none;
      }

      .tw-pin {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: auto;
        /* O canvas embaixo já é touch-action: none — o OrbitControls o põe
           assim para poder girar o panorama com o dedo. Sobre ele, a página
           nunca rolou; o pin só acompanha a vizinhança. Sem isto o browser
           trata o arraste do pin como rolagem e engole os pointermove. */
        touch-action: none;
        /* Posição vem do laço de frame, em transform — nunca em top/left,
           que forçariam layout 60 vezes por segundo. */
        will-change: transform;
        /* Nasce invisível. Entre o clique que cria o hotspot e o primeiro
           frame do laço, o pin já está no DOM e ainda sem transform — ou seja,
           em (0,0), o canto do canvas, e não onde a pessoa clicou. É um frame
           só, mas é um pin piscando no canto a cada ponto criado. O laço o
           torna visível junto com a primeira posição. */
        visibility: hidden;
      }

      /* Provisório, até o acabamento do B2. O pin ainda não tem desenho
         nenhum, mas um arraste sem retorno visual é indistinguível de um
         travamento: sem isto, no mouse — que não vibra — nada na tela diz que o
         ponto foi pego. */
      .tw-pin.is-dragging {
        box-shadow: var(--tw-shadow-pin-drag);
        cursor: grabbing;
      }
    `,
  ],
})
export class HotspotOverlayComponent {
  readonly hotspots = input<WizardHotspot[]>([]);
  readonly viewer = input<PanoramicViewerComponent | null>(null);
  /** Nomes dos ambientes, por id — só para o pin dizer para onde leva. */
  readonly roomNames = input<Record<string, string>>({});

  /**
   * Qual ponto está sendo arrastado, se algum. Vem de fora, do `pinDrag` do
   * store, em vez de nascer aqui: a lixeira (B10) precisa da mesma informação,
   * e duas cópias sairiam de sincronia no primeiro caso de borda.
   */
  readonly draggingId = input<string | null>(null);

  /**
   * Quem decide o que o clique faz é a etapa, não o overlay: com destino
   * navega, sem destino abre o editor. Aqui só se sabe qual pin foi tocado.
   */
  readonly pinActivated = output<string>();

  /** O long-press completou: este ponto passou a seguir o dedo (B9). */
  readonly pinDragStarted = output<string>();

  /**
   * O ponto em arraste tem uma posição nova.
   *
   * Vai com `(u, v)` E com o ponto da tela: o par do panorama é o que se grava,
   * e o de tela é o que a lixeira (B10) precisa para saber se o dedo está sobre
   * ela. Calcular o de tela de novo lá em cima exigiria a câmera do viewer, que
   * é justamente o que este componente tem e a etapa não.
   */
  readonly pinDragMoved = output<{
    u: number;
    v: number;
    clientX: number;
    clientY: number;
  }>();

  /** O dedo soltou. Quem decide o que fazer com a soltura é a etapa. */
  readonly pinDragEnded = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly translate = inject(TranslateService);

  /**
   * O que o leitor de tela anuncia no pin.
   *
   * Um `<button>` cujo conteúdo é "2" não diz nada: nem que é um ponto de
   * navegação, nem para onde vai. A a11y é metade da razão de os pins serem
   * HTML e não sprites — desperdiçá-la aqui seria perder a aposta.
   */
  ariaLabel(hotspot: WizardHotspot, index: number): string {
    const nome = hotspot.label.trim() || String(index + 1);
    const destino = hotspot.target ? this.roomNames()[hotspot.target] : null;
    return destino
      ? this.translate.instant('TOUR_WIZARD.STEP2.PIN_NAV', { nome, destino })
      : this.translate.instant('TOUR_WIZARD.STEP2.PIN_ORPHAN', { nome });
  }

  constructor() {
    effect((onCleanup) => {
      const viewer = this.viewer();
      if (!viewer) return;

      const stop = viewer.onFrame(() => this.reposition(viewer));
      onCleanup(stop);
    });

    // Um timer de long-press vivo depois do componente morto dispararia um
    // arraste sobre uma etapa que não está mais na tela.
    inject(DestroyRef).onDestroy(() => this.cancelarPressao());
  }

  // ---- long-press e arraste (B9) -----------------------------------------
  //
  // O gesto é reconhecido AQUI porque é aqui que se sabe onde os pins estão na
  // tela e onde fica a câmera do viewer. O que fazer com ele — mover, excluir
  // na lixeira — é decisão da etapa, e sai por `output`.

  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private pressao: Pressao | null = null;
  private arrastando = false;
  private engolirClique = false;

  onPointerDown(hotspotId: string, event: PointerEvent): void {
    this.cancelarPressao();
    this.engolirClique = false;

    const alvo = event.currentTarget as HTMLElement;
    this.pressao = {
      hotspotId,
      x: event.clientX,
      y: event.clientY,
      deToque: event.pointerType !== 'mouse',
    };

    // A captura vem JÁ, e não quando o arraste começa.
    //
    // Tentei o contrário primeiro, com o argumento de que capturar de saída
    // roubaria eventos de quem só ia tocar e soltar. O argumento é falso — quem
    // gira o panorama é o OrbitControls, que escuta no canvas, e o pin é irmão
    // dele, não filho: nada do que acontece aqui chegava lá de qualquer forma.
    //
    // E o preço da demora apareceu no navegador: o pin tem ~20px, o mouse sai
    // dele antes de percorrer a folga de 8px, e sem captura o `pointermove`
    // seguinte vai para o canvas. O arraste de mouse simplesmente não começava.
    try {
      alvo.setPointerCapture(event.pointerId);
    } catch {
      // Ponteiro sintético (teste) ou já solto — ver §6 das notas da frente.
    }

    // Só o toque espera. Ver `onPointerMove` para o porquê.
    if (!this.pressao.deToque) return;

    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      this.comecarArraste();
    }, LONG_PRESS_MS);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.arrastando) {
      // A conversão é a MESMA do clique que cria um ponto — é o `uvAt` do
      // viewer. Uma segunda implementação divergiria, e o pin escaparia do dedo.
      const uv = this.viewer()?.uvAt(event.clientX, event.clientY);
      if (!uv) return;

      this.pinDragMoved.emit({
        ...uv,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      return;
    }

    const pressao = this.pressao;
    if (!pressao) return;

    const percorrido = Math.hypot(
      event.clientX - pressao.x,
      event.clientY - pressao.y,
    );
    if (percorrido <= LONG_PRESS_SLOP_PX) return;

    // Passou da folga: o gesto deixou de ser um clique, arraste ou não. Com a
    // captura ligada o browser dispara o `click` no pin mesmo que a solta seja
    // longe dele — sem esta linha, passar o dedo por cima de um ponto e soltar
    // adiante navegaria para o destino dele.
    this.engolirClique = true;

    if (pressao.deToque) {
      // Dedo que anda antes dos 320ms não queria arrastar: queria rolar, ou
      // errou o alvo. Cancelar aqui é o que impede a etapa 2 de sequestrar a
      // rolagem de quem passou o polegar por cima de um ponto.
      this.cancelarPressao();
      return;
    }

    // Com mouse não há o que desambiguar: o pin não rola nada, e o giro do
    // panorama nem chega a começar num pin (o OrbitControls escuta no canvas, e
    // o pin é irmão dele, não filho). Esperar 320ms de mouse parado seria um
    // gesto que ninguém descobre — e o DoD pede mover em desktop E mobile.
    this.comecarArraste();
  }

  onPointerUp(): void {
    if (this.arrastando) {
      // Largar um ponto não pode navegar para o destino dele. O `engolirClique`
      // já foi ligado no primeiro movimento, mas o long-press sem movimento
      // nenhum também pega o ponto — e soltá-lo ali mesmo também não é clique.
      this.engolirClique = true;
      this.pinDragEnded.emit();
    }
    this.cancelarPressao();
  }

  onPointerCancel(): void {
    // Não há clique depois de um cancelamento, então não há o que engolir.
    if (this.arrastando) this.pinDragEnded.emit();
    this.cancelarPressao();
  }

  onClick(hotspotId: string): void {
    if (this.engolirClique) {
      this.engolirClique = false;
      return;
    }
    this.pinActivated.emit(hotspotId);
  }

  private comecarArraste(): void {
    const pressao = this.pressao;
    if (!pressao) return;

    this.arrastando = true;
    this.pinDragStarted.emit(pressao.hotspotId);
    // O tátil é o que diz "soltou, agora segue o dedo" sem nada na tela.
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() =>
      navigator.vibrate?.(40),
    );
  }

  private cancelarPressao(): void {
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = null;
    this.pressao = null;
    this.arrastando = false;
  }

  /**
   * Reposiciona os pins. Roda a cada frame, fora do ciclo do Angular.
   *
   * O casamento entre elemento e hotspot é por `data-hotspot-id`, e não por
   * índice. Índice acopla a ordem do DOM à ordem do array: no dia em que as
   * duas divergirem — um `track` diferente, uma reordenação, um filtro — cada
   * pin passa a assumir a coordenada de outro, e o sintoma é um ponto no lugar
   * errado, sem erro nenhum no console. Custa um `Map` por frame sobre uma
   * lista de dezenas de itens, o que é irrelevante perto de disparar o próprio
   * `render()` do three.js.
   *
   * Os elementos vêm de `host.children` pelo mesmo motivo de robustez: é uma
   * coleção viva, sem depender de quando o Angular reavalia uma consulta.
   */
  private reposition(viewer: PanoramicViewerComponent): void {
    const camera = viewer.viewerCamera;
    const size = viewer.viewerSize;
    if (!camera || !size) return;

    const porId = new Map(this.hotspots().map((h) => [h.id, h]));
    const elements = this.host.nativeElement.children;
    const arrastado = this.draggingId();

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as HTMLElement;
      const hotspot = porId.get(el.dataset['hotspotId'] ?? '');
      if (!hotspot) continue;

      const point = projectToScreen(
        hotspotToWorld(hotspot.u, hotspot.v),
        camera,
        size.width,
        size.height,
      );

      if (!point || !isWithinCanvas(point, size.width, size.height)) {
        el.style.visibility = 'hidden';
        continue;
      }

      el.style.visibility = 'visible';
      // translate3d primeiro, depois o -50% do próprio pin: leva o centro da
      // pílula ao ponto, e não o canto superior esquerdo.
      //
      // O aumento do ponto em arraste sai daqui e não do CSS porque esta linha
      // reescreve `transform` a cada frame — um `scale` numa classe seria
      // sobrescrito no frame seguinte, e o pin voltaria ao tamanho normal
      // sozinho.
      const escala = hotspot.id === arrastado ? ' scale(1.25)' : '';
      el.style.transform =
        `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%)${escala}`;
    }
  }
}
