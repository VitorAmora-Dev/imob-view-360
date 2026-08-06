import { CameraModel, DEG, focalPx } from './camera-projection';

/**
 * Gera um frame sintético pela INVERSA da projeção: para cada pixel do frame
 * calcula-se (lon, lat) e pinta-se em função deles. Os warps aplicam a
 * projeção direta — se a cor esperada reaparece no lugar certo da saída, o
 * mapeamento fecha o ciclo. Compartilhado pelos specs de warp (gomo e polos).
 */
export function makeFrame(
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
