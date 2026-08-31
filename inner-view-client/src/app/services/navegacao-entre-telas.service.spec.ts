import { TestBed } from '@angular/core/testing';
import { Event, NavigationEnd, Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import {
  NavegacaoEntreTelas,
  caminhoDe,
  ehAHome,
} from './navegacao-entre-telas.service';

/**
 * A regra que o cache de página do Ionic obriga a ter, num lugar só.
 *
 * Ela tem uma armadilha que já custou uma rodada de correção: os filtros da
 * home moram na query string, e cada troca de filtro é uma navegação para
 * `/home` também. Comparar só o destino faz a tela recarregar a cada tecla —
 * foi assim que seis testes de filtro da `HomePage` caíram com "Expected no
 * open requests". Estes casos existem para o segundo consumidor não repetir o
 * erro do primeiro.
 */
describe('NavegacaoEntreTelas', () => {
  let navegacao: NavegacaoEntreTelas;
  let router: Router;

  function navegarPara(url: string): void {
    (router.events as unknown as Subject<Event>).next(new NavigationEnd(1, url, url));
  }

  /** Quantas vezes a tela "voltou a aparecer" desde que se começou a ouvir. */
  function contarVoltas(): () => number {
    let voltas = 0;
    navegacao.aoVoltarPara(ehAHome).subscribe(() => voltas++);
    return () => voltas;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    navegacao = TestBed.inject(NavegacaoEntreTelas);
    router = TestBed.inject(Router);
  });

  it('avisa quando a tela volta a aparecer', () => {
    const voltas = contarVoltas();

    navegarPara('/tour/novo');
    navegarPara('/home');

    expect(voltas()).toBe(1);
  });

  it('não avisa ao SAIR da tela', () => {
    const voltas = contarVoltas();

    navegarPara('/tour/novo');

    expect(voltas()).toBe(0);
  });

  /**
   * A armadilha. Os filtros da home são query string: `/home?type=HOUSE` é a
   * MESMA tela, e recarregar ali seria uma requisição por tecla digitada.
   */
  it('não avisa em navegação dentro da própria tela', () => {
    const voltas = contarVoltas();

    navegarPara('/home?type=HOUSE');
    navegarPara('/home?type=HOUSE&purpose=SALE');
    navegarPara('/home');

    expect(voltas()).toBe(0);
  });

  /**
   * O componente é ativado ANTES de o `NavigationEnd` da navegação que o criou
   * ser anunciado — e quem busca no `ngOnInit` já carregou por ela. Sem isto,
   * toda abertura da tela custaria duas buscas.
   */
  it('a navegação que criou quem ouve não conta como volta', () => {
    const voltas = contarVoltas();

    navegarPara('/home');

    expect(voltas()).toBe(0);
  });

  it('avisa de novo a cada ida e volta', () => {
    const voltas = contarVoltas();

    navegarPara('/perfil');
    navegarPara('/home');
    navegarPara('/tour/novo');
    navegarPara('/home?type=LAND');

    expect(voltas()).toBe(2);
  });

  it('cada ouvinte tem a sua própria conta', () => {
    // O estado é do assinante, não do serviço: quem chega depois não herda o
    // "estava fora" de quem já ouvia.
    const primeiro = contarVoltas();
    navegarPara('/tour/novo');
    const segundo = contarVoltas();

    navegarPara('/home');

    expect(primeiro()).toBe(1);
    // Para o segundo, a navegação que o criou é justamente esta.
    expect(segundo()).toBe(0);
  });
});

describe('caminhoDe', () => {
  it('corta query string e fragmento', () => {
    expect(caminhoDe('/home?type=HOUSE#lista')).toBe('/home');
    expect(caminhoDe('/home')).toBe('/home');
  });
});

describe('ehAHome', () => {
  it('reconhece a home e mais nada', () => {
    expect(ehAHome('/home')).toBe(true);
    expect(ehAHome('/tour/novo')).toBe(false);
    expect(ehAHome('/home/algo')).toBe(false);
  });
});
