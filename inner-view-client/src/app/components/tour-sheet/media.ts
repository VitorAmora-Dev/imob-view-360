import { DestroyRef, Signal, inject, signal } from '@angular/core';

/**
 * Corte do responsivo do visualizador, em JS.
 *
 * É o mesmo 767px do `TW_MOBILE_QUERY` em
 * `tour-wizard/hotspots/media.ts`, repetido aqui de propósito: aquele arquivo
 * é do domínio do wizard e espelha um mixin CONGELADO, que só muda por PR para
 * a branch de integração. Importar de lá amarraria o visualizador a um corte
 * que não é dele.
 *
 * Se um dia o corte mudar, muda nos dois — daí o nome exportado, para que uma
 * busca por `TOUR_MOBILE_QUERY` ache este lado.
 */
export const TOUR_MOBILE_QUERY = '(max-width: 767px)';

/**
 * Sinal que acompanha a largura da janela.
 *
 * Chamar em contexto de injeção — o listener é solto junto com o componente.
 */
export function emViewportMobile(): Signal<boolean> {
  const media = matchMedia(TOUR_MOBILE_QUERY);
  const valor = signal(media.matches);
  const aoMudar = () => valor.set(media.matches);

  media.addEventListener('change', aoMudar);
  inject(DestroyRef).onDestroy(() => media.removeEventListener('change', aoMudar));

  return valor.asReadonly();
}
