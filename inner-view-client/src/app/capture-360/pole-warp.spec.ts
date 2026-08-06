import { CameraModel } from './camera-projection';
import { EQUIRECT_W, NADIR_STRIP_H, ZENITH_STRIP_H } from './capture-360.types';
import { warpNadir, warpZenith } from './pole-warp';
import { makeFrame } from './test-helpers';

describe('pole-warp', () => {
  it('warpZenith mapeia a calota +40..+90 para a tira superior', () => {
    // Radial em latitude: R proporcional a (lat−40). Só a calota é pintada.
    const cam: CameraModel = { pitchDeg: 90, vFovDeg: 120, width: 900, height: 900 };
    const frame = makeFrame(cam, (_lon, lat) =>
      lat > 40 ? [Math.round(((lat - 40) / 50) * 255), 100, 50] : [0, 0, 0],
    );

    const strip = warpZenith(frame, 120);
    expect(strip.width).toBe(EQUIRECT_W);
    expect(strip.height).toBe(ZENITH_STRIP_H);

    // Linha 0 = lat 90 (polo, R alto); última linha = lat 40 (R baixo).
    const col = 2000;
    const near = (strip.data[(10 * EQUIRECT_W + col) * 4]);
    const far = (strip.data[((ZENITH_STRIP_H - 10) * EQUIRECT_W + col) * 4]);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(180); // perto do polo, quase saturado
  });

  it('warpNadir mapeia a calota −90..−40 para a tira inferior', () => {
    const cam: CameraModel = { pitchDeg: -90, vFovDeg: 120, width: 900, height: 900 };
    const frame = makeFrame(cam, (_lon, lat) =>
      lat < -40 ? [Math.round(((-40 - lat) / 50) * 255), 80, 40] : [0, 0, 0],
    );

    const strip = warpNadir(frame, 120);
    expect(strip.width).toBe(EQUIRECT_W);
    expect(strip.height).toBe(NADIR_STRIP_H);

    // Linha 0 = lat −40 (R baixo); última linha = lat −90 (polo, R alto).
    const col = 2000;
    const nearBand = strip.data[(10 * EQUIRECT_W + col) * 4];
    const nearPole = strip.data[((NADIR_STRIP_H - 10) * EQUIRECT_W + col) * 4];
    expect(nearPole).toBeGreaterThan(nearBand);
    expect(nearPole).toBeGreaterThan(180);
  });

  it('preenche a largura toda da tira (longitude cheia a partir de uma foto)', () => {
    const cam: CameraModel = { pitchDeg: 90, vFovDeg: 120, width: 800, height: 800 };
    // Cor constante na calota → a tira inteira deve ficar preenchida (alpha 255).
    const frame = makeFrame(cam, (_lon, lat) => (lat > 40 ? [50, 200, 90] : [0, 0, 0]));
    const strip = warpZenith(frame, 120);
    for (const x of [10, EQUIRECT_W / 2, EQUIRECT_W - 10]) {
      const o = (Math.floor(ZENITH_STRIP_H / 2) * EQUIRECT_W + x) * 4;
      expect(strip.data[o + 3]).toBe(255);
      expect(strip.data[o + 1]).toBeGreaterThan(150); // canal G da cor da calota
    }
  });
});
