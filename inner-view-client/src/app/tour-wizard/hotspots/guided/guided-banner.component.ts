import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * A instrucao do passo, sobre a foto.
 *
 * `role="status"` e nao `alert`: a instrucao muda a cada passo e precisa ser
 * anunciada, mas esperando a vez -- interromper o leitor de tela a cada avanco
 * atropelaria a leitura do que a pessoa esta fazendo.
 */
@Component({
  selector: 'app-guided-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './guided-banner.component.html',
  styleUrls: ['./guided-banner.component.scss'],
})
export class GuidedBannerComponent {
  /** Nome do ambiente para onde a passagem leva. */
  readonly target = input.required<string>();

  /** Token de cor do ambiente alvo. Vem de `corDoAmbiente()`. */
  readonly cor = input.required<string>();

  /** No ultimo passo a instrucao muda: e a passagem de volta ao primeiro. */
  readonly ultimo = input.required<boolean>();
}
