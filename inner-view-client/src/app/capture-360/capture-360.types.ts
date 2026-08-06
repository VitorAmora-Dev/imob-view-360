/**
 * Método 2 — captura guiada em grade esférica.
 *
 * O panorama é dividido em 16 gomos truncados: 2 faixas latitudinais
 * (superior: 0°..+40°, inferior: −40°..0°) × 8 fotos de 45° de longitude.
 * Cada captura vira um tile equiretangular local de 512×455 px
 * (512/45° ≈ 455/40° ≈ 11.38 px/grau), montados numa equiretangular
 * completa de 4096×2048 que entra no fluxo de upload existente.
 */
export type Band = 'upper' | 'lower';

export interface CaptureSlot {
  band: Band;
  /** 0..7 dentro da faixa; o yaw absoluto é arbitrário (sem bússola). */
  index: number;
}

export interface CapturedTile {
  slot: CaptureSlot;
  /** TILE_W × TILE_H, projeção equiretangular local do gomo. */
  tile: ImageData;
}

export const TILES_PER_BAND = 8;
export const TILE_W = 512;
export const TILE_H = 455;
export const LON_SPAN_DEG = 45;
export const LAT_SPAN_DEG = 40;
/** Inclinação da câmera no centro vertical da faixa: +20° (superior) / −20° (inferior). */
export const BAND_PITCH_DEG = 20;

export const EQUIRECT_W = 4096;
export const EQUIRECT_H = 2048;
/** Linha do topo da faixa superior: (90−40)/180 · 2048 ≈ 569. As faixas ocupam [569,1024) e [1024,1479). */
export const UPPER_BAND_Y = 569;
export const LOWER_BAND_Y = 1024;

/**
 * FOV vertical assumido do frame nativo. getUserMedia não expõe o FOV real;
 * 100° corresponde à ultrawide típica em retrato — a única lente em que o
 * gomo de 45° de longitude cabe no enquadramento (exige hFOV ≥ ~48°).
 * Calibrável em campo via localStorage sem rebuild.
 */
export const DEFAULT_VFOV_DEG = 100;
export const VFOV_STORAGE_KEY = 'capture360.vfovDeg';

/** `zoom` não existe no typing de MediaTrackCapabilities do lib dom — extensão local. */
export interface ZoomCapableCapabilities extends MediaTrackCapabilities {
  zoom?: { min: number; max: number; step?: number };
}

export interface ZoomConstraintSet extends MediaTrackConstraintSet {
  zoom?: number;
}
