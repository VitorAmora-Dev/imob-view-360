import { Component, effect, input, output, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';

import { TrashIconComponent } from '../trash-icon/trash-icon.component';
import { AcaoDoDialogo, PerguntaDoWizard } from './wizard-dialog.model';

/**
 * O CARTÃO do diálogo: título, mensagem, X e a linha de ações.
 *
 * DONO: Frente A.
 *
 * Separado do `WizardDialogComponent` — que é só a casca do `IonModal` — por
 * dois motivos que andam juntos. Um é responsabilidade: aqui está o desenho, e
 * lá está o comportamento de sobreposição (foco preso, Esc, scrim, scroll
 * travado), que é do Ionic. O outro é que o conteúdo de um `ion-modal` mora
 * dentro de um `<ng-template>` e só existe no DOM depois de o modal apresentar
 * — assíncrono, e com o foco do documento inteiro em jogo. Sozinho, o cartão
 * renderiza num `detectChanges()`, e o que o corretor vê pode ser testado de
 * verdade: dois botões, a ordem deles, quem é azul, quem tem a lixeira.
 */
@Component({
  selector: 'app-tw-wizard-dialog-box',
  templateUrl: './wizard-dialog-box.component.html',
  styleUrls: ['./wizard-dialog-box.component.scss'],
  standalone: true,
  imports: [IonIcon, TranslatePipe, TrashIconComponent],
})
export class WizardDialogBoxComponent {
  readonly pergunta = input.required<PerguntaDoWizard>();

  readonly escolheu = output<AcaoDoDialogo>();
  readonly fechou = output<void>();

  /** Rótulo do X quando a pergunta não traz um seu. */
  readonly fecharPadrao = 'TOUR_WIZARD.COMMON.DIALOG_CLOSE';

  private readonly acaoArmada = signal<AcaoDoDialogo | null>(null);

  /** A ação que já recebeu o primeiro toque e espera o segundo, ou `null`. */
  readonly armada = this.acaoArmada.asReadonly();

  constructor() {
    addIcons({ closeOutline });

    // Pergunta nova chega sempre desarmada.
    //
    // Não é zelo à toa: o cartão NÃO é necessariamente recriado entre duas
    // perguntas. `perguntar()` troca a pergunta aberta sem passar por `null`,
    // e quando isso acontece dentro do mesmo gesto — sair salvando abre a de
    // "não salvou" quando a rede cai — o `@if` da casca nunca chega a ver o
    // vazio, e esta instância sobrevive. Sem isto, a segunda pergunta herdaria
    // um botão armado que ninguém armou.
    effect(() => {
      this.pergunta();
      this.acaoArmada.set(null);
    });
  }

  /**
   * Um toque numa ação: responde, ou arma a confirmação.
   *
   * Ações com `confirmaKey` custam dois toques. O primeiro só troca o rótulo —
   * nada acontece —, e é isso que separa "quis apagar" de "errou a mira". A
   * ação segura ao lado continua viva o tempo todo: armar não pode virar uma
   * armadilha onde a única saída é confirmar.
   */
  tocar(acao: AcaoDoDialogo): void {
    if (acao.confirmaKey && this.acaoArmada()?.id !== acao.id) {
      this.acaoArmada.set(acao);
      return;
    }

    this.acaoArmada.set(null);
    this.escolheu.emit(acao);
  }

  /**
   * Tirar o foco do botão desarma.
   *
   * É a saída de quem navega por teclado e mudou de ideia — sem ela, o Tab
   * deixaria para trás um botão armado, e voltar a ele com Shift+Tab e apertar
   * Enter apagaria sem aviso. No celular a saída é outra e já existe: o X, o
   * toque fora e a ação segura ao lado.
   */
  desarmar(): void {
    this.acaoArmada.set(null);
  }
}
