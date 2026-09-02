import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { TOTAL_ETAPAS } from '../../tour-wizard.model';

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
export class WizardActionsComponent implements OnDestroy {
  readonly store = inject(TourDraftStore);
  readonly blockedFeedback = signal<string | null>(null);
  private feedbackTimer: number | null = null;

  /**
   * Quem publica é a ÚLTIMA etapa, hoje a 4.
   *
   * Ficou em 3 na renumeração, e a etapa de passagens passou a anunciar
   * "Publicar tour" num botão que só avançava. Prometer a ação final e entregar
   * outra tela é pior do que um rótulo feio: quem aperta acha que terminou.
   */
  readonly primaryLabelKey = computed(() => {
    if (this.store.step() === 1) return 'TOUR_WIZARD.COMMON.DONE';
    if (this.store.step() !== TOTAL_ETAPAS) return 'TOUR_WIZARD.COMMON.NEXT';

    // Em edição o tour já está no ar: prometer "Publicar" seria descrever uma
    // ação que não vai acontecer, e deixaria o corretor achando que o link
    // muda ou que o tour sai e volta do ar.
    return this.store.editando()
      ? 'TOUR_WIZARD.COMMON.SAVE_CHANGES'
      : 'TOUR_WIZARD.COMMON.PUBLISH';
  });

  /**
   * "Pular" só existe na etapa de PASSAGENS, e só enquanto ela é de fato
   * pulável — ou seja, com UM ambiente, onde não há destino possível.
   *
   * Apontava para a etapa 2, que hoje é a ordenação: o botão aparecia na tela
   * errada, oferecendo pular o que nem era pulável.
   *
   * Com dois ou mais, pular passou a ser mentira: o visitante não teria como
   * sair do ambiente inicial, porque o viewer não tem outra navegação. Um botão
   * que oferece um caminho bloqueado é pior do que botão nenhum.
   *
   * E some assim que o ambiente ganha um ponto: com um ponto criado, pular
   * deixa de ser a saída óbvia e o botão vira ruído ao lado de "Próximo".
   */
  readonly showSkip = computed(
    () => this.store.step() === 3 && this.store.etapaPassagensOpcional(),
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
   *
   * Cada etapa tem a SUA frase porque tem o seu conserto: na ordenação falta
   * escolher com quem o ambiente se conecta; nas passagens falta marcar onde
   * fica a porta. Depois da renumeração este método só perguntava pela etapa 2,
   * então a 3 travava em silêncio — botão apagado e nenhuma palavra na tela,
   * que é o que o comentário do próprio template existe para evitar.
   */
  readonly motivoBloqueio = computed(() => {
    if (!this.store.temImagem()) return 'TOUR_WIZARD.COMMON.NEEDS_IMAGE';
    if (this.store.step() === 1 && this.store.ambientesSemNome().length) {
      return 'TOUR_WIZARD.STEP1.NEEDS_NAMES';
    }
    if (this.store.step() === 2 && this.store.ilhadosPorConexao().length) {
      return 'TOUR_WIZARD.STEP_ORDER.NEEDS_LINKS';
    }
    if (this.store.step() === 3 && this.store.ambientesIlhados().length) {
      return 'TOUR_WIZARD.PASSAGES.NEEDS_LINKS';
    }
    return null;
  });

  onPrimaryClick(): void {
    if (this.store.publishing()) return;

    if (!this.store.canAdvance()) {
      // `next()` marca os campos que precisam de correção. Na etapa de
      // imagens somamos uma explicação breve e temporária, porque ali o botão
      // apagado continua tocável justamente para responder "por quê?".
      this.store.next();
      if (this.store.step() === 1) this.showBlockedFeedback();
      return;
    }

    this.blockedFeedback.set(null);
    this.store.next();
  }

  ngOnDestroy(): void {
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
  }

  private showBlockedFeedback(): void {
    const key = this.motivoBloqueio();
    if (!key) return;

    this.blockedFeedback.set(key);
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => {
      this.blockedFeedback.set(null);
      this.feedbackTimer = null;
    }, 2800);
  }
}
