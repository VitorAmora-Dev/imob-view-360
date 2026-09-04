import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { Panorama, VirtualTour } from '../models/virtual-tour.model';
import { TourViewerPage } from './tour-viewer.page';
import { TourViewerStore } from './tour-viewer.store';
import { NavegacaoEntreTelas } from '../services/navegacao-entre-telas.service';
import { Subject } from 'rxjs';

/**
 * O que só se descobre com a tela montada e as folhas de estilo aplicadas.
 *
 * Estes casos existem por um defeito real, achado no navegador e não em teste:
 * a camada de hotspots ganhou a classe `.tv-slot` ao ser encaixada na página, e
 * a regra `pointer-events: auto` dos filhos do chrome — declarada DEPOIS, com a
 * mesma especificidade — venceu o `pointer-events: none` da camada. O resultado
 * foi uma placa invisível de `inset: 0` sobre a foto: o panorama parou de girar,
 * sem erro nenhum no console e com todos os 932 testes verdes.
 *
 * Nenhum teste de unidade pega isso, porque não há unidade errada. O que erra é
 * a CASCATA, e ela só existe quando as folhas se encontram.
 */

function panorama(id: string, order: number): Panorama {
  return {
    id,
    roomName: `Cômodo ${order + 1}`,
    // Data-URI de 1x1 para o viewer não sair pedindo foto ao servidor de teste.
    imageUrl:
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    order,
    initialPanorama: order === 0,
    // Cada cômodo com UM ponto, e com rótulos diferentes: é o rótulo que denuncia
    // de qual cena são os pins desenhados.
    originHotspots: [
      order === 0
        ? { id: 'h-a', positionX: 0.75, positionY: 0.6, targetId: 'b', label: 'Quarto' }
        : { id: 'h-b', positionX: 0.25, positionY: 0.6, targetId: 'a', label: 'Sala' },
    ],
    measurements: [],
  };
}

const TOUR: VirtualTour = {
  id: 't1',
  status: 'PUBLISHED',
  propertyId: 'p1',
  createdAt: '',
  updatedAt: '',
  panoramas: [panorama('a', 0), panorama('b', 1)],
};

describe('TourViewerPage — camadas da tela', () => {
  let fixture: ComponentFixture<TourViewerPage>;
  let page: TourViewerPage;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TourViewerPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'p1' }) } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourViewerPage);
    page = fixture.componentInstance;

    // O primeiro `detectChanges` roda o `ngOnInit`, e ele chama `carregar()`,
    // que liga o `loading` na primeira linha. Por isso os dados entram DEPOIS:
    // postos antes, o próprio init os cobriria com a tela de carregamento.
    //
    // A requisição fica pendurada no backend de teste e nunca é respondida — o
    // que está sob teste é o ARRANJO com dados na tela, não a busca deles.
    fixture.detectChanges();
    page.store.tour.set(TOUR);
    page.store.loading.set(false);
    fixture.detectChanges();

    // A primeira textura chegou. Faz parte da linha de base porque a camada de
    // hotspots segue a FOTO na tela, e nao a cena pedida: antes deste anuncio
    // nao existe foto, e portanto nao existe nada para desenhar em cima dela.
    page.aoTrocarPanorama(TOUR.panoramas[0]);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  function overlay(): HTMLElement {
    return fixture.nativeElement.querySelector('app-tv-hotspot-overlay');
  }

  it('a camada de hotspots NÃO intercepta o arrasto do panorama', () => {
    // O gesto principal desta tela é girar a foto. Uma camada de `inset: 0` com
    // `pointer-events: auto` por cima dela mata esse gesto inteiro.
    expect(getComputedStyle(overlay()).pointerEvents).toBe('none');
  });

  it('o container do chrome também não intercepta — só os filhos dele', () => {
    const chrome = fixture.nativeElement.querySelector('.tv-chrome') as HTMLElement;

    expect(getComputedStyle(chrome).pointerEvents).toBe('none');
  });

  it('os scrims não interceptam', () => {
    const scrims = fixture.nativeElement.querySelectorAll('.tv-scrim');

    expect(scrims.length).toBe(2);
    for (const scrim of scrims) {
      expect(getComputedStyle(scrim as HTMLElement).pointerEvents).toBe('none');
    }
  });

  /**
   * O mesmo defeito da camada de hotspots, um andar abaixo — e agora com a
   * barra de ações, que deixou de sumir por inteiro no imersivo para poder
   * carregar o botão que devolve a interface.
   *
   * `.tv-chrome > .tv-slot` dá `pointer-events: auto` a TODO slot, e o slot das
   * ações é uma faixa de ponta a ponta da tela. Sem a placa de vidro ela fica
   * invisível — mas transparência não conta para hit test, e ela continuaria
   * engolindo o arrasto do panorama nos 70px de baixo, que é justamente onde o
   * polegar começa o gesto. A regra que devolve o toque precisa VENCER a que o
   * tira, e é por isso que ela repete a âncora `.tv-chrome >`.
   */
  it('no imersivo a faixa das ações devolve o arrasto ao panorama', () => {
    const slot = fixture.nativeElement.querySelector('.tv-slot--acoes') as HTMLElement;
    expect(getComputedStyle(slot).pointerEvents).toBe('auto');

    page.store.chromeVisible.set(false);
    fixture.detectChanges();

    expect(slot.classList).toContain('is-imersivo');
    expect(getComputedStyle(slot).pointerEvents).toBe('none');
    // E o botão que sobrou continua clicável, senão não há volta.
    const botao = slot.querySelector('.tv-actions__button--visibility') as HTMLElement;
    expect(getComputedStyle(botao).pointerEvents).toBe('auto');
  });

  it('os hotspots vêm DEPOIS do chrome na ordem de tabulação', () => {
    // O handoff pede o Tab passando por voltar, título, pill e ações antes de
    // sair andando pela foto. Quem decide isso é a ordem no DOM; a pilha visual
    // continua sendo do z-index.
    const chrome = fixture.nativeElement.querySelector('.tv-chrome') as HTMLElement;
    const posicao = chrome.compareDocumentPosition(overlay());

    expect(posicao & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ---- a intenção contra a realidade --------------------------------------
  //
  // A tela tem duas noções de "cena atual". `store.currentScene()` é a
  // INTENÇÃO: vira no instante do toque. `cenaNaTela()` é a REALIDADE: vira
  // quando a textura chega, segundos depois num 4G. Tudo o que é desenhado em
  // cima da foto tem de ler da segunda, e os três casos abaixo são os lugares
  // onde ler da primeira dava defeito de verdade, visto no navegador.

  function rotulosDosPins(): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.tv-pin__placa') as NodeListOf<HTMLElement>,
    ).map((placa) => placa.textContent!.trim());
  }

  function avisoDeErro(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.tv-estado--sobre-a-foto');
  }

  it('não desenha pin nenhum antes de existir foto na tela', () => {
    // O palco ainda vazio: `currentSceneIndex` já aponta para a cena inicial e
    // `loading` já caiu, mas a primeira equirretangular não chegou. Ligado ao
    // store, o overlay pintava os pins da cena inicial sobre o nada.
    const zerado = TestBed.createComponent(TourViewerPage);
    zerado.detectChanges();
    zerado.componentInstance.store.tour.set(TOUR);
    zerado.componentInstance.store.loading.set(false);
    zerado.detectChanges();

    expect(zerado.nativeElement.querySelector('app-tv-hotspot-overlay')).toBeNull();
    zerado.destroy();
  });

  it('desenha os pins da cena que está NA TELA, e não da que acabou de ser pedida', () => {
    expect(rotulosDosPins()).toEqual(['Quarto']);

    // O toque. A textura da cena 'b' comeca a baixar e vai demorar.
    page.store.irParaCena(1);
    fixture.detectChanges();

    // A foto na tela ainda é a de 'a'. Os pins de 'b' aqui seriam posições de
    // OUTRA equirretangular projetadas nesta — boiando sobre nada, e clicáveis.
    expect(rotulosDosPins()).toEqual(['Quarto']);

    page.aoTrocarPanorama(TOUR.panoramas[1]);
    fixture.detectChanges();
    expect(rotulosDosPins()).toEqual(['Sala']);
  });

  /**
   * "Ocultar interface" esconde a MOLDURA, não a foto.
   *
   * O defeito: o modo imersivo levava junto os pontos de navegação entre
   * cenas. Como o toque na foto é o outro jeito de sair do imersivo, quem
   * ocultasse a interface para ver o cômodo inteiro ficava sem como ANDAR até
   * o cômodo seguinte — tinha que trazer a interface de volta primeiro. O
   * imersivo deixava de ser "ver a foto sem os controles" e virava "ver a foto
   * e não poder se mexer".
   *
   * O teste mora na página, e não no store, porque o que precisa ser provado é
   * o overlay RENDERIZADO — o store não tem mais opinião nenhuma sobre isso.
   */
  describe('modo imersivo', () => {
    function barraDeAcoes(): HTMLElement {
      return fixture.nativeElement.querySelector('app-tour-actions-bar');
    }

    it('esconde a moldura e mantém os pontos de navegação', () => {
      expect(rotulosDosPins()).toEqual(['Quarto']);

      page.store.alternarChrome();
      fixture.detectChanges();

      // A moldura foi mesmo embora — senão o teste passaria sem imersivo algum.
      expect(page.store.chromeVisible()).toBeFalse();
      expect(barraDeAcoes().classList).toContain('is-imersivo');
      expect(fixture.nativeElement.querySelector('app-tour-scenes-strip')).toBeNull();

      // E os pins continuam lá.
      expect(rotulosDosPins()).toEqual(['Quarto']);
    });

    it('e o pin continua levando para a outra cena', () => {
      page.store.alternarChrome();
      fixture.detectChanges();

      const pin = fixture.nativeElement.querySelector('.tv-pin') as HTMLButtonElement;
      pin.click();
      fixture.detectChanges();

      expect(page.store.currentSceneIndex()).toBe(1);
      // Navegar por um pin não devolve a interface: quem está no imersivo
      // pediu para ficar nele.
      expect(page.store.chromeVisible()).toBeFalse();
    });

    /**
     * O pin é um `<button>` sobre o canvas, e o viewer escuta o toque no
     * PRÓPRIO canvas. Se o pin deixasse o evento passar, um toque nele
     * navegaria E alternaria o chrome no mesmo gesto — a interface voltaria
     * sozinha ao andar pelo tour.
     */
    it('o pin intercepta o toque, e a camada em volta não', () => {
      const camada = fixture.nativeElement.querySelector('app-tv-hotspot-overlay');
      const pin = fixture.nativeElement.querySelector('.tv-pin') as HTMLElement;

      expect(getComputedStyle(camada).pointerEvents).toBe('none');
      expect(getComputedStyle(pin).pointerEvents).toBe('auto');
    });
  });

  it('a falha atrasada de uma cena abandonada não cobre a cena que está boa', () => {
    page.store.irParaCena(1);
    fixture.detectChanges();
    page.aoTrocarPanorama(TOUR.panoramas[1]);
    fixture.detectChanges();

    // A carga de 'a', que o corretor já abandonou, falha agora.
    page.aoFalharCena(TOUR.panoramas[0]);
    fixture.detectChanges();

    expect(avisoDeErro()).toBeNull();
  });

  it('o aviso de erro sai ao voltar para uma cena que está carregada', () => {
    page.store.irParaCena(1);
    fixture.detectChanges();
    page.aoFalharCena(TOUR.panoramas[1]);
    fixture.detectChanges();
    expect(avisoDeErro()).not.toBeNull();

    // De volta para 'a', que nunca saiu da tela. Repare que o efeito de
    // navegação NÃO roda aqui — a cena pedida volta a ser a que já está na
    // tela —, então não há `panoramaChange` para derrubar o aviso. Era
    // exatamente por isso que o booleano ficava preso.
    page.store.irParaCena(0);
    fixture.detectChanges();

    expect(avisoDeErro()).toBeNull();
  });

  // O caso "sem chrome, sem camada de hotspots" ERA testado aqui, e era o
  // defeito: ver o bloco `modo imersivo` acima, que agora prova o contrário.
});

/**
 * A tela voltou a aparecer — e o tour pode ter mudado enquanto ela esteve fora.
 *
 * O app usa `<ion-router-outlet>`, que MANTEM a pagina na pilha: sair daqui
 * para o wizard e voltar reusa esta mesma instancia, e `ngOnInit` — que e onde
 * `carregar()` e chamado — nao roda de novo. O corretor salvava a edicao, era
 * devolvido para ca pelo proprio salvamento (ver `edicaoSalva` na pagina do
 * wizard) e via o tour como ele era ANTES de editar. So ir ate a home e entrar
 * outra vez mostrava o resultado, porque so ai a pagina era destruida e criada.
 *
 * A regra ja existia no `NavegacaoEntreTelas`, escrita para a home; faltava
 * esta tela ser consumidora dela.
 */
describe('TourViewerPage — voltar de outra tela', () => {
  let fixture: ComponentFixture<TourViewerPage>;
  let voltou: Subject<void>;
  let ehEstaTela: ((caminho: string) => boolean) | null;

  beforeEach(async () => {
    voltou = new Subject<void>();
    ehEstaTela = null;

    await TestBed.configureTestingModule({
      imports: [TourViewerPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'p1' }) } },
        },
        {
          // Duble do servico, e nao eventos de Router de verdade: o que
          // interessa aqui e o que ESTA TELA faz com o aviso de retorno. Quando
          // o aviso chega e assunto do spec do proprio `NavegacaoEntreTelas`.
          provide: NavegacaoEntreTelas,
          useValue: {
            aoVoltarPara: (eh: (caminho: string) => boolean) => {
              ehEstaTela = eh;
              return voltou.asObservable();
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourViewerPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('recarrega o tour quando a tela volta a aparecer', () => {
    const store = fixture.debugElement.injector.get(TourViewerStore);
    const recarregar = spyOn(store, 'recarregar').and.resolveTo();

    voltou.next();

    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  /**
   * O criterio e o caminho DESTE imovel, e nao o prefixo da rota.
   *
   * Com prefixo, ir do tour de um imovel para o de outro nao contaria como ter
   * saido — e voltar tambem nao recarregaria, que e o mesmo defeito num lugar
   * novo. `/home` esta aqui para prender o caso obvio.
   */
  it('so reconhece a tela deste imovel', () => {
    expect(ehEstaTela).not.toBeNull();
    expect(ehEstaTela!('/inner-view-page/p1')).toBeTrue();
    expect(ehEstaTela!('/inner-view-page/p2')).toBeFalse();
    expect(ehEstaTela!('/home')).toBeFalse();
  });
});
