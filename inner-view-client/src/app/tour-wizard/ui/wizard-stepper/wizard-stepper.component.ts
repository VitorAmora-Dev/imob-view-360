import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { TOTAL_ETAPAS, WizardStep } from '../../tour-wizard.model';

/** Os quatro estados visuais de um chip, na ordem em que o handoff os define. */
export type ChipState = 'done' | 'current' | 'reachable' | 'blocked';

/**
 * Stepper do wizard: os três chips e a barra de progresso.
 *
 * DONO: Frente A (tarefa A2).
 *
 * O stepper é INDICADOR DE ESTADO, não comando. Ele navega — clicar num chip
 * alcançável volta àquela etapa —, mas nenhuma ação primária mora aqui: avançar
 * e publicar ficam no rodapé, depois do conteúdo que os confirma.
 */
@Component({
  selector: 'app-wizard-stepper',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './wizard-stepper.component.html',
  styleUrls: ['./wizard-stepper.component.scss'],
})
export class WizardStepperComponent {
  readonly store = inject(TourDraftStore);
  readonly steps: WizardStep[] = [1, 2, 3, 4];

  /** O total vem da constante, e não do template. Ver `TOTAL_ETAPAS`. */
  readonly total = TOTAL_ETAPAS;

  stateOf(step: WizardStep): ChipState {
    const current = this.store.step();
    if (step < current) return 'done';
    if (step === current) return 'current';
    return this.store.canReach(step) ? 'reachable' : 'blocked';
  }

  /**
   * Chip bloqueado continua focável, com `aria-disabled`, em vez de levar o
   * atributo `disabled`.
   *
   * `disabled` tira o botão da ordem de tabulação: quem navega por teclado ou
   * leitor de tela deixaria de saber que as etapas 2 e 3 existem, e o motivo de
   * não dar para ir ("Envie ao menos uma foto") está justo ao lado, na dica da
   * barra de progresso. Some a informação e o remédio de uma vez. Focável e
   * inerte anuncia as duas coisas.
   */
  onChip(step: WizardStep): void {
    if (!this.store.canReach(step)) return;
    this.store.goTo(step);
  }
}
