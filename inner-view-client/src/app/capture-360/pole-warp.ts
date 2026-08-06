import {
  EQUIRECT_W,
  LAT_SPAN_DEG,
  NADIR_STRIP_H,
  POLE_PITCH_DEG,
  ZENITH_STRIP_H,
} from './capture-360.types';
import { warpFrameToRegion } from './mesh-warp';

/**
 * Calotas dos polos. A foto de zênite (câmera reta para cima, pitch +90°) cobre
 * a calota lat +40..+90 em todas as longitudes; a de nadir (pitch −90°), lat
 * −90..−40. Cada uma vira uma tira de 4096 px de largura que preenche o topo
 * ou a base do equiretangular — o mesmo warp inverso das faixas, só com pitch
 * ±90° e longitude cheia (a projeção azimutal da calota emerge naturalmente).
 *
 * A calota exige lente larga: cobrir um raio de 50° pede vFOV ≳ 100°. Com lente
 * estreita as bordas da calota saem esticadas (clamp), mas a UI já orienta o uso
 * do ultrawide.
 */
export function warpZenith(frame: ImageData, vFovDeg: number): ImageData {
  const cam = { pitchDeg: POLE_PITCH_DEG, vFovDeg, width: frame.width, height: frame.height };
  return warpFrameToRegion(frame, cam, {
    lonLo: -180,
    lonHi: 180,
    latLo: LAT_SPAN_DEG,
    latHi: 90,
    outW: EQUIRECT_W,
    outH: ZENITH_STRIP_H,
  });
}

export function warpNadir(frame: ImageData, vFovDeg: number): ImageData {
  const cam = { pitchDeg: -POLE_PITCH_DEG, vFovDeg, width: frame.width, height: frame.height };
  return warpFrameToRegion(frame, cam, {
    lonLo: -180,
    lonHi: 180,
    latLo: -90,
    latHi: -LAT_SPAN_DEG,
    outW: EQUIRECT_W,
    outH: NADIR_STRIP_H,
  });
}
