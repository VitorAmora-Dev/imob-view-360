import { Band, LAT_SPAN_DEG, LON_SPAN_DEG, TILE_H, TILE_W } from './capture-360.types';
import { CameraModel, DEG, focalPx } from './camera-projection';

/** Região equiretangular de saída, em graus, e o tamanho do bitmap alvo. */
export interface WarpRegion {
  lonLo: number;
  lonHi: number;
  latLo: number;
  latHi: number;
  outW: number;
  outH: number;
}

/**
 * Deswarp genérico: frame da câmera → bitmap equiretangular de uma região.
 *
 * Mapeamento INVERSO por pixel (não é homografia de 4 pontos — as bordas são
 * curvas): cada pixel de saída define um (lon, lat) — linha 0 = latHi, pois o
 * equiretangular cresce para baixo; a direção esférica é projetada pela MESMA
 * câmera da máscara (fonte única de verdade) e a cor vem de amostragem
 * bilinear no frame. A projeção está inline (não chama projectLonLat) porque o
 * loop roda centenas de milhares de vezes; a trigonometria de longitude é
 * pré-computada por coluna e a de latitude uma vez por linha.
 *
 * Serve tanto o gomo das faixas (pitch ±20°, região 45°×40°) quanto as calotas
 * de polo (pitch ±90°, longitude cheia) — a mesma matemática, regiões
 * diferentes. Coordenadas fora do frame recebem clamp de borda.
 */
export function warpFrameToRegion(frame: ImageData, cam: CameraModel, region: WarpRegion): ImageData {
  const { lonLo, lonHi, latLo, latHi, outW, outH } = region;
  const out = new ImageData(outW, outH);
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

  const lonSpan = lonHi - lonLo;
  const latSpan = latHi - latLo;

  const sinLon = new Float64Array(outW);
  const cosLon = new Float64Array(outW);
  for (let i = 0; i < outW; i++) {
    const lon = (lonLo + (lonSpan * (i + 0.5)) / outW) * DEG;
    sinLon[i] = Math.sin(lon);
    cosLon[i] = Math.cos(lon);
  }

  const maxX = srcW - 2;
  const maxY = srcH - 2;

  for (let j = 0; j < outH; j++) {
    const lat = (latHi - (latSpan * (j + 0.5)) / outH) * DEG;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);

    for (let i = 0; i < outW; i++) {
      const dx = cosLat * sinLon[i];
      const dy = sinLat;
      const dz = cosLat * cosLon[i];

      const df = dy * sinP + dz * cosP; // > 0 dentro das regiões usadas (gomo ±20°, calotas ±90°)
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

      const o = (j * outW + i) * 4;
      dst[o] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      dst[o + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
      dst[o + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
      dst[o + 3] = 255;
    }
  }

  return out;
}

/** Região do gomo de uma faixa: 45° de longitude centrados, 40° de latitude. */
export function bandRegion(band: Band): WarpRegion {
  const halfLon = LON_SPAN_DEG / 2;
  return band === 'upper'
    ? { lonLo: -halfLon, lonHi: halfLon, latLo: 0, latHi: LAT_SPAN_DEG, outW: TILE_W, outH: TILE_H }
    : { lonLo: -halfLon, lonHi: halfLon, latLo: -LAT_SPAN_DEG, latHi: 0, outW: TILE_W, outH: TILE_H };
}

/** Deswarp do gomo de uma faixa → tile equiretangular local 512×455. */
export function warpFrameToTile(frame: ImageData, cam: CameraModel, band: Band): ImageData {
  return warpFrameToRegion(frame, cam, bandRegion(band));
}
