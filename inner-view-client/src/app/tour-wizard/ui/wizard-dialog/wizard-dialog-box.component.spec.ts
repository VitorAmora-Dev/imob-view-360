import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { WizardDialogBoxComponent } from './wizard-dialog-box.component';
import { PerguntaDoWizard } from './wizard-dialog.model';

/**
 * O desenho que substituiu o `ion-alert`.
 *
 * O que se prova aqui é a DECISÃO DE PRODUTO, não o CSS: quantos botões
 * existem, em que ordem, qual deles carrega o peso do primário, qual carrega a
 * lixeira, e que o X só aparece quando fechar é uma resposta legítima. Cada um
 * desses é uma escolha que um refactor bem-intencionado desfaz sem perceber —
 * e desfazê-la aqui transforma um toque errado numa exclusão de fotos.
 *
 * As cores em si ficam de fora: elas vêm de tokens `--tw-*` e o documento de
 * teste do Karma não carrega a folha do wizard. O que fica travado é a CLASSE,
 * que é o contrato entre este template e aquela folha.
 */
describe('WizardDialogBoxComponent', () => {
  function pergunta(extras: Partial<PerguntaDoWizard> = {}): PerguntaDoWizard {
    return {
      tituloKey: 'TITULO',
      mensagemKey: 'MENSAGEM',
      dispensavel: true,
      acoes: [
        { id: 'seguir', rotuloKey: 'SEGUIR', tom: 'primario' },
        {
          id: 'apagar',
          rotuloKey: 'APAGAR',
          tom: 'destrutivo',
          icone: 'lixeira',
          confirmaKey: 'APAGAR_MESMO',
        },
      ],
      ...extras,
    };
  }

  function montar(
    p: PerguntaDoWizard = pergunta(),
  ): ComponentFixture<WizardDialogBoxComponent> {
    const fixture = TestBed.createComponent(WizardDialogBoxComponent);
    fixture.componentRef.setInput('pergunta', p);
    fixture.detectChanges();
    return fixture;
  }

  function botoesDeAcao(fixture: ComponentFixture<unknown>): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.tw-dialog__action',
      ),
    );
  }

  function oX(fixture: ComponentFixture<unknown>): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('.tw-dialog__close');
  }

  /**
   * O rótulo que está À VISTA.
   *
   * Um botão que pede confirmação carrega os DOIS rótulos o tempo todo — é o
   * que reserva a largura e impede o botão de crescer sob o dedo —, e o que não
   * vale está apenas `visibility: hidden`. `textContent` traria os dois.
   */
  function rotuloVisivel(botao: HTMLElement): string {
    return Array.from(botao.querySelectorAll('.tw-dialog__rotulo'))
      .filter((rotulo) => !rotulo.classList.contains('is-oculto'))
      .map((rotulo) => rotulo.textContent?.trim())
      .join(' ');
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    });
  });

  it('mostra o título e a mensagem da pergunta', () => {
    const host = montar().nativeElement as HTMLElement;

    // Sem loader configurado, o TranslateService devolve a própria chave.
    expect(host.querySelector('.tw-dialog__title')?.textContent).toContain('TITULO');
    expect(host.querySelector('.tw-dialog__message')?.textContent).toContain(
      'MENSAGEM',
    );
  });

  /**
   * DUAS, e não três. O alerta antigo empilhava "Ficar aqui", "Descartar
   * captura" e "Continuar depois" numa coluna, e a saída mais provável —
   * desistir de sair — ocupava o mesmo peso das duas que decidem.
   */
  it('mostra uma ação por saída, na ordem em que a pergunta as declara', () => {
    const rotulos = botoesDeAcao(montar()).map((b) => rotuloVisivel(b));

    expect(rotulos).toEqual(['SEGUIR', 'APAGAR']);
  });

  /**
   * A hierarquia inteira mora nestas classes. `tw-btn--primary` é o azul cheio
   * da barra de ação do wizard; o destrutivo é contorno vermelho sobre a
   * superfície do card — de propósito MAIS LEVE que o primário, e não igual a
   * ele em outra cor.
   */
  it('dá o peso do primário à ação segura e o contorno de erro à destrutiva', () => {
    const [seguro, destrutivo] = botoesDeAcao(montar());

    expect(seguro.classList).toContain('tw-btn--primary');
    expect(destrutivo.classList).toContain('tw-dialog__action--destrutivo');
    // O que não pode acontecer: as duas com o mesmo peso.
    expect(destrutivo.classList).not.toContain('tw-btn--primary');
  });

  it('usa o contorno neutro no tom neutro', () => {
    const fixture = montar(
      pergunta({ acoes: [{ id: 'x', rotuloKey: 'X', tom: 'neutro' }] }),
    );

    expect(botoesDeAcao(fixture)[0].classList).toContain('tw-btn--bordered');
  });

  it('só a ação que pede a lixeira ganha a lixeira', () => {
    const [seguro, destrutivo] = botoesDeAcao(montar());

    expect(destrutivo.querySelector('app-tw-trash-icon svg')).not.toBeNull();
    expect(seguro.querySelector('app-tw-trash-icon')).toBeNull();
  });

  it('emite a ação tocada quando ela não pede confirmação', () => {
    const fixture = montar();
    const escolhas: string[] = [];
    fixture.componentInstance.escolheu.subscribe((acao) => escolhas.push(acao.id));

    botoesDeAcao(fixture)[0].click();

    expect(escolhas).toEqual(['seguir']);
  });

  /**
   * O X é o "Ficar aqui" que saiu da fileira de botões. Ele vem ANTES das ações
   * no DOM porque a tecla que chega antes de qualquer decisão deve ser a que
   * não decide nada — vale para o Tab e para o leitor de tela.
   */
  it('o X é o primeiro nó focável do cartão', () => {
    const focaveis = Array.from(
      (montar().nativeElement as HTMLElement).querySelectorAll('button'),
    );

    expect(focaveis[0].classList).toContain('tw-dialog__close');
  });

  it('o X emite o fechamento', () => {
    const fixture = montar();
    let fechou = 0;
    fixture.componentInstance.fechou.subscribe(() => fechou++);

    oX(fixture)!.click();

    expect(fechou).toBe(1);
  });

  /**
   * Um X que não fecha é pior que nenhum: ele promete uma saída que a pergunta
   * não tem. Quando as duas respostas são consequentes, sair só pelos botões é
   * a intenção.
   */
  it('não desenha o X quando a pergunta não é dispensável', () => {
    expect(oX(montar(pergunta({ dispensavel: false })))).toBeNull();
  });

  /**
   * "Fechar" descreve o gesto; neste diálogo o X quer dizer "ficar aqui", e é
   * isso que o leitor de tela precisa anunciar.
   */
  it('o X é anunciado pela consequência quando a pergunta a nomeia', () => {
    const fixture = montar(pergunta({ fecharKey: 'FICAR_AQUI' }));

    expect(oX(fixture)!.getAttribute('aria-label')).toContain('FICAR_AQUI');
  });

  it('sem nome próprio, o X cai em "fechar"', () => {
    expect(oX(montar())!.getAttribute('aria-label')).toContain('DIALOG_CLOSE');
  });

  /**
   * O segundo toque.
   *
   * `descartarRascunho()` apaga o imóvel em cascata — as fotos e o tratamento
   * por IA que já subiram vão junto, e não voltam. No alerta de três botões
   * este ficava protegido por estar no meio da pilha; com dois botões grandes
   * ele virou metade da tela, do lado em que o polegar descansa. Estes casos
   * guardam o custo que a simplificação tirou.
   */
  describe('ações que pedem confirmação', () => {
    function oDestrutivo(fixture: ComponentFixture<unknown>): HTMLButtonElement {
      return botoesDeAcao(fixture)[1];
    }

    it('o primeiro toque NÃO responde — só troca o rótulo', () => {
      const fixture = montar();
      const escolhas: string[] = [];
      fixture.componentInstance.escolheu.subscribe((acao) => escolhas.push(acao.id));

      oDestrutivo(fixture).click();
      fixture.detectChanges();

      expect(escolhas).toEqual([]);
      expect(rotuloVisivel(oDestrutivo(fixture))).toBe('APAGAR_MESMO');
    });

    it('o segundo toque responde', () => {
      const fixture = montar();
      const escolhas: string[] = [];
      fixture.componentInstance.escolheu.subscribe((acao) => escolhas.push(acao.id));

      oDestrutivo(fixture).click();
      fixture.detectChanges();
      oDestrutivo(fixture).click();

      expect(escolhas).toEqual(['apagar']);
    });

    /**
     * A confirmação não pode virar uma armadilha: quem armou por engano precisa
     * de saída, e a mais óbvia é o botão seguro ao lado — que continua vivo.
     */
    it('a ação segura continua respondendo com a destrutiva armada', () => {
      const fixture = montar();
      const escolhas: string[] = [];
      fixture.componentInstance.escolheu.subscribe((acao) => escolhas.push(acao.id));

      oDestrutivo(fixture).click();
      fixture.detectChanges();
      botoesDeAcao(fixture)[0].click();

      expect(escolhas).toEqual(['seguir']);
    });

    /**
     * Sem isto, o Tab deixaria para trás um botão armado: voltar a ele com
     * Shift+Tab e apertar Enter apagaria de primeira, sem o aviso.
     */
    it('tirar o foco desarma', () => {
      const fixture = montar();
      const escolhas: string[] = [];
      fixture.componentInstance.escolheu.subscribe((acao) => escolhas.push(acao.id));

      oDestrutivo(fixture).click();
      fixture.detectChanges();
      oDestrutivo(fixture).dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();

      expect(rotuloVisivel(oDestrutivo(fixture))).toBe('APAGAR');
      oDestrutivo(fixture).click();
      expect(escolhas).toEqual([]);
    });

    /**
     * O botão que cresce sob o dedo empurraria o "Continuar depois" de lugar, e
     * o segundo toque — dado no mesmo ponto do primeiro — cairia num botão
     * diferente do que se está confirmando. Os dois rótulos ficam sempre no
     * DOM, empilhados, e é isso que reserva a largura do maior.
     */
    it('carrega os dois rótulos o tempo todo, para a largura não mudar', () => {
      const rotulos = Array.from(
        oDestrutivo(montar()).querySelectorAll('.tw-dialog__rotulo'),
      ).map((r) => r.textContent?.trim());

      expect(rotulos).toEqual(['APAGAR', 'APAGAR_MESMO']);
    });

    /** O peso sólido só é honesto depois do primeiro toque. */
    it('armado, o destrutivo troca o contorno pelo vermelho cheio', () => {
      const fixture = montar();

      expect(oDestrutivo(fixture).classList).not.toContain('is-armada');
      oDestrutivo(fixture).click();
      fixture.detectChanges();

      expect(oDestrutivo(fixture).classList).toContain('is-armada');
    });

    /**
     * Trocar o texto do elemento FOCADO não é reanunciado de forma confiável
     * por leitor de tela: sem esta região, quem não vê a tela apertaria de novo
     * sem saber que a pergunta mudou.
     */
    it('anuncia a confirmação para quem não vê a tela', () => {
      const fixture = montar();
      const host = fixture.nativeElement as HTMLElement;
      const aviso = host.querySelector('[role="status"]')!;

      expect(aviso.textContent?.trim()).toBe('');
      oDestrutivo(fixture).click();
      fixture.detectChanges();

      expect(aviso.textContent?.trim()).toBe('APAGAR_MESMO');
    });

    /**
     * Uma pergunta nova chega desarmada.
     *
     * O cartão não é necessariamente recriado entre duas perguntas — sair
     * salvando abre a de "não salvou" quando a rede cai, e a casca nunca chega
     * a ver o vazio entre as duas. Sem o reset, a segunda herdaria um botão
     * armado que ninguém armou.
     */
    it('a pergunta seguinte chega desarmada', () => {
      const fixture = montar();
      oDestrutivo(fixture).click();
      fixture.detectChanges();

      fixture.componentRef.setInput('pergunta', pergunta({ tituloKey: 'OUTRO' }));
      fixture.detectChanges();

      expect(rotuloVisivel(oDestrutivo(fixture))).toBe('APAGAR');
    });
  });
});
