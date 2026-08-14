import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Card "Resumo do tour" da etapa 3.
 *
 * DONO: Frente A (tarefa A10).
 *
 * Existe para o corretor confirmar o que está prestes a publicar sem voltar
 * duas etapas. É por isso que a contagem de hotspots é a soma de TODOS os
 * ambientes, e não a do que estava aberto na etapa 2: aqui a pergunta é
 * "o tour está pronto?", não "este ambiente está pronto?".
 */
@Component({
  selector: 'app-tour-summary',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './tour-summary.component.html',
  styleUrls: ['./tour-summary.component.scss'],
})
export class TourSummaryComponent {
  readonly store = inject(TourDraftStore);

  readonly coverUrl = computed(() => this.store.coverScene()?.imageData ?? null);

  readonly coverName = computed(() => this.store.coverScene()?.room?.trim() || null);

  readonly roomsKey = computed(() =>
    this.store.readyScenes().length === 1
      ? 'TOUR_WIZARD.STEP1.SCENES_COUNT_ONE'
      : 'TOUR_WIZARD.STEP1.SCENES_COUNT',
  );
}
