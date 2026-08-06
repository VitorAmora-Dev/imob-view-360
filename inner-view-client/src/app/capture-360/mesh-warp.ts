import { Band, LAT_SPAN_DEG, LON_SPAN_DEG, TILE_H, TILE_W } from './capture-360.types';
import { CameraModel, DEG, focalPx } from './camera-projection';

/**
 * Deswarp do gomo: frame da câmera → tile equiretangular local 512×455.
 *
 * Mapeamento INVERSO por pixel (não é homografia de 4 pontos — as bordas do
 * gomo são curvas): cada pixel do tile define um (lon, lat); a direção
 * esférica é projetada pela MESMA câmera da máscara; a cor vem de amostragem
 * bilinear no frame. A projeção está inline (não chama projectLonLat) porque
 * o loop roda 233k vezes — a trigonometria de longitude é pré-computada por
 * coluna e a de latitude uma vez por linha.
 *
 * Fora do gomo enquadrado não há amostra válida; coordenadas fora do frame
 * recebem clamp de borda (acontece apenas se a lente for mais estreita que o
 * necessário — caso em que a UI já exibiu o aviso de ultrawide).
 */
export function warpFrameToTile(frame: ImageData, cam: CameraModel, band: Band): ImageData {
  const out = new ImageData(TILE_W, TILE_H);
  const src = frame.data;
  const dst = out.data;
  const srcW = frame.width;
  const srcH = frame.height;

  const f = focalPx(cam);
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  const phi = cam.pitchDeg * DEG;
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);

  // Linha 0 do tile = latitude mais ALTA do gomo (equiretangular cresce para baixo).
  const latTop = band === 'upper' ? LAT_SPAN_DEG : 0;

  const sinLon = new Float64Array(TILE_W);
  const cosLon = new Float64Array(TILE_W);
  for (let i = 0; i < TILE_W; i++) {
    const lon = (-LON_SPAN_DEG / 2 + (LON_SPAN_DEG * (i + 0.5)) / TILE_W) * DEG;
    sinLon[i] = Math.sin(lon);
    cosLon[i] = Math.cos(lon);
  }

  const maxX = srcW - 2;
  const maxY = srcH - 2;

  for (let j = 0; j < TILE_H; j++) {
    const lat = (latTop - (LAT_SPAN_DEG * (j + 0.5)) / TILE_H) * DEG;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);

    for (let i = 0; i < TILE_W; i++) {
      const dx = cosLat * sinLon[i];
      const dy = sinLat;
      const dz = cosLat * cosLon[i];

      const df = dy * sinP + dz * cosP; // sempre > 0 dentro do gomo com |pitch| = 20°
      const u = cx + (dx / df) * f;
      const v = cy - ((dy * cosP - dz * sinP) / df) * f;

      // bilinear: centros de pixel em coordenadas k+0.5
      let x0 = Math.floor(u - 0.5);
      let y0 = Math.floor(v - 0.5);
      if (x0 < 0) x0 = 0;
      else if (x0 > maxX) x0 = maxX;
      if (y0 < 0) y0 = 0;
      else if (y0 > maxY) y0 = maxY;

      let tx = u - 0.5 - x0;
      let ty = v - 0.5 - y0;
      if (tx < 0) tx = 0;
      else if (tx > 1) tx = 1;
      if (ty < 0) ty = 0;
      else if (ty > 1) ty = 1;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + srcW * 4;
      const i11 = i01 + 4;

      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;

      const o = (j * TILE_W + i) * 4;
      dst[o] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      dst[o + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
      dst[o + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
      dst[o + 3] = 255;
    }
  }

  return out;
}
