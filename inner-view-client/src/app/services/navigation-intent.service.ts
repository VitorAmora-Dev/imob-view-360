import { Injectable } from '@angular/core';

/**
 * Carrega a intenção de uma navegação — "abri esta página querendo já fazer X" —
 * entre quem navega e quem chega.
 *
 * **Por que não router state.** A primeira versão levava a intenção em
 * `router.navigate(..., { state })`, apostando que ela morreria no refresh. Não
 * morre: o `navigateToSyncWithBrowser()` do Angular copia `history.state` de
 * volta para `extras.state` a cada bootstrap, e o navegador preserva
 * `history.state` através do reload. Medido em navegador de verdade — o seletor
 * de imagem reabria em TODO refresh subsequente daquela entrada de histórico, e
 * também na volta pelo botão do navegador.
 *
 * **Por que memória.** Um valor em memória morre no reload por construção, que
 * é a semântica que se quer: a intenção pertence àquela navegação, e a nenhuma
 * outra. Não depende de ninguém lembrar de limpar.
 */
@Injectable({ providedIn: 'root' })
export class NavigationIntentService {
  private pending: { targetId: string; action: string } | null = null;

  /** Registrado imediatamente antes de navegar. */
  register(targetId: string, action: string): void {
    this.pending = { targetId, action };
  }

  /**
   * Consome de uma vez só: a segunda leitura devolve `null`.
   *
   * O `targetId` é conferido porque uma navegação abortada — por um guard, por
   * exemplo — deixaria a intenção pendurada, e sem essa conferência ela
   * dispararia na próxima página que perguntasse.
   */
  consume(targetId: string): string | null {
    if (this.pending?.targetId !== targetId) return null;
    const { action } = this.pending;
    this.pending = null;
    return action;
  }
}
