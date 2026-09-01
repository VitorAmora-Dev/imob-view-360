import { convertToParamMap } from '@angular/router';

import {
  FILTROS_VAZIOS,
  PropertyFilters,
  criteriosAtivos,
  mesmosFiltros,
  parseFilters,
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

  it('le os tres criterios', () => {
    expect(parseFilters(mapa({
      q: 'cobertura',
      purpose: 'RENT',
      type: 'APARTMENT',
    }))).toEqual({
      query: 'cobertura',
      purpose: 'RENT',
      type: 'APARTMENT',
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
    expect(parseFilters(mapa({ q: '  ' })).query).toBe('');
  });

  /**
   * O passo "Onde?" e uma caixa so, e ela escreve em `q`. Um link antigo com
   * `?location=` chega de favorito, de histórico ou de conversa — ele nao pode
   * quebrar a tela, e tambem nao pode filtrar por um criterio que a busca de
   * hoje nao mostra em lugar nenhum.
   */
  it('ignora um location de link antigo', () => {
    expect(parseFilters(mapa({ location: 'Centro' }))).toEqual(FILTROS_VAZIOS);
  });
});

describe('toQueryParams', () => {
  it('criterio ausente vira null, para sair da URL', () => {
    expect(toQueryParams(FILTROS_VAZIOS)).toEqual({
      q: null,
      purpose: null,
      type: null,
    });
  });

  it('ida e volta preserva os criterios', () => {
    const params = { q: 'casa', purpose: 'SALE', type: 'HOUSE' };
    expect(toQueryParams(parseFilters(mapa(params)))).toEqual(params);
  });
});

describe('temFiltros e temCriterios', () => {
  const soTexto: PropertyFilters = { ...FILTROS_VAZIOS, query: 'casa' };

  // A diferenca entre os dois decide o que a tela de zero resultados diz:
  // "nenhum imovel para 'zzz'" ou "nenhum corresponde aos filtros".
  it('texto de busca e criterio, mas nao e filtro', () => {
    expect(temCriterios(soTexto)).toBeTrue();
    expect(temFiltros(soTexto)).toBeFalse();
  });

  it('sem nada, nenhum dos dois', () => {
    expect(temCriterios(FILTROS_VAZIOS)).toBeFalse();
    expect(temFiltros(FILTROS_VAZIOS)).toBeFalse();
  });

  it('finalidade e tipo sao filtros', () => {
    for (const filtros of [
      { ...FILTROS_VAZIOS, purpose: 'RENT' as const },
      { ...FILTROS_VAZIOS, type: 'HOUSE' as const },
    ]) {
      expect(temFiltros(filtros)).toBeTrue();
      expect(temCriterios(filtros)).toBeTrue();
    }
  });
});

describe('criteriosAtivos', () => {
  it('sem criterio, lista vazia', () => {
    expect(criteriosAtivos(FILTROS_VAZIOS)).toEqual([]);
  });

  /**
   * A ordem e a dos passos — onde, finalidade, tipo — porque e ela que monta o
   * resumo da barra fechada. Ler "Canoas · Aluguel · Casa" tem de ser a mesma
   * experiencia de ter preenchido o painel de cima para baixo.
   */
  it('devolve na ordem dos passos, com o texto da busca na frente', () => {
    const cheio: PropertyFilters = {
      query: 'Canoas',
      purpose: 'RENT',
      type: 'APARTMENT',
    };

    expect(criteriosAtivos(cheio)).toEqual([
      { key: 'query', labelKey: null, labelText: 'Canoas' },
      { key: 'purpose', labelKey: 'UPLOAD.PURPOSE.RENT', labelText: '' },
      { key: 'type', labelKey: 'UPLOAD.TYPE.APARTMENT', labelText: '' },
    ]);
  });

  it('so o que existe entra', () => {
    expect(criteriosAtivos({ ...FILTROS_VAZIOS, type: 'LAND' })).toEqual([
      { key: 'type', labelKey: 'UPLOAD.TYPE.LAND', labelText: '' },
    ]);
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

  it('manda os tres criterios', () => {
    expect(toListParams({
      query: 'Canoas', purpose: 'RENT', type: 'HOUSE',
    })).toEqual({ limit: 100, search: 'Canoas', purpose: 'RENT', type: 'HOUSE' });
  });
});

describe('mesmosFiltros', () => {
  it('compara valor, nao referencia', () => {
    expect(mesmosFiltros({ ...FILTROS_VAZIOS }, { ...FILTROS_VAZIOS })).toBeTrue();
  });

  it('qualquer campo diferente e diferente', () => {
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, query: 'x' })).toBeFalse();
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, purpose: 'SALE' })).toBeFalse();
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, type: 'HOUSE' })).toBeFalse();
  });
});
