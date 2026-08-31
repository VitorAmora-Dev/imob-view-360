import { TestBed } from '@angular/core/testing';

import { DialogoDoWizard } from './dialogo-do-wizard.service';
import { PerguntaDoWizard } from './wizard-dialog.model';

/**
 * A ponte entre o guard, que fala promise, e a tela, que fala signal.
 *
 * Cada caso aqui existe por causa de um jeito de a promise ficar PENDURADA —
 * que, do lado do `CanDeactivate`, é o corretor descobrindo que não consegue
 * mais sair do wizard.
 */
describe('DialogoDoWizard', () => {
  let dialogo: DialogoDoWizard;

  function pergunta(titulo: string): PerguntaDoWizard {
    return {
      tituloKey: titulo,
      mensagemKey: 'M',
      dispensavel: true,
      acoes: [{ id: 'ok', rotuloKey: 'OK', tom: 'primario' }],
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DialogoDoWizard] });
    dialogo = TestBed.inject(DialogoDoWizard);
  });

  it('começa sem pergunta na tela', () => {
    expect(dialogo.pergunta()).toBeNull();
  });

  it('perguntar coloca a pergunta na tela', () => {
    const p = pergunta('A');

    void dialogo.perguntar(p);

    expect(dialogo.pergunta()).toBe(p);
  });

  it('escolher responde com o id e tira a pergunta da tela', async () => {
    const resposta = dialogo.perguntar(pergunta('A'));

    dialogo.escolher('ok');

    expect(await resposta).toBe('ok');
    expect(dialogo.pergunta()).toBeNull();
  });

  it('dispensar responde null', async () => {
    const p = pergunta('A');
    const resposta = dialogo.perguntar(p);

    dialogo.dispensar(p);

    expect(await resposta).toBeNull();
    expect(dialogo.pergunta()).toBeNull();
  });

  /**
   * O caso que fez a assinatura de `dispensar` receber a pergunta.
   *
   * O `didDismiss` do Ionic chega depois da animação de saída, e a essa altura
   * uma segunda pergunta já pode estar aberta: sair salvando abre a de "não
   * salvou" quando a rede cai, no mesmo gesto. Sem conferir a identidade, a
   * saída da PRIMEIRA cancelaria a SEGUNDA — e o corretor sairia sem ler o
   * aviso que ela existe para dar.
   */
  it('a dispensa de uma pergunta antiga não responde pela pergunta atual', async () => {
    const primeira = pergunta('A');
    const respostaDaPrimeira = dialogo.perguntar(primeira);
    dialogo.escolher('ok');
    await respostaDaPrimeira;

    const segunda = pergunta('B');
    const respostaDaSegunda = dialogo.perguntar(segunda);

    // O `didDismiss` atrasado da primeira chega agora.
    dialogo.dispensar(primeira);

    expect(dialogo.pergunta()).toBe(segunda);
    dialogo.escolher('ok');
    expect(await respostaDaSegunda).toBe('ok');
  });

  /**
   * Uma pergunta de cada vez. Sem isto, a promise da primeira ficaria pendurada
   * para sempre — e com ela a navegação que o guard estava segurando.
   */
  it('uma pergunta nova responde null à que estava aberta', async () => {
    const antiga = dialogo.perguntar(pergunta('A'));

    const nova = dialogo.perguntar(pergunta('B'));

    expect(await antiga).toBeNull();
    dialogo.escolher('ok');
    expect(await nova).toBe('ok');
  });

  it('escolher sem pergunta aberta não explode', () => {
    expect(() => dialogo.escolher('ok')).not.toThrow();
  });

  it('a mesma pergunta não é respondida duas vezes', async () => {
    const p = pergunta('A');
    const resposta = dialogo.perguntar(p);

    dialogo.escolher('ok');
    // O `didDismiss` que vem logo atrás do fechamento: fechar o modal É
    // dispensá-lo, aos olhos do Ionic.
    dialogo.dispensar(p);

    expect(await resposta).toBe('ok');
  });
});
