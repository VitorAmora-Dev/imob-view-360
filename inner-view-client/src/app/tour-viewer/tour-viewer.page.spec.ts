import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { Panorama, VirtualTour } from '../models/virtual-tour.model';
import { TourViewerPage } from './tour-viewer.page';

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
    originHotspots:
      order === 0
        ? [{ id: 'h1', positionX: 0.75, positionY: 0.6, targetId: 'b', label: 'Quarto' }]
        : [],
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

  it('os hotspots vêm DEPOIS do chrome na ordem de tabulação', () => {
    // O handoff pede o Tab passando por voltar, título, pill e ações antes de
    // sair andando pela foto. Quem decide isso é a ordem no DOM; a pilha visual
    // continua sendo do z-index.
    const chrome = fixture.nativeElement.querySelector('.tv-chrome') as HTMLElement;
    const posicao = chrome.compareDocumentPosition(overlay());

    expect(posicao & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sem chrome, sem camada de hotspots', () => {
    page.store.alternarChrome();
    fixture.detectChanges();

    expect(overlay()).toBeNull();
  });
});
