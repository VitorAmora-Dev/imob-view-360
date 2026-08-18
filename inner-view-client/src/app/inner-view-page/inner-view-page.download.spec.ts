import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, ActivatedRoute } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { InnerViewPagePage } from './inner-view-page.page';
import { PropertyService } from '../services/property.service';
import { VirtualTourService } from '../services/virtual-tour.service';
import { Property } from '../models/property.model';
import { Panorama } from '../models/virtual-tour.model';

/**
 * Testa só o download do panorama atual, isolado do fluxo de rota/viewer:
 * o componente é construído com mocks e ngOnInit nunca roda (sem detectChanges),
 * então nada de rota, API ou three.js/WebGL entra no caminho.
 */
describe('InnerViewPagePage — download do panorama', () => {
  let toastCreate: jasmine.Spy;

  const panorama: Panorama = {
    id: 'p1',
    roomName: 'Sala',
    imageData: 'data:image/jpeg;base64,SGk=', // "Hi"
    order: 0,
    initialPanorama: true,
    originHotspots: [],
    measurements: [],
  };

  function makeComponent(): InnerViewPagePage {
    const present = jasmine.createSpy('present').and.resolveTo(undefined);
    toastCreate = jasmine.createSpy('create').and.resolveTo({ present });

    TestBed.configureTestingModule({
      imports: [InnerViewPagePage],
      providers: [
        provideHttpClient(),
        { provide: Router, useValue: {} },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'x' } } } },
        { provide: PropertyService, useValue: {} },
        { provide: VirtualTourService, useValue: {} },
        // Os QUATRO controllers que a página injeta precisam de dublê. O spec
        // dispensa o `provideIonicAngular()` de propósito, para ficar isolado do
        // viewer e da rota — mas isso significa que nada mais os fornece, e
        // faltar um derruba a construção do componente antes de o teste começar.
        { provide: AlertController, useValue: {} },
        { provide: ToastController, useValue: { create: toastCreate } },
        { provide: ModalController, useValue: {} },
        { provide: ActionSheetController, useValue: {} },
        provideTranslateService(),
      ],
    });
    return TestBed.createComponent(InnerViewPagePage).componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('não faz nada quando não há panorama atual', () => {
    const c = makeComponent();
    const create = spyOn(document, 'createElement').and.callThrough();
    c.onDownloadPanorama();
    expect(create).not.toHaveBeenCalled();
    expect(toastCreate).not.toHaveBeenCalled();
  });

  it('dispara o download com "imóvel - ambiente.jpg" e um blob URL', () => {
    const c = makeComponent();
    c.property = { title: 'Casa Azul' } as unknown as Property;
    c.currentPanorama = panorama;

    const anchor = document.createElement('a');
    const click = spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.returnValue(anchor);
    const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
    const revoke = spyOn(URL, 'revokeObjectURL');

    c.onDownloadPanorama();

    expect(createObjectUrl).toHaveBeenCalled();
    // o Blob decodificado tem os 2 bytes de "Hi"
    expect((createObjectUrl.calls.mostRecent().args[0] as Blob).size).toBe(2);
    expect(anchor.download).toBe('Casa Azul - Sala.jpg');
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    expect(toastCreate).toHaveBeenCalled(); // toast de sucesso
  });

  it('mostra toast de erro quando a imagem é inválida', () => {
    const c = makeComponent();
    c.property = { title: 'Casa' } as unknown as Property;
    c.currentPanorama = { ...panorama, imageData: 'data:image/jpeg;base64,@@@nao-base64' };

    c.onDownloadPanorama();

    expect(toastCreate).toHaveBeenCalled(); // caiu no catch → toast de erro
  });
});
