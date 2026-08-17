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
   * "Pular" só existe na etapa 2, e só enquanto ela é de fato pulável — ou
   * seja, com UM ambiente, onde não há destino possível para ponto nenhum.
   *
   * Com dois ou mais, pular passou a ser mentira: o visitante não teria como
   * sair do ambiente inicial, porque o viewer não tem outra navegação. Um botão
   * que oferece um caminho bloqueado é pior do que botão nenhum.
   *
   * E some assim que o ambiente ganha um ponto: com um ponto criado, pular
   * deixa de ser a saída óbvia e o botão vira ruído ao lado de "Próximo".
   */
  readonly showSkip = computed(
    () =>
      this.store.step() === 2 &&
      this.store.readyScenes().length < 2 &&
      (this.store.selectedScene()?.hotspots.length ?? 0) === 0,
  );

  readonly primaryDisabled = computed(
    () => !this.store.canAdvance() || this.store.publishing(),
  );

  /**
   * Por que o botão está desligado, para o `title` do hover.
   *
   * A falta de imagem e a falta de ligação travam o mesmo botão por motivos
   * diferentes, e a frase genérica de antes ("envie uma imagem") mandaria o
   * corretor para a etapa errada.
   */
  readonly motivoBloqueio = computed(() => {
    if (!this.store.temImagem()) return 'TOUR_WIZARD.COMMON.NEEDS_IMAGE';
    if (this.store.step() === 1 && this.store.ambientesSemNome().length) {
      return 'TOUR_WIZARD.STEP1.NEEDS_NAMES';
    }
    if (this.store.step() === 2 && this.store.ambientesIlhados().length) {
      return 'TOUR_WIZARD.STEP2.NEEDS_LINKS';
    }
    return null;
  });
}
