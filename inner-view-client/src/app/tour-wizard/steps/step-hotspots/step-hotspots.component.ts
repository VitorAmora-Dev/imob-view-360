import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { HotspotOverlayComponent } from '../../hotspots/hotspot-overlay/hotspot-overlay.component';
import { HotspotPanelComponent } from '../../hotspots/hotspot-panel/hotspot-panel.component';
import { SceneRailComponent } from '../../hotspots/scene-rail/scene-rail.component';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Etapa 2 — Hotspots.
 *
 * DONO: Frente B. B1, B2, B5 e B6 de pé; faltam B4 (navegar no pin), B7 a B10
 * e B12.
 *
 * O `HotspotEditorStore` é fornecido AQUI, e não na página: o estado de edição
 * não deve sobreviver a sair da etapa 2 e voltar.
 */
@Component({
  selector: 'app-tour-step-hotspots',
  standalone: true,
  imports: [
    TranslatePipe,
    PanoramicViewerComponent,
    HotspotOverlayComponent,
    SceneRailComponent,
    HotspotPanelComponent,
  ],
  providers: [HotspotEditorStore],
  templateUrl: './step-hotspots.component.html',
  styleUrls: ['./step-hotspots.component.scss'],
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
