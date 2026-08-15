import { Component, ElementRef, effect, inject, input } from '@angular/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { WizardHotspot } from '../../tour-wizard.model';
import {
  hotspotToWorld,
  isWithinCanvas,
  projectToScreen,
} from '../hotspot-projection';

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
    @for (hotspot of hotspots(); track hotspot.id) {
      <button #pin type="button" class="tw-pin" [attr.data-hotspot-id]="hotspot.id">
        {{ hotspot.label || $index + 1 }}
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
    `,
  ],
})
export class HotspotOverlayComponent {
  readonly hotspots = input<WizardHotspot[]>([]);
  readonly viewer = input<PanoramicViewerComponent | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect((onCleanup) => {
      const viewer = this.viewer();
      if (!viewer) return;

      const stop = viewer.onFrame(() => this.reposition(viewer));
      onCleanup(stop);
    });
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
      el.style.transform =
        `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%)`;
    }
  }
}
