import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { WizardHotspot } from '../../tour-wizard.model';
import {
  hotspotToWorld,
  isWithinCanvas,
  projectToScreen,
} from '../hotspot-projection';
import { prefersReducedMotion } from '../media';

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
  /** Só o dedo que começou o gesto continua mandando nele. Ver `onPointerDown`. */
  pointerId: number;
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
 * O estilo entrou por último, como manda o §8 do plano: primeiro provar a
 * projeção, depois desenhar. E o que se paga por ter esperado é ter estilizado
 * uma vez só, já sabendo de que estados o pin precisa — com destino, órfão, em
 * arraste, em foco.
 */
@Component({
  selector: 'app-hotspot-overlay',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @for (pin of pins(); track pin.hotspot.id; let i = $index) {
      <button
        type="button"
        class="tw-pin"
        [class.is-orphan]="!pin.hotspot.target"
        [class.is-dragging]="draggingId() === pin.hotspot.id"
        [attr.data-hotspot-id]="pin.hotspot.id"
        [attr.aria-label]="pin.ariaLabel"
        (pointerdown)="onPointerDown(pin.hotspot.id, $event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerCancel($event)"
        (contextmenu)="$event.preventDefault()"
        (click)="onClick(pin.hotspot.id, $event)">
        <!--
          O dot leva o anel de pulso; o rótulo visível cai no número quando o
          ponto ainda não tem nome. Os dois são aria-hidden porque o rótulo
          acessível do botão já carrega a descrição inteira — "3" sozinho não
          diz nada a quem não vê a foto, e o dot não diz nada a ninguém.
        -->
        <span class="tw-pin__dot" aria-hidden="true"></span>
        <span class="tw-pin__label" aria-hidden="true">{{ pin.rotulo }}</span>
      </button>
    }

    <!--
      O seletor de destino, ancorado no pin recém-criado.

      Fica DEPOIS dos pins no DOM para desenhar por cima deles, e é posicionado
      pelo mesmo laço de frame — assim ele acompanha a foto quando o corretor
      gira em vez de descolar do ponto a que se refere.
    -->
    @if (picker()) {
      <div
        #seletor
        class="tw-picker"
        role="dialog"
        [attr.aria-label]="'TOUR_WIZARD.STEP2.PICK_TARGET' | translate"
        (keydown.escape)="pickerClosed.emit()">
        <p class="tw-picker__titulo">
          {{ 'TOUR_WIZARD.STEP2.PICK_TARGET' | translate }}
        </p>

        <ul class="tw-picker__lista">
          @for (sala of rooms(); track sala.id) {
            <li>
              <button
                type="button"
                class="tw-picker__opcao"
                (click)="escolher(sala.id)">
                {{ sala.room }}
              </button>
            </li>
          }
        </ul>

        <!--
          Sair sem escolher é caminho de primeira classe, e não um X escondido
          no canto: o ponto fica órfão, o painel já avisa que órfão não é salvo,
          e insistir aqui transformaria "marcar um ponto" no formulário que este
          seletor existe para não ser.
        -->
        <button type="button" class="tw-picker__depois" (click)="pickerClosed.emit()">
          {{ 'TOUR_WIZARD.STEP2.PICK_LATER' | translate }}
        </button>
      </div>
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
        /* O long-press de 320ms cai exatamente na janela em que iOS e Android
           abrem a seleção de texto e a lupa sobre um botão com rótulo. O gesto
           de arrastar e o callout do sistema começariam no mesmo instante, e no
           iOS a seleção resultante emite pointercancel — o ponto seria pego e
           largado no mesmo movimento. O contextmenu já é prevenido, mas ele não
           cobre seleção. */
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        /* Posição vem do laço de frame, em transform — nunca em top/left,
           que forçariam layout 60 vezes por segundo. */
        will-change: transform;
        /* Nasce invisível. Entre o clique que cria o hotspot e o primeiro
           frame do laço, o pin já está no DOM e ainda sem transform — ou seja,
           em (0,0), o canto do canvas, e não onde a pessoa clicou. É um frame
           só, mas é um pin piscando no canto a cada ponto criado. O laço o
           torna visível junto com a primeira posição. */
        visibility: hidden;

        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 34px;
        max-width: 168px;
        padding: 0 13px 0 11px;
        /* A borda é da marca, e não um branco a 18%, para o pin ser notado
           sobre foto qualquer — o mesmo motivo e a mesma cor do sprite do
           inner-view, que é este pin visto pelo visitante. 2px aqui equivalem
           aos 5px de lá: a pílula do sprite tem 76px de altura lógica contra os
           34px desta, e o que se mantém é a proporção, não o número. */
        border: 2px solid var(--tw-brand);
        border-radius: var(--tw-radius-pill);
        background: var(--tw-pin-bg);
        /* A pílula fica sobre uma foto qualquer: sem o blur, um trecho de céu
           claro atrás dela deixa o texto branco ilegível mesmo com o fundo a
           78% de opacidade. */
        backdrop-filter: blur(7px);
        box-shadow: var(--tw-shadow-pin);
        color: #fff;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
        cursor: grab;

        /* NÃO usa --tw-ease-pin, apesar do nome do token: ele inclui
           transform, e o transform deste elemento é reescrito a cada frame
           pelo laço de posicionamento. Uma transição de 0,14s ali faria o pin
           correr atrás da câmera com um sexto de segundo de atraso — que é
           exatamente o defeito que o overlay existe para não ter. */
        transition: box-shadow 0.14s ease, border-color 0.14s ease;
      }

      /* A área que o dedo acerta, esticada por fora sem mexer no desenho.
         A pílula tem 34px de altura porque 44 pesa demais sobre a foto, ainda
         mais com vários pontos; o piso de toque da WCAG vale do mesmo jeito. */
      .tw-pin::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100%;
        min-width: 44px;
        height: 44px;
        transform: translate(-50%, -50%);
      }

      .tw-pin:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
        /* O halo escuro é o que garante o contraste do anel branco quando a
           foto atrás também é clara. */
        box-shadow: var(--tw-shadow-pin), 0 0 0 5px rgba(0, 0, 0, 0.55);
      }

      .tw-pin__dot {
        position: relative;
        flex: 0 0 auto;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--tw-brand);
      }

      /* O anel de pulso. Nasce em opacity 0 e quem o acende é a animação — daí
         desligar a animação bastar para sumir com ele, sem deixar um círculo
         opaco parado em volta do dot. */
      .tw-pin__dot::after {
        content: '';
        position: absolute;
        inset: -1px;
        border-radius: 50%;
        background: var(--tw-brand);
        opacity: 0;
        animation: tw-pulse-ring 2.4s ease-out infinite;
      }

      .tw-pin__label {
        /* min-width: 0 para o ellipsis valer dentro do flex; sem ele o nome
           comprido estica a pílula em vez de ser cortado. */
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Ponto sem destino: dot vazado e borda de atenção, SEM pulso.
         O anel é a promessa de "clique aqui e você vai para outro lugar" que o
         visitante vai ver — e é justamente o que este ponto ainda não cumpre.
         Pulsar aqui seria ensaiar uma promessa falsa. */
      .tw-pin.is-orphan {
        border-color: rgba(253, 246, 227, 0.5);
      }

      .tw-pin.is-orphan .tw-pin__dot {
        background: transparent;
        box-shadow: inset 0 0 0 2px var(--tw-warn-soft);
      }

      .tw-pin.is-orphan .tw-pin__dot::after {
        animation: none;
      }

      .tw-pin.is-dragging {
        box-shadow: var(--tw-shadow-pin-drag);
        border-color: rgba(255, 255, 255, 0.4);
        cursor: grabbing;
      }

      /* Um anel pulsando debaixo do próprio dedo não informa nada e concorre
         com a lixeira pela atenção. */
      .tw-pin.is-dragging .tw-pin__dot::after {
        animation: none;
      }

      /* ---- Seletor de destino -------------------------------------------
         Mesma identidade do pin — pílula escura, borda da marca — porque é a
         continuação do mesmo gesto: o ponto que acabou de nascer perguntando
         para onde leva. */
      .tw-picker {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: auto;
        /* Posição vem do laço de frame, como a dos pins. Nasce invisível pelo
           mesmo motivo: antes do primeiro frame ele estaria no canto do canvas. */
        visibility: hidden;
        will-change: transform;

        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 152px;
        /* Nunca mais largo que a foto, mesmo com nome de ambiente comprido. */
        max-width: min(232px, 88%);
        padding: 10px;
        border: 2px solid var(--tw-brand);
        border-radius: 14px;
        background: var(--tw-pin-bg-canvas);
        backdrop-filter: blur(7px);
        box-shadow: var(--tw-shadow-pin-drag);
        color: #fff;
      }

      .tw-picker__titulo {
        margin: 0 2px 2px;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.3;
        opacity: 0.85;
      }

      .tw-picker__lista {
        /* A lista tem teto e rola: num celular a foto tem ~270px de altura, e um
           tour de oito ambientes faria o seletor passar da imagem inteira. */
        max-height: 156px;
        overflow-y: auto;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .tw-picker__opcao,
      .tw-picker__depois {
        display: block;
        width: 100%;
        /* 44px é o piso de alvo da WCAG, e aqui vale duplo: escolhe-se isto com
           o polegar, sobre uma foto, logo depois de outro toque. */
        min-height: 44px;
        padding: 0 12px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
      }

      .tw-picker__opcao:hover {
        background: rgba(255, 255, 255, 0.16);
        border-color: rgba(255, 255, 255, 0.4);
      }

      .tw-picker__depois {
        border-color: transparent;
        background: transparent;
        font-weight: 500;
        text-align: center;
        opacity: 0.8;
      }

      .tw-picker__opcao:focus-visible,
      .tw-picker__depois:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
      }

      /* B12. O tour-wizard.scss zera os tokens de transição, mas nem a animação
         do anel nem a transição escrita à mão acima passam por token — ficam
         aqui. O que some é o movimento: a cor do dot, o contorno e a sombra
         continuam distinguindo cada estado. */
      @media (prefers-reduced-motion: reduce) {
        .tw-pin {
          transition: none;
        }

        .tw-pin__dot::after {
          animation: none;
        }
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

  // ---- seletor de destino ------------------------------------------------

  /** Id do ponto que está perguntando para onde leva, ou nada. */
  readonly picker = input<string | null>(null);

  /** Destinos possíveis, já sem o ambiente aberto. */
  readonly rooms = input<{ id: string; room: string }[]>([]);

  readonly targetPicked = output<{ hotspotId: string; targetId: string }>();
  readonly pickerClosed = output<void>();

  private readonly seletor = viewChild<ElementRef<HTMLElement>>('seletor');

  escolher(targetId: string): void {
    const hotspotId = this.picker();
    if (hotspotId) this.targetPicked.emit({ hotspotId, targetId });
  }

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly translate = inject(TranslateService);
  private readonly injector = inject(Injector);
  private readonly semMovimento = prefersReducedMotion();

  /**
   * Os pins com o texto já resolvido.
   *
   * É um `computed`, e não uma chamada de método no template, porque o laço de
   * render roda DENTRO da zona do Angular (§2.3 das notas da frente: medido em
   * ~62 frames/s com `NgZone.isInAngularZone()` verdadeiro). Cada frame é uma
   * tarefa de zona, então toda expressão do template era reavaliada 60 vezes
   * por segundo — com 8 pins, umas 500 chamadas de `translate.instant()` por
   * segundo, cada uma interpolando parâmetros e alocando string.
   *
   * O overlay foi escrito de propósito para o laço de frame não passar por
   * binding do Angular; deixar o rótulo como método desfazia metade disso.
   * Aqui ele só recalcula quando os hotspots ou os nomes de ambiente mudam.
   *
   * O que o leitor de tela anuncia: um `<button>` cujo conteúdo é "2" não diz
   * nada — nem que é um ponto de navegação, nem para onde vai. A a11y é metade
   * da razão de os pins serem HTML e não sprites.
   */
  readonly pins = computed(() => {
    const nomes = this.roomNames();
    return this.hotspots().map((hotspot, index) => {
      const nome = hotspot.label.trim() || String(index + 1);
      const destino = hotspot.target ? nomes[hotspot.target] : null;
      return {
        hotspot,
        rotulo: hotspot.label || index + 1,
        ariaLabel: destino
          ? this.translate.instant('TOUR_WIZARD.STEP2.PIN_NAV', { nome, destino })
          : this.translate.instant('TOUR_WIZARD.STEP2.PIN_ORPHAN', { nome }),
      };
    });
  });

  constructor() {
    effect((onCleanup) => {
      const viewer = this.viewer();
      if (!viewer) return;

      const stop = viewer.onFrame(() => this.reposition(viewer));
      onCleanup(stop);
    });

    // O seletor abre com o foco na primeira opção.
    //
    // Sem isto ele seria alcançável só por ponteiro: quem navega por teclado
    // criaria um ponto, o seletor apareceria, e o Tab seguinte iria para o pin
    // seguinte — passando por cima da única pergunta da tela. `afterNextRender`
    // porque o elemento nasce no mesmo tick em que o estado muda; foi o que
    // mordeu o foco do painel.
    effect(() => {
      if (!this.picker()) return;
      afterNextRender(
        () => this.seletor()?.nativeElement
          .querySelector<HTMLButtonElement>('.tw-picker__opcao')
          ?.focus(),
        { injector: this.injector },
      );
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
    // Um arraste em curso não é interrompido por um segundo dedo.
    //
    // Antes, o `cancelarPressao()` abaixo zerava `arrastando` sem emitir
    // `pinDragEnded`, e o `pointerup` seguinte via `arrastando === false` e
    // também não emitia nada. O `pinDrag` do store ficava preso para sempre: a
    // lixeira pendurada sobre a foto e o pin travado em escala, sem saída a não
    // ser completar outro arraste inteiro. Reproduzido com dois dedos.
    if (this.arrastando) return;

    this.cancelarPressao();
    this.engolirClique = false;

    const alvo = event.currentTarget as HTMLElement;
    this.pressao = {
      hotspotId,
      x: event.clientX,
      y: event.clientY,
      deToque: event.pointerType !== 'mouse',
      pointerId: event.pointerId,
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
    // Só o dedo dono do gesto o comanda. Sem isto, um segundo dedo encostando
    // na tela move o ponto que o primeiro está arrastando.
    if (!this.doDono(event)) return;

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

  onPointerUp(event: PointerEvent): void {
    if (!this.doDono(event)) return;

    if (this.arrastando) {
      // Largar um ponto não pode navegar para o destino dele. O `engolirClique`
      // já foi ligado no primeiro movimento, mas o long-press sem movimento
      // nenhum também pega o ponto — e soltá-lo ali mesmo também não é clique.
      this.engolirClique = true;
      this.pinDragEnded.emit();
    }
    this.cancelarPressao();
  }

  /** Se o evento é do ponteiro que começou a pressão em curso. */
  private doDono(event: PointerEvent): boolean {
    return this.pressao === null || this.pressao.pointerId === event.pointerId;
  }

  onPointerCancel(event: PointerEvent): void {
    if (!this.doDono(event)) return;

    // Não há clique depois de um cancelamento, então não há o que engolir.
    if (this.arrastando) this.pinDragEnded.emit();
    this.cancelarPressao();
  }

  onClick(hotspotId: string, event: MouseEvent): void {
    // `detail > 0` é o que separa clique de ponteiro de clique de teclado: o
    // Enter num <button> gera um `click` sintético com `detail` 0.
    //
    // Sem essa distinção a trava fica pendurada. Ela é ligada no `pointerup` do
    // arraste e só é desligada pelo clique que vem em seguida ou pelo
    // `pointerdown` seguinte — e um usuário de teclado não gera nenhum dos
    // dois. Encontrado no navegador: depois de arrastar um ponto com o mouse,
    // dar Tab até outro pin e apertar Enter não fazia nada. Nada no console.
    if (this.engolirClique && event.detail > 0) {
      this.engolirClique = false;
      return;
    }

    this.engolirClique = false;
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
   * errado, sem erro nenhum no console.
   *
   * Custa um `Map` por frame, e isso já foi levantado como alocação por frame.
   * Medido no navegador, com o `reposition` real chamado em lote (o
   * `performance.now()` do Chrome está travado em 100µs, então um cronômetro
   * por chamada só devolve zero ou 100):
   *
   *              | laço inteiro | do qual, o Map | de um frame de 16,7ms
   *     8 pins   |    22,8µs    |  0,35µs (1,5%) |        0,14%
   *     40 pins  |    98,4µs    |  5,31µs (5,4%) |        0,59%
   *
   * Escala linear, e mesmo em 40 pontos — bem além do realista para um ambiente
   * — o laço TODO não chega a 0,6% do frame. Trocar o `Map` por estrutura
   * guardada compraria centésimos de por cento de frame ao preço de sincronizar
   * cache com a lista; o casamento por id é que não pode ser perdido.
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
    // Sem o aumento quando o sistema pede menos movimento (B12). O ponto em
    // arraste continua distinguível pela sombra, que é cor e não deslocamento.
    const arrastado = this.semMovimento() ? null : this.draggingId();

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

      const ehDoSeletor = hotspot.id === this.picker();

      if (!point || !isWithinCanvas(point, size.width, size.height)) {
        el.style.visibility = 'hidden';
        // O seletor vai junto. Sem isto, girar a foto até o ponto sair de quadro
        // deixaria o seletor parado no último lugar em que o pin esteve —
        // visível, ancorado em nada, perguntando o destino de um ponto que já
        // não está na tela.
        if (ehDoSeletor) this.esconderSeletor();
        continue;
      }

      if (ehDoSeletor) this.posicionarSeletor(point, size.width, size.height);

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

  /** Medida do seletor, tirada UMA vez por abertura. Ver `posicionarSeletor`. */
  private seletorMedido: string | null = null;
  private seletorTamanho = { largura: 0, altura: 0 };

  /**
   * Põe o seletor logo abaixo do pin, sem deixá-lo sair da foto.
   *
   * A medida do elemento sai do DOM uma vez por abertura, e não a cada frame:
   * ler `offsetWidth` é leitura de layout, e aqui ela cairia no meio de um laço
   * que acabou de escrever `transform` em todos os pins — reflow forçado 60
   * vezes por segundo, que é justo o padrão que a lixeira foi medida para não
   * ter. O tamanho não muda enquanto o seletor está aberto: a lista de destinos
   * é a mesma.
   */
  private posicionarSeletor(
    ponto: { x: number; y: number },
    largura: number,
    altura: number,
  ): void {
    const el = this.seletor()?.nativeElement;
    const alvo = this.picker();
    if (!el || !alvo) return;

    if (this.seletorMedido !== alvo) {
      this.seletorMedido = alvo;
      this.seletorTamanho = { largura: el.offsetWidth, altura: el.offsetHeight };
    }

    const { largura: w, altura: h } = this.seletorTamanho;
    const folga = 8;
    // 26px abaixo do centro do pin: o suficiente para a pílula não ser coberta
    // pelo próprio seletor que ela abriu.
    const y = ponto.y + 26;

    el.style.transform =
      `translate3d(${this.entre(ponto.x - w / 2, folga, largura - w - folga)}px, ` +
      // Não cabendo embaixo, vai para cima do pin em vez de vazar para fora da
      // foto — que é o caso do ponto criado na metade de baixo da imagem, o
      // mesmo que fazia o sheet cobrir o ponto recém-criado.
      `${y + h + folga > altura ? this.entre(ponto.y - 26 - h, folga, altura - h - folga) : y}px, 0)`;
    el.style.visibility = 'visible';
  }

  private esconderSeletor(): void {
    const el = this.seletor()?.nativeElement;
    if (el) el.style.visibility = 'hidden';
  }

  private entre(valor: number, minimo: number, maximo: number): number {
    return Math.min(Math.max(valor, minimo), Math.max(minimo, maximo));
  }
}
