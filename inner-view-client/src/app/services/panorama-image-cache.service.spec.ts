import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { PanoramaImageCache } from './panorama-image-cache.service';
import { VirtualTourService } from './virtual-tour.service';

/**
 * A rota de preview é autenticada, então o `TextureLoader` não consegue
 * buscá-la: ele não passa por interceptor e não teria como levar o token. O
 * caminho obrigatório é `HttpClient` → `blob:` → viewer, e este serviço é o
 * dono desses blobs — sem um dono, cada cômodo aberto deixa alguns MB presos
 * até a aba fechar.
 */
describe('PanoramaImageCache', () => {
  let cache: PanoramaImageCache;
  let baixar: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    cache = TestBed.inject(PanoramaImageCache);
    baixar = spyOn(TestBed.inject(VirtualTourService), 'baixarPreview')
      .and.returnValue(of(new Blob(['x'], { type: 'image/jpeg' })));
  });

  afterEach(() => cache.liberar());

  it('baixa uma vez e reaproveita na segunda chamada', async () => {
    const a = await cache.obter('p1', 'treated');
    const b = await cache.obter('p1', 'treated');

    expect(a).toBe(b);
    expect(baixar).toHaveBeenCalledTimes(1);
  });

  it('trata tratada e original como imagens diferentes', async () => {
    // Sem separar por variante, o "ver original" da etapa 2 receberia de volta
    // a tratada — o mesmo tipo de colisão que o ETag da rota já evita.
    const tratada = await cache.obter('p1', 'treated');
    const original = await cache.obter('p1', 'original');

    expect(tratada).not.toBe(original);
    expect(baixar).toHaveBeenCalledTimes(2);
  });

  it('não dispara dois downloads para chamadas simultâneas', async () => {
    const [a, b] = await Promise.all([
      cache.obter('p1', 'treated'),
      cache.obter('p1', 'treated'),
    ]);

    expect(a).toBe(b);
    expect(baixar).toHaveBeenCalledTimes(1);
  });

  /**
   * A miniatura de 320px e a equirretangular inteira são imagens diferentes do
   * mesmo cômodo. Sem a largura na chave, o card da etapa 1 — que carrega
   * primeiro — deixaria a versão pequena na entrada que o viewer da etapa 2 lê
   * depois, e a esfera abriria borrada sem nenhuma requisição para denunciar.
   */
  it('trata larguras diferentes como imagens diferentes', async () => {
    const cheia = await cache.obter('p1', 'treated');
    const miniatura = await cache.obter('p1', 'treated', 320);

    expect(cheia).not.toBe(miniatura);
    expect(baixar).toHaveBeenCalledTimes(2);
    expect(baixar).toHaveBeenCalledWith('p1', 'treated', undefined);
    expect(baixar).toHaveBeenCalledWith('p1', 'treated', 320);
  });

  it('reaproveita a miniatura já baixada, sem voltar à rede', async () => {
    const a = await cache.obter('p1', 'treated', 320);
    const b = await cache.obter('p1', 'treated', 320);

    expect(a).toBe(b);
    expect(baixar).toHaveBeenCalledTimes(1);
  });

  it('liberar solta a foto cheia e a miniatura do mesmo cômodo', async () => {
    // A varredura é por prefixo de panorama: as duas entradas do mesmo cômodo
    // têm que sair juntas, senão descartar um rascunho deixaria a miniatura
    // dele presa até a aba fechar.
    const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
    await cache.obter('p1', 'treated');
    await cache.obter('p1', 'treated', 320);

    cache.liberar('p1');

    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('liberar revoga e força novo download', async () => {
    const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
    await cache.obter('p1', 'treated');

    cache.liberar('p1');
    await cache.obter('p1', 'treated');

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(baixar).toHaveBeenCalledTimes(2);
  });
});
