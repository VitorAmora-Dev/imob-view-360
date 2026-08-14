import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Barra de ação do rodapé.
 *
 * DONO: Frente A (tarefa A3).
 *
 * A ação primária fica AQUI, no desktop e no mobile — nunca junto à barra de
 * progresso. Progresso é indicador de estado, não comando, e a ação tem que vir
 * depois do conteúdo que a confirma. Consistência deliberada entre plataformas.
 */
@Component({
  selector: 'app-wizard-actions',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './wizard-actions.component.html',
  styleUrls: ['./wizard-actions.component.scss'],
})
export class WizardActionsComponent {
  readonly store = inject(TourDraftStore);

  readonly primaryLabelKey = computed(() =>
    this.store.step() === 3
      ? 'TOUR_WIZARD.COMMON.PUBLISH'
      : 'TOUR_WIZARD.COMMON.NEXT',
  );

  /**
   * "Pular" só existe na etapa 2, e só enquanto o ambiente não tem ponto
   * nenhum: com um ponto já criado, pular deixa de ser a saída óbvia e o botão
   * vira ruído ao lado de "Próximo".
   */
  readonly showSkip = computed(
    () =>
      this.store.step() === 2 &&
      (this.store.selectedScene()?.hotspots.length ?? 0) === 0,
  );

  readonly primaryDisabled = computed(
    () => !this.store.canAdvance() || this.store.publishing(),
  );
}
