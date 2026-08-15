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

/** Preferência do sistema por menos movimento. */
export const TW_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Sinal que acompanha uma media query.
 *
 * Chamar em contexto de injeção — o listener é solto junto com o componente.
 */
function sinalDeMedia(consulta: string): Signal<boolean> {
  const media = matchMedia(consulta);
  const valor = signal(media.matches);
  const aoMudar = () => valor.set(media.matches);

  media.addEventListener('change', aoMudar);
  inject(DestroyRef).onDestroy(() => media.removeEventListener('change', aoMudar));

  return valor.asReadonly();
}

/**
 * `true` enquanto a viewport for de celular.
 *
 * Existe porque o bottom sheet precisa NÃO EXISTIR no desktop, e não apenas
 * ficar invisível: um `IonModal` escondido por CSS continua prendendo o foco,
 * travando o scroll da página e respondendo ao Esc. A diferença entre "some da
 * vista" e "não está lá" é a diferença entre um painel ao lado do viewer e um
 * teclado que não sai mais do modal.
 */
export function isMobileViewport(): Signal<boolean> {
  return sinalDeMedia(TW_MOBILE_QUERY);
}

/**
 * `true` quando o sistema pede menos movimento (B12).
 *
 * Em CSS isso se resolve numa media query, e a maior parte do wizard já resolve
 * assim — `tour-wizard.scss` zera os tokens de transição. Aqui é para o que o
 * CSS não alcança: o laço de frame do overlay reescreve `transform` sessenta
 * vezes por segundo, e um `scale` posto por classe seria sobrescrito no frame
 * seguinte. Quem decide se ele entra é o TypeScript, então a preferência
 * precisa chegar até lá.
 */
export function prefersReducedMotion(): Signal<boolean> {
  return sinalDeMedia(TW_REDUCED_MOTION_QUERY);
}
