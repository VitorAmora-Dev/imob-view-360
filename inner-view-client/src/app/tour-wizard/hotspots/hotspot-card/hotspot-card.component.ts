import { Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { WizardHotspot } from '../../tour-wizard.model';

/**
 * O card de um ponto: nome, destino e excluir.
 *
 * DONO: Frente B.
 *
 * Nasceu dentro do painel do desktop (B6) e saiu de lá quando o bottom sheet
 * (B8) precisou do mesmo card: o telefone edita o MESMO ponto que o desktop, e
 * duas cópias do formulário divergiriam na primeira mudança de regra — o aviso
 * de ponto sem destino, a explicação do tour de um ambiente só, o `[selected]`
 * de cada opção. Cada um desses foi um bug ou quase.
 *
 * Fala com o store direto em vez de emitir eventos: o `HotspotEditorStore` é
 * fornecido na etapa e é o único lugar que muta hotspot, então repassar por
 * output só somaria um degrau sem decisão nenhuma no meio.
 */
@Component({
  selector: 'app-hotspot-card',
  standalone: true,
  imports: [TranslatePipe],
  // A classe fica no host para que quem lista os cards não precise de um
  // invólucro só para estilizá-los.
  host: { class: 'tw-hp__card' },
  templateUrl: './hotspot-card.component.html',
  styleUrls: ['./hotspot-card.component.scss'],
})
export class HotspotCardComponent {
  readonly hotspot = input.required<WizardHotspot>();
  /** Posição na lista do ambiente — é o rótulo visível do ponto. */
  readonly index = input.required<number>();

  private readonly editor = inject(HotspotEditorStore);

  readonly targets = computed(() => this.editor.targetOptions());

  /**
   * Não há para onde apontar quando o tour tem um ambiente só.
   *
   * O select fica de fora nesse caso, com uma explicação no lugar: um campo
   * vazio e sem opções faz o corretor procurar o que fez de errado, quando na
   * verdade falta uma foto na etapa 1.
   */
  readonly hasTargets = computed(() => this.targets().length > 0);

  onLabel(event: Event): void {
    this.editor.update(this.hotspot().id, {
      label: (event.target as HTMLInputElement).value,
    });
  }

  /** `''` no select é "sem destino", que é um estado válido — e o inicial. */
  onTarget(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.editor.update(this.hotspot().id, { target: value || null });
  }

  remove(): void {
    this.editor.remove(this.hotspot().id);
  }
}
