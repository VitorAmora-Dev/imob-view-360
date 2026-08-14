import {
  Component,
  ElementRef,
  effect,
  input,
  viewChildren,
} from '@angular/core';
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
      }
    `,
  ],
})
export class HotspotOverlayComponent {
  readonly hotspots = input<WizardHotspot[]>([]);
  readonly viewer = input<PanoramicViewerComponent | null>(null);

  private readonly pins =
    viewChildren<ElementRef<HTMLButtonElement>>('pin');

  constructor() {
    effect((onCleanup) => {
      const viewer = this.viewer();
      if (!viewer) return;

      const stop = viewer.onFrame(() => this.reposition(viewer));
      onCleanup(stop);
    });
  }

  private reposition(viewer: PanoramicViewerComponent): void {
    const camera = viewer.viewerCamera;
    const size = viewer.viewerSize;
    if (!camera || !size) return;

    const hotspots = this.hotspots();
    const elements = this.pins();

    for (let i = 0; i < elements.length; i++) {
      const hotspot = hotspots[i];
      if (!hotspot) continue;
      const el = elements[i].nativeElement;

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
