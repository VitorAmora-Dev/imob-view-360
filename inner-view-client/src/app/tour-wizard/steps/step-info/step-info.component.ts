import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Etapa 3 — Informações do imóvel.
 *
 * DONO: Frente A. STUB do commit-zero — tarefas A9 e A10.
 *
 * Falta: formulário (nome, tipo, finalidade), acordeão de endereço com autofill
 * por CEP via `CepService` (incluindo os estados de carregando e não
 * encontrado, que o protótipo não mostra) e o card "Resumo do tour".
 */
@Component({
  selector: 'app-tour-step-info',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <header class="tw-step-head">
      <h2>{{ 'TOUR_WIZARD.STEP3.TITLE' | translate }}</h2>
      <p>{{ 'TOUR_WIZARD.STEP3.SUBTITLE' | translate }}</p>
    </header>

    <p>
      {{ store.readyScenes().length }}
      {{ 'TOUR_WIZARD.STEP3.SUMMARY_SCENES' | translate }} ·
      {{ store.totalHotspots() }}
      {{ 'TOUR_WIZARD.STEP3.SUMMARY_HOTSPOTS' | translate }}
    </p>
  `,
})
export class StepInfoComponent {
  readonly store = inject(TourDraftStore);
}
