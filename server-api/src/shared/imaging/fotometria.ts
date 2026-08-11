import { Raster, Vec3 } from './cubemap';
import { CoberturaOpts, Orientacao, hfovFromVfov } from './coverage';
import { Quaternion, conjugar, projetarNdc } from './quat';

/**
 * Quanto dois frames vizinhos discordam sobre a cor da mesma parede.
 *
 * É o experimento D do bake-off, e não usa IA nenhuma. A medição é feita onde os
 * dois frames enxergam a MESMA direção: ali qualquer diferença é da câmera —
 * medição automática de exposição e balanço de branco mudando entre os cliques —,
 * não da cena. Comparar a média de frames inteiros não serviria, porque um frame
 * apontado para a janela é legitimamente mais claro que um apontado para o
 * corredor.
 *
 * O ganho por canal que sai daqui é o mesmo que o stitcher resolve nas
 * sobreposições; a serventia da medida é dimensionar o que sobra depois dele —
 * se o resíduo for grande, o caminho é blending multibanda e balanço global, e
 * não prompt.
 */

export interface AmostraPar {
  /** Índices dos dois frames comparados. */
  a: number;
  b: number;
  /** Direções em que os dois se enxergam. */
  amostras: number;
  /** Razão b/a por canal: 1,0 é concordância perfeita. */
  ganho: [number, number, number];
  /**
   * Desvio de balanço de branco: o quanto os canais R e B divergem depois de
   * normalizar por G. Separado do ganho porque exposição a mais some com um
   * multiplicador, dominante de cor não some.
   */
  desvioWB: number;
}

export interface RelatorioFotometrico {
  pares: AmostraPar[];
  /** Maior razão de exposição entre vizinhos, em paradas (stops). */
  maiorSaltoStops: number;
  /** Razão entre o frame mais claro e o mais escuro ao longo do anel, em paradas. */
  amplitudeAnelStops: number;
  maiorDesvioWB: number;
}

interface FrameAmostravel {
  raster: Raster;
  conjugada: Quaternion;
}

/**
 * Compara cada par de frames vizinhos no anel, mais o par que fecha a volta —
 * o erro de fechamento é justamente onde a costura mais denuncia.
 */
export function medirFotometria(
  frames: readonly Raster[],
  orientacoes: readonly Orientacao[],
  opts: CoberturaOpts,
  amostrasPorPar = 4000,
): RelatorioFotometrico {
  const tanHalfV = Math.tan((opts.vfovDeg * Math.PI) / 360);
  const tanHalfH = Math.tan((hfovFromVfov(opts.vfovDeg, opts.frameAspect) * Math.PI) / 360);

  const amostraveis: FrameAmostravel[] = frames.map((raster, i) => ({
    raster,
    conjugada: conjugar(orientacoes[i].quaternion),
  }));

  const pares: AmostraPar[] = [];
  for (let i = 0; i < amostraveis.length; i++) {
    const j = (i + 1) % amostraveis.length;
    if (j === i) continue;

    const par = compararPar(amostraveis[i], amostraveis[j], tanHalfH, tanHalfV, amostrasPorPar);
    if (par) pares.push({ a: i, b: j, ...par });
  }

  return {
    pares,
    maiorSaltoStops: pares.reduce((max, p) => Math.max(max, emStops(luminancia(p.ganho))), 0),
    amplitudeAnelStops: amplitudeAcumulada(pares),
    maiorDesvioWB: pares.reduce((max, p) => Math.max(max, p.desvioWB), 0),
  };
}

/**
 * Amostra direções num padrão de Fibonacci na esfera — cobre o overlap de forma
 * uniforme sem privilegiar os polos, que é o que uma varredura em (yaw, pitch)
 * faria.
 */
function compararPar(
  a: FrameAmostravel,
  b: FrameAmostravel,
  tanHalfH: number,
  tanHalfV: number,
  tentativas: number,
): Omit<AmostraPar, 'a' | 'b'> | null {
  const somaA: [number, number, number] = [0, 0, 0];
  const somaB: [number, number, number] = [0, 0, 0];
  let amostras = 0;

  const passo = Math.PI * (3 - Math.sqrt(5));

  for (let k = 0; k < tentativas; k++) {
    const y = 1 - (2 * (k + 0.5)) / tentativas;
    const raio = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = k * passo;
    const dir = { x: Math.cos(phi) * raio, y, z: Math.sin(phi) * raio };

    const pa = projetar(a, dir, tanHalfH, tanHalfV);
    if (!pa) continue;
    const pb = projetar(b, dir, tanHalfH, tanHalfV);
    if (!pb) continue;

    for (let c = 0; c < 3; c++) {
      somaA[c] += pa[c];
      somaB[c] += pb[c];
    }
    amostras++;
  }

  // Poucas amostras significam sobreposição desprezível: o par não diz nada.
  if (amostras < 50) return null;

  const ganho: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    ganho[c] = somaA[c] < 1e-6 ? 1 : somaB[c] / somaA[c];
  }

  return { amostras, ganho, desvioWB: desvioWB(ganho) };
}

/**
 * Amostra o pixel do frame na direção dada, ou null se ele não enxerga ali.
 * A margem de 0,9 descarta a borda, onde vinheta e distorção de lente
 * contaminariam a medida de exposição.
 */
function projetar(
  frame: FrameAmostravel,
  dir: Vec3,
  tanHalfH: number,
  tanHalfV: number,
): [number, number, number] | null {
  const ndc = projetarNdc(frame.conjugada, dir, tanHalfH, tanHalfV, 0.9);
  if (!ndc) return null;

  const { raster } = frame;
  const x = Math.round(((ndc.x + 1) / 2) * raster.width - 0.5);
  const y = Math.round(((1 - ndc.y) / 2) * raster.height - 0.5);
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return null;

  const i = (y * raster.width + x) * 4;
  return [raster.data[i], raster.data[i + 1], raster.data[i + 2]];
}

/** Luminância Rec.709 de um ganho por canal. */
export function luminancia(ganho: readonly [number, number, number]): number {
  return 0.2126 * ganho[0] + 0.7152 * ganho[1] + 0.0722 * ganho[2];
}

/** Um ganho de 2× é uma parada; o sinal diz se clareou ou escureceu. */
export function emStops(razao: number): number {
  return Math.abs(Math.log2(Math.max(1e-6, razao)));
}

/**
 * Depois de dividir fora a exposição, o que sobra em R e B é dominante de cor.
 * Zero é neutro.
 */
export function desvioWB(ganho: readonly [number, number, number]): number {
  const g = ganho[1] === 0 ? 1 : ganho[1];
  return (Math.abs(ganho[0] / g - 1) + Math.abs(ganho[2] / g - 1)) / 2;
}

/**
 * Encadeia os ganhos ao longo do anel e mede a distância entre o extremo mais
 * claro e o mais escuro. É o número que corresponde ao "lado esquerdo escuro,
 * lado direito claro" que se vê no panorama montado.
 */
function amplitudeAcumulada(pares: readonly AmostraPar[]): number {
  if (pares.length === 0) return 0;

  let acumulado = 1;
  let min = 1;
  let max = 1;

  for (const par of pares) {
    acumulado *= luminancia(par.ganho);
    min = Math.min(min, acumulado);
    max = Math.max(max, acumulado);
  }

  return emStops(max / Math.max(1e-6, min));
}
