import {
  BAND_PITCH_DEG,
  CaptureStep,
  POLE_PITCH_DEG,
  TILES_PER_BAND,
} from './capture-360.types';

/**
 * Sequência linear e guiada de 18 passos:
 *   1. faixa superior — 8 fotos girando 360° (pitch +20°)
 *   2. faixa inferior — 8 fotos girando 360° (pitch −20°)
 *   3. zênite (teto, reto para cima) e nadir (chão, reto para baixo)
 *
 * A primeira foto de cada faixa pede para inclinar; as demais, para girar ~45°.
 * As instruções são chaves i18n resolvidas pelo componente.
 */
export function buildCapturePlan(): CaptureStep[] {
  const steps: CaptureStep[] = [];

  for (let i = 0; i < TILES_PER_BAND; i++) {
    steps.push({
      key: `upper:${i}`,
      kind: 'band',
      band: 'upper',
      index: i,
      pitchDeg: BAND_PITCH_DEG,
      viewfinder: 'gore',
      instructionKey: i === 0 ? 'CAPTURE.TILT_UP' : 'CAPTURE.TURN',
      arrow: i === 0 ? 'up' : 'right',
    });
  }

  for (let i = 0; i < TILES_PER_BAND; i++) {
    steps.push({
      key: `lower:${i}`,
      kind: 'band',
      band: 'lower',
      index: i,
      pitchDeg: -BAND_PITCH_DEG,
      viewfinder: 'gore',
      instructionKey: i === 0 ? 'CAPTURE.TILT_DOWN' : 'CAPTURE.TURN',
      arrow: i === 0 ? 'down' : 'right',
    });
  }

  steps.push({
    key: 'zenith',
    kind: 'pole',
    pole: 'zenith',
    pitchDeg: POLE_PITCH_DEG,
    viewfinder: 'disc',
    instructionKey: 'CAPTURE.POINT_UP',
    arrow: 'up',
  });
  steps.push({
    key: 'nadir',
    kind: 'pole',
    pole: 'nadir',
    pitchDeg: -POLE_PITCH_DEG,
    viewfinder: 'disc',
    instructionKey: 'CAPTURE.POINT_DOWN',
    arrow: 'down',
  });

  return steps;
}

/** Total de passos do plano (18). */
export const TOTAL_STEPS = 2 * TILES_PER_BAND + 2;
