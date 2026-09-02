import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../components/panoramic-viewer/panoramic-viewer.component';
// Do wizard, de propósito. A projeção é a MESMA matemática, já testada contra
// a câmera de verdade, e o comentário de `hotspotToWorld` documenta a cadeia de
// conversão inteira. Copiar daria duas versões que divergem no primeiro ajuste;
// mover o arquivo para um lugar neutro mexeria em `tour-wizard/**`, que é de
// outra task. Fica o import cruzado, que é o menor dos três males.
import {
  hotspotToWorld,
  isWithinCanvas,
  projectToScreen,
} from '../../tour-wizard/hotspots/hotspot-projection';
import { prefersReducedMotion } from '../../tour-wizard/hotspots/media';
import { ViewerHotspot } from '../tour-viewer.model';

/**
 * Lado do disco no horizonte e junto ao observador, em px.
 *
 * A escala por distância é o que faz o disco ler como algo DEITADO NO CHÃO e
 * não como um adesivo colado na foto: perto é grande, longe é pequeno. Sem ela
 * a perspectiva sozinha não convence.
 */
const LADO_LONGE = 64;
const LADO_PERTO = 124;

/**
 * A faixa de `v` em que a interpolação acontece.
 *
 * `v = 0.5` é o equador da esfera — o horizonte, o ponto mais distante que um
 * hotspot de piso pode ocupar. `v = 1` é o polo de baixo, exatamente sob os pés
 * de quem olha. Um ponto de chão nasce entre os dois.
 *
 * Confere com o handoff sem que ninguém tenha ajustado número: o disco de 88px
 * que `03-hotspots.md` especifica para o mobile cai em `v = 0.70`, que é onde
 * um ponto de piso a poucos passos costuma ficar.
 */
const V_HORIZONTE = 0.5;
const V_AOS_PES = 1;

/** Um pin já com tudo o que o template precisa, sem conta no meio do render. */
interface Pin {
  id: string;
  targetSceneId: string;
  label: string;
  ariaLabel: string;
  principal: boolean;
  /** Lado do disco, já em `px`, para a custom property do elemento. */
  lado: string;
}

/**
 * Os hotspots de piso desenhados sobre o canvas do viewer (TV-7).
 *
 * DONO: Frente C.
 *
 * HTML sobre o canvas, e não sprite dentro da cena 3D (decisão D3 do plano).
 * O disco pede gradiente radial, anel que pulsa, blur na plaquinha e um rótulo
 * com ellipsis — tudo CSS. Desenhar isso numa textura de canvas seria
 * reimplementar meio motor de layout; e o `<button>` ainda vem de graça, com
 * foco, teclado e leitor de tela.
 *
 * O preço é reposicionar tudo a cada frame, porque quem manda na posição é a
 * câmera do three.js. Daí o desenho: o `@for` cria e destrói nós só quando a
 * lista muda, e o laço de frame não toca em estado do Angular — escreve
 * `transform` direto no elemento, fora da zona.
 *
 * A ARMADILHA que este componente existe para não cair (está nomeada em
 * `03-hotspots.md` e é o primeiro item do QA): a animação de flutuação e a
 * perspectiva NÃO podem morar no mesmo elemento. `pin-bob` anima `transform`, e
 * a keyframe substitui o `transform` inteiro do elemento — levando junto o
 * `perspective() rotateX()`. O disco deixa de ser elipse deitada e vira um
 * círculo chapado de frente para a câmera, sem erro nenhum no console. Por isso
 * são três camadas: o botão leva a posição, o `__bob` leva a animação, o
 * `__disco` leva a perspectiva.
 */
@Component({
  selector: 'app-tv-hotspot-overlay',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './tour-hotspot-overlay.component.html',
  styleUrls: ['./tour-hotspot-overlay.component.scss'],
})
export class TourHotspotOverlayComponent {
  readonly hotspots = input<ViewerHotspot[]>([]);
  readonly viewer = input<PanoramicViewerComponent | null>(null);

  /**
   * O destino escolhido. Emite o id da CENA, não o do hotspot: quem ouve chama
   * `irParaCenaPorId`, e traduzir de novo lá em cima exigiria o mapa de
   * hotspots que este componente já tem na mão.
   */
  readonly cenaEscolhida = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly translate = inject(TranslateService);

  /**
   * Público porque o template decide com ele se o anel de pulso chega a
   * existir. Com menos movimento pedido, um anel parado seria só um círculo
   * solto em volta do disco — pior que não ter. As durações das duas animações
   * já são zeradas por `tour-viewer.scss`; isto é o que o CSS não alcança.
   */
  readonly semMovimento = prefersReducedMotion();

  /**
   * Os pins com rótulo, tamanho e papel já resolvidos.
   *
   * `computed`, e nunca método chamado do template: o laço de render do viewer
   * roda DENTRO da zona do Angular, então cada expressão do template seria
   * reavaliada umas 60 vezes por segundo — com meia dúzia de pins, centenas de
   * `translate.instant()` por segundo, cada um alocando string. Aqui recalcula
   * só quando a lista de hotspots muda.
   */
  readonly pins = computed<Pin[]>(() =>
    this.hotspots().map((h) => ({
      id: h.id,
      targetSceneId: h.targetSceneId,
      label: h.label,
      // O rótulo visível é aria-hidden (ver o template): quem não enxerga a
      // foto precisa da frase inteira, não do nome do cômodo solto.
      ariaLabel: this.translate.instant('TOUR_VIEWER.HOTSPOT.GO_TO', { name: h.label }),
      principal: h.kind === 'primary',
      lado: `${ladoDoDisco(h.v)}px`,
    })),
  );

  constructor() {
    effect((onCleanup) => {
      const viewer = this.viewer();
      if (!viewer) return;

      // Do laço do PRÓPRIO viewer, e não de um requestAnimationFrame daqui: em
      // laços separados os pins saem de sincronia com a foto e arrastam atrás
      // no giro rápido.
      const parar = viewer.onFrame(() => this.reposicionar(viewer));
      onCleanup(parar);
    });

    // Nada de timer nem de listener global aqui — o `onCleanup` acima já
    // desassina o laço. Fica o hook para quem vier depois não recriar a dúvida.
    inject(DestroyRef).onDestroy(() => undefined);
  }

  /**
   * Põe cada pin onde a câmera diz que ele está, uma vez por frame.
   *
   * Escreve direto no DOM: um binding do Angular aqui dispararia detecção de
   * mudança sessenta vezes por segundo, que é exatamente o custo que o overlay
   * em HTML existe para evitar.
   */
  private reposicionar(viewer: PanoramicViewerComponent): void {
    const camera = viewer.viewerCamera;
    const size = viewer.viewerSize;
    if (!camera || !size) return;

    const porId = new Map(this.hotspots().map((h) => [h.id, h]));
    const elementos = this.host.nativeElement.children;

    for (let i = 0; i < elementos.length; i++) {
      const el = elementos[i] as HTMLElement;
      const hotspot = porId.get(el.dataset['hotspotId'] ?? '');
      if (!hotspot) continue;

      const ponto = projectToScreen(
        hotspotToWorld(hotspot.u, hotspot.v),
        camera,
        size.width,
        size.height,
      );

      // `display: none` e não `visibility: hidden` (handoff, §Integração item 5):
      // o pin fora de quadro sai também da ordem de tabulação, que é o que
      // impede o Tab de percorrer destinos que ninguém está vendo. Nenhuma cena
      // fica inalcançável por isso — a pill e o sheet Cenas listam todas.
      if (!ponto || !isWithinCanvas(ponto, size.width, size.height)) {
        el.style.display = 'none';
        continue;
      }

      el.style.display = 'flex';
      // O `translate(-50%, -50%)` vem DEPOIS: leva o centro do pin ao ponto, e
      // não o canto superior esquerdo dele.
      el.style.transform =
        `translate3d(${ponto.x}px, ${ponto.y}px, 0) translate(-50%, -50%)`;
    }
  }
}

/**
 * O lado do disco para um hotspot naquele pitch.
 *
 * Fora da classe porque não depende de nada dela, e porque assim o teste a
 * verifica sem montar componente nem WebGL.
 */
export function ladoDoDisco(v: number): number {
  const t = Math.min(Math.max((v - V_HORIZONTE) / (V_AOS_PES - V_HORIZONTE), 0), 1);
  return Math.round(LADO_LONGE + (LADO_PERTO - LADO_LONGE) * t);
}
