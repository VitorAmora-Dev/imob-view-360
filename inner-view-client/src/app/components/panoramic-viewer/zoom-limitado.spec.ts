import {
  ZOOM_MAXIMO_DO_TOUR,
  limitarZoomDoTour,
  zoomDepoisDaPinca,
  zoomDepoisDaRoda,
} from './zoom-limitado';

describe('zoom limitado do tour', () => {
  it('abre sem ampliação', () => {
    expect(limitarZoomDoTour(0)).toBe(0);
  });

  it('nunca sai da faixa de zero a cinquenta por cento', () => {
    expect(limitarZoomDoTour(-1)).toBe(0);
    expect(limitarZoomDoTour(1)).toBe(ZOOM_MAXIMO_DO_TOUR);
  });

  it('a roda aproxima e afasta sem atravessar os limites', () => {
    expect(zoomDepoisDaRoda(0, -10_000)).toBe(ZOOM_MAXIMO_DO_TOUR);
    expect(zoomDepoisDaRoda(ZOOM_MAXIMO_DO_TOUR, 10_000)).toBe(0);
  });

  it('a pinça de cinquenta por cento chega ao teto sem ultrapassá-lo', () => {
    expect(zoomDepoisDaPinca(0, 100, 150)).toBeCloseTo(ZOOM_MAXIMO_DO_TOUR, 8);
    expect(zoomDepoisDaPinca(0, 100, 300)).toBe(ZOOM_MAXIMO_DO_TOUR);
  });
});
