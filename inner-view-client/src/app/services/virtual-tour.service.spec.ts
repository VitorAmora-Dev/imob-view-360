import { HttpClient, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { environment } from '../../environments/environment';
import { VirtualTourService } from './virtual-tour.service';

/**
 * Espiona o `HttpClient` em vez de usar `HttpTestingController`: o que
 * importa aqui é a URL e o corpo que cada método monta, não o ciclo de vida
 * de uma requisição HTTP de verdade.
 */
describe('VirtualTourService', () => {
  let service: VirtualTourService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient()],
    });
    service = TestBed.inject(VirtualTourService);
  });

  it('pede a lista de rascunhos com o filtro de status', () => {
    const http = TestBed.inject(HttpClient);
    const get = spyOn(http, 'get').and.returnValue(of([]));

    service.listarRascunhos().subscribe();

    expect(get).toHaveBeenCalledWith(
      `${environment.apiUrl}/virtual-tours`,
      { params: { status: 'DRAFT' } },
    );
  });

  it('lê o rascunho pela rota autenticada, e não pela pública', () => {
    // `GET /virtual-tours/:id` é sem guard e filtra PUBLISHED: usá-la para
    // retomar devolveria 404 em todo rascunho.
    const http = TestBed.inject(HttpClient);
    const get = spyOn(http, 'get').and.returnValue(of({}));

    service.lerRascunho('t1').subscribe();

    expect(get).toHaveBeenCalledWith(`${environment.apiUrl}/virtual-tours/t1/rascunho`);
  });

  it('move um hotspot com PATCH, sem apagar e recriar', () => {
    const http = TestBed.inject(HttpClient);
    const patch = spyOn(http, 'patch').and.returnValue(of({ id: 'h1' }));

    service.atualizarHotspot('h1', { positionX: 0.4, positionY: 0.6 }).subscribe();

    expect(patch).toHaveBeenCalledWith(
      `${environment.apiUrl}/hotspots/h1`,
      { positionX: 0.4, positionY: 0.6 },
    );
  });
  /**
   * O `w` da rota de preview existia no servidor desde sempre e o cliente
   * nunca o mandava: toda miniatura baixava a equirretangular inteira.
   */
  it('pede a imagem reduzida quando quem chama diz de que tamanho precisa', () => {
    expect(service.urlDoPreview('p1', 'treated', { largura: 320 })).toBe(
      `${environment.apiUrl}/panoramas/p1/preview?variant=treated&w=320`,
    );
  });

  it('pede a imagem inteira quando ninguém diz o tamanho — é o caso do viewer', () => {
    expect(service.urlDoPreview('p1', 'treated')).toBe(
      `${environment.apiUrl}/panoramas/p1/preview?variant=treated`,
    );
  });

  it('leva a largura até o download do blob', () => {
    const http = TestBed.inject(HttpClient);
    const get = spyOn(http, 'get').and.returnValue(of(new Blob()));

    service.baixarPreview('p1', 'treated', 320).subscribe();

    // Só a URL: a sobrecarga de `get` que devolve blob tem um tipo de opções
    // que o `toHaveBeenCalledWith` do Jasmine não consegue casar.
    expect(get.calls.mostRecent().args[0]).toBe(
      `${environment.apiUrl}/panoramas/p1/preview?variant=treated&w=320`,
    );
  });
});
