/** Ampliação máxima permitida no tour: 1,1×, isto é, dez por cento. */
export const ZOOM_MAXIMO_DO_TOUR = 0.1;

/**
 * Sensibilidade da roda em pixels.
 *
 * Uma roda tradicional costuma entregar cerca de 100 px por passo: dois
 * passos chegam ao teto. O trackpad entrega deltas menores e, por isso, mantém
 * a progressão contínua em vez de saltar direto para 10%.
 */
const ZOOM_POR_PIXEL_DA_RODA = 0.0005;

export function limitarZoomDoTour(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(ZOOM_MAXIMO_DO_TOUR, Math.max(0, valor));
}

/**
 * Converte a roda para a faixa lógica 0..0,1.
 * `deltaMode` pode vir em pixels, linhas ou páginas, conforme o dispositivo.
 */
export function zoomDepoisDaRoda(
  atual: number,
  deltaY: number,
  deltaMode: number = WheelEvent.DOM_DELTA_PIXEL,
): number {
  const multiplicador =
    deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 800
        : 1;

  return limitarZoomDoTour(atual - deltaY * multiplicador * ZOOM_POR_PIXEL_DA_RODA);
}

/**
 * Mantém a pinça proporcional: afastar os dedos em 10% produz 1,1×.
 * A função pura também protege o componente contra distâncias inválidas.
 */
export function zoomDepoisDaPinca(
  zoomInicial: number,
  distanciaInicial: number,
  distanciaAtual: number,
): number {
  if (
    !Number.isFinite(distanciaInicial) ||
    !Number.isFinite(distanciaAtual) ||
    distanciaInicial <= 0 ||
    distanciaAtual <= 0
  ) {
    return limitarZoomDoTour(zoomInicial);
  }

  return limitarZoomDoTour((1 + zoomInicial) * (distanciaAtual / distanciaInicial) - 1);
}
