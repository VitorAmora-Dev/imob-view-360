import { Component, computed, inject, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { HotspotOverlayComponent } from '../../hotspots/hotspot-overlay/hotspot-overlay.component';
import { HotspotPanelComponent } from '../../hotspots/hotspot-panel/hotspot-panel.component';
import { HotspotSheetComponent } from '../../hotspots/hotspot-sheet/hotspot-sheet.component';
import { HotspotSummaryRowComponent } from '../../hotspots/hotspot-summary-row/hotspot-summary-row.component';
import { HotspotTrashComponent } from '../../hotspots/hotspot-trash/hotspot-trash.component';
import { SceneRailComponent } from '../../hotspots/scene-rail/scene-rail.component';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Etapa 2 — Hotspots.
 *
 * DONO: Frente B. B1 a B8 de pé; faltam B9, B10 e o resto do B12.
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
    HotspotSummaryRowComponent,
    HotspotSheetComponent,
    HotspotTrashComponent,
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

  /** Nomes por id, para o pin poder dizer para onde leva (a11y). */
  readonly roomNames = computed<Record<string, string>>(() => {
    const mapa: Record<string, string> = {};
    for (const s of this.draft.readyScenes()) mapa[s.id] = s.room;
    return mapa;
  });

  /**
   * Clique no pin (B4).
   *
   * Com destino, NAVEGA — e nunca abre o editor. É regra dura do DoD, e a
   * razão é que este é o único lugar onde o corretor confere o que o visitante
   * vai viver: se clicar num ponto abrisse um formulário, ele nunca veria o
   * tour funcionando enquanto o monta.
   *
   * Sem destino não há para onde ir, e aí o clique vira o que resta de útil:
   * abrir a edição daquele ponto.
   */
  onPinActivated(hotspotId: string): void {
    const hotspot = this.editor.hotspots().find((h) => h.id === hotspotId);
    if (!hotspot) return;

    if (hotspot.target) {
      this.editor.closeSheet();
      this.draft.selectScene(hotspot.target);
      return;
    }

    this.editor.openEditor(hotspotId);
  }

  private readonly trash = viewChild(HotspotTrashComponent);

  /**
   * O ponto seguiu o dedo (B9) e, de quebra, a lixeira responde (B10).
   *
   * O hit test é da lixeira, que conhece o próprio retângulo; a etapa é só quem
   * junta as duas pontas, porque é ela que tem as duas na mão. Isso mantém o
   * overlay sem saber que existe lixeira e a lixeira sem saber que existe
   * arraste.
   */
  onPinDragMoved(event: {
    u: number;
    v: number;
    clientX: number;
    clientY: number;
  }): void {
    this.editor.dragTo(event.u, event.v);
    this.editor.setOverTrash(
      this.trash()?.contains(event.clientX, event.clientY) ?? false,
    );
  }
}
