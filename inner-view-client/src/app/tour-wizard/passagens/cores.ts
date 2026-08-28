/**
 * Cor de identidade de um ambiente, ciclando entre os tons do tema.
 *
 * Devolve `var(--app-room-N)` e nunca um hex: a paleta e decidida num lugar so,
 * em `theme/variables.scss`, como manda o `.agents/AGENTS.md`. Com mais de seis
 * ambientes dois repetem -- o swatch e apoio para reconhecer de relance, nao
 * identificador.
 */
export const TONS_DE_AMBIENTE = 6;

export function corDoAmbiente(i: number): string {
  const tom = ((i % TONS_DE_AMBIENTE) + TONS_DE_AMBIENTE) % TONS_DE_AMBIENTE;
  return `var(--app-room-${tom + 1})`;
}
