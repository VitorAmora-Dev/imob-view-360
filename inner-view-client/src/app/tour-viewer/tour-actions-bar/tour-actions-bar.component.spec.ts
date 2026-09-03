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

  function render(canEdit: boolean, hasScenes: boolean, chromeVisible = true) {
    fixture = TestBed.createComponent(TourActionsBarComponent);
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.componentRef.setInput('hasScenes', hasScenes);
    fixture.componentRef.setInput('chromeVisible', chromeVisible);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const seletores = {
    editar: '.tv-actions__button--edit',
    ocultar: '.tv-actions__button--visibility',
    compartilhar: '.tv-actions__button--share',
  };

  it('mostra EDITAR, OCULTAR e COMPARTILHAR com alvos reais de 56px', () => {
    const host = render(true, true);
    const buttons = Array.from(host.querySelectorAll('button')) as HTMLButtonElement[];

    expect(buttons.length).toBe(3);
    expect(buttons.every((button) => getComputedStyle(button).height === '56px')).toBeTrue();
    for (const seletor of Object.values(seletores)) {
      expect(host.querySelector(seletor)).not.toBeNull();
    }
  });

  /** A ordem é a do critério, e ela é lida da esquerda para a direita. */
  it('OCULTAR fica no meio, entre editar e compartilhar', () => {
    const host = render(true, true);
    const classes = Array.from(host.querySelectorAll('button')).map((button) => {
      const partes = button.className.split(' ');
      return partes[partes.length - 1];
    });

    expect(classes).toEqual([
      'tv-actions__button--edit',
      'tv-actions__button--visibility',
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
    expect(host.querySelectorAll('button').length).toBe(2);
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

      expect(host.querySelectorAll('button').length).toBe(1);
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
