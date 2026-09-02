import { Injectable, signal } from '@angular/core';

/**
 * Qual sheet do visualizador está aberto — nenhum, ou um.
 *
 * É um `signal` de um valor só, e essa é a decisão: não existe estado em que
 * dois sheets estejam abertos, porque não há onde guardar o segundo. O
 * critério "abrir um segundo sheet não empilha" fica verdadeiro por
 * construção, e não por disciplina de quem escreve o próximo sheet.
 *
 * O shell (`TourSheetComponent`) NÃO depende deste store: ele recebe `isOpen`
 * pronto. Quem liga os dois é cada consumidor, com
 * `[isOpen]="store.aberto() === 'cenas'"`. Assim TV-4, TV-5 e TV-6 são
 * arquivos novos que não editam nem o shell nem este arquivo.
 *
 * Um `signal` e não uma pilha porque nenhum sheet do sprint abre outro. Sem
 * navegação entre sheets não há para onde voltar, e uma pilha inventaria um
 * botão de volta que nenhuma tela pede.
 */
@Injectable({ providedIn: 'root' })
export class TourSheetStore {
  private readonly _aberto = signal<string | null>(null);

  /** Id do sheet aberto, ou `null`. */
  readonly aberto = this._aberto.asReadonly();

  /** Abre um sheet. Se outro estiver aberto, ele é substituído. */
  abrir(id: string): void {
    this._aberto.set(id);
  }

  fechar(): void {
    this._aberto.set(null);
  }
}
