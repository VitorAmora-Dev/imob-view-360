import { CameraModel, DEG, focalPx } from './camera-projection';
import { LAT_SPAN_DEG, LON_SPAN_DEG, TILE_H, TILE_W } from './capture-360.types';
import { warpFrameToTile } from './mesh-warp';

/**
 * Os frames sintéticos são gerados pela INVERSA da projeção: para cada pixel
 * do frame calcula-se (lon, lat) e pinta-se em função deles. O warp aplica a
 * projeção direta — se a cor esperada reaparece no lugar certo do tile, o
 * mapeamento fecha o ciclo.
 */
function makeFrame(
  cam: CameraModel,
  paint: (lonDeg: number, latDeg: number) => [number, number, number],
): ImageData {
  const frame = new ImageData(cam.width, cam.height);
  const data = frame.data;
  const f = focalPx(cam);
  const phi = cam.pitchDeg * DEG;
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);

  for (let py = 0; py < cam.height; py++) {
    const yn = (cam.height / 2 - (py + 0.5)) / f;
    for (let px = 0; px < cam.width; px++) {
      const xn = (px + 0.5 - cam.width / 2) / f;
      const dx = xn;
      const dy = yn * cosP + sinP;
      const dz = -yn * sinP + cosP;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const lon = Math.atan2(dx, dz) / DEG;
      const lat = Math.asin(dy / len) / DEG;
      const [r, g, b] = paint(lon, lat);
      const o = (py * cam.width + px) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return frame;
}

describe('mesh-warp', () => {
  // Frame menor que o real para o teste rodar rápido; a geometria independe da escala.
  const cam: CameraModel = { pitchDeg: 20, vFovDeg: 100, width: 720, height: 1280 };

  it('warpa cada célula de uma grade lon/lat para a célula certa do tile', () => {
    // Grade 8×5: células de 5.625° de longitude × 8° de latitude.
    const LON_CELL = LON_SPAN_DEG / 8;
    const LAT_CELL = LAT_SPAN_DEG / 5;
    const color = (ci: number, cj: number): [number, number, number] => [
      20 + ci * 28,
      20 + cj * 45,
      128,
    ];
    const frame = makeFrame(cam, (lon, lat) => {
      if (lon < -22.5 || lon >= 22.5 || lat < 0 || lat >= 40) return [0, 0, 0];
      const ci = Math.min(7, Math.floor((lon + 22.5) / LON_CELL));
      const cj = Math.min(4, Math.floor((40 - lat) / LAT_CELL)); // linha 0 = lat mais alta
      return color(ci, cj);
    });

    const tile = warpFrameToTile(frame, cam, 'upper');
    expect(tile.width).toBe(TILE_W);
    expect(tile.height).toBe(TILE_H);

    // Centro de cada célula correspondente no tile (64×91 px por célula).
    for (let ci = 0; ci < 8; ci++) {
      for (let cj = 0; cj < 5; cj++) {
        const i = ci * (TILE_W / 8) + TILE_W / 16;
        const j = cj * (TILE_H / 5) + TILE_H / 10;
        const o = (Math.round(j) * TILE_W + Math.round(i)) * 4;
        const [r, g, b] = color(ci, cj);
        // bilinear no interior de célula chapada = cor exata (±1 por arredondamento)
        expect(Math.abs(tile.data[o] - r)).toBeLessThanOrEqual(1);
        expect(Math.abs(tile.data[o + 1] - g)).toBeLessThanOrEqual(1);
        expect(Math.abs(tile.data[o + 2] - b)).toBeLessThanOrEqual(1);
        expect(tile.data[o + 3]).toBe(255);
      }
    }
  });

  it('produz costura contínua entre tiles adjacentes da mesma cena', () => {
    // Cena mundial com gradiente suave em função de lon_world e lat.
    // O tile k vê lon_world = lon_cam + 45k: warpamos k=0 e k=1 e comparamos
    // a última coluna de um com a primeira do outro (0.088° de distância).
    const world = (lonWorld: number, lat: number): [number, number, number] => [
      Math.round((((lonWorld % 360) + 360) % 360) / 360 * 255),
      Math.round(((lat + 90) / 180) * 255),
      100,
    ];

    const frame0 = makeFrame(cam, (lon, lat) => world(lon, lat));
    const frame1 = makeFrame(cam, (lon, lat) => world(lon + 45, lat));
    const tile0 = warpFrameToTile(frame0, cam, 'upper');
    const tile1 = warpFrameToTile(frame1, cam, 'upper');

    for (let j = 0; j < TILE_H; j += 7) {
      const oLast = (j * TILE_W + (TILE_W - 1)) * 4;
      const oFirst = (j * TILE_W) * 4;
      expect(Math.abs(tile0.data[oLast] - tile1.data[oFirst])).toBeLessThanOrEqual(2);
      expect(Math.abs(tile0.data[oLast + 1] - tile1.data[oFirst + 1])).toBeLessThanOrEqual(2);
    }
  });

  it('warpa a faixa inferior com o espelho da superior', () => {
    // Cena simétrica em relação ao equador → tiles idênticos linha a linha invertida.
    const paint = (lon: number, lat: number): [number, number, number] => [
      Math.round(((lon + 90) / 180) * 255),
      Math.round((Math.abs(lat) / 90) * 255),
      64,
    ];
    const upperCam = cam;
    const lowerCam: CameraModel = { ...cam, pitchDeg: -20 };
    const tileUp = warpFrameToTile(makeFrame(upperCam, paint), upperCam, 'upper');
    const tileDown = warpFrameToTile(makeFrame(lowerCam, paint), lowerCam, 'lower');

    for (let j = 0; j < TILE_H; j += 13) {
      for (let i = 0; i < TILE_W; i += 17) {
        const oUp = (j * TILE_W + i) * 4;
        const oDown = ((TILE_H - 1 - j) * TILE_W + i) * 4;
        expect(Math.abs(tileUp.data[oUp] - tileDown.data[oDown])).toBeLessThanOrEqual(2);
        expect(Math.abs(tileUp.data[oUp + 1] - tileDown.data[oDown + 1])).toBeLessThanOrEqual(2);
      }
    }
  });
});
