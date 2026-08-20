import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { HomePage } from './home.page';
import { Property } from '../models/property.model';

function imovel(id: string, overrides: Partial<Property> = {}): Property {
  return {
    id,
    code: 'RLX-' + id,
    title: 'Imovel ' + id,
    type: 'HOUSE',
    purpose: 'SALE',
    status: 'AVAILABLE',
    agencyId: 'a1',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    virtualTour: null,
    ...overrides,
  };
}

describe('HomePage', () => {
  let fixture: ComponentFixture<HomePage>;
  let component: HomePage;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Responde a chamada pendente de /properties com os imoveis dados. */
  function responder(data: Property[]) {
    fixture.detectChanges(); // dispara o ngOnInit
    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ data, total: data.length, page: 1, limit: 100, pages: 1 });
    fixture.detectChanges();
  }

  function falhar() {
    fixture.detectChanges();
    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ statusCode: 500, message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
  }

  function texto() {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('should create', () => {
    responder([]);
    expect(component).toBeTruthy();
  });

  // Os dois testes que a propria feature poderia introduzir errados.
  it('nao sugere criar tour enquanto carrega', () => {
    fixture.detectChanges(); // ngOnInit dispara, resposta ainda nao veio
    expect(component.view()).toBe('loading');
    expect(texto()).not.toContain('HOME.EMPTY_TITLE');
    expect(texto()).toContain('HOME.LOADING');

    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ data: [], total: 0, page: 1, limit: 100, pages: 1 });
  });

  it('nao sugere criar tour quando a chamada falha', () => {
    falhar();
    expect(component.view()).toBe('error');
    expect(texto()).not.toContain('HOME.EMPTY_TITLE');
    expect(texto()).toContain('HOME.ERROR_TEXT');
  });

  it('conta sem imoveis mostra o onboarding', () => {
    responder([]);
    expect(component.view()).toBe('empty');
    expect(texto()).toContain('HOME.EMPTY_TITLE');
  });

  // A precedencia. Conta vazia COM busca ativa satisfaz as duas condicoes.
  it('conta vazia com busca ativa mostra onboarding, nao "sem resultado"', () => {
    responder([]);
    component.query.set('qualquer coisa');
    fixture.detectChanges();
    expect(component.view()).toBe('empty');
    expect(texto()).not.toContain('HOME.NO_RESULTS');
  });

  it('busca sem resultado, com acervo, mostra "sem resultado"', () => {
    responder([imovel('1')]);
    component.query.set('zzzz-nao-existe');
    fixture.detectChanges();
    expect(component.view()).toBe('no-results');
    expect(texto()).toContain('HOME.NO_RESULTS');
  });

  it('nenhum imovel com tour mostra a faixa', () => {
    responder([imovel('1'), imovel('2')]);
    expect(component.view()).toBe('list');
    expect(component.mostrarFaixa()).toBeTrue();
  });

  it('um imovel com tour DRAFT ja conta como "tem tour"', () => {
    responder([imovel('1', { virtualTour: { id: 't1', status: 'DRAFT' } }), imovel('2')]);
    expect(component.mostrarFaixa()).toBeFalse();
  });

  // A faixa le `properties`, nao `filtered` — senao apareceria e sumiria
  // conforme a pessoa digita.
  it('a faixa nao some ao digitar na busca', () => {
    responder([imovel('1'), imovel('2')]);
    component.query.set('Imovel 1');
    fixture.detectChanges();
    expect(component.view()).toBe('list');
    expect(component.mostrarFaixa()).toBeTrue();
  });

  function moldura() {
    const el = fixture.nativeElement as HTMLElement;
    return {
      busca: el.querySelector('ion-searchbar') !== null,
      fab: el.querySelector('ion-fab') !== null,
    };
  }

  // A mutacao que passava antes destes testes: soltar o FAB no estado de erro,
  // oferecendo "adicionar" sobre uma tela que diz que a chamada falhou. As
  // duas condicoes eram escritas em polaridades opostas e ninguem cobria
  // carregando nem erro.
  it('busca e FAB somem em carregando e em erro', () => {
    fixture.detectChanges(); // carregando
    expect(component.view()).toBe('loading');
    expect(moldura()).toEqual({ busca: false, fab: false });

    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ statusCode: 500, message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges(); // erro

    expect(component.view()).toBe('error');
    expect(moldura()).toEqual({ busca: false, fab: false });
  });

  it('busca e FAB aparecem juntos em lista e em "sem resultado"', () => {
    responder([imovel('1')]);
    expect(moldura()).toEqual({ busca: true, fab: true });

    component.query.set('zzzz-nao-existe');
    fixture.detectChanges();

    expect(component.view()).toBe('no-results');
    expect(moldura()).toEqual({ busca: true, fab: true });
  });

  // O campo de busca e' destruido no estado de carregando e nao tem `[value]`:
  // sem esta limpeza, voltar com `query` preenchido mostraria "nenhum resultado
  // para zzzz" sobre uma caixa visivelmente vazia.
  it('recarregar limpa a busca', () => {
    responder([imovel('1')]);
    component.query.set('zzzz-nao-existe');
    fixture.detectChanges();
    expect(component.view()).toBe('no-results');

    component.carregar();
    expect(component.query()).toBe('');

    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ data: [imovel('1')], total: 1, page: 1, limit: 100, pages: 1 });
    fixture.detectChanges();

    expect(component.view()).toBe('list');
  });

  it('busca oculta em empty e visivel em no-results', () => {
    responder([]);
    expect(fixture.nativeElement.querySelector('ion-searchbar')).toBeNull();

    component.properties.set([imovel('1')]);
    component.query.set('zzzz');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-searchbar')).not.toBeNull();
  });

  it('FAB oculto em empty', () => {
    responder([]);
    expect(fixture.nativeElement.querySelector('ion-fab')).toBeNull();

    component.properties.set([imovel('1')]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-fab')).not.toBeNull();
  });

  it('tentar de novo refaz a chamada', () => {
    falhar();
    component.carregar();
    expect(component.view()).toBe('loading');

    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ data: [imovel('1')], total: 1, page: 1, limit: 100, pages: 1 });
    fixture.detectChanges();

    expect(component.view()).toBe('list');
  });
});
