import { TestBed } from '@angular/core/testing';

import { TourSheetStore } from './tour-sheet.store';

describe('TourSheetStore', () => {
  let store: TourSheetStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(TourSheetStore);
  });

  it('nasce sem nenhum sheet aberto', () => {
    expect(store.aberto()).toBeNull();
  });

  it('abrir marca qual sheet esta aberto', () => {
    store.abrir('cenas');
    expect(store.aberto()).toBe('cenas');
  });

  // O criterio de aceite "abrir um segundo sheet nao empilha". Aqui ele e'
  // verdadeiro por construcao -- nao existe onde guardar o segundo -- e este
  // teste so registra a intencao para quem for tentar transformar isto numa
  // pilha sem ler a spec.
  it('abrir outro SUBSTITUI o atual, nao empilha', () => {
    store.abrir('cenas');
    store.abrir('gerenciar');

    expect(store.aberto()).toBe('gerenciar');
  });

  it('fechar volta ao estado sem sheet', () => {
    store.abrir('cenas');
    store.fechar();
    expect(store.aberto()).toBeNull();
  });
});
