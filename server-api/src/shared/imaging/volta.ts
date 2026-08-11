import { Raster } from './cubemap';

/**
 * Reconstitui a continuidade entre a borda esquerda e a direita do equirect.
 *
 * Num panorama a coluna 0 encosta na última: girando no tour, o observador
 * atravessa essa junção sem saber que ela existe. O stitcher respeita isso por
 * construção, mas o modelo generativo não — ele trata a imagem como um retângulo
 * comum e as duas bordas voltam com tons diferentes.
 *
 * A medição na primeira sonda: o salto médio entre as colunas extremas subiu de
 * 5,5 para 9,9 níveis depois da IA, mesmo com o prompt proibindo explicitamente.
 * É a diferença entre pedir e garantir — e aqui dá para garantir com aritmética,
 * sem custo e sem depender de obediência.
 *
 * O ajuste é fotométrico, não geométrico: distribui o degrau de cor ao longo de
 * uma faixa nas duas pontas, com peso caindo linearmente para o centro. Não
 * conserta desalinhamento de objeto na junção — isso continua sendo trabalho do
 * modelo — mas elimina a linha vertical, que é o que o olho pega primeiro.
 */
export function costurarVolta(equirect: Raster, larguraFaixa: number): Raster {
  const { width, height } = equirect;
  const faixa = Math.max(1, Math.min(Math.floor(width / 4), larguraFaixa));
  const data = new Uint8ClampedArray(equirect.data);

  for (let y = 0; y < height; y++) {
    const esquerda = (y * width) * 4;
    const direita = (y * width + width - 1) * 4;

    for (let c = 0; c < 3; c++) {
      // Metade do degrau para cada lado: as duas bordas se encontram no meio do
      // caminho, em vez de uma ser puxada até a outra.
      const meioDegrau = (equirect.data[direita + c] - equirect.data[esquerda + c]) / 2;
      if (meioDegrau === 0) continue;

      for (let d = 0; d < faixa; d++) {
        const peso = 1 - d / faixa;

        const iEsq = (y * width + d) * 4 + c;
        data[iEsq] = equirect.data[iEsq] + meioDegrau * peso;

        const iDir = (y * width + width - 1 - d) * 4 + c;
        data[iDir] = equirect.data[iDir] - meioDegrau * peso;
      }
    }
  }

  return { data, width, height };
}

/** Salto médio por canal entre a primeira e a última coluna — a métrica da volta. */
export function saltoNaVolta(equirect: Raster, y0 = 0, y1 = equirect.height): number {
  let soma = 0;
  let n = 0;

  for (let y = y0; y < y1; y++) {
    const esquerda = (y * equirect.width) * 4;
    const direita = (y * equirect.width + equirect.width - 1) * 4;
    for (let c = 0; c < 3; c++) {
      soma += Math.abs(equirect.data[esquerda + c] - equirect.data[direita + c]);
      n++;
    }
  }

  return n === 0 ? 0 : soma / n;
}
