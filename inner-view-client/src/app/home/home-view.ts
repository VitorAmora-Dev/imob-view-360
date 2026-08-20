/** Situação da requisição que alimenta a home. */
export type HomeStatus = 'loading' | 'error' | 'ready';

/** Qual bloco a home renderiza. */
export type HomeView = 'loading' | 'error' | 'empty' | 'no-results' | 'list';

/**
 * Com a filtragem no servidor, "conta vazia" e "busca sem resultado" chegam
 * exatamente iguais: uma resposta com zero imóveis. O que as separa é ter
 * havido critério — e é por isso que `comCriterios` inclui o texto da busca, e
 * não só os filtros.
 */
export interface HomeViewInput {
  readonly status: HomeStatus;
  /** Já houve ao menos uma resposta bem-sucedida nesta visita. */
  readonly jaCarregou: boolean;
  /** A última resposta veio sem nenhum imóvel. */
  readonly vazio: boolean;
  /** Há texto de busca ou algum filtro ativo. */
  readonly comCriterios: boolean;
}

/**
 * A ordem aqui É o contrato, porque mais de uma condição pode valer ao mesmo
 * tempo.
 *
 * O `jaCarregou` na primeira linha é o que faz refiltrar não voltar ao
 * placeholder de tela cheia: a busca e a barra de filtros só existem nas views
 * `list` e `no-results`, então uma refiltragem que virasse `loading`
 * destruiria o campo que a pessoa está usando.
 */
export function resolveHomeView({
  status,
  jaCarregou,
  vazio,
  comCriterios,
}: HomeViewInput): HomeView {
  if (status === 'loading' && !jaCarregou) return 'loading';
  if (status === 'error') return 'error';
  if (!vazio) return 'list';
  return comCriterios ? 'no-results' : 'empty';
}
