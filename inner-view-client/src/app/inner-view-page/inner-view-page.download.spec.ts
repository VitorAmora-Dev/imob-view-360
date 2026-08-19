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
    imageUrl: '/panoramas/p1/image?v=1',
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

  it('não faz nada quando não há panorama atual', async () => {
    const c = makeComponent();
    const create = spyOn(document, 'createElement').and.callThrough();
    await c.onDownloadPanorama();
    expect(create).not.toHaveBeenCalled();
    expect(toastCreate).not.toHaveBeenCalled();
  });

  it('busca a imagem pela URL do panorama e dispara o download', async () => {
    const c = makeComponent();
    c.property = { title: 'Casa Azul' } as unknown as Property;
    c.currentPanorama = panorama;

    const anchor = document.createElement('a');
    const click = spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.returnValue(anchor);
    const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
    const revoke = spyOn(URL, 'revokeObjectURL');
    const buscar = spyOn(window, 'fetch').and.resolveTo(
      new Response(new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }), { status: 200 }),
    );

    await c.onDownloadPanorama();

    // O endereço pedido é o do panorama, e não um data-URI: é isso que faz o
    // download reaproveitar o que o visualizador já baixou.
    expect(buscar.calls.mostRecent().args[0] as string).toContain('/panoramas/p1/image');
    expect(createObjectUrl).toHaveBeenCalled();
    expect((createObjectUrl.calls.mostRecent().args[0] as Blob).size).toBe(2);
    expect(anchor.download).toBe('Casa Azul - Sala.jpg');
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    expect(toastCreate).toHaveBeenCalled(); // toast de sucesso
  });

  it('mostra toast de erro quando o servidor recusa a imagem', async () => {
    const c = makeComponent();
    c.property = { title: 'Casa' } as unknown as Property;
    c.currentPanorama = panorama;
    spyOn(window, 'fetch').and.resolveTo(new Response('', { status: 404 }));

    await c.onDownloadPanorama();

    expect(toastCreate).toHaveBeenCalled(); // caiu no catch → toast de erro
  });
});
