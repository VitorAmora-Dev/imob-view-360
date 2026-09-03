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
 * A largura da janela, como sinal.
 *
 * POR QUE em JS e não numa `@media` no SCSS: quem decide a forma do
 * `TourSheetComponent` (`variante="adaptavel"`) precisa deste valor em
 * TypeScript, porque a diferença entre bottom sheet e diálogo centralizado é
 * a PRESENÇA da propriedade `breakpoints` no `ion-modal` — não é coisa que
 * CSS alcance. Esconder um `IonModal` por CSS não o desliga: ele continua
 * prendendo o foco, travando a rolagem da página e respondendo ao Esc. Um
 * `@media` aqui devolveria exatamente esse modal invisível que sequestra o
 * teclado.
 *
 * Chamar em contexto de injeção. Fora dele o `inject()` lança NG0203 — por
 * isso ele vem ANTES do `addEventListener`: na ordem inversa, o caminho de
 * erro deixaria o listener pendurado sem ninguém para soltá-lo.
 */
export function emViewportMobile(): Signal<boolean> {
  const destroyRef = inject(DestroyRef);
  const media = matchMedia(TOUR_MOBILE_QUERY);
  const valor = signal(media.matches);
  const aoMudar = () => valor.set(media.matches);

  media.addEventListener('change', aoMudar);
  destroyRef.onDestroy(() => media.removeEventListener('change', aoMudar));

  return valor.asReadonly();
}
