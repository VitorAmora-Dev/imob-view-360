import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';

import { environment } from '../../../environments/environment';
import { Panorama } from '../../models/virtual-tour.model';
import { CenasSheetComponent } from './cenas-sheet.component';

/**
 * O que se prova aqui NÃO é o desenho do sheet -- arrasto, trap de foco e
 * paradas são do `TourSheetComponent`, e o spec dele já os cobre. O que se
 * prova é o que é DESTE consumidor: a ordem dos cards, a contagem no
 * subtítulo, o marcador da cena vigente, a forma do card, o fechar-ao-escolher
 * e o caminho autenticado da miniatura.
 *
 * ESTE arquivo REGISTRA TRADUÇÕES DE VERDADE, e é o único da suíte que o faz.
 *
 * A convenção do repositório é a oposta: sem loader HTTP o `translate` devolve
 * a CHAVE, e asserir a chave mantém o teste imune a uma reescrita do pt.json.
 * Aqui ela não serve, e o motivo é concreto: um dos critérios da spec é "a
 * contagem do subtítulo bate com `cenas.length`", e a contagem só existe
 * DENTRO do texto interpolado. Com a chave crua no DOM,
 * `toBe('TOUR_VIEWER.SCENE_COUNT')` passa igual se o componente mandar `{ n: 3 }`
 * ou `{ n: 999 }` — foi assim que o `{ n }` ficou oito testes sem cobertura.
 *
 * O `MENSAGENS` abaixo é um dublê CURTO e local: nada aqui lê `pt.json`, então
 * uma reescrita do arquivo de tradução continua não quebrando este spec. O que
 * ele fixa é a FORMA da mensagem ("{{n}} cenas"), que é o que carrega o número.
 */
const MENSAGENS = {
  TOUR_VIEWER: {
    SCENE_COUNT: '{{n}} cenas',
    SCENE_COUNT_ONE: '1 cena',
    SCENES: {
      SHEET_TITLE: 'Cenas do tour',
      CURRENT_BADGE: 'ATUAL',
    },
  },
};

function cena(id: string, order: number): Panorama {
  return {
    id,
    roomName: `Ambiente ${id}`,
    imageUrl: `/panoramas/${id}/image`,
    order,
  } as unknown as Panorama;
}

describe('CenasSheetComponent', () => {
  let fixture: ComponentFixture<CenasSheetComponent>;
  let http: HttpTestingController;

  /** Tudo o que foi criado no teste, para o `afterEach` derrubar. */
  const criados: ComponentFixture<unknown>[] = [];

  /**
   * O conteúdo do `<ng-template>` do `IonModal` só entra no DOM quando ele
   * APRESENTA, e apresentar é assíncrono. Sem esperar, uma consulta pelos
   * cards acharia lista vazia e todo teste daqui passaria por vacuidade.
   */
  function apresentado(no: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      no.addEventListener('didPresent', () => resolve(), { once: true });
    });
  }

  /**
   * Monta o sheet já aberto e devolve o nó do `<ion-modal>`.
   *
   * O nó é capturado ANTES da apresentação, e não reconsultado depois: ao
   * apresentar, o Ionic TELEPORTA o `<ion-modal>` para o `<body>`, e
   * `fixture.nativeElement.querySelector('ion-modal')` passa a devolver
   * `null`. Todo o conteúdo do sheet -- a grade, os cards, o subtítulo -- está
   * dentro desse nó teleportado.
   */
  async function abrir(cenas: Panorama[], atualId: string | null = null): Promise<HTMLElement> {
    fixture = TestBed.createComponent(CenasSheetComponent);
    criados.push(fixture);
    fixture.componentRef.setInput('cenas', cenas);
    fixture.componentRef.setInput('atualId', atualId);
    fixture.componentRef.setInput('aberto', true);
    fixture.detectChanges();

    const no = fixture.nativeElement.querySelector('ion-modal') as HTMLElement;
    await apresentado(no);
    return no;
  }

  const cards = (no: HTMLElement): HTMLElement[] =>
    Array.from(no.querySelectorAll<HTMLElement>('.cenas-sheet__card'));

  /** Toda requisição pendente à rota de preview -- é o CUSTO do sheet aberto. */
  const pedidosDeMiniatura = () =>
    http.match((r) => r.url.includes('/panoramas/') && r.url.includes('/preview'));

  /**
   * Responde a todos os downloads de miniatura e deixa o DOM assentar.
   *
   * Os `blob:` só chegam ao `<img>` depois que a promessa do
   * `PanoramaImageCache` resolve, e resolver é microtask -- sem o
   * `whenStable` a asserção mediria o card ainda vazio.
   */
  async function entregarMiniaturas(): Promise<void> {
    for (const req of pedidosDeMiniatura()) {
      req.flush(new Blob(['x'], { type: 'image/jpeg' }));
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    // Ver o cabeçalho do arquivo: aqui a chave crua não prova a contagem.
    TestBed.inject(TranslateService).setTranslation('pt', MENSAGENS, true);
  });

  /**
   * Um `IonModal` apresentado prende o foco no DOCUMENTO, que é um só para a
   * suíte inteira e sobrevive ao teardown do TestBed. `backdrop-no-scroll` sai
   * junto: é ele quem trava a rolagem da PÁGINA, e um resto dele aqui deixaria
   * as suítes seguintes rodando com `overflow: hidden` no documento.
   */
  afterEach(() => {
    while (criados.length) criados.pop()!.destroy();
    document.querySelectorAll('ion-modal').forEach((m) => m.remove());
    document.body.classList.remove('backdrop-no-scroll');
    (document.activeElement as HTMLElement | null)?.blur();
  });

  /**
   * A entrada vem FORA de ordem de propósito: com um array já ordenado o teste
   * passaria mesmo se o componente ignorasse `order` e renderizasse `cenas()`
   * cru.
   */
  it('monta um card por cena, em ordem crescente de order', async () => {
    const no = await abrir([cena('c', 3), cena('a', 1), cena('b', 2)]);

    expect(cards(no).map((b) => b.getAttribute('data-cena'))).toEqual(['a', 'b', 'c']);
  });

  /**
   * O NÚMERO no subtítulo, e não só a chave.
   *
   * A spec lista "a contagem do subtítulo bate com `cenas.length`" como
   * critério. Asserir `'TOUR_VIEWER.SCENE_COUNT'` distinguia apenas plural de
   * singular: `{ n: 999 }` passava igual. Três cenas precisam dizer três.
   */
  it('mostra o titulo e a contagem REAL no plural quando ha varias cenas', async () => {
    const no = await abrir([cena('a', 1), cena('b', 2), cena('c', 3)]);

    expect(no.querySelector('.tour-sheet__titulo')?.textContent?.trim())
      .toBe('Cenas do tour');
    expect(no.querySelector('.tour-sheet__sub')?.textContent?.trim())
      .withContext('o subtitulo precisa contar as cenas que estao na grade')
      .toBe('3 cenas');
  });

  /**
   * Trinta cenas, contadas. Um segundo volume porque um `{ n: 3 }` fixo
   * passaria no teste acima — o que amarra o número a `cenas.length` é ele
   * mudar junto.
   */
  it('a contagem acompanha o tamanho da lista, e nao um numero fixo', async () => {
    const no = await abrir(Array.from({ length: 30 }, (_, i) => cena(`p${i}`, i)));

    expect(no.querySelector('.tour-sheet__sub')?.textContent?.trim()).toBe('30 cenas');
  });

  // A chave separada existe porque o ngx-translate nao faz plural sozinho: sem
  // ela o sheet de uma cena so anunciaria "1 cenas".
  it('com uma cena so, usa a chave singular e nao quebra', async () => {
    const no = await abrir([cena('a', 1)]);

    expect(cards(no).length).toBe(1);
    expect(no.querySelector('.tour-sheet__sub')?.textContent?.trim())
      .toBe('1 cena');
  });

  /**
   * Trocar de idioma com o sheet ABERTO precisa retraduzir o subtítulo.
   *
   * O `legenda()` era um `computed` sobre `translate.instant`, e `instant` não
   * é sinal: nada invalidava o cache. Com a página aberta, pt→en dava
   * cabeçalho híbrido -- o título (pipe) virava inglês e o subtítulo não. O
   * mesmo cache congelava a CHAVE para sempre quando o JSON das traduções
   * ainda não tinha chegado na primeira detecção de mudanças (o `main.ts`
   * carrega por HTTP, sem `APP_INITIALIZER` bloqueante).
   */
  it('o subtitulo acompanha a troca de idioma com o sheet aberto', async () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { TOUR_VIEWER: { SCENE_COUNT: '{{n}} scenes' } }, true);

    const no = await abrir([cena('a', 1), cena('b', 2)]);
    expect(no.querySelector('.tour-sheet__sub')?.textContent?.trim()).toBe('2 cenas');

    translate.use('en');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(no.querySelector('.tour-sheet__sub')?.textContent?.trim())
      .withContext('o subtitulo congelou no idioma anterior')
      .toBe('2 scenes');
  });

  /**
   * Trinta cenas é o volume que o escopo cita, e o que ele exige é que a grade
   * ROLE em vez de crescer para fora do sheet.
   *
   * `scrollTop` é a asserção que importa: um elemento não rolável IGNORA a
   * atribuição e continua em zero, enquanto `scrollHeight > clientHeight` é
   * verdade até com `overflow: visible` e passaria sem o `overflow-y: auto`.
   */
  it('com trinta cenas, a grade rola em vez de estourar o sheet', async () => {
    const muitas = Array.from({ length: 30 }, (_, i) => cena(`p${i}`, i));
    const no = await abrir(muitas);

    expect(cards(no).length).toBe(30);

    const grade = no.querySelector('.cenas-sheet__grade') as HTMLElement;
    expect(grade.scrollHeight)
      .withContext('trinta cards precisam passar da altura maxima da grade')
      .toBeGreaterThan(grade.clientHeight);

    grade.scrollTop = 200;

    expect(grade.scrollTop)
      .withContext('a grade foi cortada em vez de rolada')
      .toBeGreaterThan(0);
  });

  /**
   * O badge é pílula E `aria-current`: um leitor de tela não vê a pílula, e
   * marcar só visualmente deixaria quem navega por leitor sem saber onde está.
   */
  it('marca so a cena vigente, no visual e no aria-current', async () => {
    const no = await abrir([cena('a', 1), cena('b', 2), cena('c', 3)], 'b');
    const lista = cards(no);

    const comBadge = lista.filter((b) => b.querySelector('.cenas-sheet__badge'));
    expect(comBadge.map((b) => b.getAttribute('data-cena'))).toEqual(['b']);
    expect(comBadge[0].querySelector('.cenas-sheet__badge')?.textContent?.trim())
      .toBe('ATUAL');

    const marcados = lista.filter((b) => b.getAttribute('aria-current') === 'true');
    expect(marcados.map((b) => b.getAttribute('data-cena'))).toEqual(['b']);
  });

  // `<button>` e nao `<div (click)>`: o card precisa de foco por teclado e de
  // papel de controle. Uma div com click e' invisivel para o Tab e ainda assim
  // troca de cena.
  it('o card e um botao de verdade', async () => {
    const no = await abrir([cena('a', 1)]);
    const card = cards(no)[0];

    expect(card.tagName).toBe('BUTTON');
    expect(card.getAttribute('type')).toBe('button');
  });

  /**
   * Fechar ao escolher é regra DESTE sheet, e por isso mora aqui: deixá-la com
   * quem escuta `(selecionada)` faria cada consumidor futuro reimplementá-la.
   */
  it('escolher emite a cena e fecha o sheet', async () => {
    const no = await abrir([cena('a', 1), cena('b', 2)], 'a');
    const escolhidas: Panorama[] = [];
    const fechamentos: number[] = [];
    fixture.componentInstance.selecionada.subscribe((c) => escolhidas.push(c));
    fixture.componentInstance.fechado.subscribe(() => fechamentos.push(1));

    cards(no)[1].click();

    expect(escolhidas.map((c) => c.id)).toEqual(['b']);
    // Pedir o fechamento continua sendo regra DESTE sheet (o TV-4 mantém o
    // dele aberto ao copiar). O que mudou é quem obedece: antes ele mesmo
    // escrevia num store global; agora avisa a tela, que é quem sabe.
    expect(fechamentos.length)
      .withContext('escolher uma cena não pediu para fechar')
      .toBe(1);
  });


  /**
   * A corrida do carregamento: as traducoes chegam DEPOIS da primeira
   * deteccao de mudancas.
   *
   * O `main.ts` carrega o JSON por HTTP sem `APP_INITIALIZER` bloqueante, e o
   * `app-cenas-sheet` vive no template da pagina -- o subtitulo e' avaliado
   * antes de o arquivo chegar. Se o valor congelasse ali, o sheet mostraria
   * `TOUR_VIEWER.SCENE_COUNT` para sempre.
   */
  it('o subtitulo se corrige quando as traducoes chegam depois da montagem', async () => {
    const translate = TestBed.inject(TranslateService);
    // Apaga a mensagem: e' o estado de "o JSON ainda nao chegou".
    translate.setTranslation('pt', { TOUR_VIEWER: { SCENE_COUNT: 'AINDA NAO' } }, true);

    const no = await abrir([cena('a', 1), cena('b', 2)]);
    expect(no.querySelector('.tour-sheet__sub')?.textContent?.trim()).toBe('AINDA NAO');

    translate.setTranslation('pt', { TOUR_VIEWER: { SCENE_COUNT: '{{n}} cenas' } }, true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(no.querySelector('.tour-sheet__sub')?.textContent?.trim())
      .withContext('o subtitulo congelou no valor da primeira deteccao de mudancas')
      .toBe('2 cenas');
  });

  /**
   * A miniatura chega por `blob:`, e NUNCA por `<img src="/api/...">`.
   *
   * A rota `/panoramas/:id/preview` é autenticada (`JwtAccessGuard`), o token
   * mora no `localStorage` e a tag `<img>` não passa pelo `authInterceptor` --
   * ela não tem como levar o token. Apontar o `src` para a API dava 401 e
   * trinta retângulos vazios distinguíveis só pelo nome. O caminho é
   * `HttpClient` → `blob:` → tela, igual ao que `lista-de-rascunhos` já faz.
   *
   * A asserção é sobre COMPORTAMENTO -- o esquema do `src` que o navegador vai
   * buscar --, e não sobre a string da URL: era justamente uma asserção de
   * string que passava verde com a implementação errada.
   */
  it('a miniatura chega como blob autenticado, e nao como URL da API', async () => {
    const no = await abrir([cena('a', 1)]);

    const pedidos = pedidosDeMiniatura();
    expect(pedidos.length)
      .withContext('a miniatura nao passou pelo HttpClient')
      .toBe(1);
    expect(pedidos[0].request.responseType)
      .withContext('sem responseType blob nao ha o que virar object URL')
      .toBe('blob');

    pedidos[0].flush(new Blob(['x'], { type: 'image/jpeg' }));

    // Um `setTimeout(0)` e não só `whenStable()`: entre o flush e o `src` na
    // tela há uma cadeia de tres microtasks -- `firstValueFrom` resolve, o
    // cache faz `createObjectURL` e devolve, e so entao o componente escreve
    // o sinal. Uma macrotask drena as tres; `whenStable()` sozinho volta
    // antes e le o `<img>` ainda sem `src`.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const src = no.querySelector('.cenas-sheet__thumb')?.getAttribute('src') ?? '';
    expect(src)
      .withContext('o <img> ficou apontando para um endereco que ele nao sabe autenticar')
      .toMatch(/^blob:/);
  });

  /**
   * O `w=320` é o que torna trinta cenas viável: sem esse parâmetro a rota
   * devolve a equirretangular inteira -- dezenas de MB por cômodo.
   *
   * A URL INTEIRA, e não `toContain('w=320')`: `w=3200` contém `w=320`, e uma
   * largura 10× maior é exatamente a regressão que a constante existe para
   * impedir. Mesmo critério de `virtual-tour.service.spec.ts`, que compara a
   * URL montada com `toBe`.
   */
  it('pede a miniatura tratada reduzida a exatamente 320 de largura', async () => {
    await abrir([cena('a', 1)]);

    const pedido = http.expectOne(
      `${environment.apiUrl}/panoramas/a/preview?variant=treated&w=320`,
    );
    expect(pedido.request.method).toBe('GET');
  });

  /**
   * O CUSTO de trinta cenas, medido: trinta downloads de 320px, e nenhum antes
   * de o sheet abrir.
   *
   * Carregar todas de uma vez é o precedente da casa (`lista-de-rascunhos`
   * dispara um download por rascunho no `ngOnInit`) e substitui o
   * `loading="lazy"` que o `<img>` tinha -- `blob:` já está baixado quando
   * chega ao `src`, então `lazy` deixaria de economizar de qualquer forma. O
   * que segura a conta é o `w=320` (dezenas de KB por cenário em vez da
   * equirretangular inteira) e o gatilho ser a ABERTURA do sheet: o
   * `app-cenas-sheet` vive no template da página, e disparar no construtor
   * cobraria trinta downloads de quem nunca tocou no botão.
   */
  it('trinta cenas custam trinta downloads, e so depois de o sheet abrir', async () => {
    const muitas = Array.from({ length: 30 }, (_, i) => cena(`p${i}`, i));

    fixture = TestBed.createComponent(CenasSheetComponent);
    criados.push(fixture);
    fixture.componentRef.setInput('cenas', muitas);
    fixture.detectChanges();

    expect(pedidosDeMiniatura().length)
      .withContext('baixou miniatura com o sheet fechado')
      .toBe(0);

    fixture.componentRef.setInput('aberto', true);
    fixture.detectChanges();

    expect(pedidosDeMiniatura().length).toBe(30);
  });

  /**
   * Reabrir o sheet não rebaixa nada: o `PanoramaImageCache` guarda por
   * `(id, variante, largura)`. Sem isso, cada toque no botão custaria trinta
   * downloads de novo.
   */
  it('reabrir o sheet nao rebaixa as miniaturas', async () => {
    await abrir([cena('a', 1), cena('b', 2)]);
    await entregarMiniaturas();

    fixture.componentRef.setInput('aberto', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('aberto', true);
    fixture.detectChanges();

    expect(pedidosDeMiniatura().length)
      .withContext('o cache foi ignorado ao reabrir')
      .toBe(0);
  });

  /**
   * O nome do cômodo tem ellipsis. Sem `title`, "Suíte máster com closet e
   * varanda gourmet" vira "Suíte máster co..." e não há gesto que revele o
   * resto.
   */
  it('o card expoe o nome inteiro do comodo em title', async () => {
    const no = await abrir([cena('a', 1)]);

    expect(cards(no)[0].getAttribute('title')).toBe('Ambiente a');
  });
});
