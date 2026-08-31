import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Event, NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';

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
  let harness: RouterTestingHarness;
  let component: HomePage;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        // Rota de verdade, e nao um ActivatedRoute falso: o assunto destes
        // testes e' justamente a URL mandando nos criterios.
        provideRouter([
          { path: 'home', component: HomePage },
          // O `RouterTestingHarness.create()` navega para `/` antes de
          // qualquer teste; sem uma rota que case, ele rejeita com NG04002.
          { path: '', children: [] },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });

    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  // `ignoreCancelled` porque o `switchMap` cancela a requisicao anterior de
  // proposito — e' contrato, nao vazamento.
  afterEach(() => http.verify({ ignoreCancelled: true }));

  /**
   * A faixa de rascunhos (Tarefa 13) dispara a propria chamada assim que
   * `HomePage` e' criada — nenhum destes testes fala dela, so' precisam
   * drenar a requisicao para `http.verify()` nao acusar pedido em aberto.
   * So' dispara uma vez: com `IonicRouteStrategy`, `refiltrar()` reusa o
   * mesmo componente e nao recria `app-rascunhos-band`.
   */
  function flushRascunhos(): void {
    http.match((r) => r.url.endsWith('/virtual-tours')).forEach((r) => r.flush([]));
  }

  /** Abre a home na URL dada e devolve a requisicao pendente. */
  async function abrir(url = '/home'): Promise<TestRequest> {
    component = await harness.navigateByUrl(url, HomePage);
    harness.detectChanges();
    flushRascunhos();
    return http.expectOne((r) => r.url.endsWith('/properties'));
  }

  /** Navega para outra URL da mesma rota e devolve a requisicao pendente. */
  async function refiltrar(url: string): Promise<TestRequest> {
    await harness.navigateByUrl(url);
    harness.detectChanges();
    return http.expectOne((r) => r.url.endsWith('/properties'));
  }

  function responder(req: TestRequest, data: Property[]): void {
    req.flush({ data, total: data.length, page: 1, limit: 100, pages: 1 });
    harness.detectChanges();
  }

  function falhar(req: TestRequest): void {
    req.flush(
      { statusCode: 500, message: 'boom' },
      { status: 500, statusText: 'Server Error' },
    );
    harness.detectChanges();
  }

  function el(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function texto(): string {
    return el().textContent ?? '';
  }

  function moldura() {
    return {
      busca: el().querySelector('ion-searchbar') !== null,
      filtros: el().querySelector('app-property-filters-bar') !== null,
      fab: el().querySelector('ion-fab') !== null,
    };
  }

  it('a primeira carga ocupa a tela', async () => {
    const req = await abrir();
    expect(component.view()).toBe('loading');
    expect(texto()).toContain('HOME.LOADING');
    responder(req, []);
  });

  it('falha mostra erro, nao onboarding', async () => {
    falhar(await abrir());
    expect(component.view()).toBe('error');
    expect(texto()).toContain('HOME.ERROR_TEXT');
    expect(texto()).not.toContain('HOME.EMPTY_TITLE');
  });

  it('conta sem imoveis mostra o onboarding', async () => {
    responder(await abrir(), []);
    expect(component.view()).toBe('empty');
    expect(texto()).toContain('HOME.EMPTY_TITLE');
  });

  // Com o servidor filtrando, conta vazia e busca sem resultado chegam iguais:
  // zero imoveis. O que separa as duas e' ter havido criterio.
  it('zero resultados com filtro e "sem resultado", nao onboarding', async () => {
    responder(await abrir('/home?type=LAND'), []);
    expect(component.view()).toBe('no-results');
    expect(texto()).toContain('HOME.FILTERS.NO_RESULTS_FILTERS');
    expect(texto()).toContain('HOME.FILTERS.CLEAR');
    expect(texto()).not.toContain('HOME.EMPTY_TITLE');
  });

  it('zero resultados so com texto usa a mensagem com o termo', async () => {
    responder(await abrir('/home?q=zzz'), []);
    expect(component.view()).toBe('no-results');
    expect(texto()).toContain('HOME.NO_RESULTS');
    expect(texto()).not.toContain('HOME.FILTERS.NO_RESULTS_FILTERS');
  });

  it('os criterios da URL viram parametros da requisicao', async () => {
    const req = await abrir('/home?type=APARTMENT&purpose=RENT&location=Centro&q=cobertura');

    expect(req.request.params.get('type')).toBe('APARTMENT');
    expect(req.request.params.get('purpose')).toBe('RENT');
    expect(req.request.params.get('location')).toBe('Centro');
    // `q` na URL vira `search` na API.
    expect(req.request.params.get('search')).toBe('cobertura');

    responder(req, [imovel('1')]);
  });

  // Um link colado com valor fora do enum faria a API devolver 400, e a home
  // mostraria erro de servidor por causa de um erro de digitacao.
  it('valor invalido na URL nao chega na API', async () => {
    const req = await abrir('/home?type=CASTELO');
    expect(req.request.params.get('type')).toBeNull();
    responder(req, [imovel('1')]);
  });

  it('mudar filtro dispara uma requisicao, e uma so', async () => {
    responder(await abrir(), [imovel('1')]);
    const req = await refiltrar('/home?type=HOUSE');
    expect(req.request.params.get('type')).toBe('HOUSE');
    responder(req, [imovel('1')]);
  });

  // A moldura sobrevive a refiltragem — senao mexer num filtro faria a barra
  // sumir, e digitar na busca destruiria o campo em foco no meio da digitacao.
  it('a moldura fica de pe enquanto refiltra', async () => {
    responder(await abrir(), [imovel('1')]);
    expect(moldura()).toEqual({ busca: true, filtros: true, fab: true });

    const req = await refiltrar('/home?type=HOUSE');

    expect(component.view()).toBe('list');
    expect(component.refiltrando()).toBeTrue();
    expect(moldura()).toEqual({ busca: true, filtros: true, fab: true });
    expect(el().querySelector('ion-progress-bar')).not.toBeNull();

    responder(req, [imovel('1')]);
    expect(component.refiltrando()).toBeFalse();
    expect(el().querySelector('ion-progress-bar')).toBeNull();
  });

  it('explica no FAB que a acao cria um novo tour 360', async () => {
    responder(await abrir(), [imovel('1')]);

    const button = el().querySelector('ion-fab-button.home-new-tour');
    expect(button?.getAttribute('routerlink')).toBe('/tour/novo');
    expect(button?.querySelector('ion-icon')?.getAttribute('name')).toBe('add');
    expect(button?.textContent).toContain('HOME.NEW_TOUR_CTA');
  });

  it('busca, filtros e FAB somem em carregando e em erro', async () => {
    const req = await abrir();
    expect(component.view()).toBe('loading');
    expect(moldura()).toEqual({ busca: false, filtros: false, fab: false });

    falhar(req);

    expect(component.view()).toBe('error');
    expect(moldura()).toEqual({ busca: false, filtros: false, fab: false });
  });

  // A faixa fala do acervo. Com o servidor filtrando, `properties()` e' a
  // pagina filtrada, e a mesma frase passaria a falar do resultado da busca.
  it('a faixa de "sem tour" some com criterio ativo', async () => {
    responder(await abrir(), [imovel('1'), imovel('2')]);
    expect(component.mostrarFaixa()).toBeTrue();

    responder(await refiltrar('/home?type=HOUSE'), [imovel('1'), imovel('2')]);
    expect(component.view()).toBe('list');
    expect(component.mostrarFaixa()).toBeFalse();
  });

  it('a faixa tambem some so com texto de busca', async () => {
    responder(await abrir('/home?q=imovel'), [imovel('1'), imovel('2')]);
    expect(component.mostrarFaixa()).toBeFalse();
  });

  it('um imovel com tour ja derruba a faixa', async () => {
    responder(await abrir(), [
      imovel('1', { virtualTour: { id: 't1', status: 'DRAFT' } }),
      imovel('2'),
    ]);
    expect(component.mostrarFaixa()).toBeFalse();
  });

  it('a busca mostra o texto que veio da URL', async () => {
    responder(await abrir('/home?q=cobertura'), [imovel('1')]);
    const busca = el().querySelector('ion-searchbar') as HTMLIonSearchbarElement;
    expect(busca.value).toBe('cobertura');
  });

  // "Limpar filtros" limpa filtros. O texto tem caixa propria, visivel.
  it('limpar filtros mantem o texto da busca', async () => {
    responder(await abrir('/home?type=LAND&q=abc'), [imovel('1')]);

    component.limpar();
    await harness.fixture.whenStable();
    harness.detectChanges();

    const url = TestBed.inject(Router).url;
    expect(url).not.toContain('type=');
    expect(url).toContain('q=abc');

    responder(http.expectOne((r) => r.url.endsWith('/properties')), [imovel('1')]);
  });

  it('remover um chip tira so aquele filtro da URL', async () => {
    responder(await abrir('/home?type=LAND&purpose=SALE'), [imovel('1')]);

    component.removerChip('type');
    await harness.fixture.whenStable();
    harness.detectChanges();

    const url = TestBed.inject(Router).url;
    expect(url).not.toContain('type=');
    expect(url).toContain('purpose=SALE');

    responder(http.expectOne((r) => r.url.endsWith('/properties')), [imovel('1')]);
  });

  it('tentar de novo refaz a chamada com os mesmos criterios', async () => {
    falhar(await abrir('/home?type=HOUSE'));

    component.carregar();
    harness.detectChanges();

    const req = http.expectOne((r) => r.url.endsWith('/properties'));
    expect(req.request.params.get('type')).toBe('HOUSE');
    responder(req, [imovel('1')]);
    expect(component.view()).toBe('list');
  });

  // O que o `switchMap` compra: sem ele, a resposta lenta do criterio antigo
  // chega por ultimo e sobrescreve a tela com o resultado errado.
  it('resposta de criterio antigo nao sobrescreve a nova', async () => {
    responder(await abrir(), [imovel('1')]);

    await harness.navigateByUrl('/home?type=HOUSE');
    harness.detectChanges();
    await harness.navigateByUrl('/home?type=APARTMENT');
    harness.detectChanges();

    const pendentes = http.match((r) => r.url.endsWith('/properties'));
    expect(pendentes.length).toBe(2);
    expect(pendentes[0].cancelled).toBeTrue();

    pendentes[1].flush({ data: [imovel('9')], total: 1, page: 1, limit: 100, pages: 1 });
    harness.detectChanges();

    expect(component.properties().map((p) => p.id)).toEqual(['9']);
  });

  /**
   * A lista envelhecia na página em cache.
   *
   * O `<ion-router-outlet>` mantém a home VIVA enquanto o corretor está no
   * wizard, e o gatilho da consulta só dispara quando filtro muda. Voltar de
   * uma publicação com os mesmos critérios não emitia nada: ele acabava de
   * criar um imóvel e a tela principal não o reconhecia.
   *
   * O evento é empurrado no stream do `Router` em vez de navegar de verdade
   * porque é a única forma de reproduzir o cache aqui: uma navegação real neste
   * harness DESTRÓI a `HomePage`, e a seguinte criaria outra — que carrega no
   * `ngOnInit` de qualquer jeito, e o teste passaria sem exercitar nada.
   */
  it('recarrega a lista ao voltar de outra tela', async () => {
    responder(await abrir(), [imovel('1')]);
    const eventos = TestBed.inject(Router).events as unknown as Subject<Event>;

    eventos.next(new NavigationEnd(1, '/tour/novo', '/tour/novo'));
    eventos.next(new NavigationEnd(2, '/home', '/home'));
    harness.detectChanges();
    // A faixa de rascunhos volta pelo mesmo caminho, e também pede o dela.
    flushRascunhos();

    responder(
      http.expectOne((r) => r.url.endsWith('/properties')),
      [imovel('1'), imovel('2')],
    );

    expect(component.properties().map((p) => p.id)).toEqual(['1', '2']);
  });
});
