import { Raster } from './cubemap';

/**
 * O que faz a geração ENCOSTAR na fotografia em vez de só preencher.
 *
 * A primeira rodada do bake-off mostrou que preencher é a parte fácil: os dois
 * modelos completaram o buraco de forma plausível. O que reprovava era a junção
 * — o `borda`, salto médio de cor na fronteira, ficou em 17,5 de mediana e 97 no
 * pior caso, o que no tour aparece como um anel em volta do ponto do observador.
 *
 * Três peças, nesta ordem:
 *   1. a máscara mandada ao modelo é EROD1DA, então ele repinta alguns pixels
 *      para dentro do que é fotografia e tem sobre o que casar textura;
 *   2. `casarCorNaBorda` corrige a cor do gerado por estatística da própria
 *      borda — determinístico, sem custo de API, e resolve o caso do teto bege
 *      contra o teto branco;
 *   3. `recomporComPena` mistura os dois ao longo da faixa erodida em vez de
 *      cortar seco.
 *
 * A garantia de fidelidade continua: além da faixa da pena, que tem poucos
 * pixels e só existe nas faces de polo, o pixel fotografado é intocado.
 */

/** Distância de xadrez até o pixel sem cobertura mais próximo, saturada em `max`. */
export function distanciaAoBuraco(cobertura: Raster, max: number): Uint16Array {
  const { width, height, data } = cobertura;
  const dist = new Uint16Array(width * height);
  const teto = max + 1;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    dist[p] = data[i] > 127 ? teto : 0;
  }

  // Transformada de distância em duas passagens. A alternativa — varrer uma
  // janela de raio `max` em cada pixel — seria 625 leituras por pixel numa face
  // de 1280, ou seja um bilhão de operações para a mesma resposta.
  const relaxar = (p: number, vizinho: number) => {
    const candidato = dist[vizinho] + 1;
    if (candidato < dist[p]) dist[p] = candidato;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (dist[p] === 0) continue;
      if (x > 0) relaxar(p, p - 1);
      if (y > 0) relaxar(p, p - width);
      if (y > 0 && x > 0) relaxar(p, p - width - 1);
      if (y > 0 && x < width - 1) relaxar(p, p - width + 1);
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      if (dist[p] === 0) continue;
      if (x < width - 1) relaxar(p, p + 1);
      if (y < height - 1) relaxar(p, p + width);
      if (y < height - 1 && x < width - 1) relaxar(p, p + width + 1);
      if (y < height - 1 && x > 0) relaxar(p, p + width - 1);
    }
  }

  for (let p = 0; p < dist.length; p++) {
    if (dist[p] > max) dist[p] = max;
  }

  return dist;
}

/**
 * Corrige a cor do gerado por uma transformação afim por canal, ajustada para
 * que a estatística do gerado junto à fronteira bata com a da fotografia junto à
 * fronteira.
 *
 * Compara só as duas faixas vizinhas à junção, não as regiões inteiras: o centro
 * do chão gerado pode ser legitimamente mais escuro que a parede, e forçar a
 * média global a bater destruiria essa variação em vez de corrigir o degrau.
 */
export function casarCorNaBorda(
  gerado: Raster,
  original: Raster,
  cobertura: Raster,
  faixa = 24,
  ganhoMax = 1.6,
): Raster {
  // `faixa + 1`, não `faixa`: a distância satura no teto que se pede, então
  // pedir `faixa` fazia todo pixel fotografado sair com `dist <= faixa` e o
  // filtro logo abaixo virava letra morta — a estatística vinha da região
  // inteira, que é justamente o que o comentário acima diz para não fazer. Com
  // um a mais, o que está além da faixa satura em `faixa + 1` e é excluído.
  const dist = distanciaAoBuraco(cobertura, faixa + 1);

  const somaFoto = [0, 0, 0];
  const somaFoto2 = [0, 0, 0];
  let nFoto = 0;

  const somaGer = [0, 0, 0];
  const somaGer2 = [0, 0, 0];
  let nGer = 0;

  for (let p = 0, i = 0; p < dist.length; p++, i += 4) {
    const fotografado = cobertura.data[i] > 127;

    // Fotografia: só a faixa colada na fronteira. Gerado: idem, medido do lado
    // de dentro, onde `dist` é 0 mas o vizinho imediato é coberto.
    if (fotografado && dist[p] > 0 && dist[p] <= faixa) {
      for (let c = 0; c < 3; c++) {
        somaFoto[c] += original.data[i + c];
        somaFoto2[c] += original.data[i + c] ** 2;
      }
      nFoto++;
    } else if (!fotografado && gerado.data[i + 3] >= 128) {
      for (let c = 0; c < 3; c++) {
        somaGer[c] += gerado.data[i + c];
        somaGer2[c] += gerado.data[i + c] ** 2;
      }
      nGer++;
    }
  }

  // Sem borda dos dois lados não há o que casar; devolver cópia é mais honesto
  // que inventar uma correção a partir de nada.
  if (nFoto < 32 || nGer < 32) {
    return { data: new Uint8ClampedArray(gerado.data), width: gerado.width, height: gerado.height };
  }

  const ganho: number[] = [];
  const desloc: number[] = [];

  for (let c = 0; c < 3; c++) {
    const mediaFoto = somaFoto[c] / nFoto;
    const mediaGer = somaGer[c] / nGer;
    const dpFoto = Math.sqrt(Math.max(1, somaFoto2[c] / nFoto - mediaFoto ** 2));
    const dpGer = Math.sqrt(Math.max(1, somaGer2[c] / nGer - mediaGer ** 2));

    // O ganho é limitado porque uma faixa de parede lisa pode ter desvio quase
    // zero, e a razão sem trava viraria um multiplicador absurdo que estouraria
    // o contraste do gerado inteiro.
    ganho[c] = Math.max(1 / ganhoMax, Math.min(ganhoMax, dpFoto / dpGer));
    desloc[c] = mediaFoto - mediaGer * ganho[c];
  }

  const data = new Uint8ClampedArray(gerado.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = gerado.data[i + c] * ganho[c] + desloc[c];
    }
  }

  return { data, width: gerado.width, height: gerado.height };
}

/**
 * Recompõe misturando ao longo de `pena` pixels em vez de cortar seco.
 *
 * `cobertura` é a cobertura VERDADEIRA, não a erodida: a pena cresce para dentro
 * da fotografia, e a fração de gerado cai a zero em `pena` pixels da fronteira.
 * Com `pena` 0 o comportamento é o corte duro da primeira rodada.
 */
export function recomporComPena(
  original: Raster,
  gerado: Raster,
  cobertura: Raster,
  pena: number,
): Raster {
  const data = new Uint8ClampedArray(original.data);
  const dist = pena > 0 ? distanciaAoBuraco(cobertura, pena) : null;
  const total = original.width * original.height;

  for (let p = 0, i = 0; p < total; p++, i += 4) {
    if (gerado.data[i + 3] < 128) continue;

    const fotografado = cobertura.data[i] > 127;
    let pesoGerado: number;

    if (!fotografado) {
      pesoGerado = 1;
    } else if (dist && dist[p] < pena) {
      // Encostado na fronteira o gerado ainda pesa; a `pena` pixels ele zera.
      pesoGerado = 1 - dist[p] / pena;
    } else {
      continue;
    }

    for (let c = 0; c < 3; c++) {
      data[i + c] = original.data[i + c] * (1 - pesoGerado) + gerado.data[i + c] * pesoGerado;
    }
    data[i + 3] = 255;
  }

  return { data, width: original.width, height: original.height };
}
