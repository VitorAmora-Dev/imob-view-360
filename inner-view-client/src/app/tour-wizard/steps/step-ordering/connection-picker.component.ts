import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { nomeDoAmbiente } from '../../passagens/fila';
import { WizardScene } from '../../tour-wizard.model';

/** Uma opcao de destino, com o nome resolvido e o estado de selecao. */
export interface OpcaoDeDestino {
  readonly id: string;
  readonly nome: string;
  readonly miniatura: string | null;
  readonly escolhido: boolean;
}

/**
 * A lista de destinos de um ambiente, com selecao multipla.
 *
 * O ambiente atual nunca aparece: um ponto que leva a si mesmo nao leva a lugar
 * nenhum, e a regra pura ja recusa -- mas oferecer e recusar e pior do que nao
 * oferecer.
 */
@Component({
  selector: 'app-connection-picker',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './connection-picker.component.html',
  styleUrls: ['./connection-picker.component.scss'],
})
export class ConnectionPickerComponent {
  readonly scene = input.required<WizardScene>();
  readonly todas = input.required<readonly WizardScene[]>();

  /** Emite o id do destino tocado -- ligar ou desligar e de quem ouve. */
  readonly alternar = output<string>();

  readonly opcoes = computed<OpcaoDeDestino[]>(() => {
    const atual = this.scene();
    const escolhidos = new Set(atual.connections ?? []);

    return this.todas()
      .filter((s) => s.id !== atual.id && s.state === 'ready')
      .map((s) => ({
        id: s.id,
        nome: nomeDoAmbiente(s),
        miniatura: s.treatedImageUrl || s.imageData || null,
        escolhido: escolhidos.has(s.id),
      }));
  });
}
