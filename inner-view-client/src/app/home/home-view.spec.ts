import { resolveHomeView } from './home-view';

const PRONTO = {
  status: 'ready' as const,
  jaCarregou: true,
  vazio: false,
  comCriterios: false,
};

describe('resolveHomeView', () => {
  it('a primeira carga e carregando', () => {
    expect(resolveHomeView({ ...PRONTO, status: 'loading', jaCarregou: false }))
      .toBe('loading');
  });

  // Refiltrar NAO volta para o placeholder de tela cheia. A busca e a barra de
  // filtros vivem dentro da moldura, que so aparece em `list` e `no-results`:
  // se refiltrar virasse `loading`, mexer num filtro faria a barra sumir, e
  // digitar na busca destruiria o campo em foco no meio da digitacao.
  it('refiltrar mantem a view anterior', () => {
    expect(resolveHomeView({ ...PRONTO, status: 'loading' })).toBe('list');
    expect(resolveHomeView({ ...PRONTO, status: 'loading', vazio: true, comCriterios: true }))
      .toBe('no-results');
  });

  it('erro vence o conteudo', () => {
    expect(resolveHomeView({ ...PRONTO, status: 'error' })).toBe('error');
    expect(resolveHomeView({ ...PRONTO, status: 'error', vazio: true })).toBe('error');
  });

  // Esta e' a asserção que trava a precedencia. Com o servidor filtrando, uma
  // resposta vazia pode ser conta zerada OU busca que nao casou — o que separa
  // as duas e' ter havido criterio. Quem tem trinta imoveis e digita "zzz"
  // precisa de "nenhum resultado", nao do onboarding de conta zerada.
  it('vazio sem criterio e onboarding', () => {
    expect(resolveHomeView({ ...PRONTO, vazio: true })).toBe('empty');
  });

  it('vazio com criterio e "sem resultado"', () => {
    expect(resolveHomeView({ ...PRONTO, vazio: true, comCriterios: true }))
      .toBe('no-results');
  });

  it('com itens e lista, com ou sem criterio', () => {
    expect(resolveHomeView(PRONTO)).toBe('list');
    expect(resolveHomeView({ ...PRONTO, comCriterios: true })).toBe('list');
  });
});
