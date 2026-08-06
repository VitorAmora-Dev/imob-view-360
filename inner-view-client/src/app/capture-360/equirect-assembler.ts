import {
  CapturedTile,
  EQUIRECT_H,
  EQUIRECT_W,
  LOWER_BAND_Y,
  TILE_H,
  TILE_W,
  UPPER_BAND_Y,
} from './capture-360.types';

/**
 * Monta a equiretangular completa 4096×2048 (aspecto 2:1, contrato do viewer):
 * faixa superior nas linhas [569, 1024), inferior em [1024, 1479), tile k em
 * x = k·512. Os polos (±40°..±90°) não têm captura na v1 — são preenchidos
 * estendendo a linha de borda de cada faixa com um degradê por coluna até a
 * cor média da linha, o que evita tanto o "buraco preto" quanto listras
 * verticais convergindo no zênite/nadir.
 *
 * Separado de `assembleEquirect` para os testes lerem pixels direto do canvas
 * sem decodificar JPEG.
 */
export function assembleEquirectCanvas(tiles: CapturedTile[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = EQUIRECT_W;
  canvas.height = EQUIRECT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('assembleEquirect: canvas 2d indisponível');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, EQUIRECT_W, EQUIRECT_H);

  for (const { slot, tile } of tiles) {
    const x = slot.index * TILE_W;
    const y = slot.band === 'upper' ? UPPER_BAND_Y : LOWER_BAND_Y;
    ctx.putImageData(tile, x, y);
  }

  fillPole(ctx, UPPER_BAND_Y, 0, UPPER_BAND_Y);
  fillPole(ctx, LOWER_BAND_Y + TILE_H - 1, LOWER_BAND_Y + TILE_H, EQUIRECT_H);

  return canvas;
}

/** Monta e serializa. ~1–2 MB em q0.85 — muito abaixo do limite de 50 MB do backend. */
export function assembleEquirect(tiles: CapturedTile[], quality = 0.85): string {
  return assembleEquirectCanvas(tiles).toDataURL('image/jpeg', quality);
}

/**
 * Preenche as linhas [yStart, yEnd) a partir da linha de borda `sampleRow`:
 * cada coluna faz lerp da sua cor de borda para a cor média da linha,
 * proporcional à distância até o polo (t=0 encostado na faixa, t=1 no polo).
 */
function fillPole(
  ctx: CanvasRenderingContext2D,
  sampleRow: number,
  yStart: number,
  yEnd: number,
): void {
  const rows = yEnd - yStart;
  if (rows <= 0) return;

  const border = ctx.getImageData(0, sampleRow, EQUIRECT_W, 1).data;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let x = 0; x < EQUIRECT_W; x++) {
    sumR += border[x * 4];
    sumG += border[x * 4 + 1];
    sumB += border[x * 4 + 2];
  }
  const avgR = sumR / EQUIRECT_W;
  const avgG = sumG / EQUIRECT_W;
  const avgB = sumB / EQUIRECT_W;

  const region = new ImageData(EQUIRECT_W, rows);
  const out = region.data;
  const maxDist = Math.max(Math.abs(yStart - sampleRow), Math.abs(yEnd - 1 - sampleRow));

  for (let r = 0; r < rows; r++) {
    const y = yStart + r;
    const t = Math.abs(y - sampleRow) / maxDist;
    for (let x = 0; x < EQUIRECT_W; x++) {
      const b = x * 4;
      const o = (r * EQUIRECT_W + x) * 4;
      out[o] = border[b] + (avgR - border[b]) * t;
      out[o + 1] = border[b + 1] + (avgG - border[b + 1]) * t;
      out[o + 2] = border[b + 2] + (avgB - border[b + 2]) * t;
      out[o + 3] = 255;
    }
  }

  ctx.putImageData(region, 0, yStart);
}
