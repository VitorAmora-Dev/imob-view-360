import { DestroyRef, Signal, inject, signal } from '@angular/core';

/**
 * Corte do responsivo do wizard, em JS.
 *
 * É o mesmo 767px do mixin `tw-mobile`, repetido aqui porque
 * `_tour-wizard-mixins.scss` está CONGELADO (só muda por PR para a branch de
 * integração) e não pode virar fonte de verdade para o TypeScript no meio do
 * sprint. Se um dia o corte mudar, muda nos dois — daí o nome exportado, para
 * que uma busca por `TW_MOBILE_QUERY` ache todo mundo.
 */
export const TW_MOBILE_QUERY = '(max-width: 767px)';

/**
 * `true` enquanto a viewport for de celular.
 *
 * Existe porque o bottom sheet precisa NÃO EXISTIR no desktop, e não apenas
 * ficar invisível: um `IonModal` escondido por CSS continua prendendo o foco,
 * travando o scroll da página e respondendo ao Esc. A diferença entre "some da
 * vista" e "não está lá" é a diferença entre um painel ao lado do viewer e um
 * teclado que não sai mais do modal.
 *
 * Chamar em contexto de injeção — o listener é solto junto com o componente.
 */
export function isMobileViewport(): Signal<boolean> {
  const media = matchMedia(TW_MOBILE_QUERY);
  const mobile = signal(media.matches);
  const aoMudar = () => mobile.set(media.matches);

  media.addEventListener('change', aoMudar);
  inject(DestroyRef).onDestroy(() => media.removeEventListener('change', aoMudar));

  return mobile.asReadonly();
}
