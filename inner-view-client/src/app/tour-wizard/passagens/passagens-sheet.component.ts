import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Passagem, nomeDoAmbiente } from './fila';

/**
 * O painel inferior da etapa de passagens.
 *
 * Diferente da gaveta do assistente anterior num ponto que muda o desenho: aqui
 * ha uma LISTA de destinos ainda pendentes na mesma foto. E ela que responde
 * "quantas faltam nesta sala", pergunta que nao existia quando cada ambiente
 * tinha uma passagem so.
 *
 * Nao e um `IonModal`: e parte da tela, sempre visivel. Um modal permanente
 * prenderia o foco o tempo todo e fecharia no Esc.
 */
@Component({
  selector: 'app-passagens-sheet',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './passagens-sheet.component.html',
  styleUrls: ['./passagens-sheet.component.scss'],
})
export class PassagensSheetComponent {
  readonly pendentes = input.required<readonly Passagem[]>();
  readonly feitas = input.required<number>();
  readonly total = input.required<number>();
  readonly temPonto = input.required<boolean>();

  readonly confirmar = output<void>();
  readonly refazer = output<void>();
  readonly voltar = output<void>();

  readonly nome = nomeDoAmbiente;
}
