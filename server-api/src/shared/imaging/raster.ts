import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { Raster } from './cubemap';

/** Ponte entre o `Raster` RGBA cru, que a geometria manipula, e arquivos em disco. */

export async function lerRaster(arquivo: string): Promise<Raster> {
  const { data, info } = await sharp(arquivo)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

export async function pngParaRaster(png: Buffer): Promise<Raster> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

export function rasterParaPng(raster: Raster): Promise<Buffer> {
  return sharp(Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length), {
    raw: { width: raster.width, height: raster.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export function rasterParaJpeg(raster: Raster, quality = 92): Promise<Buffer> {
  return sharp(Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length), {
    raw: { width: raster.width, height: raster.height, channels: 4 },
  })
    .jpeg({ quality, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export async function escrever(arquivo: string, conteudo: Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(arquivo), { recursive: true });
  await fs.promises.writeFile(arquivo, conteudo);
}

/** Redimensiona preservando o alfa — usado para caber no limite nativo dos modelos. */
export async function redimensionar(raster: Raster, width: number, height: number): Promise<Raster> {
  const png = await rasterParaPng(raster);
  const { data, info } = await sharp(png)
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

/**
 * Converte a máscara de cobertura (branco = fotografado) na convenção que a API
 * de edição da OpenAI espera: alfa 0 marca o que PODE ser reescrito. O RGB é
 * irrelevante ali, mas fica preto para o PNG ser legível quando aberto na mão.
 */
export function mascaraParaAlfaEditavel(cobertura: Raster): Raster {
  const data = new Uint8ClampedArray(cobertura.data.length);

  for (let i = 0; i < cobertura.data.length; i += 4) {
    const fotografado = cobertura.data[i] > 127;
    data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = fotografado ? 255 : 0;
  }

  return { data, width: cobertura.width, height: cobertura.height };
}

/**
 * Abre um buraco transparente na face onde não há fotografia. É assim que o
 * Gemini enxerga a região a preencher — ele não tem parâmetro de máscara, então
 * o recorte precisa estar na própria imagem.
 */
export function furarPelaCobertura(face: Raster, cobertura: Raster): Raster {
  const data = new Uint8ClampedArray(face.data);

  for (let i = 0; i < data.length; i += 4) {
    if (cobertura.data[i] <= 127) data[i + 3] = 0;
  }

  return { data, width: face.width, height: face.height };
}

/** Pinta de uma cor chapada o que está fora da cobertura — versão legível para contact sheet. */
export function marcarBuraco(face: Raster, cobertura: Raster, cor: [number, number, number]): Raster {
  const data = new Uint8ClampedArray(face.data);

  for (let i = 0; i < data.length; i += 4) {
    if (cobertura.data[i] <= 127) {
      data[i] = cor[0];
      data[i + 1] = cor[1];
      data[i + 2] = cor[2];
      data[i + 3] = 255;
    }
  }

  return { data, width: face.width, height: face.height };
}
