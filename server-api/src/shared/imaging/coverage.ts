import * as fs from 'fs';
import * as path from 'path';
import { FaceName, Raster, directionForEquirectPixel, directionForFacePixel } from './cubemap';
import { Quaternion, conjugar, projetarNdc } from './quat';

export { Quaternion };

/**
 * Máscara do que foi de fato fotografado.
 *
 * O equirect exportado é JPEG, e JPEG não tem alfa — a máscara de cobertura que
 * o stitcher escreve no canal alfa (`NORMALIZE_FRAGMENT`) morre na exportação.
 * Então ela é recomputada aqui a partir de `orientacoes.json`, repetindo a mesma
 * regra de projeção do shader (`PROJECT_GLSL` em capture-360/stitcher.ts):
 *
 *   cam = conjugada(q) · dir            (a câmera olha para -Z)
 *   ndc = (cam.x / -cam.z / tan(hfov/2), cam.y / -cam.z / tan(vfov/2))
 *   coberto  ⇔  cam.z < 0  e  |ndc.x| < 1  e  |ndc.y| < 1
 *
 * Uma ressalva honesta: são os quaternions CRUS do giroscópio, sem o
 * alinhamento de anel em três eixos que o `frame-align.ts` aplica antes de
 * costurar. A diferença é de alguns graus na borda do footprint, o que é
 * irrelevante para delimitar a calota de nadir/zênite — que é o uso aqui — mas
 * não serviria para decidir posse de pixel.
 */

export interface Orientacao {
  arquivo: string;
  quaternion: Quaternion;
}

export interface CoberturaOpts {
  /** Campo vertical ajustado da captura, em graus (coluna "campo vertical" do INDICE.md). */
  vfovDeg: number;
  /** Largura ÷ altura do frame original. */
  frameAspect: number;
}

/** Mesma fórmula de `hfovFromVfov` do stitcher — não divergir daqui. */
export function hfovFromVfov(vfovDeg: number, frameAspect: number): number {
  return (2 * Math.atan(Math.tan((vfovDeg * Math.PI) / 360) * frameAspect) * 180) / Math.PI;
}

/** Lê e valida `orientacoes.json` de uma pasta de `fotos-originais/`. */
export function lerOrientacoes(pasta: string): Orientacao[] {
  const arquivo = path.join(pasta, 'orientacoes.json');
  const cru: unknown = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

  if (!Array.isArray(cru) || cru.length === 0) {
    throw new Error(`${arquivo}: esperava um array não vazio de orientações.`);
  }

  return cru.map((item, i) => {
    const o = item as Partial<Orientacao>;
    const q = o.quaternion;
    if (!o.arquivo || !q || [q.x, q.y, q.z, q.w].some((n) => typeof n !== 'number')) {
      throw new Error(`${arquivo}: entrada ${i} sem arquivo ou quaternion válido.`);
    }
    return { arquivo: o.arquivo, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w } };
  });
}

/**
 * Máscara equirretangular: branco (255) onde algum frame enxerga, preto onde
 * nenhum enxerga. Alfa fica 255 nos dois casos — quem precisa de alfa é o
 * provider, e cada um quer uma convenção diferente.
 */
export function mascaraDeCobertura(
  width: number,
  height: number,
  orientacoes: readonly Orientacao[],
  opts: CoberturaOpts,
): Raster {
  const tanHalfV = Math.tan((opts.vfovDeg * Math.PI) / 360);
  const tanHalfH = Math.tan((hfovFromVfov(opts.vfovDeg, opts.frameAspect) * Math.PI) / 360);
  const conjugadas = orientacoes.map((o) => conjugar(o.quaternion));

  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dir = directionForEquirectPixel(x, y, width, height);
      const coberto = conjugadas.some((q) => projetarNdc(q, dir, tanHalfH, tanHalfV) !== null);

      const i = (y * width + x) * 4;
      const v = coberto ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }

  return { data, width, height };
}

/**
 * A mesma cobertura, avaliada direto no espaço da face.
 *
 * Passar pela máscara equirretangular e recortá-la custaria 13 milhões de testes
 * de projeção num panorama 5120×2560 para depois jogar fora quase tudo, e ainda
 * entregaria a borda reamostrada. Aqui cada pixel da face é testado uma vez, na
 * resolução em que vai ser usado.
 */
export function mascaraDeCoberturaFace(
  face: FaceName,
  size: number,
  orientacoes: readonly Orientacao[],
  opts: CoberturaOpts,
): Raster {
  const tanHalfV = Math.tan((opts.vfovDeg * Math.PI) / 360);
  const tanHalfH = Math.tan((hfovFromVfov(opts.vfovDeg, opts.frameAspect) * Math.PI) / 360);
  const conjugadas = orientacoes.map((o) => conjugar(o.quaternion));

  const data = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dir = directionForFacePixel(face, x, y, size);
      const coberto = conjugadas.some((q) => projetarNdc(q, dir, tanHalfH, tanHalfV) !== null);

      const i = (y * size + x) * 4;
      const v = coberto ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }

  return { data, width: size, height: size };
}

/**
 * Alternativa quando não há `orientacoes.json`: calota a partir da faixa de
 * pitch que o INDICE.md já registra por captura. Mais grosseira — ignora a
 * ondulação em yaw da borda de cobertura — mas suficiente para delimitar
 * nadir e zênite.
 */
export function mascaraPorFaixa(
  width: number,
  height: number,
  pitchMinDeg: number,
  pitchMaxDeg: number,
): Raster {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    // theta corre de 0 no polo norte a π no sul; pitch é o complemento.
    const theta = ((y + 0.5) / height) * Math.PI;
    const pitchDeg = 90 - (theta * 180) / Math.PI;
    const dentro = pitchDeg >= pitchMinDeg && pitchDeg <= pitchMaxDeg;

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = dentro ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }

  return { data, width, height };
}

/**
 * Come alguns pixels da borda coberta, para que a região a gerar invada um
 * pouco o que é fotografia. Sem essa margem o modelo encosta exatamente no
 * limite do dado e a junção vira um anel visível; com ela, ele tem sobre o que
 * casar textura e cor.
 */
export function erodirCobertura(mask: Raster, raio: number): Raster {
  if (raio <= 0) return { ...mask, data: new Uint8ClampedArray(mask.data) };

  const { width, height } = mask;
  const out = new Uint8ClampedArray(mask.data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask.data[(y * width + x) * 4] === 0) continue;

      let vizinhoVazio = false;
      for (let dy = -raio; dy <= raio && !vizinhoVazio; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -raio; dx <= raio; dx++) {
          // Wrap em x: a borda φ=0 não é borda de verdade.
          const xx = ((x + dx) % width + width) % width;
          if (mask.data[(yy * width + xx) * 4] === 0) {
            vizinhoVazio = true;
            break;
          }
        }
      }

      if (vizinhoVazio) {
        const i = (y * width + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = 0;
      }
    }
  }

  return { data: out, width, height };
}

/**
 * Fração da esfera coberta, ponderada por ângulo sólido — sem o peso, as linhas
 * junto aos polos (que são fatias finíssimas de esfera esticadas por toda a
 * largura) dominariam a conta e o buraco pareceria muito maior do que é.
 * Espelha `measureCoverage` do stitcher.
 */
export function fracaoCoberta(mask: Raster): number {
  let cobertoPonderado = 0;
  let totalPonderado = 0;

  for (let y = 0; y < mask.height; y++) {
    const theta = ((y + 0.5) / mask.height) * Math.PI;
    const peso = Math.sin(theta);

    for (let x = 0; x < mask.width; x++) {
      totalPonderado += peso;
      if (mask.data[(y * mask.width + x) * 4] > 127) cobertoPonderado += peso;
    }
  }

  return totalPonderado === 0 ? 0 : cobertoPonderado / totalPonderado;
}

/** Faixa de pitch efetivamente coberta, em graus — o "faixa fotografada" do INDICE.md. */
export function faixaCoberta(mask: Raster): { pitchMinDeg: number; pitchMaxDeg: number } {
  let min = 90;
  let max = -90;

  for (let y = 0; y < mask.height; y++) {
    const theta = ((y + 0.5) / mask.height) * Math.PI;
    const pitchDeg = 90 - (theta * 180) / Math.PI;

    for (let x = 0; x < mask.width; x++) {
      if (mask.data[(y * mask.width + x) * 4] > 127) {
        if (pitchDeg < min) min = pitchDeg;
        if (pitchDeg > max) max = pitchDeg;
        break;
      }
    }
  }

  return { pitchMinDeg: min, pitchMaxDeg: max };
}

