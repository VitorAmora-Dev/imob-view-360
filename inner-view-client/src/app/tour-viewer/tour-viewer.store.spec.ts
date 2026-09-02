import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Panorama, VirtualTour } from '../models/virtual-tour.model';
import { TourViewerStore } from './tour-viewer.store';

/**
 * Os invariantes de `06-state-behavior.md`, que o TV-0 declarou e a tela
 * inteira assume (TV-8).
 *
 * Eles moram no store justamente para continuarem verdadeiros quando a quarta
 * frente chegar — e é aqui que isso deixa de ser promessa. Sem estes casos, a
 * regra "sem chrome, sem hotspot" vale até alguém escrever um `@if` a mais no
 * template e ninguém perceber.
 */

function panorama(id: string, order: number): Panorama {
  return {
    id,
    roomName: `Cômodo ${order + 1}`,
    imageUrl: `/panoramas/${id}/image?v=1`,
    order,
    initialPanorama: order === 0,
    originHotspots: [],
    measurements: [],
  };
}

const TOUR: VirtualTour = {
  id: 't1',
  status: 'PUBLISHED',
  propertyId: 'p1',
  createdAt: '',
  updatedAt: '',
  panoramas: [panorama('a', 0), panorama('b', 1), panorama('c', 2)],
};

describe('TourViewerStore', () => {
  let store: TourViewerStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourViewerStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    store = TestBed.inject(TourViewerStore);
    store.tour.set(TOUR);
  });

  describe('navegação entre cenas', () => {
    it('os quatro caminhos chegam ao mesmo lugar', () => {
      // Miniatura e card do sheet mandam o índice; hotspot e pill mandam o id.
      // Se os dois divergissem, trocar de cena pela faixa e pelo ponto de
      // navegação levaria a estados diferentes para o mesmo cômodo.
      store.irParaCena(2);
      const porIndice = store.currentScene();

      store.irParaCena(0);
      store.irParaCenaPorId('c');

      expect(store.currentScene()).toEqual(porIndice!);
      expect(store.currentSceneIndex()).toBe(2);
    });

    it('ignora índice fora da faixa em vez de mostrar tela vazia', () => {
      store.irParaCena(1);

      store.irParaCena(9);
      store.irParaCena(-1);

      expect(store.currentSceneIndex()).toBe(1);
    });

    it('ignora id que não existe no tour', () => {
      store.irParaCena(1);

      store.irParaCenaPorId('cena-que-foi-apagada');

      expect(store.currentSceneIndex()).toBe(1);
    });
  });

  describe('invariantes da tela', () => {
    it('sem chrome não há hotspot — nem faixa de cenas', () => {
      store.alternarChrome();

      expect(store.chromeVisible()).toBeFalse();
      expect(store.hotspotsVisiveis()).toBeFalse();
      expect(store.faixaVisivel()).toBeFalse();
    });

    it('sheet aberto esconde a faixa, para não haver duas listas na tela', () => {
      store.abrirSheet('scenes');

      expect(store.faixaVisivel()).toBeFalse();
      // O chrome continua no ar: quem some é a faixa.
      expect(store.chromeVisible()).toBeTrue();
    });

    it('abrir um segundo sheet substitui o primeiro', () => {
      store.abrirSheet('embed');
      store.abrirSheet('delete');

      expect(store.sheet()).toBe('delete');
    });

    it('tour sem cenas não mostra faixa', () => {
      store.tour.set({ ...TOUR, panoramas: [] });

      expect(store.semCenas()).toBeTrue();
      expect(store.faixaVisivel()).toBeFalse();
    });
  });

  describe('link público', () => {
    it('sai vazio sem tour, para ninguém copiar meia URL', () => {
      store.tour.set(null);

      expect(store.linkPublico()).toBe('');
    });

    it('desligar os controles vira parâmetro na URL', () => {
      expect(store.linkPublico()).toBe(`${window.location.origin}/embed/t1`);

      store.embedShowControls.set(false);

      expect(store.linkPublico()).toBe(`${window.location.origin}/embed/t1?controles=0`);
    });
  });
});
