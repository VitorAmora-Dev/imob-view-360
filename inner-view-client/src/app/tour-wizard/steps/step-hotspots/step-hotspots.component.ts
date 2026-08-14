import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { HotspotOverlayComponent } from '../../hotspots/hotspot-overlay/hotspot-overlay.component';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Etapa 2 — Hotspots.
 *
 * DONO: Frente B. B1 e B2 de pé; faltam B5 a B12.
 *
 * O `HotspotEditorStore` é fornecido AQUI, e não na página: o estado de edição
 * não deve sobreviver a sair da etapa 2 e voltar.
 */
@Component({
  selector: 'app-tour-step-hotspots',
  standalone: true,
  imports: [TranslatePipe, PanoramicViewerComponent, HotspotOverlayComponent],
  providers: [HotspotEditorStore],
  template: `
    <header class="tw-step-head">
      <h2>{{ 'TOUR_WIZARD.STEP2.TITLE' | translate }}</h2>
      <p>{{ 'TOUR_WIZARD.STEP2.SUBTITLE' | translate }}</p>
    </header>

    @if (viewerPanoramas().length) {
      <div class="tw-viewer">
        <app-panoramic-viewer
          #viewer
          [panoramas]="viewerPanoramas()"
          [editMode]="true"
          (hotspotPlaced)="onPlaced($event)" />
        <app-hotspot-overlay [viewer]="viewer" [hotspots]="editor.hotspots()" />
      </div>

      <p class="tw-viewer__meta">
        {{ draft.selectedScene()?.room }} — {{ editor.hotspots().length }}
        {{ 'TOUR_WIZARD.STEP2.COUNT' | translate }}
      </p>
    } @else {
      <p class="tw-viewer__empty">{{ 'TOUR_WIZARD.STEP2.EMPTY' | translate }}</p>
    }
  `,
  styles: [
    `
      .tw-viewer {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        border-radius: 12px;
        background: #000;
      }

      /* TODO(B1): 4/3 no mobile, hachura e balão de dica do handoff. */
      @media (max-width: 767px) {
        .tw-viewer {
          aspect-ratio: 4 / 3;
        }
      }
    `,
  ],
})
export class StepHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);

  /**
   * A cena selecionada no formato que o viewer entende.
   *
   * `originHotspots` vai VAZIO de propósito: quem desenha os pontos é o overlay
   * HTML (B2). Deixar a lista cheia faria o viewer desenhar também os sprites
   * dele, e apareceriam dois pins por hotspot.
   */
  readonly viewerPanoramas = computed<Panorama[]>(() => {
    const scene = this.draft.selectedScene();
    if (!scene || scene.state !== 'ready') return [];

    return [
      {
        id: scene.id,
        roomName: scene.room,
        imageData: scene.imageData,
        order: scene.order,
        initialPanorama: true,
        originHotspots: [],
        measurements: [],
      },
    ];
  });

  /**
   * O viewer já entrega o par no formato do backend (`positionX`, e
   * `positionY` com o eixo vertical invertido). É o mesmo par que o
   * `WizardHotspot` guarda em `u`/`v` — não há conversão aqui.
   */
  onPlaced(event: { positionX: number; positionY: number }): void {
    this.editor.add(event.positionX, event.positionY);
  }
}
