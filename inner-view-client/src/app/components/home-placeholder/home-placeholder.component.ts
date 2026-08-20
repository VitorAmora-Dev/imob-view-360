import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Bloco que ocupa o lugar do conteúdo quando ele não existe: carregando, erro,
 * conta vazia e busca sem resultado.
 *
 * Não injeta Router nem serviço — quem navega ou refaz a chamada é a HomePage.
 * O componente é desenho, e nada mais.
 */
@Component({
  selector: 'app-home-placeholder',
  templateUrl: './home-placeholder.component.html',
  styleUrls: ['./home-placeholder.component.scss'],
  standalone: true,
  imports: [IonIcon, IonSpinner, TranslatePipe],
})
export class HomePlaceholderComponent {
  /** Nome do ionicon. Sem ícone quando ausente. */
  @Input() icon?: string;
  /** Mostra o spinner no lugar do ícone. */
  @Input() spinner = false;
  /**
   * Chama-se `heading`, e não `title`, de propósito: `title` é atributo global
   * do HTML, e um chamador que escrevesse `title="HOME.EMPTY_TITLE"` sem
   * colchetes — a forma idiomática para valor literal — deixaria a chave crua
   * como atributo no host, e o navegador mostraria um tooltip nativo escrito
   * "HOME.EMPTY_TITLE".
   */
  @Input() heading?: string;
  /** Obrigatório: os quatro estados têm texto, e um `<p>` mudo não é estado. */
  @Input({ required: true }) text!: string;
  /** Parâmetros de interpolação do `text` (ex.: `{ query: 'sala' }`). */
  @Input() textParams: Record<string, unknown> = {};
  /** Sem rótulo, nenhuma ação é renderizada. */
  @Input() actionLabel?: string;

  @Output() action = new EventEmitter<void>();
}
