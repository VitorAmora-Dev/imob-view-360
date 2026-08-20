import { resolveHomeView } from './home-view';

describe('resolveHomeView', () => {
  it('carregando vence tudo', () => {
    expect(resolveHomeView({ status: 'loading', total: 0, filtered: 0 })).toBe('loading');
    expect(resolveHomeView({ status: 'loading', total: 5, filtered: 5 })).toBe('loading');
  });

  it('erro vence o conteudo', () => {
    expect(resolveHomeView({ status: 'error', total: 0, filtered: 0 })).toBe('error');
    expect(resolveHomeView({ status: 'error', total: 5, filtered: 5 })).toBe('error');
  });

  // Esta e' a asserção que trava a precedencia. Como `filtered <= total`
  // sempre, `total === 0` arrasta `filtered === 0` junto — entao conta vazia
  // COM busca ativa cai exatamente aqui, e o que decide que ela vê onboarding
  // em vez de "nenhum resultado" e' esta checagem vir ANTES da de `filtered`.
  // Inverter as duas quebra este teste, que e' o ponto dele.
  it('conta sem imovel algum e onboarding', () => {
    expect(resolveHomeView({ status: 'ready', total: 0, filtered: 0 })).toBe('empty');
  });

  it('busca que nao casou nada, com acervo, e "sem resultado"', () => {
    expect(resolveHomeView({ status: 'ready', total: 5, filtered: 0 })).toBe('no-results');
  });

  it('com itens filtrados e lista', () => {
    expect(resolveHomeView({ status: 'ready', total: 5, filtered: 5 })).toBe('list');
    expect(resolveHomeView({ status: 'ready', total: 5, filtered: 1 })).toBe('list');
  });
});
