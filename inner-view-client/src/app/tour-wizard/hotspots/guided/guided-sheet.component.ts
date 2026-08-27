import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DotState } from './guided-route';

/**
 * A gaveta do assistente: onde ficam o progresso e a decisao.
 *
 * Nao e um `IonModal`. O bottom sheet do editor livre e modal porque abre sobre
 * a foto e prende o foco enquanto se edita um ponto; aqui a gaveta e parte da
 * tela, sempre visivel, e um modal permanente prenderia o foco o tempo todo e
 * responderia ao Esc fechando o que nao deveria fechar.
 */
@Component({
  selector: 'app-guided-sheet',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './guided-sheet.component.html',
  styleUrls: ['./guided-sheet.component.scss'],
})
export class GuidedSheetComponent {
  readonly dots = input.required<DotState[]>();

  /** Nome do ambiente para onde a passagem leva. */
  readonly target = input.required<string>();
  readonly cor = input.required<string>();
  readonly ultimo = input.required<boolean>();

  /** Sem passagem marcada, o botao primario nao faz nada -- e diz isso. */
  readonly temPassagem = input.required<boolean>();

  readonly confirmar = output<void>();
  readonly refazer = output<void>();
}
