import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TourActionsBarComponent } from './tour-actions-bar.component';

describe('TourActionsBarComponent', () => {
  let fixture: ComponentFixture<TourActionsBarComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  function render(
    canEdit: boolean,
    hasScenes: boolean,
    chromeVisible = true,
    deitado = false,
  ) {
    fixture = TestBed.createComponent(TourActionsBarComponent);
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.componentRef.setInput('hasScenes', hasScenes);
    fixture.componentRef.setInput('chromeVisible', chromeVisible);
    fixture.componentRef.setInput('deitado', deitado);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const seletores = {
    editar: '.tv-actions__button--edit',
    ocultar: '.tv-actions__button--visibility',
    orientacao: '.tv-actions__button--orientation',
    compartilhar: '.tv-actions__button--share',
  };

  /**
   * Os botoes que a pessoa ENXERGA.
   *
   * "Deitar a tela" some por `display: none` acima de 767px — o criterio dele e
   * a largura da JANELA, que o CSS conhece e o TypeScript so saberia com um
   * listener de resize. A janela do Karma decide de que lado do corte estes
   * casos rodam, e `noCelular()` responde isso.
   */
  function botoesVisiveis(host: HTMLElement): HTMLButtonElement[] {
    return (Array.from(host.querySelectorAll('button')) as HTMLButtonElement[])
      .filter((botao) => getComputedStyle(botao).display !== 'none');
  }

  /** O mesmo corte do `.tv-palco--deitado`. */
  function noCelular(): boolean {
    return window.matchMedia('(max-width: 767px)').matches;
  }

  /** Quantos controles a barra oferece, contando o de deitar so quando ele vale. */
  function quantosVisiveis(base: number): number {
    return noCelular() ? base + 1 : base;
  }

  it('mostra EDITAR, OCULTAR e COMPARTILHAR com alvos reais de 56px', () => {
    const host = render(true, true);
    const buttons = botoesVisiveis(host);

    expect(buttons.length).toBe(quantosVisiveis(3));
    expect(buttons.every((button) => getComputedStyle(button).height === '56px')).toBeTrue();
    for (const seletor of Object.values(seletores)) {
      expect(host.querySelector(seletor)).not.toBeNull();
    }
  });

  /**
   * A ordem é a do critério, e ela é lida da esquerda para a direita: as duas
   * pontas fazem algo COM o tour (editar, compartilhar) e o miolo muda COMO se
   * olha para ele (ocultar a interface, deitar a tela).
   */
  it('os controles de como se olha ficam no miolo', () => {
    const host = render(true, true);
    const classes = botoesVisiveis(host).map((button) => {
      const partes = button.className.split(' ');
      return partes[partes.length - 1];
    });

    expect(classes).toEqual([
      'tv-actions__button--edit',
      'tv-actions__button--visibility',
      ...(noCelular() ? ['tv-actions__button--orientation'] : []),
      'tv-actions__button--share',
    ]);
  });

  it('sem permissão de edição sobram compartilhar e ocultar', () => {
    const host = render(false, true);

    expect(host.querySelector(seletores.editar)).toBeNull();
    expect(host.querySelector(seletores.compartilhar)).not.toBeNull();
    expect(host.querySelector(seletores.ocultar)).not.toBeNull();
  });

  /**
   * Tour sem cena não tem o que compartilhar: quem recebesse o link abriria uma
   * tela vazia. Editar continua, porque é por ali que se põe a primeira cena.
   */
  it('sem cenas mostra editar e ocultar, escondendo compartilhar', () => {
    const host = render(true, false);

    expect(host.querySelector(seletores.editar)).not.toBeNull();
    expect(host.querySelector(seletores.compartilhar)).toBeNull();
    expect(botoesVisiveis(host).length).toBe(quantosVisiveis(2));
  });

  it('emite intenções sem executar ações do tour', () => {
    const host = render(true, true);
    const component = fixture.componentInstance;
    const editar = spyOn(component.editRequested, 'emit');
    const compartilhar = spyOn(component.shareRequested, 'emit');
    const ocultar = spyOn(component.visibilityToggled, 'emit');

    (host.querySelector(seletores.editar) as HTMLButtonElement).click();
    (host.querySelector(seletores.compartilhar) as HTMLButtonElement).click();
    (host.querySelector(seletores.ocultar) as HTMLButtonElement).click();

    expect(editar).toHaveBeenCalledOnceWith();
    expect(compartilhar).toHaveBeenCalledOnceWith();
    expect(ocultar).toHaveBeenCalledOnceWith();
  });

  describe('deitar a tela', () => {
    /**
     * O criterio e a LARGURA da janela: o palco so gira abaixo de 767px, e o
     * mesmo @media governa o botao. Oferecer um controle que nao faz nada e
     * pior que nao oferecer controle.
     */
    /**
     * Segue o MESMO corte de largura do `.tv-palco--deitado`: o palco so gira
     * abaixo de 767px, e oferecer um controle que nao faz nada e pior que nao
     * oferecer controle. O caso vale nas duas larguras, e e a janela do Karma
     * que decide qual delas esta sendo exercitada.
     */
    it('acompanha o corte de largura do palco', () => {
      const host = render(true, true);
      const botao = host.querySelector(seletores.orientacao) as HTMLElement;

      expect(botao).not.toBeNull();
      expect(getComputedStyle(botao).display).toBe(noCelular() ? 'flex' : 'none');
    });

    /**
     * A PROPRIEDADE do `<ion-icon>`, e nao o atributo: o wrapper Angular do
     * Ionic escreve a ligacao direto no elemento, e sem o custom element
     * hidratado nada e refletido para atributo.
     */
    function nomeDoIcone(host: HTMLElement): string {
      const icone = host.querySelector(seletores.orientacao)!.querySelector('ion-icon');
      return (icone as unknown as { name: string }).name;
    }

    /** O icone e o rotulo dizem a ACAO, nao o estado — como o de ocultar. */
    it('o icone e o rotulo mostram o que o toque faz', () => {
      const emPe = render(true, true);
      expect(nomeDoIcone(emPe)).toBe('phone-landscape-outline');
      expect(
        emPe.querySelector(seletores.orientacao)!.getAttribute('aria-label'),
      ).toBe('TOUR_VIEWER.ACTIONS.LANDSCAPE_LONG');

      fixture.destroy();

      const deitado = render(true, true, true, true);
      expect(nomeDoIcone(deitado)).toBe('phone-portrait-outline');
      expect(
        deitado.querySelector(seletores.orientacao)!.getAttribute('aria-label'),
      ).toBe('TOUR_VIEWER.ACTIONS.PORTRAIT_LONG');
    });

    it('emite a intencao, sem girar nada por conta propria', () => {
      const host = render(true, true);
      const girar = spyOn(fixture.componentInstance.orientationToggled, 'emit');

      (host.querySelector(seletores.orientacao) as HTMLButtonElement).click();

      expect(girar).toHaveBeenCalledOnceWith();
    });

    /**
     * Sai no imersivo, como editar e compartilhar.
     *
     * O invariante da barra e que o imersivo deixa UM botao, e ele ja e o
     * caminho de volta para os dois: devolver a interface traz este de novo.
     * Dois controles flutuando sobre a foto desfariam o modo que existe
     * justamente para nao haver nada sobre ela.
     */
    it('sai do DOM no imersivo, como editar e compartilhar', () => {
      const host = render(true, true, false);

      expect(host.querySelector(seletores.orientacao)).toBeNull();
    });
  });

  describe('no modo imersivo', () => {
    /**
     * O caso que o botão flutuante de ocultar cobria antes de vir para cá.
     *
     * A barra inteira sumindo deixaria como único jeito de recuperar a
     * interface um toque na foto — sem afordância nenhuma, e ninguém descobre.
     * O que some é a BARRA; o caminho de volta fica.
     */
    it('sobra UM botão, e é o que devolve a interface', () => {
      const host = render(true, true, false);

      expect(botoesVisiveis(host).length).toBe(1);
      expect(host.querySelector(seletores.ocultar)).not.toBeNull();
    });

    /**
     * `@if` e não `opacity`: escondidos por estilo, os outros dois continuariam
     * na ordem de tabulação, e o Tab passearia por controles invisíveis.
     */
    it('editar e compartilhar saem do DOM, e não só da vista', () => {
      const host = render(true, true, false);

      expect(host.querySelector(seletores.editar)).toBeNull();
      expect(host.querySelector(seletores.compartilhar)).toBeNull();
    });

    /**
     * O ARRASTO é o gesto principal da tela. Sem placa, a faixa continua sendo
     * um retângulo de ponta a ponta — e um retângulo transparente com
     * `pointer-events: auto` engole o arrasto igual a um opaco, porque
     * transparência não conta para hit test.
     */
    it('devolve o arrasto ao panorama: só o botão intercepta', () => {
      const host = render(true, true, false);
      const grade = host.querySelector('.tv-actions__grid') as HTMLElement;
      const botao = host.querySelector(seletores.ocultar) as HTMLElement;

      expect(getComputedStyle(grade).pointerEvents).toBe('none');
      expect(getComputedStyle(botao).pointerEvents).toBe('auto');
    });

    it('a placa de vidro da barra sai junto', () => {
      const host = render(true, true, false);

      expect(host.classList).toContain('is-imersivo');
      expect(getComputedStyle(host).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    });
  });

  /**
   * O rótulo diz a AÇÃO, e o ícone diz a mesma coisa. Foi onde os dois
   * componentes que este substitui discordavam: o flutuante mostrava o olho
   * ABERTO com a interface à vista (o estado) e o cluster do desktop mostrava o
   * olho CORTADO (a ação). Aqui, com rótulo visível ao lado, só a ação faz
   * sentido — "OCULTAR" com um olho aberto é uma instrução contra a outra.
   */
  it('rótulo e ícone dizem a ação, e trocam juntos', () => {
    // Lido da PROPRIEDADE, e não do atributo: `[name]` num custom element vira
    // propriedade quando o elemento a define, e `ion-icon` define. Um
    // `querySelector('ion-icon[name=…]')` não acharia nada e passaria a
    // impressão de que a ligação sumiu.
    const icone = (host: HTMLElement) =>
      (host.querySelector(`${seletores.ocultar} ion-icon`) as unknown as { name: string })
        .name;

    const comInterface = render(true, true, true);
    expect(icone(comInterface)).toBe('eye-off-outline');
    expect(fixture.componentInstance.chaveCurtaDaVisibilidade())
      .toBe('TOUR_VIEWER.ACTIONS.HIDE');
    expect(fixture.componentInstance.chaveDaVisibilidade()).toBe('TOUR_VIEWER.HIDE_UI');
    fixture.destroy();

    const semInterface = render(true, true, false);
    expect(icone(semInterface)).toBe('eye-outline');
    expect(fixture.componentInstance.chaveDaVisibilidade()).toBe('TOUR_VIEWER.SHOW_UI');
  });

  /**
   * `aria-pressed` foi DEIXADO de fora, e é decisão e não esquecimento: com o
   * nome acessível mudando junto, o par vira contradição — o leitor de tela
   * anunciaria "Mostrar interface, pressionado", que descreve o modo imersivo
   * usando o rótulo da ação que sai dele.
   */
  it('o botão de ocultar não anuncia estado pressionado', () => {
    const host = render(true, true, false);
    const botao = host.querySelector(seletores.ocultar) as HTMLElement;

    expect(botao.hasAttribute('aria-pressed')).toBeFalse();
    // Sem loader de traduções o pipe devolve a própria chave — o que importa
    // aqui é que o nome acessível MUDA com o estado, e é a de "mostrar".
    expect(botao.getAttribute('aria-label')).toBe('TOUR_VIEWER.SHOW_UI');
  });
});
