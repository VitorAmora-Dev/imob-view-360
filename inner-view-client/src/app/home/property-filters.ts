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
 * de lidos, e a ordem dos campos é a ordem dos passos da busca: onde,
 * finalidade, tipo.
 *
 * **Não há mais um critério de localização separado.** O passo "Onde?" é uma
 * caixa só, e ela escreve em `query` — que a API casa contra código, título,
 * descrição, rua, bairro, cidade, estado e CEP, um superconjunto do que o
 * antigo `location` alcançava. O parâmetro continua existindo na API (é
 * contrato público, e o DTO de lá diz isso); o que saiu foi a segunda caixa
 * que perguntava a mesma coisa de um jeito mais estreito.
 */
export interface PropertyFilters {
  readonly query: string;
  readonly purpose: PropertyPurpose | null;
  readonly type: PropertyType | null;
}

export const FILTROS_VAZIOS: PropertyFilters = {
  query: '',
  purpose: null,
  type: null,
};

/** Teto de itens da home. Paginação continua fora de escopo. */
export const LIMITE_DA_HOME = 100;

export type ChaveDoCriterio = 'query' | 'purpose' | 'type';

/**
 * Um critério ativo, pronto para virar rótulo.
 *
 * Dois formatos porque são duas naturezas: finalidade e tipo são valores
 * fechados, e o rótulo deles é uma chave de tradução; o texto da busca é o que
 * o corretor escreveu, e traduzir não faz sentido.
 */
export interface CriterioAtivo {
  readonly key: ChaveDoCriterio;
  /** Chave de tradução, ou `null` quando o rótulo é texto do corretor. */
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
 *
 * Um `?location=` de link antigo é simplesmente ignorado — a URL de hoje não
 * tem esse parâmetro, e ler o que não se sabe usar é pior do que não ler.
 */
export function parseFilters(params: ParamMap): PropertyFilters {
  return {
    query: (params.get('q') ?? '').trim(),
    purpose: valorValido(params.get('purpose'), PROPERTY_PURPOSES),
    type: valorValido(params.get('type'), PROPERTY_TYPES),
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
    q: filtros.query || null,
    purpose: filtros.purpose ?? null,
    type: filtros.type ?? null,
  };
}

/** Há finalidade ou tipo — o que distingue "sem resultado" de "filtro demais". */
export function temFiltros(filtros: PropertyFilters): boolean {
  return filtros.purpose !== null || filtros.type !== null;
}

/** Há filtro OU texto de busca — o que distingue "sem resultado" de "conta vazia". */
export function temCriterios(filtros: PropertyFilters): boolean {
  return temFiltros(filtros) || filtros.query !== '';
}

/**
 * Os critérios ativos, na ORDEM DOS PASSOS da busca.
 *
 * A ordem não é decoração: é ela que monta o resumo da barra fechada
 * ("Canoas · Aluguel · Casa"), e ler o resumo tem de ser a mesma experiência de
 * ter preenchido o painel.
 *
 * O texto da busca entra aqui — diferente do que valia quando isto alimentava
 * chips de filtro, onde ele ficava de fora porque tinha caixa própria na tela.
 * Agora ele é o primeiro passo, e omiti-lo faria a barra dizer "Aluguel · Casa"
 * escondendo o "Canoas" que produziu o resultado.
 */
export function criteriosAtivos(filtros: PropertyFilters): CriterioAtivo[] {
  const criterios: CriterioAtivo[] = [];

  if (filtros.query) {
    criterios.push({ key: 'query', labelKey: null, labelText: filtros.query });
  }
  if (filtros.purpose) {
    criterios.push({
      key: 'purpose',
      labelKey: 'UPLOAD.PURPOSE.' + filtros.purpose,
      labelText: '',
    });
  }
  if (filtros.type) {
    criterios.push({
      key: 'type',
      labelKey: 'UPLOAD.TYPE.' + filtros.type,
      labelText: '',
    });
  }

  return criterios;
}

/** O que vai para o `PropertyService`. `q` da URL vira `search` da API. */
export function toListParams(filtros: PropertyFilters): ListPropertiesParams {
  return {
    limit: LIMITE_DA_HOME,
    ...(filtros.query && { search: filtros.query }),
    ...(filtros.purpose && { purpose: filtros.purpose }),
    ...(filtros.type && { type: filtros.type }),
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
    a.query === b.query && a.purpose === b.purpose && a.type === b.type
  );
}
