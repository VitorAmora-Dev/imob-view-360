import { assembleEquirect, assembleEquirectCanvas } from './equirect-assembler';
import {
  Band,
  CapturedTile,
  EQUIRECT_H,
  EQUIRECT_W,
  LOWER_BAND_Y,
  NADIR_STRIP_H,
  NADIR_STRIP_Y,
  TILE_H,
  TILE_W,
  TILES_PER_BAND,
  UPPER_BAND_Y,
  ZENITH_STRIP_H,
} from './capture-360.types';

function solidStrip(w: number, h: number, [r, g, b]: [number, number, number]): ImageData {
  const strip = new ImageData(w, h);
  for (let i = 0; i < strip.data.length; i += 4) {
    strip.data[i] = r;
    strip.data[i + 1] = g;
    strip.data[i + 2] = b;
    strip.data[i + 3] = 255;
  }
  return strip;
}

function solidTile(band: Band, index: number, [r, g, b]: [number, number, number]): CapturedTile {
  const tile = new ImageData(TILE_W, TILE_H);
  for (let i = 0; i < tile.data.length; i += 4) {
    tile.data[i] = r;
    tile.data[i + 1] = g;
    tile.data[i + 2] = b;
    tile.data[i + 3] = 255;
  }
  return { slot: { band, index }, tile };
}

/** Cor única por slot para detectar troca de posição na montagem. */
function slotColor(band: Band, index: number): [number, number, number] {
  return [band === 'upper' ? 200 : 40, 20 + index * 25, band === 'upper' ? 60 : 180];
}

function allTiles(): CapturedTile[] {
  const tiles: CapturedTile[] = [];
  for (const band of ['upper', 'lower'] as Band[]) {
    for (let i = 0; i < TILES_PER_BAND; i++) {
      tiles.push(solidTile(band, i, slotColor(band, i)));
    }
  }
  return tiles;
}

describe('equirect-assembler', () => {
  it('posiciona cada tile no slot certo do equiretangular 4096×2048', () => {
    const canvas = assembleEquirectCanvas(allTiles());
    expect(canvas.width).toBe(EQUIRECT_W);
    expect(canvas.height).toBe(EQUIRECT_H);
    const ctx = canvas.getContext('2d')!;

    for (const band of ['upper', 'lower'] as Band[]) {
      const y = (band === 'upper' ? UPPER_BAND_Y : LOWER_BAND_Y) + Math.floor(TILE_H / 2);
      for (let k = 0; k < TILES_PER_BAND; k++) {
        const x = k * TILE_W + Math.floor(TILE_W / 2);
        const px = ctx.getImageData(x, y, 1, 1).data;
        const [r, g, b] = slotColor(band, k);
        expect(px[0]).toBe(r);
        expect(px[1]).toBe(g);
        expect(px[2]).toBe(b);
      }
    }
  });

  it('preenche os polos com degradê da borda para a média (sem buraco preto)', () => {
    const canvas = assembleEquirectCanvas(allTiles());
    const ctx = canvas.getContext('2d')!;
    const x = Math.floor(TILE_W / 2); // coluna dentro do tile 0 da faixa superior

    const border = ctx.getImageData(x, UPPER_BAND_Y, 1, 1).data;
    const nearBand = ctx.getImageData(x, UPPER_BAND_Y - 2, 1, 1).data;
    const nearPole = ctx.getImageData(x, 1, 1, 1).data;

    // encostado na faixa: praticamente a cor da borda daquela coluna
    expect(Math.abs(nearBand[0] - border[0])).toBeLessThanOrEqual(2);
    expect(Math.abs(nearBand[1] - border[1])).toBeLessThanOrEqual(2);
    // no polo: convergiu para a média da linha — e nunca preto puro
    expect(nearPole[0] + nearPole[1] + nearPole[2]).toBeGreaterThan(0);

    // o mesmo para o nadir
    const nearBottomBand = ctx.getImageData(x, LOWER_BAND_Y + TILE_H + 1, 1, 1).data;
    const bottomBorder = ctx.getImageData(x, LOWER_BAND_Y + TILE_H - 1, 1, 1).data;
    expect(Math.abs(nearBottomBand[0] - bottomBorder[0])).toBeLessThanOrEqual(2);
    const nadir = ctx.getImageData(x, EQUIRECT_H - 2, 1, 1).data;
    expect(nadir[0] + nadir[1] + nadir[2]).toBeGreaterThan(0);
  });

  it('no polo, colunas diferentes convergem para a mesma cor média', () => {
    const canvas = assembleEquirectCanvas(allTiles());
    const ctx = canvas.getContext('2d')!;
    const a = ctx.getImageData(100, 0, 1, 1).data;
    const b = ctx.getImageData(3000, 0, 1, 1).data;
    // t=1 na linha 0: ambas exatamente a média (±1 por arredondamento)
    expect(Math.abs(a[0] - b[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(a[1] - b[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(a[2] - b[2])).toBeLessThanOrEqual(1);
  });

  it('cola as calotas reais nos polos quando fornecidas', () => {
    const zenith = solidStrip(EQUIRECT_W, ZENITH_STRIP_H, [10, 220, 30]);
    const nadir = solidStrip(EQUIRECT_W, NADIR_STRIP_H, [220, 20, 40]);
    const canvas = assembleEquirectCanvas(allTiles(), { zenith, nadir });
    const ctx = canvas.getContext('2d')!;

    const top = ctx.getImageData(2000, 10, 1, 1).data;
    expect(top[1]).toBe(220); // G da calota do zênite

    const bottom = ctx.getImageData(2000, NADIR_STRIP_Y + 10, 1, 1).data;
    expect(bottom[0]).toBe(220); // R da calota do nadir
  });

  it('cai no degradê de polo quando as calotas não são fornecidas', () => {
    const canvas = assembleEquirectCanvas(allTiles()); // sem poles
    const nearPole = canvas.getContext('2d')!.getImageData(100, 1, 1, 1).data;
    // não é preto puro (degradê da borda), e não é a cor chapada de uma calota
    expect(nearPole[0] + nearPole[1] + nearPole[2]).toBeGreaterThan(0);
  });

  it('serializa como data URI JPEG', () => {
    const dataUrl = assembleEquirect(allTiles(), {}, 0.8);
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBeTrue();
    // sanidade de tamanho: nem vazio nem absurdo
    expect(dataUrl.length).toBeGreaterThan(10_000);
    expect(dataUrl.length).toBeLessThan(8_000_000);
  });

  it('monta parcialmente sem lançar (tiles faltantes ficam pretos)', () => {
    const canvas = assembleEquirectCanvas([solidTile('upper', 3, [255, 0, 0])]);
    const ctx = canvas.getContext('2d')!;
    const filled = ctx.getImageData(3 * TILE_W + 10, UPPER_BAND_Y + 10, 1, 1).data;
    const empty = ctx.getImageData(10, UPPER_BAND_Y + 10, 1, 1).data;
    expect(filled[0]).toBe(255);
    expect(empty[0] + empty[1] + empty[2]).toBe(0);
  });
});
