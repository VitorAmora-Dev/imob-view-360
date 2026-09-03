import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { Panorama, VirtualTour } from '../../../models/virtual-tour.model';
import { VirtualTourService } from '../../../services/virtual-tour.service';
import { TourViewerStore } from '../../tour-viewer.store';
import { TourManageSheetComponent } from './tour-manage-sheet.component';

const PANORAMA: Panorama = {
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
    panoramas: [PANORAMA],
  };
}

describe('TourManageSheetComponent', () => {
  let fixture: ComponentFixture<TourManageSheetComponent>;
  let component: TourManageSheetComponent;
  let store: TourViewerStore;
  let recordShare: jasmine.Spy;
  let publicarTour: jasmine.Spy;
  let shareOriginal: PropertyDescriptor | undefined;
  let clipboardOriginal: PropertyDescriptor | undefined;

  beforeEach(async () => {
    recordShare = jasmine.createSpy('recordShare').and.returnValue(of({}));
    publicarTour = jasmine.createSpy('publicarTour').and.returnValue(of({ status: 'PUBLISHED' }));
    shareOriginal = Object.getOwnPropertyDescriptor(navigator, 'share');
    clipboardOriginal = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    await TestBed.configureTestingModule({
      imports: [TourManageSheetComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        TourViewerStore,
        {
          provide: VirtualTourService,
          useValue: { recordShare, publicarTour },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourManageSheetComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(TourViewerStore);
    store.tour.set(tour('PUBLISHED'));
    store.property.set({ title: 'Casa Azul' } as never);
    fixture.detectChanges();
  });

  afterEach(() => {
    if (shareOriginal) Object.defineProperty(navigator, 'share', shareOriginal);
    else Reflect.deleteProperty(navigator, 'share');
    if (clipboardOriginal) Object.defineProperty(navigator, 'clipboard', clipboardOriginal);
    else Reflect.deleteProperty(navigator, 'clipboard');
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('esconde publicar e baixar quando os itens estão indisponíveis', () => {
    expect(component.podePublicar()).toBeFalse();
    expect(component.podeBaixar()).toBeFalse();
    expect(component.podeEditar()).toBeTrue();
    expect(component.podeCompartilhar()).toBeTrue();
  });

  it('leva Configurações para a etapa de informações da edição', () => {
    const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    component.abrirConfiguracoes();

    expect(navegar).toHaveBeenCalledWith(
      ['/tour', 'tour-1', 'editar'],
      { queryParams: { etapa: 4 } },
    );
  });

  it('publica somente o rascunho e remove o item depois do sucesso', async () => {
    store.tour.set(tour('DRAFT'));
    fixture.detectChanges();

    await component.publicar();
    fixture.detectChanges();

    expect(publicarTour).toHaveBeenCalledWith('tour-1');
    expect(store.tour()?.status).toBe('PUBLISHED');
    expect(store.toast()).toBe('TOUR_VIEWER.TOAST.PUBLISHED');
  });

  it('copia como fallback e registra o compartilhamento', async () => {
    const escrever = jasmine.createSpy('writeText').and.resolveTo();
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: escrever },
    });

    await component.compartilhar();

    expect(escrever).toHaveBeenCalledWith(`${window.location.origin}/embed/tour-1`);
    expect(recordShare).toHaveBeenCalledWith('tour-1', 'clipboard');
  });

  it('mantém o download da cena atual', async () => {
    fixture.componentRef.setInput('panoramaAtual', PANORAMA);
    const anchor = document.createElement('a');
    const click = spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.returnValue(anchor);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:cena');
    spyOn(URL, 'revokeObjectURL');
    spyOn(window, 'fetch').and.resolveTo(
      new Response(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), { status: 200 }),
    );

    await component.baixarCena();

    expect(click).toHaveBeenCalled();
    expect(anchor.download).toBe('Casa Azul - Sala.jpg');
    expect(store.toast()).toBe('TOUR_VIEWER.TOAST.DOWNLOAD_SUCCESS');
  });
});
