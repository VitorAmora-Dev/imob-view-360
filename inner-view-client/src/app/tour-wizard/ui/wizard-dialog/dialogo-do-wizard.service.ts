import { Injectable, signal } from '@angular/core';
import { PerguntaDoWizard } from './wizard-dialog.model';

/**
 * A ponte entre "quero perguntar e esperar a resposta" e "há uma pergunta na
 * tela".
 *
 * DONO: Frente A.
 *
 * Quem decide se dá para sair do wizard é um `CanDeactivate`, e um guard fala
 * promise: ou ele recebe a resposta, ou a navegação fica pendurada. Quem
 * desenha o diálogo fala signal, como o resto do wizard. Este serviço é a
 * tradução entre os dois, e é a única coisa no app que conhece as duas pontas.
 *
 * Fornecido PELA PÁGINA (`providers: [...]`), não em `root`, pelo mesmo motivo
 * do `TourDraftStore`: a pergunta pertence à tela e morre com ela. Em `root`,
 * uma pergunta deixada aberta por uma navegação abrupta sobreviveria à página
 * que a fez.
 *
 * Ele não sabe o que está perguntando, e o componente não sabe o que a
 * resposta significa. Quem sabe as duas coisas é a página — que é onde a regra
 * de negócio deve estar.
 */
@Injectable()
export class DialogoDoWizard {
  private readonly aberta = signal<PerguntaDoWizard | null>(null);

  /** A pergunta na tela, ou `null`. É o que o template liga no componente. */
  readonly pergunta = this.aberta.asReadonly();

  private responder: ((escolha: string | null) => void) | null = null;

  /**
   * Abre a pergunta e resolve com o `id` da ação escolhida — ou `null` quando
   * a pessoa dispensou o diálogo (X, toque fora, Esc).
   *
   * Uma pergunta de cada vez: se outra chega com uma aberta, a primeira é
   * respondida com `null`. É a mesma regra que o próprio diálogo aplica na
   * tela (só um pode estar visível), e sem ela a promise da primeira ficaria
   * pendurada para sempre — no caso do guard, prendendo a navegação junto.
   */
  perguntar(pergunta: PerguntaDoWizard): Promise<string | null> {
    this.responderCom(null);

    return new Promise<string | null>((resolve) => {
      this.responder = resolve;
      this.aberta.set(pergunta);
    });
  }

  /** Uma das ações foi tocada. */
  escolher(id: string): void {
    this.aberta.set(null);
    this.responderCom(id);
  }

  /**
   * O diálogo foi dispensado sem escolha.
   *
   * Recebe a pergunta QUE ESTAVA NA TELA, e não é enfeite de assinatura: o
   * `didDismiss` do Ionic chega depois da animação de saída, e a essa altura
   * uma segunda pergunta já pode ter aberto — sair salvando abre a de "não
   * salvou" quando a rede cai, no mesmo gesto. Sem conferir a identidade, a
   * saída da primeira cancelaria a segunda, e o corretor sairia sem ler o
   * aviso que a segunda existe para dar.
   */
  dispensar(pergunta: PerguntaDoWizard): void {
    if (this.aberta() !== pergunta) return;

    this.aberta.set(null);
    this.responderCom(null);
  }

  private responderCom(escolha: string | null): void {
    const responder = this.responder;
    this.responder = null;
    responder?.(escolha);
  }
}
