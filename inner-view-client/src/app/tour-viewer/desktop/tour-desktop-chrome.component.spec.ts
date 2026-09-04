import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { Panorama, VirtualTour } from '../../models/virtual-tour.model';
import { VirtualTourService } from '../../services/virtual-tour.service';
import { PanoramaDownloadService } from '../sheets/manage/panorama-download.service';
import { TourViewerStore } from '../tour-viewer.store';
import { TourDesktopChromeComponent } from './tour-desktop-chrome.component';

const CENA: Panorama = {
  id: 'cena-1',
  roomName: 'Sala',
  imageUrl: '/panoramas/cena-1/image',
  order: 0,
  initialPanorama: true,
  originHotspots: [],
  measurements: [],
};

function tour(status: 'DRAFT' | 'PUBLISHED'): VirtualTour {
  return {
    id: 'tour-1',
    propertyId: 'imovel-1',
    status,
    createdAt: '',
    updatedAt: '',
    panoramas: [CENA],
  };
}

describe('TourDesktopChromeComponent', () => {
  let fixture: ComponentFixture<TourDesktopChromeComponent>;
  let store: TourViewerStore;
  let baixar: jasmine.Spy;
  const baixando = signal(false);

  beforeEach(async () => {
    baixar = jasmine.createSpy('baixar').and.resolveTo(true);
    baixando.set(false);

    await TestBed.configureTestingModule({
      imports: [TourDesktopChromeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        TourViewerStore,
        {
          provide: VirtualTourService,
          useValue: { publicarTour: () => of({ status: 'PUBLISHED' }) },
        },
        {
          provide: PanoramaDownloadService,
          useValue: { baixar, baixando: baixando.asReadonly() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourDesktopChromeComponent);
    store = TestBed.inject(TourViewerStore);
    store.property.set({ title: 'Casa Azul' } as never);
    store.tour.set(tour('DRAFT'));
    fixture.componentRef.setInput('panoramaAtual', CENA);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('mantém gestão fora do topo e agrupa as ações no rodapé', () => {
    const header = fixture.nativeElement.querySelector('app-header');
    const acoes = fixture.nativeElement.querySelector('.tv-desktop__acoes');

    expect(header.querySelector('.tv-desktop__acao')).toBeNull();
    expect(acoes.querySelector('[data-action="edit"]')).not.toBeNull();
    expect(acoes.querySelector('[data-action="embed"]')).not.toBeNull();
    expect(acoes.querySelector('[data-action="download"]')).not.toBeNull();
    expect(acoes.querySelector('[data-action="publish"]')).not.toBeNull();
    expect(acoes.querySelector('.tv-desktop__divisor')).not.toBeNull();
  });

  it('não exibe um segundo navegador de cenas no canto superior esquerdo', () => {
    expect(fixture.nativeElement.querySelector('.tv-desktop__contexto')).toBeNull();
    expect(fixture.nativeElement.querySelector('.tv-desktop__pill')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="TOUR_VIEWER.SCENES.OPEN_LIST"]'),
    ).toBeNull();
  });

  it('esconde Publicar quando o tour já está publicado', () => {
    store.tour.set(tour('PUBLISHED'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-action="publish"]')).toBeNull();
  });

  it('sem permissão de edição mantém Incorporar e Baixar cena', () => {
    fixture.componentRef.setInput('canEdit', false);
    fixture.detectChanges();

    const acoes = Array.from(
      fixture.nativeElement.querySelectorAll('.tv-desktop__acoes [data-action]'),
    ) as HTMLElement[];
    expect(acoes.map((acao) => acao.dataset['action'])).toEqual(['embed', 'download']);
  });

  it('baixa a cena realmente exibida com nome de arquivo legível', async () => {
    await fixture.componentInstance.baixarCena();

    expect(baixar).toHaveBeenCalledOnceWith('cena-1', 'Casa Azul - Sala.jpg');
    expect(store.toast()).toBe('TOUR_VIEWER.TOAST.DOWNLOAD_SUCCESS');
  });

  it('esconde Baixar cena enquanto nenhuma panorâmica terminou de carregar', () => {
    fixture.componentRef.setInput('panoramaAtual', null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-action="download"]')).toBeNull();
  });

  it('desabilita Baixar cena enquanto outro download está em andamento', () => {
    baixando.set(true);
    fixture.detectChanges();

    const botao = fixture.nativeElement.querySelector(
      '[data-action="download"]',
    ) as HTMLButtonElement;
    expect(botao.disabled).toBeTrue();
    expect(botao.getAttribute('aria-busy')).toBe('true');

    botao.click();
    expect(baixar).not.toHaveBeenCalled();
  });

  it('avisa quando o download falha', async () => {
    baixar.and.rejectWith(new Error('offline'));
    await fixture.componentInstance.baixarCena();

    expect(store.toast()).toBe('TOUR_VIEWER.TOAST.DOWNLOAD_ERROR');
  });

  it('o olho alterna o modo imersivo e mantém aria-pressed', () => {
    const olho = fixture.nativeElement.querySelector(
      '.tv-desktop__visualizacao-botao',
    ) as HTMLButtonElement;

    olho.click();
    fixture.detectChanges();

    expect(store.chromeVisible()).toBeFalse();
    expect(olho.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('.tv-desktop__acoes').classList)
      .toContain('is-hidden');
  });

  it('todo botão do cluster tem nome acessível e title', () => {
    const botoes = Array.from(
      fixture.nativeElement.querySelectorAll('.tv-desktop__acoes button'),
    ) as HTMLButtonElement[];

    expect(botoes.length).toBeGreaterThan(0);
    expect(botoes.every((botao) => Boolean(botao.getAttribute('aria-label')))).toBeTrue();
    expect(botoes.every((botao) => Boolean(botao.getAttribute('title')))).toBeTrue();
  });
});
