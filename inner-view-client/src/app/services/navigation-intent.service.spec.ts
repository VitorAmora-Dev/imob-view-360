import { TestBed } from '@angular/core/testing';

import { NavigationIntentService } from './navigation-intent.service';

describe('NavigationIntentService', () => {
  let service: NavigationIntentService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NavigationIntentService);
  });

  it('sem nada registrado nao devolve intencao', () => {
    expect(service.consume('p1')).toBeNull();
  });

  it('devolve a intencao registrada para o mesmo alvo', () => {
    service.register('p1', 'add-tour');
    expect(service.consume('p1')).toBe('add-tour');
  });

  // O consumo unico e' o que impede a intencao de disparar de novo na volta
  // pelo botao do navegador — foi o defeito que derrubou a versao por router
  // state, onde ela ressuscitava a cada bootstrap.
  it('consome de uma vez so', () => {
    service.register('p1', 'add-tour');

    expect(service.consume('p1')).toBe('add-tour');
    expect(service.consume('p1')).toBeNull();
  });

  // Navegacao abortada — por um guard, por exemplo — deixaria a intencao
  // pendurada; sem conferir o alvo ela dispararia na proxima pagina que
  // perguntasse.
  it('nao entrega intencao de outro alvo', () => {
    service.register('p1', 'add-tour');

    expect(service.consume('p2')).toBeNull();
    expect(service.consume('p1')).toBe('add-tour');
  });
});
