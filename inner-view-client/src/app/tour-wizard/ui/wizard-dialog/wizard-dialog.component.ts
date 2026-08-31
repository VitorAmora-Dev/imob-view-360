import { Component, inject, input, output } from '@angular/core';
import { IonModal } from '@ionic/angular/standalone';
import { TranslateService } from '@ngx-translate/core';

import { WizardDialogBoxComponent } from './wizard-dialog-box.component';
import { AcaoDoDialogo, PerguntaDoWizard } from './wizard-dialog.model';

/**
 * O diálogo de decisão do wizard, na linguagem visual do wizard.
 *
 * DONO: Frente A.
 *
 * Substitui o `AlertController`. O `ion-alert` desenha o alerta do SISTEMA — no
 * Android, uma caixa Material com botões em CAIXA ALTA empilhados à direita,
 * que não é a cara de nenhuma outra superfície deste app e não aceita ícone
 * dentro do botão. Aqui a caixa é nossa (ver `WizardDialogBoxComponent`).
 *
 * `IonModal` continua por baixo, e de propósito — mesma decisão do
 * `hotspot-sheet` e do `property-filters-sheet`, pelo mesmo motivo: prender o
 * foco, fechar no Esc, devolver o foco a quem abriu, travar o scroll do fundo
 * e o scrim vêm prontos. O que se troca é a PINTURA, não o comportamento de
 * diálogo, que é a parte cara de acertar.
 *
 * Apresentacional puro: não conhece o rascunho, o store nem a rota. Recebe uma
 * pergunta e devolve a resposta; quem sabe o que ela significa é a página.
 */
@Component({
  selector: 'app-tw-wizard-dialog',
  templateUrl: './wizard-dialog.component.html',
  styleUrls: ['./wizard-dialog.component.scss'],
  standalone: true,
  imports: [IonModal, WizardDialogBoxComponent],
})
export class WizardDialogComponent {
  private readonly translate = inject(TranslateService);

  readonly pergunta = input<PerguntaDoWizard | null>(null);

  readonly escolheu = output<string>();
  readonly dispensou = output<PerguntaDoWizard>();

  /**
   * A pergunta que está MESMO na tela, capturada na apresentação.
   *
   * Não dá para ler `pergunta()` na hora de dispensar: o `didDismiss` do Ionic
   * chega depois da animação de saída, e nesse intervalo o input já pode
   * apontar para a pergunta SEGUINTE — sair salvando abre a de "não salvou"
   * quando a rede cai, dentro do mesmo gesto. Capturar aqui é o que faz a
   * saída de uma pergunta responder por ela, e só por ela.
   *
   * Zerada assim que uma resposta sai, para o `didDismiss` que vem logo atrás
   * (fechar o modal É dispensá-lo, aos olhos do Ionic) não responder de novo.
   */
  private emExibicao: PerguntaDoWizard | null = null;

  escolher(acao: AcaoDoDialogo): void {
    this.emExibicao = null;
    this.escolheu.emit(acao.id);
  }

  /** O X do cartão. */
  fechar(): void {
    // O `??` cobre o modal que ainda não anunciou `didPresent` — em teste, e
    // no toque rápido demais na animação de entrada.
    this.responderDispensa(this.emExibicao ?? this.pergunta());
  }

  /** Toque fora, Esc, e o voltar do Android. */
  aoDispensar(): void {
    this.responderDispensa(this.emExibicao);
  }

  /**
   * Dá nome ao diálogo, entrando no shadow DOM do Ionic.
   *
   * O `role="dialog"` não fica no `<ion-modal>`, e sim num `.modal-wrapper`
   * dentro do shadow root; `aria-label` no host nomeia o host, que é um nó
   * genérico, e `aria-labelledby` não atravessa fronteira de shadow. O
   * levantamento completo está em `hotspot-sheet.component.ts` — aqui é a
   * mesma solução, com o título da pergunta da vez.
   */
  aoApresentar(event: Event): void {
    const pergunta = this.pergunta();
    this.emExibicao = pergunta;
    if (!pergunta) return;

    (event.target as HTMLElement).shadowRoot
      ?.querySelector('.modal-wrapper')
      ?.setAttribute('aria-label', this.translate.instant(pergunta.tituloKey));
  }

  private responderDispensa(exibida: PerguntaDoWizard | null): void {
    this.emExibicao = null;
    if (exibida) this.dispensou.emit(exibida);
  }
}
