import { convertToParamMap } from '@angular/router';

import {
  FILTROS_VAZIOS,
  PropertyFilters,
  chipsAtivos,
  contarFiltros,
  limparTodos,
  mesmosFiltros,
  parseFilters,
  removerFiltro,
  temCriterios,
  temFiltros,
  toListParams,
  toQueryParams,
} from './property-filters';

function mapa(params: Record<string, string>) {
  return convertToParamMap(params);
}

describe('parseFilters', () => {
  it('sem params devolve tudo vazio', () => {
    expect(parseFilters(mapa({}))).toEqual(FILTROS_VAZIOS);
  });

  it('le os quatro criterios', () => {
    expect(parseFilters(mapa({
      type: 'APARTMENT',
      purpose: 'RENT',
      location: 'Centro',
      q: 'cobertura',
    }))).toEqual({
      type: 'APARTMENT',
      purpose: 'RENT',
      location: 'Centro',
      query: 'cobertura',
    });
  });

  // Um link colado ou editado a mao chegaria com valor fora do enum, o zod da
  // API devolveria 400, e a home mostraria erro de servidor por causa de um
  // erro de digitacao.
  it('descarta tipo que nao existe', () => {
    expect(parseFilters(mapa({ type: 'CASTELO' })).type).toBeNull();
  });

  it('descarta finalidade que nao existe', () => {
    expect(parseFilters(mapa({ purpose: 'TROCA' })).purpose).toBeNull();
  });

  it('espaco em branco conta como ausente', () => {
    const filtros = parseFilters(mapa({ location: '   ', q: '  ' }));
    expect(filtros.location).toBe('');
    expect(filtros.query).toBe('');
  });
});

describe('toQueryParams', () => {
  it('criterio ausente vira null, para sair da URL', () => {
    expect(toQueryParams(FILTROS_VAZIOS)).toEqual({
      type: null,
      purpose: null,
      location: null,
      q: null,
    });
  });

  it('ida e volta preserva os criterios', () => {
    const params = { type: 'HOUSE', purpose: 'SALE', location: 'Centro', q: 'casa' };
    expect(toQueryParams(parseFilters(mapa(params)))).toEqual(params);
  });
});

describe('temFiltros e temCriterios', () => {
  const soTexto: PropertyFilters = { ...FILTROS_VAZIOS, query: 'casa' };

  // A diferenca entre os dois decide duas coisas: se a faixa de "sem tour"
  // aparece (criterios) e se o botao "Limpar filtros" aparece (filtros).
  it('texto de busca e criterio, mas nao e filtro', () => {
    expect(temCriterios(soTexto)).toBeTrue();
    expect(temFiltros(soTexto)).toBeFalse();
  });

  it('sem nada, nenhum dos dois', () => {
    expect(temCriterios(FILTROS_VAZIOS)).toBeFalse();
    expect(temFiltros(FILTROS_VAZIOS)).toBeFalse();
  });

  it('localizacao e filtro', () => {
    const comLocal = { ...FILTROS_VAZIOS, location: 'Centro' };
    expect(temFiltros(comLocal)).toBeTrue();
    expect(temCriterios(comLocal)).toBeTrue();
  });
});

describe('limparTodos', () => {
  // O texto tem caixa propria, visivel, com botao de limpar do proprio
  // searchbar. Apaga-lo por tabela seria apagar algo que a pessoa nao pediu
  // para apagar e que ela esta vendo.
  it('mantem o texto da busca', () => {
    const antes: PropertyFilters = {
      type: 'HOUSE', purpose: 'SALE', location: 'Centro', query: 'casa',
    };

    expect(limparTodos(antes)).toEqual({ ...FILTROS_VAZIOS, query: 'casa' });
  });
});

describe('removerFiltro', () => {
  const cheio: PropertyFilters = {
    type: 'HOUSE', purpose: 'SALE', location: 'Centro', query: 'casa',
  };

  it('tira so o que foi pedido', () => {
    expect(removerFiltro(cheio, 'type')).toEqual({ ...cheio, type: null });
    expect(removerFiltro(cheio, 'purpose')).toEqual({ ...cheio, purpose: null });
    expect(removerFiltro(cheio, 'location')).toEqual({ ...cheio, location: '' });
  });
});

describe('chipsAtivos', () => {
  it('sem filtro, nenhum chip', () => {
    expect(chipsAtivos(FILTROS_VAZIOS)).toEqual([]);
    expect(contarFiltros(FILTROS_VAZIOS)).toBe(0);
  });

  it('o texto da busca nao vira chip', () => {
    expect(chipsAtivos({ ...FILTROS_VAZIOS, query: 'casa' })).toEqual([]);
  });

  it('tipo e finalidade viram chave de traducao; localizacao vira texto cru', () => {
    const cheio: PropertyFilters = {
      type: 'APARTMENT', purpose: 'RENT', location: 'Centro', query: '',
    };

    expect(chipsAtivos(cheio)).toEqual([
      { key: 'type', labelKey: 'UPLOAD.TYPE.APARTMENT', labelText: '' },
      { key: 'purpose', labelKey: 'UPLOAD.PURPOSE.RENT', labelText: '' },
      { key: 'location', labelKey: null, labelText: 'Centro' },
    ]);
    expect(contarFiltros(cheio)).toBe(3);
  });
});

describe('toListParams', () => {
  it('so manda o que existe', () => {
    expect(toListParams(FILTROS_VAZIOS)).toEqual({ limit: 100 });
  });

  // `q` na URL vira `search` na API — sao vocabularios diferentes de proposito:
  // `q` e' curto porque a pessoa ve; `search` e' o nome do parametro da API.
  it('o texto da busca vira search', () => {
    expect(toListParams({ ...FILTROS_VAZIOS, query: 'cobertura' }))
      .toEqual({ limit: 100, search: 'cobertura' });
  });

  it('manda os tres filtros', () => {
    expect(toListParams({
      type: 'HOUSE', purpose: 'RENT', location: 'Centro', query: '',
    })).toEqual({ limit: 100, type: 'HOUSE', purpose: 'RENT', location: 'Centro' });
  });
});

describe('mesmosFiltros', () => {
  it('compara valor, nao referencia', () => {
    expect(mesmosFiltros({ ...FILTROS_VAZIOS }, { ...FILTROS_VAZIOS })).toBeTrue();
  });

  it('qualquer campo diferente e diferente', () => {
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, type: 'HOUSE' })).toBeFalse();
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, purpose: 'SALE' })).toBeFalse();
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, location: 'x' })).toBeFalse();
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, query: 'x' })).toBeFalse();
  });
});
