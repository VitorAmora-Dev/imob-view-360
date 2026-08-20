/** Situação da requisição que alimenta a home. */
export type HomeStatus = 'loading' | 'error' | 'ready';

/** Qual bloco a home renderiza. Os estados 4 e 5 da spec são ambos `list`. */
export type HomeView = 'loading' | 'error' | 'empty' | 'no-results' | 'list';

/**
 * Invariante: `filtered <= total`, sempre — `filtered` e' o resultado de
 * filtrar a mesma lista que `total` conta. Trocar os dois de lugar na chamada
 * nao e' erro de TypeScript e nao e' cosmetico: quem tem imoveis e busca sem
 * resultado passaria a ver o onboarding de conta vazia.
 */
export interface HomeViewInput {
  readonly status: HomeStatus;
  /** Quantos imóveis a conta tem, ignorando a busca. */
  readonly total: number;
  /** Quantos sobraram depois do filtro da busca. */
  readonly filtered: number;
}

/**
 * A ordem aqui É o contrato, porque duas condições podem valer ao mesmo tempo.
 *
 * O caso que decide a ordem: conta sem nenhum imóvel com texto na busca
 * satisfaz `total === 0` e `filtered === 0` juntos. Ganha `empty` — quem não
 * tem imóvel algum precisa do onboarding, não de "nenhum resultado para xyz",
 * que sugeriria que existe acervo e o termo é que não casou.
 */
export function resolveHomeView({ status, total, filtered }: HomeViewInput): HomeView {
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  if (total === 0) return 'empty';
  if (filtered === 0) return 'no-results';
  return 'list';
}
