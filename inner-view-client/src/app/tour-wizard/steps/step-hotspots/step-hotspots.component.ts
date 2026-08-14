import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Etapa 2 — Hotspots.
 *
 * DONO: Frente B. STUB do commit-zero — tarefas B1 a B12.
 *
 * Falta tudo: viewer com `PanoramicViewerComponent` em `editMode`, overlay HTML
 * dos pins, rail de ambientes, painel do desktop, linha-resumo e bottom sheet
 * do mobile, e o gesto de arrastar até a lixeira.
 *
 * O `HotspotEditorStore` é fornecido AQUI, e não na página: o estado de edição
 * não deve sobreviver a sair da etapa 2 e voltar.
 */
@Component({
  selector: 'app-tour-step-hotspots',
  standalone: true,
  imports: [TranslatePipe],
  providers: [HotspotEditorStore],
  template: `
    <header class="tw-step-head">
      <h2>{{ 'TOUR_WIZARD.STEP2.TITLE' | translate }}</h2>
      <p>{{ 'TOUR_WIZARD.STEP2.SUBTITLE' | translate }}</p>
    </header>

    <p>
      {{ draft.selectedScene()?.room }} — {{ editor.hotspots().length }}
      {{ 'TOUR_WIZARD.STEP2.COUNT' | translate }}
    </p>
  `,
})
export class StepHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);
}
