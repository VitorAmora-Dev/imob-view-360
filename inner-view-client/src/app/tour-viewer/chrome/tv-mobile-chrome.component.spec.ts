import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TvHeaderComponent } from './tv-header.component';

describe('Chrome móvel do tour', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  /**
   * Os tres pontos ficam no CENTRO do botao.
   *
   * `.tv-header__circular` centraliza com `display: grid` + `place-items:
   * center`, e `.tv-header__gerenciar` troca o display para `flex` sem dizer
   * mais nada. `place-items` e atalho de `align-items` + `justify-items`, e
   * `justify-items` nao existe em flexbox: sobra o `justify-content` padrao,
   * `flex-start`. Os pontos somam 16,5px numa caixa de 40px e ficam encostados
   * na borda esquerda.
   *
   * Medido, e nao inspecionado por propriedade: o defeito nasceu de DUAS regras
   * concordando em separado e discordando juntas, e uma asserção sobre
   * `justify-content` passaria com qualquer outro jeito de centralizar. O que
   * precisa ser verdade e a posicao.
   */
  it('os tres pontos ficam centrados no botao de gerenciar', () => {
    const fixture = TestBed.createComponent(TvHeaderComponent);
    fixture.componentRef.setInput('tourName', 'Cobertura Vila Nova');
    fixture.componentRef.setInput('sceneCount', 6);
    fixture.componentRef.setInput('chromeVisible', true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const gerenciar = host.querySelector('.tv-header__gerenciar') as HTMLElement;
    const pontos = Array.from(gerenciar.querySelectorAll('span'));
    const caixa = gerenciar.getBoundingClientRect();
    const primeiro = pontos[0].getBoundingClientRect();
    const ultimo = pontos[pontos.length - 1].getBoundingClientRect();

    const folgaEsquerda = primeiro.left - caixa.left;
    const folgaDireita = caixa.right - ultimo.right;
    const folgaTopo = primeiro.top - caixa.top;
    const folgaBase = caixa.bottom - primeiro.bottom;

    expect(pontos.length).toBe(3);
    expect(Math.abs(folgaEsquerda - folgaDireita))
      .withContext(`horizontal: ${folgaEsquerda} a esquerda, ${folgaDireita} a direita`)
      .toBeLessThanOrEqual(0.5);
    expect(Math.abs(folgaTopo - folgaBase))
      .withContext(`vertical: ${folgaTopo} acima, ${folgaBase} abaixo`)
      .toBeLessThanOrEqual(0.5);

    fixture.destroy();
  });

  it('no imersivo esconde título e gerenciar, mas preserva voltar', () => {
    const fixture = TestBed.createComponent(TvHeaderComponent);
    fixture.componentRef.setInput('tourName', 'Cobertura Vila Nova');
    fixture.componentRef.setInput('sceneCount', 6);
    fixture.componentRef.setInput('chromeVisible', false);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const voltar = host.querySelector('.tv-header__circular') as HTMLButtonElement;
    const titulo = host.querySelector('.tv-header__titulo') as HTMLElement;
    const gerenciar = host.querySelector('.tv-header__gerenciar') as HTMLButtonElement;

    expect(voltar.classList).not.toContain('is-hidden');
    expect(getComputedStyle(voltar).width).toBe('40px');
    expect(getComputedStyle(voltar).height).toBe('40px');
    expect(titulo.classList).toContain('is-hidden');
    expect(gerenciar.classList).toContain('is-hidden');
    expect(gerenciar.hasAttribute('inert')).toBeTrue();

    fixture.destroy();
  });

  // A pill de cena e o botão flutuante de ocultar saíram da tela com a
  // reorganização dos menus: a faixa de cenas assumiu a primeira e a barra de
  // ações assumiu o segundo. O que cada um garantia continua testado — a faixa
  // em `tour-scenes-strip.component.spec.ts`, o ocultar em
  // `tour-actions-bar.component.spec.ts`.
});
