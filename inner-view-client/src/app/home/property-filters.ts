import { ParamMap, Params } from '@angular/router';

import {
  ListPropertiesParams,
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  PropertyPurpose,
  PropertyType,
} from '../models/property.model';

/**
 * Os critérios da home.
 *
 * A fonte de verdade deles é a URL — este tipo é a forma que eles tomam depois
 * de lidos. `query` é a busca por texto; os outros três são os filtros.
 * A distinção importa: "limpar filtros" não apaga o texto, e a faixa de
 * "imóveis sem tour" some com qualquer um dos quatro.
 */
export interface PropertyFilters {
  readonly type: PropertyType | null;
  readonly purpose: PropertyPurpose | null;
  readonly location: string;
  readonly query: string;
}

export const FILTROS_VAZIOS: PropertyFilters = {
  type: null,
  purpose: null,
  location: '',
  query: '',
};

/** Teto de itens da home. Paginação continua fora de escopo. */
export const LIMITE_DA_HOME = 100;

/**
 * Um filtro ativo, pronto para virar chip.
 *
 * Dois formatos de rótulo porque são duas naturezas: tipo e finalidade são
 * valores fechados, e o rótulo deles é uma chave de tradução; localização é
 * texto que a pessoa escreveu, e traduzir não faz sentido.
 */
export interface FilterChip {
  readonly key: 'type' | 'purpose' | 'location';
  /** Chave de tradução, ou `null` quando o rótulo é texto do usuário. */
  readonly labelKey: string | null;
  /** Texto pronto — usado quando `labelKey` é nulo. */
  readonly labelText: string;
}

function valorValido<T extends string>(
  bruto: string | null,
  aceitos: readonly T[],
): T | null {
  return aceitos.includes(bruto as T) ? (bruto as T) : null;
}

/**
 * Lê os critérios da URL.
 *
 * Valor fora do enum é DESCARTADO, não repassado: um `?type=CASTELO` de link
 * colado ou editado à mão faria o zod da API devolver 400, e a home mostraria
 * erro de servidor por causa de um erro de digitação.
 */
export function parseFilters(params: ParamMap): PropertyFilters {
  return {
    type: valorValido(params.get('type'), PROPERTY_TYPES),
    purpose: valorValido(params.get('purpose'), PROPERTY_PURPOSES),
    location: (params.get('location') ?? '').trim(),
    query: (params.get('q') ?? '').trim(),
  };
}

/**
 * Converte para query params.
 *
 * Critério ausente vira `null` e não string vazia: o Router do Angular remove
 * da URL os params nulos, e é isso que faz o filtro desaparecer do endereço em
 * vez de ficar pendurado como `?type=`.
 */
export function toQueryParams(filtros: PropertyFilters): Params {
  return {
    type: filtros.type ?? null,
    purpose: filtros.purpose ?? null,
    location: filtros.location || null,
    q: filtros.query || null,
  };
}

/** Há tipo, finalidade ou localização — o que o "Limpar filtros" apaga. */
export function temFiltros(filtros: PropertyFilters): boolean {
  return (
    filtros.type !== null || filtros.purpose !== null || filtros.location !== ''
  );
}

/** Há filtro OU texto de busca — o que distingue "sem resultado" de "conta vazia". */
export function temCriterios(filtros: PropertyFilters): boolean {
  return temFiltros(filtros) || filtros.query !== '';
}

export function limparTodos(filtros: PropertyFilters): PropertyFilters {
  return { ...FILTROS_VAZIOS, query: filtros.query };
}

export function removerFiltro(
  filtros: PropertyFilters,
  key: FilterChip['key'],
): PropertyFilters {
  switch (key) {
    case 'type':
      return { ...filtros, type: null };
    case 'purpose':
      return { ...filtros, purpose: null };
    case 'location':
      return { ...filtros, location: '' };
  }
}

export function chipsAtivos(filtros: PropertyFilters): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filtros.type) {
    chips.push({
      key: 'type',
      labelKey: 'UPLOAD.TYPE.' + filtros.type,
      labelText: '',
    });
  }
  if (filtros.purpose) {
    chips.push({
      key: 'purpose',
      labelKey: 'UPLOAD.PURPOSE.' + filtros.purpose,
      labelText: '',
    });
  }
  if (filtros.location) {
    chips.push({ key: 'location', labelKey: null, labelText: filtros.location });
  }

  return chips;
}

export function contarFiltros(filtros: PropertyFilters): number {
  return chipsAtivos(filtros).length;
}

/** O que vai para o `PropertyService`. `q` da URL vira `search` da API. */
export function toListParams(filtros: PropertyFilters): ListPropertiesParams {
  return {
    limit: LIMITE_DA_HOME,
    ...(filtros.type && { type: filtros.type }),
    ...(filtros.purpose && { purpose: filtros.purpose }),
    ...(filtros.location && { location: filtros.location }),
    ...(filtros.query && { search: filtros.query }),
  };
}

/**
 * Igualdade por valor.
 *
 * `parseFilters` devolve um objeto novo a cada leitura da URL, então comparar
 * por referência dispararia uma requisição a cada emissão do router, inclusive
 * nas que não mexeram em critério nenhum.
 */
export function mesmosFiltros(a: PropertyFilters, b: PropertyFilters): boolean {
  return (
    a.type === b.type &&
    a.purpose === b.purpose &&
    a.location === b.location &&
    a.query === b.query
  );
}
