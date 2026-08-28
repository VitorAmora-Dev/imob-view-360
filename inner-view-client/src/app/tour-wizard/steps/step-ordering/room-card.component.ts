import { Component, computed, input, output } from '@angular/core';
import { IonReorder } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { WizardScene } from '../../tour-wizard.model';

/**
 * Um ambiente na tela de ordenacao.
 *
 * Recolhido mostra o que ja esta decidido: a posicao, a foto, o nome e com quem
 * conecta. Expandido da lugar a lista de destinos, que e filha e vem de fora --
 * este componente nao sabe escolher conexao, so mostrar e pedir.
 */
@Component({
  selector: 'app-room-card',
  standalone: true,
  imports: [TranslatePipe, IonReorder],
  templateUrl: './room-card.component.html',
  styleUrls: ['./room-card.component.scss'],
})
export class RoomCardComponent {
  readonly scene = input.required<WizardScene>();

  /** 1-based: e o que aparece no quadradinho. */
  readonly posicao = input.required<number>();
  readonly nomes = input.required<string[]>();
  readonly aberto = input.required<boolean>();

  readonly alternar = output<void>();

  readonly nome = computed(
    () => this.scene().room.trim() || this.scene().fileName,
  );

  readonly miniatura = computed(
    () => this.scene().treatedImageUrl || this.scene().imageData || null,
  );

  /**
   * A chave do resumo, escolhida no TypeScript.
   *
   * Tres casos e nao um com plural: "sem conexoes", "conecta com Cozinha" e
   * "conecta com Sala e Banheiro" tem estruturas diferentes em portugues, e
   * montar a frase no template exigiria concatenar string traduzida.
   */
  readonly resumoKey = computed(() => {
    const n = this.nomes().length;
    if (n === 0) return 'TOUR_WIZARD.STEP_ORDER.SUMMARY_NONE';
    if (n === 1) return 'TOUR_WIZARD.STEP_ORDER.SUMMARY_ONE';
    return 'TOUR_WIZARD.STEP_ORDER.SUMMARY_MANY';
  });

  /** "Sala e Banheiro" -- o "e" antes do ultimo, como se escreve. */
  readonly resumoParams = computed(() => {
    const lista = this.nomes();
    if (lista.length <= 1) return { nome: lista[0] ?? '' };
    return {
      nomes: lista.slice(0, -1).join(', '),
      ultimo: lista[lista.length - 1],
    };
  });
}
