import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Event, NavigationEnd, Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';

import { TabBarComponent } from './tab-bar.component';

/**
 * A navegação do celular, que substituiu o hambúrguer.
 *
 * O que se prova aqui é ONDE ela aparece — e o custo de errar é assimétrico: a
 * barra que falta esconde a navegação inteira, e a barra que sobra empilha com
 * a `tw-actions` do wizard (`position: sticky; bottom: 0`) comendo um quinto da
 * tela do telefone, ou cobre o visualizador 360 em modo imersivo.
 *
 * Por isso a regra é LISTA DE PERMISSÃO: rota nova nasce sem barra. Estes casos
 * guardam as duas pontas.
 */
describe('TabBarComponent', () => {
  let fixture: ComponentFixture<TabBarComponent>;
  let router: Router;

  function navegarPara(url: string): void {
    (router.events as unknown as Subject<Event>).next(new NavigationEnd(1, url, url));
    fixture.detectChanges();
  }

  function abas(): HTMLAnchorElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.tabs__item'),
    );
  }

  function temBarra(): boolean {
    return !!(fixture.nativeElement as HTMLElement).querySelector('.tabs');
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(TabBarComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    document.body.classList.remove('com-barra-inferior');
  });

  for (const rota of ['/home', '/rascunhos', '/configuracoes', '/profile']) {
    it(`aparece em ${rota}`, () => {
      navegarPara(rota);
      expect(temBarra()).toBeTrue();
    });
  }

  for (const rota of [
    '/login',
    '/register',
    '/tour/novo',
    '/inner-view-page/abc',
    '/embed/abc',
    '/upload-legado',
  ]) {
    it(`NAO aparece em ${rota}`, () => {
      navegarPara(rota);
      expect(temBarra()).toBeFalse();
    });
  }

  /**
   * A armadilha da query string, a mesma que `NavegacaoEntreTelas` documenta:
   * os filtros da home moram ali, e comparar a URL inteira faria a barra
   * piscar a cada tecla digitada na busca.
   */
  it('os filtros da home nao fazem a barra sumir', () => {
    navegarPara('/home?type=HOUSE&purpose=SALE');
    expect(temBarra()).toBeTrue();

    navegarPara('/home#lista');
    expect(temBarra()).toBeTrue();
  });

  /**
   * Tres, e o "+" no MEIO. Configuracoes saiu para a engrenagem do cabecalho,
   * e a ordem e o que poe a acao no centro exato — o teste guarda as duas
   * coisas, porque tirar a celula sem reordenar deixaria o "+" na ponta.
   */
  it('oferece as tres celulas, com a acao no meio', () => {
    navegarPara('/home');

    expect(abas().map((a) => a.getAttribute('href'))).toEqual([
      '/home',
      '/tour/novo',
      '/rascunhos',
    ]);
  });

  /** A engrenagem esta no `app-header`; aqui ela nao pode reaparecer. */
  it('nao oferece Configuracoes', () => {
    navegarPara('/home');

    expect(abas().map((a) => a.getAttribute('href'))).not.toContain('/configuracoes');
  });

  /** O ativo pinta cheio; os demais, contorno. Convenção do iOS. */
  it('marca a aba da tela atual, e so ela', () => {
    navegarPara('/rascunhos');

    // A PROPRIEDADE do `<ion-icon>`, não o atributo: o wrapper Angular do Ionic
    // escreve a ligação direto no elemento, e sem o custom element hidratado
    // nada é refletido para atributo.
    const icones = abas().map(
      (a) => (a.querySelector('ion-icon') as unknown as { name: string }).name,
    );

    expect(icones).toEqual(['home-outline', 'add', 'time']);

    const ativas = abas().filter((a) => a.classList.contains('tabs__item--ativo'));
    expect(ativas.length).toBe(1);
    expect(ativas[0].getAttribute('href')).toBe('/rascunhos');
  });

  /**
   * O "+" é AÇÃO, não destino: ele abre o wizard, que é uma tela SEM barra.
   * Marcá-lo como "você está aqui" seria mentira em toda tela onde ele aparece.
   */
  it('o "+" nunca fica marcado como tela atual', () => {
    navegarPara('/home');
    const maisMais = abas()[1];

    expect(maisMais.classList).toContain('tabs__item--acao');
    expect(maisMais.classList).not.toContain('tabs__item--ativo');
  });

  /**
   * A barra é `position: fixed` e cobre o pé da tela. Sem a folga que esta
   * classe aciona em `global.scss`, o último cartão da home fica embaixo dela e
   * o botão de descartar de um rascunho vira inalcançável.
   */
  it('marca o body enquanto esta no ar, e desmarca ao sair', () => {
    navegarPara('/home');
    expect(document.body.classList).toContain('com-barra-inferior');

    navegarPara('/tour/novo');
    expect(document.body.classList).not.toContain('com-barra-inferior');
  });
});
