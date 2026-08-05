import * as THREE from 'three';
import { CameraSpec } from './capture-sources';
import {
  AxisTriple,
  FrameView,
  applyCorrection,
  forwardOf,
  loopClosureResidual,
  measurePair,
  solveRingCorrections,
} from './frame-align';
import { CapturedFrame, closeDecoded, decodeFrame } from './frame-store';
import { wrapDeg180, yprFromQuaternion } from './orientation-math';
import { disagreementCost, shortestVerticalPath } from './seam-path';

/**
 * Projects the captured shots onto an equirectangular canvas using the gyro
 * quaternion recorded with each one — no feature detection. Software steps
 * close the gap to a "real" stitcher:
 *   1. the camera's true field of view is FITTED from the data (the gyro knows
 *      the angle between shots, so the only unknown is the degrees-per-pixel),
 *   2. the ring is aligned as images in all three axes and solved as a loop,
 *      so the closing error is spread rather than left at the last seam
 *      (see frame-align.ts), then per-channel exposure gain from the overlaps,
 *   3. each pixel taken from the single frame that owns it, blended only along
 *      the seam.
 * Whatever the shots genuinely miss is filled from the coverage mask, not from
 * an assumed FOV.
 *
 * The equirect is rendered in horizontal bands, and frames are decoded one at a
 * time from their stored JPEG bytes. Nothing full-size is ever resident twice,
 * which is what allows a larger output than the old whole-canvas pass could
 * afford.
 */
export interface StitchShot {
  frame: CapturedFrame;
  /** Session-frame camera orientation at the moment of capture. */
  quaternion: { x: number; y: number; z: number; w: number };
}

/**
 * `seam` takes each pixel from the single frame that owns it; `average` is the
 * old wash of every overlapping frame, kept only so before/after measurements
 * can run both paths over identical input.
 */
export type BlendMode = 'seam' | 'average';

export interface StitchOptions {
  outWidth?: number;
  outHeight?: number;
  /** Disable the correlation refinement (used by tests / troubleshooting). */
  refine?: boolean;
  /**
   * Apply the measured ring alignment instead of only reporting it. OFF by
   * default — see `alignRing` for the measurements that put it there.
   */
  align?: boolean;
  blendMode?: BlendMode;
  /** Seam sharpness: higher makes the cross-fade at the seam narrower. */
  seamK?: number;
  /**
   * Route the cut through where the photos agree, instead of down the
   * geometric midpoint. On by default; the switch exists so the two can be
   * measured over identical input.
   */
  routeSeam?: boolean;
  onProgress?: (fraction: number) => void;
}

/**
 * Calibrated on the simulated room with 25 cm of hand-held parallax — see the
 * sweep in the verification notes. Low values reintroduce the wash; very high
 * values make the seam a hard, visible line.
 */
export const DEFAULT_SEAM_K = 60;

export interface StitchResult {
  imageData: string;
  /** Vertical FOV the fit settled on — surfaced for diagnostics and tests. */
  fittedVfovDeg: number;
  /** Fraction of the sphere covered by real pixels, 0..1. */
  coverage: number;
  /**
   * How far the ring was from closing before the correction was distributed.
   * Large values mean the gyro drifted over the capture; the stitch absorbs it,
   * but it is worth seeing.
   */
  loopClosureDeg: AxisTriple;
  /**
   * How far the routed cuts wandered from the geometric midpoint. Zero means
   * the routing found no reason to move — or that it never ran.
   */
  seamSpreadDeg: number;
}

/** Used only until the fit runs; deliberately conservative (see PatternOptions). */
export const DEFAULT_VFOV_DEG = 65;

/** The fit refuses to leave this range — outside it, no phone lens exists. */
export const MIN_VFOV_DEG = 40;
export const MAX_VFOV_DEG = 130;

export function hfovFromVfov(vfovDeg: number, frameAspect: number): number {
  return (2 * Math.atan(Math.tan((vfovDeg * Math.PI) / 360) * frameAspect) * 180) / Math.PI;
}

export function hfovFromSpec(spec: CameraSpec): number {
  return hfovFromVfov(spec.vfovDeg ?? DEFAULT_VFOV_DEG, spec.frameAspect);
}

/**
 * Fits the true vertical FOV from shots already taken. Called mid-capture with
 * the first ring so the rest of the plan can be sized to the real lens, and
 * again inside the stitch. Returns the prior unchanged when the shots do not
 * give the fit enough to work with (too few, or a textureless wall).
 */
export function fitVfovFromShots(shots: StitchShot[], spec: CameraSpec): number {
  const prior = spec.vfovDeg ?? DEFAULT_VFOV_DEG;
  if (shots.length < 3) return prior;
  const adjusted = toAdjusted(shots, prior, spec.frameAspect);
  const profiles = adjusted.map((s) => buildFrameProfile(s.frame.thumbnail));
  return fitVerticalFov(adjusted, profiles, spec.frameAspect);
}

function toAdjusted(shots: StitchShot[], vfovDeg: number, frameAspect: number): AdjustedShot[] {
  return shots.map((s) => {
    const q = new THREE.Quaternion(s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w);
    return {
      frame: s.frame,
      q,
      ypr: yprFromQuaternion(q),
      gain: new THREE.Vector3(1, 1, 1),
      vfovDeg,
      hfovDeg: hfovFromVfov(vfovDeg, frameAspect),
    };
  });
}

export async function stitchEquirect(
  shots: StitchShot[],
  spec: CameraSpec,
  options: StitchOptions = {},
): Promise<StitchResult> {
  const report = options.onProgress ?? (() => undefined);
  const priorVfov = spec.vfovDeg ?? DEFAULT_VFOV_DEG;

  let adjusted = toAdjusted(shots, priorVfov, spec.frameAspect);

  report(0.05);
  let fittedVfov = priorVfov;
  let loopClosureDeg: AxisTriple = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
  if (options.refine !== false && shots.length >= 3) {
    const profiles = adjusted.map((s) => buildFrameProfile(s.frame.thumbnail));
    fittedVfov = fitVerticalFov(adjusted, profiles, spec.frameAspect);
    for (const s of adjusted) {
      s.vfovDeg = fittedVfov;
      s.hfovDeg = hfovFromVfov(fittedVfov, spec.frameAspect);
    }
    report(0.15);

    const aligned = alignRing(adjusted);
    loopClosureDeg = aligned.residual;
    if (options.align) adjusted = aligned.shots;
    report(0.3);

    // After alignment, so the overlap window the gain is read from is the one
    // the frames actually share rather than the one the gyro assumed.
    adjusted = matchExposure(adjusted, profiles);
  }
  report(0.35);

  const blendMode = options.blendMode ?? 'seam';
  // Routing the cuts needs the frames read back, so it only happens when the
  // cuts are what the result is actually made of.
  const seams =
    blendMode === 'seam' && options.routeSeam !== false ? buildSeamMap(adjusted) : null;
  report(0.45);

  const { outWidth, outHeight } = pickOutputSize(options, spec);
  const { canvas, coverage } = await renderEquirect(
    adjusted, outWidth, outHeight, blendMode,
    options.seamK ?? DEFAULT_SEAM_K, seams,
    (fraction) => report(0.5 + fraction * 0.35),
  );
  report(0.85);

  const composed = fillUncovered(canvas, outWidth, outHeight);
  const imageData = composed.toDataURL('image/jpeg', 0.85);
  report(1);
  return {
    imageData,
    fittedVfovDeg: fittedVfov,
    coverage,
    loopClosureDeg,
    seamSpreadDeg: seams?.spreadDeg ?? 0,
  };
}

interface AdjustedShot {
  frame: CapturedFrame;
  q: THREE.Quaternion;
  ypr: { yawDeg: number; pitchDeg: number; rollDeg: number };
  gain: THREE.Vector3;
  hfovDeg: number;
  vfovDeg: number;
}

/**
 * Preferred equirect width. Rendering in bands (see `tileHeightFor`) is what
 * makes this affordable: the old whole-canvas pass needed a half-float target
 * the size of the output, so 4096 was already 64 MB and 6144 was 144 MB —
 * enough, with the frames, to get an iOS tab terminated mid-stitch.
 */
export const PREFERRED_OUTPUT_WIDTH = 5120;

/** Used when the device refuses to allocate a canvas the preferred size. */
export const FALLBACK_OUTPUT_WIDTH = 4096;

/**
 * GPU budget for one band. Both render targets live at the band's size:
 * 8 bytes/px for the half-float accumulator plus 4 for the byte-sized quality
 * map, so a band holds `width × height × 12` bytes.
 */
export const TILE_MEMORY_BUDGET_MB = 64;
const TILE_BYTES_PER_PIXEL = 12;

/**
 * Height of one band. Fewer, taller bands mean fewer frame decodes (every band
 * decodes every frame it touches), so this takes the tallest band the budget
 * allows rather than a fixed count.
 */
export function tileHeightFor(outWidth: number, outHeight: number): number {
  const maxRows = Math.max(
    1,
    Math.floor((TILE_MEMORY_BUDGET_MB * 1048576) / (TILE_BYTES_PER_PIXEL * outWidth)),
  );
  // Bands are equal-height, so the count has to be chosen such that the ROUNDED
  // UP height still fits — dividing by the budget and rounding the height up
  // afterwards overshoots whenever the division is close to whole.
  let tiles = Math.max(1, Math.ceil(outHeight / maxRows));
  while (Math.ceil(outHeight / tiles) > maxRows) tiles++;
  return Math.ceil(outHeight / tiles);
}

/**
 * A GPU that reports MAX_TEXTURE_SIZE 16384 says nothing about what the 2D
 * canvas backing the result may be: iOS caps total canvas area, and past the
 * cap it hands back a canvas that silently reads as blank. So the size is
 * probed rather than assumed.
 */
let probedWidth: number | null = null;

export function pickOutputSize(
  options: StitchOptions,
  spec: CameraSpec,
): { outWidth: number; outHeight: number } {
  if (options.outWidth && options.outHeight) {
    return { outWidth: options.outWidth, outHeight: options.outHeight };
  }
  void spec;
  if (probedWidth === null) {
    probedWidth = canAllocateCanvas(PREFERRED_OUTPUT_WIDTH, PREFERRED_OUTPUT_WIDTH / 2)
      ? PREFERRED_OUTPUT_WIDTH
      : FALLBACK_OUTPUT_WIDTH;
  }
  return { outWidth: probedWidth, outHeight: probedWidth / 2 };
}

/** Writes a known pixel at the far corner and reads it back. */
function canAllocateCanvas(width: number, height: number): boolean {
  const probe = document.createElement('canvas');
  try {
    probe.width = width;
    probe.height = height;
    if (probe.width !== width || probe.height !== height) return false;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.fillStyle = '#ff8000';
    ctx.fillRect(width - 1, height - 1, 1, 1);
    const [r, g] = ctx.getImageData(width - 1, height - 1, 1, 1).data;
    return r === 255 && g === 128;
  } catch {
    return false;
  } finally {
    probe.width = 0;
    probe.height = 0;
  }
}

/* ------------------------------------------------------------------------- */
/* Frame profiles: sampled once in frame space, resampled per FOV candidate    */
/* ------------------------------------------------------------------------- */

const NDC_SAMPLES = 512;
const PROFILE_STEP_DEG = 0.25;
const MIN_CORRELATION = 0.45;

/**
 * Per-frame exposure correction range. The old ±25% could not undo a phone's
 * automatic metering, which swings 3-4x across a room with a window and a lamp
 * — that residual is what produced the milky veil over the real captures.
 */
const GAIN_MIN = 0.4;
const GAIN_MAX = 2.5;

interface FrameProfile {
  /** Luminance vs normalised x ∈ [-1,1], averaged over the central band. */
  luma: Float32Array;
  /** Per-channel means over the same band — drives white-balance matching. */
  channels: [Float32Array, Float32Array, Float32Array];
}

/**
 * Sampling in frame space (not angle) means the FOV search can resample this
 * cheaply instead of re-rasterising the frame for every candidate.
 */
function buildFrameProfile(frame: HTMLCanvasElement): FrameProfile {
  const w = NDC_SAMPLES;
  const h = Math.max(32, Math.round((w * frame.height) / frame.width));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // Central half of the frame: away from the edges, where lens distortion and
  // vignetting are worst, and common to every candidate FOV.
  const rowStart = Math.round(h * 0.25);
  const rowEnd = Math.round(h * 0.75);

  const luma = new Float32Array(w);
  const channels: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(w), new Float32Array(w), new Float32Array(w),
  ];
  for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let row = rowStart; row < rowEnd; row += 2) {
      const i = (row * w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2];
      n++;
    }
    r /= n; g /= n; b /= n;
    channels[0][x] = r; channels[1][x] = g; channels[2][x] = b;
    luma[x] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { luma, channels };
}

/** Resamples a frame-space profile onto uniform view angles for a given FOV. */
function angularResample(source: Float32Array, hfovDeg: number): Float32Array {
  const tanHalf = Math.tan((hfovDeg * Math.PI) / 360);
  const samples = Math.round(hfovDeg / PROFILE_STEP_DEG);
  const out = new Float32Array(samples);
  for (let s = 0; s < samples; s++) {
    const angle = (-hfovDeg / 2 + s * PROFILE_STEP_DEG) * (Math.PI / 180);
    const ndc = Math.tan(angle) / tanHalf;
    const pos = (ndc * 0.5 + 0.5) * (source.length - 1);
    const i = Math.max(0, Math.min(source.length - 2, Math.floor(pos)));
    const t = pos - i;
    out[s] = source[i] * (1 - t) + source[i + 1] * t;
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* FOV fit: the angle the image reports must agree with the angle the gyro did */
/* ------------------------------------------------------------------------- */

interface RingPair {
  a: number;
  b: number;
  recordedDeg: number;
}

/** Consecutive same-ring neighbours; caps and lone shots contribute nothing. */
function ringPairs(shots: AdjustedShot[]): RingPair[] {
  const byPitch = new Map<number, number[]>();
  shots.forEach((s, i) => {
    if (Math.abs(s.ypr.pitchDeg) >= 70) return; // cap shot
    const key = Math.round(s.ypr.pitchDeg / 10) * 10;
    const list = byPitch.get(key) ?? [];
    list.push(i);
    byPitch.set(key, list);
  });

  const pairs: RingPair[] = [];
  for (const indices of byPitch.values()) {
    if (indices.length < 3) continue;
    const sorted = indices.sort((i, j) => shots[i].ypr.yawDeg - shots[j].ypr.yawDeg);
    for (let k = 0; k < sorted.length; k++) {
      const a = sorted[k];
      const b = sorted[(k + 1) % sorted.length];
      const recorded = Math.abs(wrapDeg180(shots[b].ypr.yawDeg - shots[a].ypr.yawDeg));
      // A ring's wrap-around pair spans the whole remaining arc; skip anything
      // too wide to overlap at any plausible FOV.
      if (recorded > 5 && recorded < MAX_VFOV_DEG) pairs.push({ a, b, recordedDeg: recorded });
    }
  }
  return pairs;
}

/**
 * Scans candidate FOVs and keeps the one where image-measured spacing best
 * matches gyro-recorded spacing, then polishes with the direct ratio solve
 * (assumed × recorded/measured ≈ true).
 */
export function fitVerticalFov(
  shots: AdjustedShot[],
  profiles: FrameProfile[],
  frameAspect: number,
): number {
  const pairs = ringPairs(shots);
  if (pairs.length < 2) return shots[0].vfovDeg;

  const score = (vfov: number): { err: number; n: number } => {
    const hfov = hfovFromVfov(vfov, frameAspect);
    // Search wide enough to still find the peak when the candidate is far off.
    const window = Math.max(8, hfov * 0.25);
    let err = 0;
    let n = 0;
    for (const p of pairs) {
      if (p.recordedDeg >= hfov) continue; // no overlap at this candidate
      const pa = angularResample(profiles[p.a].luma, hfov);
      const pb = angularResample(profiles[p.b].luma, hfov);
      const m = correlatePair(pa, pb, hfov, p.recordedDeg, window);
      if (!m.confident) continue;
      err += Math.abs(m.measuredDeg - p.recordedDeg);
      n++;
    }
    return { err, n };
  };

  let best = { vfov: shots[0].vfovDeg, mean: Infinity };
  for (let vfov = MIN_VFOV_DEG; vfov <= MAX_VFOV_DEG; vfov += 6) {
    const { err, n } = score(vfov);
    // Require most pairs to agree, otherwise a candidate that matched a single
    // lucky pair would win on a tiny error.
    if (n < Math.max(2, pairs.length * 0.4)) continue;
    const mean = err / n;
    if (mean < best.mean) best = { vfov, mean };
  }

  // Ratio polish: the residual bias maps directly onto a FOV scale factor.
  let vfov = best.vfov;
  for (let iter = 0; iter < 3; iter++) {
    const hfov = hfovFromVfov(vfov, frameAspect);
    const window = Math.max(6, hfov * 0.2);
    let sum = 0;
    let n = 0;
    for (const p of pairs) {
      if (p.recordedDeg >= hfov) continue;
      const m = correlatePair(
        angularResample(profiles[p.a].luma, hfov),
        angularResample(profiles[p.b].luma, hfov),
        hfov, p.recordedDeg, window,
      );
      if (!m.confident || m.measuredDeg <= 0.5) continue;
      sum += p.recordedDeg / m.measuredDeg;
      n++;
    }
    if (n < 2) break;
    const ratio = Math.min(1.3, Math.max(0.77, sum / n));
    if (Math.abs(ratio - 1) < 0.005) break;
    vfov = Math.min(MAX_VFOV_DEG, Math.max(MIN_VFOV_DEG, vfov * ratio));
  }
  return vfov;
}

/* ------------------------------------------------------------------------- */
/* Per-frame yaw touch-up and per-channel exposure                            */
/* ------------------------------------------------------------------------- */

interface PairMeasure {
  measuredDeg: number;
  confident: boolean;
  /** Overlap window in frame A / frame B, as profile index ranges. */
  overlapA: [number, number];
  overlapB: [number, number];
}

/**
 * Measures how far the ring is from agreeing with itself, and — only when
 * asked — corrects it.
 *
 * This was built to fix the alignment and it did not, which is worth recording
 * rather than deleting. Correlating overlapping frames finds the shift that
 * best matches them, but under hand-held parallax that shift is NOT a rotation:
 * near and far objects disagree by different amounts, so the "best" rotation
 * satisfies whatever is nearest and throws the rest of the room off.
 *
 * On the simulated room, same capture, same code, only the pivot changed:
 *
 *   tripod (0 cm)      ring failed to close by  0.23°
 *   hand-held (25 cm)  ring failed to close by 14.87°
 *
 * Applying that correction pushed the median displacement from ground truth
 * from 0.35° to 1.76°. Restricting it to pitch and roll — the axes a sideways
 * swing barely touches — made it harmless but not better, including with a
 * simulated sensor error for it to recover.
 *
 * So the gyro keeps the last word, and the previous version's yaw nudging is
 * gone with it: it was doing the same thing, more weakly. What remains is the
 * measurement, reported in the result, because the number tells us on a REAL
 * device how much of this is parallax and how much is drift — which is the
 * evidence needed to revisit this with the frames now being kept.
 */
function alignRing(shots: AdjustedShot[]): { shots: AdjustedShot[]; residual: AxisTriple } {
  // Walk the turn in order. Capture order usually is the turn order, but a
  // retry or a target taken out of sequence would otherwise pair strangers.
  const order = shots
    .map((_, index) => index)
    .sort((a, b) => shots[a].ypr.yawDeg - shots[b].ypr.yawDeg);

  const views: FrameView[] = order.map((index) => ({
    image: shots[index].frame.thumbnail,
    quaternion: shots[index].q,
    hfovDeg: shots[index].hfovDeg,
    vfovDeg: shots[index].vfovDeg,
  }));

  const measurements = views.map((view, k) => measurePair(view, views[(k + 1) % views.length]));
  const residual = loopClosureResidual(measurements);
  const corrections = solveRingCorrections(measurements);

  const corrected = shots.slice();
  order.forEach((shotIndex, k) => {
    const q = applyCorrection(shots[shotIndex].q, corrections[k]);
    corrected[shotIndex] = { ...shots[shotIndex], q, ypr: yprFromQuaternion(q) };
  });
  return { shots: corrected, residual };
}

function matchExposure(shots: AdjustedShot[], profiles: FrameProfile[]): AdjustedShot[] {
  const pairs = ringPairs(shots);
  const gains = shots.map(() => new THREE.Vector3(1, 1, 1));

  const measured = pairs.map((p) => {
    const hfov = shots[p.a].hfovDeg;
    return correlatePair(
      angularResample(profiles[p.a].luma, hfov),
      angularResample(profiles[p.b].luma, hfov),
      hfov, p.recordedDeg, Math.max(6, hfov * 0.15),
    );
  });

  // Exposure and white balance, per channel. With seams instead of averaging,
  // a brightness mismatch stops being a soft haze and becomes a visible step
  // along the cut, so this has to cope with the full swing a phone's automatic
  // metering produces — roughly 3-4x between a lit window and a dark corner.
  pairs.forEach((p, i) => {
    const m = measured[i];
    if (!m.confident) return;
    const hfov = shots[p.a].hfovDeg;
    for (let c = 0; c < 3; c++) {
      const ca = angularResample(profiles[p.a].channels[c], hfov);
      const cb = angularResample(profiles[p.b].channels[c], hfov);
      // Median, not mean: a blown-out window inside the overlap hijacks a mean
      // and would drag the whole frame's gain with it.
      const medA = medianOf(ca, m.overlapA);
      const medB = medianOf(cb, m.overlapB);
      if (medA < 4 || medB < 4) continue;
      const ratio = Math.min(GAIN_MAX, Math.max(GAIN_MIN, medA / medB));
      gains[p.b].setComponent(c, gains[p.b].getComponent(c) * ratio);
    }
  });

  // Normalise so the set keeps its overall exposure instead of drifting.
  const geo = new THREE.Vector3(1, 1, 1);
  for (let c = 0; c < 3; c++) {
    const product = gains.reduce((acc, g) => acc * g.getComponent(c), 1);
    geo.setComponent(c, product ** (1 / gains.length));
  }

  return shots.map((s, i) => {
    const g = gains[i].clone().divide(geo);
    return {
      ...s,
      gain: new THREE.Vector3(
        clamp(g.x, GAIN_MIN, GAIN_MAX),
        clamp(g.y, GAIN_MIN, GAIN_MAX),
        clamp(g.z, GAIN_MIN, GAIN_MAX),
      ),
    };
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Robust centre of an overlap window; blown highlights must not steer it. */
export function medianOf(arr: Float32Array | number[], range: [number, number]): number {
  const lo = Math.max(0, range[0]);
  const hi = Math.min(arr.length, range[1]);
  if (hi - lo <= 0) return 0;
  const slice: number[] = [];
  for (let i = lo; i < hi; i++) slice.push(arr[i]);
  slice.sort((a, b) => a - b);
  const mid = slice.length >> 1;
  return slice.length % 2 ? slice[mid] : (slice[mid - 1] + slice[mid]) / 2;
}

function correlatePair(
  a: Float32Array,
  b: Float32Array,
  hfovDeg: number,
  recordedDeg: number,
  windowDeg: number,
): PairMeasure {
  let best = {
    delta: recordedDeg, score: -Infinity,
    overlapA: [0, 0] as [number, number], overlapB: [0, 0] as [number, number],
  };

  const lo = Math.max(1, recordedDeg - windowDeg);
  const hi = Math.min(hfovDeg - 1, recordedDeg + windowDeg);

  for (let delta = lo; delta <= hi; delta += PROFILE_STEP_DEG) {
    // Frame A angle x maps to frame B angle x − delta; overlap window in A:
    const startDeg = Math.max(-hfovDeg / 2, delta - hfovDeg / 2);
    const s0 = Math.round((startDeg + hfovDeg / 2) / PROFILE_STEP_DEG);
    const s1 = a.length;
    const offsetB = Math.round(-delta / PROFILE_STEP_DEG);
    if (s1 - s0 < 12) continue;

    let sumA = 0, sumB = 0, count = 0;
    for (let s = s0; s < s1; s++) {
      const sb = s + offsetB;
      if (sb < 0 || sb >= b.length) continue;
      sumA += a[s]; sumB += b[sb]; count++;
    }
    if (count < 12) continue;
    const meanA = sumA / count, meanB = sumB / count;

    let num = 0, varA = 0, varB = 0;
    for (let s = s0; s < s1; s++) {
      const sb = s + offsetB;
      if (sb < 0 || sb >= b.length) continue;
      const da = a[s] - meanA, db = b[sb] - meanB;
      num += da * db; varA += da * da; varB += db * db;
    }
    const denom = Math.sqrt(varA * varB);
    const score = denom > 1e-3 ? num / denom : 0;
    if (score > best.score) {
      best = {
        delta, score,
        overlapA: [s0, s1],
        overlapB: [Math.max(0, s0 + offsetB), Math.min(b.length, s1 + offsetB)],
      };
    }
  }

  return {
    measuredDeg: best.delta,
    confident: best.score >= MIN_CORRELATION,
    overlapA: best.overlapA,
    overlapB: best.overlapB,
  };
}

/* ------------------------------------------------------------------------- */
/* Where the cut between two neighbours runs                                  */
/* ------------------------------------------------------------------------- */

/** Latitude resolution of the seam. One bin is ~1.4° of the sphere. */
const SEAM_LAT_BINS = 128;
/** How many yaw positions the path may choose between. */
const SEAM_COLUMNS = 128;
/** Fraction of the available overlap the cut is allowed to wander through. */
const SEAM_SEARCH_FRACTION = 0.6;
/** Cross-fade across the chosen cut. Wide enough to hide it, narrow enough not to ghost. */
export const SEAM_FEATHER_DEG = 1.5;
/**
 * Pull back toward the midpoint, in cost units (which are luminance
 * differences). Without it the path is free to hand one frame most of the
 * sphere, and latitudes where neither frame reaches would have no reason to
 * choose anything at all.
 */
const SEAM_CENTRE_PULL = 12;

/** Samples one shot on an equirectangular grid; NaN where it does not reach. */
function sampleShotGrid(
  shot: AdjustedShot,
  yawFromDeg: number,
  yawToDeg: number,
  columns: number,
  rows: number,
): Float32Array {
  const source = shot.frame.thumbnail;
  const pixels = source
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, source.width, source.height).data;

  const inverse = shot.q.clone().invert();
  const tanHalfH = Math.tan((shot.hfovDeg * Math.PI) / 360);
  const tanHalfV = Math.tan((shot.vfovDeg * Math.PI) / 360);
  const dir = new THREE.Vector3();
  const out = new Float32Array(columns * rows);

  for (let row = 0; row < rows; row++) {
    const theta = ((row + 0.5) / rows) * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let col = 0; col < columns; col++) {
      const yawDeg = yawFromDeg + ((yawToDeg - yawFromDeg) * (col + 0.5)) / columns;
      const phi = (yawDeg * Math.PI) / 180;
      dir.set(Math.cos(phi) * sinTheta, cosTheta, Math.sin(phi) * sinTheta)
        .applyQuaternion(inverse);

      const index = row * columns + col;
      if (dir.z >= -1e-4) { out[index] = NaN; continue; }
      const ndcX = dir.x / -dir.z / tanHalfH;
      const ndcY = dir.y / -dir.z / tanHalfV;
      if (Math.abs(ndcX) >= 1 || Math.abs(ndcY) >= 1) { out[index] = NaN; continue; }

      const px = Math.round((ndcX * 0.5 + 0.5) * (source.width - 1));
      const py = Math.round((0.5 - ndcY * 0.5) * (source.height - 1));
      const s = (py * source.width + px) * 4;
      out[index] = 0.299 * pixels[s] + 0.587 * pixels[s + 1] + 0.114 * pixels[s + 2];
    }
  }
  return out;
}

/**
 * One boundary per neighbouring pair, as a yaw for every latitude, routed
 * through wherever the two photos agree.
 *
 * Row k is the cut between the k-th and (k+1)-th shot around the turn, so a
 * shot owns the arc from the row before it to its own.
 */
interface SeamMap {
  /** SEAM_LAT_BINS × count × 4 (RGBA), red channel holding the yaw. */
  boundaries: Float32Array;
  count: number;
  /** Position of each shot around the turn, by its index in the shots array. */
  positionOf: number[];
  /** Furthest any cut wandered from the midpoint — zero means routing did nothing. */
  spreadDeg: number;
}

/** Routes every cut in the ring; null when there is nothing to route. */
function buildSeamMap(shots: AdjustedShot[]): SeamMap | null {
  if (shots.length < 3) return null;
  const order = shots
    .map((_, index) => index)
    .sort((a, b) => shots[a].ypr.yawDeg - shots[b].ypr.yawDeg);

  const positionOf = new Array<number>(shots.length).fill(0);
  order.forEach((shotIndex, k) => (positionOf[shotIndex] = k));

  const { boundaries, spreadDeg } = buildSeamBoundaries(shots, order);
  return { boundaries, count: order.length, positionOf, spreadDeg };
}

/**
 * Stored as RGBA rather than a single channel: a one-channel float texture is
 * the kind of format a driver may quietly decline, and a silent zero here
 * reads as "no arc belongs to anyone", which looks exactly like the routing
 * having no effect at all.
 */
function buildSeamBoundaries(
  shots: AdjustedShot[],
  order: number[],
): { boundaries: Float32Array; spreadDeg: number } {
  const count = order.length;
  const boundaries = new Float32Array(SEAM_LAT_BINS * count * 4);
  let spreadDeg = 0;

  // Longitudes, not yaws. The equirect's phi and the session's yaw differ by a
  // quarter turn, and the boundary is read back in the shader against phi — so
  // it is taken straight from where each frame points rather than converted.
  const longitudeOf = (shot: AdjustedShot): number => {
    const forward = forwardOf(shot.q);
    return (Math.atan2(forward.z, forward.x) * 180) / Math.PI;
  };

  for (let k = 0; k < count; k++) {
    const a = shots[order[k]];
    const b = shots[order[(k + 1) % count]];
    const phiA = longitudeOf(a);
    const phiB = longitudeOf(b);
    const step = wrapDeg180(phiB - phiA);
    const spacing = Math.abs(step);
    const midYaw = phiA + step / 2;
    const overlap = a.hfovDeg - spacing;

    const write = (bin: number, yawDeg: number) => {
      boundaries[(k * SEAM_LAT_BINS + bin) * 4] = ((yawDeg % 360) + 360) % 360;
    };

    // Too little shared field to choose anything: cut down the middle.
    if (overlap <= 4 || count < 2) {
      for (let bin = 0; bin < SEAM_LAT_BINS; bin++) write(bin, midYaw);
      continue;
    }

    const half = Math.min((overlap / 2) * SEAM_SEARCH_FRACTION, 25);
    const from = midYaw - half;
    const to = midYaw + half;

    const gridA = sampleShotGrid(a, from, to, SEAM_COLUMNS, SEAM_LAT_BINS);
    const gridB = sampleShotGrid(b, from, to, SEAM_COLUMNS, SEAM_LAT_BINS);
    const cost = disagreementCost(gridA, gridB, SEAM_COLUMNS, SEAM_LAT_BINS);

    const centre = (SEAM_COLUMNS - 1) / 2;
    for (let row = 0; row < SEAM_LAT_BINS; row++) {
      for (let col = 0; col < SEAM_COLUMNS; col++) {
        cost[row * SEAM_COLUMNS + col] +=
          (SEAM_CENTRE_PULL * Math.abs(col - centre)) / centre;
      }
    }

    const path = shortestVerticalPath(cost, SEAM_COLUMNS, SEAM_LAT_BINS);
    for (let bin = 0; bin < SEAM_LAT_BINS; bin++) {
      const yawDeg = from + ((to - from) * (path[bin] + 0.5)) / SEAM_COLUMNS;
      write(bin, yawDeg);
      spreadDeg = Math.max(spreadDeg, Math.abs(yawDeg - midYaw));
    }
  }
  return { boundaries, spreadDeg };
}

/* ------------------------------------------------------------------------- */
/* WebGL projection: pick the best frame per pixel, blend only at the seam    */
/* ------------------------------------------------------------------------- */

const PASS_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Shared preamble: output pixel → world direction → this frame's image
 * coordinates, plus the "quality" of the sample, which is how far inside the
 * frame the pixel falls. The frame with the highest quality owns the pixel.
 */
const PROJECT_GLSL = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform mat3 uWorldToCamera;
  uniform vec2 uTanHalfFov; // (tan(hfov/2), tan(vfov/2))
  // (v of this band's bottom edge, band height) in whole-panorama units. The
  // band is a window onto the same sphere, not a panorama of its own.
  uniform vec2 uVRange;

  const float PI = 3.14159265358979;

  bool projectPixel(out vec2 ndc, out float quality) {
    // Inverse of the viewer's sphere mapping.
    float phi = vUv.x * 2.0 * PI;
    float theta = (1.0 - (uVRange.x + vUv.y * uVRange.y)) * PI;
    vec3 dir = vec3(cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));

    vec3 cam = uWorldToCamera * dir;
    if (cam.z > -0.001) { return false; }

    ndc = vec2(cam.x / -cam.z / uTanHalfFov.x, cam.y / -cam.z / uTanHalfFov.y);
    if (abs(ndc.x) >= 1.0 || abs(ndc.y) >= 1.0) { return false; }

    quality = min(1.0 - abs(ndc.x), 1.0 - abs(ndc.y));
    return true;
  }
`;

/** Pass A: MAX-blended, leaves the best available quality in every pixel. */
const QUALITY_FRAGMENT = PROJECT_GLSL + /* glsl */ `
  void main() {
    vec2 ndc; float quality;
    if (!projectPixel(ndc, quality)) { discard; }
    gl_FragColor = vec4(quality, 0.0, 0.0, 1.0);
  }
`;

/**
 * Pass B: each pixel is taken from the frame that owns it, with a narrow
 * cross-fade where two frames are nearly equally good — the seam.
 *
 * Weighting relative to the best quality (rather than an absolute curve) keeps
 * the winner at exactly 1.0, so a lone frame at the edge of coverage is never
 * lost to underflow, and no pixel is ever a wash of many misaligned frames.
 * That averaging is what turned hand-held parallax into triple-exposed
 * furniture; here it can only ever show as a small step along the seam.
 */
const ACCUM_FRAGMENT = PROJECT_GLSL + /* glsl */ `
  uniform sampler2D uFrame;
  uniform sampler2D uBestQuality;
  uniform vec3 uGain;
  uniform float uSeamK;
  uniform float uAverageMode;

  // The two cuts this frame lies between, as rows of the boundary map, and how
  // wide to cross-fade over them. uSeamRows.x < 0 means no routed seam exists
  // and the geometric rule stands.
  uniform sampler2D uSeams;
  uniform vec2 uSeamRows;
  uniform float uFeatherDeg;

  void main() {
    vec2 ndc; float quality;
    if (!projectPixel(ndc, quality)) { discard; }

    float best = texture2D(uBestQuality, vUv).r;
    float seamWeight = exp(-uSeamK * max(best - quality, 0.0));

    if (uSeamRows.x >= 0.0) {
      // Latitude runs 0 at the north pole to 1 at the south, matching how the
      // boundary map was built.
      float lat = 1.0 - (uVRange.x + vUv.y * uVRange.y);
      float loYaw = texture2D(uSeams, vec2(lat, uSeamRows.x)).r;
      float hiYaw = texture2D(uSeams, vec2(lat, uSeamRows.y)).r;

      float phi = vUv.x * 360.0;
      float into = mod(phi - loYaw, 360.0);
      float arc = mod(hiYaw - loYaw, 360.0);
      float owned = smoothstep(0.0, uFeatherDeg, into)
                  * smoothstep(0.0, uFeatherDeg, arc - into);
      // A whisper of the geometric rule underneath, so a pixel no arc happens
      // to claim still gets its best available frame instead of a hole.
      seamWeight = owned + 0.001 * seamWeight;
    }

    // uAverageMode reproduces the old wash for before/after measurements.
    float weight = mix(seamWeight, smoothstep(0.0, 0.35, quality), uAverageMode);

    // v = 0 is the frame's TOP row: an ImageBitmap ignores Texture.flipY, so
    // both decode paths are pinned to the same orientation here instead.
    vec3 color = texture2D(uFrame, vec2(ndc.x, -ndc.y) * 0.5 + 0.5).rgb * uGain;
    gl_FragColor = vec4(color * weight, weight);
  }
`;

const NORMALIZE_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uAccum;

  void main() {
    vec4 acc = texture2D(uAccum, vUv);
    vec3 color = acc.a > 1e-4 ? acc.rgb / acc.a : vec3(0.0);
    // Alpha carries the coverage mask into the 2D pass, which fills only the
    // pixels no shot actually reached.
    gl_FragColor = vec4(color, acc.a > 1e-4 ? 1.0 : 0.0);
  }
`;

async function renderEquirect(
  shots: AdjustedShot[],
  outWidth: number,
  outHeight: number,
  blendMode: BlendMode,
  seamK: number,
  seams: SeamMap | null,
  onProgress: (fraction: number) => void,
): Promise<{ canvas: HTMLCanvasElement; coverage: number }> {
  const tileHeight = tileHeightFor(outWidth, outHeight);

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(outWidth, tileHeight, false);
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);

  const accumTarget = new THREE.WebGLRenderTarget(outWidth, tileHeight, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  accumTarget.texture.minFilter = THREE.NearestFilter;
  accumTarget.texture.magFilter = THREE.NearestFilter;

  // Quality map: which frame owns each pixel. Bytes are ample — this only ever
  // decides a winner, and halving its cost is what buys the taller band.
  const qualityTarget = new THREE.WebGLRenderTarget(outWidth, tileHeight, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  qualityTarget.texture.minFilter = THREE.NearestFilter;
  qualityTarget.texture.magFilter = THREE.NearestFilter;

  const projectionUniforms = () => ({
    uWorldToCamera: { value: new THREE.Matrix3() },
    uTanHalfFov: { value: new THREE.Vector2(1, 1) },
    uVRange: { value: new THREE.Vector2(0, 1) },
  });

  const qualityMaterial = new THREE.ShaderMaterial({
    vertexShader: PASS_VERTEX,
    fragmentShader: QUALITY_FRAGMENT,
    uniforms: projectionUniforms(),
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    // MAX keeps the best quality seen so far without needing a second buffer.
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });

  // The routed cuts, as a yaw per latitude per boundary. Nearest sampling
  // across latitude keeps the path exactly where the search put it; a linear
  // filter between neighbouring bins would round the corners off it.
  let seamTexture: THREE.DataTexture | null = null;
  if (seams) {
    seamTexture = new THREE.DataTexture(
      seams.boundaries, SEAM_LAT_BINS, seams.count, THREE.RGBAFormat, THREE.FloatType,
    );
    seamTexture.minFilter = THREE.NearestFilter;
    seamTexture.magFilter = THREE.NearestFilter;
    seamTexture.wrapS = THREE.ClampToEdgeWrapping;
    seamTexture.wrapT = THREE.ClampToEdgeWrapping;
    seamTexture.needsUpdate = true;
  }

  const accumMaterial = new THREE.ShaderMaterial({
    vertexShader: PASS_VERTEX,
    fragmentShader: ACCUM_FRAGMENT,
    uniforms: {
      ...projectionUniforms(),
      uFrame: { value: null },
      uBestQuality: { value: qualityTarget.texture },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSeamK: { value: seamK },
      uAverageMode: { value: blendMode === 'average' ? 1 : 0 },
      uSeams: { value: seamTexture },
      uSeamRows: { value: new THREE.Vector2(-1, -1) },
      uFeatherDeg: { value: SEAM_FEATHER_DEG },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });

  const normalizeMaterial = new THREE.ShaderMaterial({
    vertexShader: PASS_VERTEX,
    fragmentShader: NORMALIZE_FRAGMENT,
    uniforms: { uAccum: { value: accumTarget.texture } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });

  const mesh = new THREE.Mesh(geometry, accumMaterial);
  scene.add(mesh);

  const rotation = new THREE.Matrix4();
  const aimFor = (shot: AdjustedShot, uniforms: Record<string, { value: unknown }>) => {
    rotation.makeRotationFromQuaternion(shot.q.clone().invert());
    (uniforms['uWorldToCamera'].value as THREE.Matrix3).setFromMatrix4(rotation);
    (uniforms['uTanHalfFov'].value as THREE.Vector2).set(
      Math.tan((shot.hfovDeg * Math.PI) / 360),
      Math.tan((shot.vfovDeg * Math.PI) / 360),
    );
  };

  const out = document.createElement('canvas');
  out.width = outWidth;
  out.height = outHeight;
  const outCtx = out.getContext('2d')!;

  const tileCount = Math.ceil(outHeight / tileHeight);
  let step = 0;
  const totalSteps = tileCount * shots.length;

  for (let tile = 0; tile < tileCount; tile++) {
    const top = tile * tileHeight;
    const rows = Math.min(tileHeight, outHeight - top);
    // GL's v axis runs bottom-up while the output canvas runs top-down, so the
    // band starting at row `top` is the v window ending at 1 − top/outHeight.
    const span = tileHeight / outHeight;
    const vBottom = 1 - (top + tileHeight) / outHeight;
    const setRange = (uniforms: Record<string, { value: unknown }>) =>
      (uniforms['uVRange'].value as THREE.Vector2).set(vBottom, span);

    if (blendMode === 'seam') {
      mesh.material = qualityMaterial;
      renderer.setRenderTarget(qualityTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      setRange(qualityMaterial.uniforms);
      for (const shot of shots) {
        aimFor(shot, qualityMaterial.uniforms);
        renderer.render(scene, camera);
      }
      mesh.material = accumMaterial;
    }

    renderer.setRenderTarget(accumTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    setRange(accumMaterial.uniforms);

    for (const [shotIndex, shot] of shots.entries()) {
      // One frame decoded at a time: the JPEG bytes stay in memory, the pixels
      // exist only between here and the upload a few lines down.
      const decoded = await decodeFrame(shot.frame);
      // Working in stored sRGB end to end: no decode on sample, no encode on
      // write — ShaderMaterial passes values through untouched.
      const texture = new THREE.Texture(decoded as unknown as HTMLImageElement);
      texture.colorSpace = THREE.NoColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.needsUpdate = true;

      aimFor(shot, accumMaterial.uniforms);
      accumMaterial.uniforms['uFrame'].value = texture;
      (accumMaterial.uniforms['uGain'].value as THREE.Vector3).copy(shot.gain);

      // A shot owns the arc from the cut behind it to the cut in front.
      const rows = accumMaterial.uniforms['uSeamRows'].value as THREE.Vector2;
      if (seams) {
        const position = seams.positionOf[shotIndex];
        const before = (position - 1 + seams.count) % seams.count;
        rows.set((before + 0.5) / seams.count, (position + 0.5) / seams.count);
      } else {
        rows.set(-1, -1);
      }
      renderer.render(scene, camera);

      texture.dispose();
      closeDecoded(decoded);
      onProgress(++step / Math.max(1, totalSteps));
    }

    mesh.material = normalizeMaterial;
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(scene, camera);

    // Drawn out in the same task, before the next band clears the buffer. The
    // band's own bottom rows are dropped when the last one overhangs.
    outCtx.drawImage(renderer.domElement, 0, 0, outWidth, rows, 0, top, outWidth, rows);
    mesh.material = accumMaterial;
  }

  geometry.dispose();
  seamTexture?.dispose();
  qualityMaterial.dispose();
  accumMaterial.dispose();
  normalizeMaterial.dispose();
  qualityTarget.dispose();
  accumTarget.dispose();
  renderer.dispose();
  renderer.forceContextLoss();

  return { canvas: out, coverage: measureCoverage(out) };
}

/** Solid-angle weighted, so rows near the poles do not dominate the ratio. */
function measureCoverage(canvas: HTMLCanvasElement): number {
  const w = 256, h = 128;
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  let covered = 0, total = 0;
  for (let y = 0; y < h; y++) {
    const theta = ((y + 0.5) / h) * Math.PI;
    const weight = Math.sin(theta);
    for (let x = 0; x < w; x++) {
      total += weight;
      if (data[(y * w + x) * 4 + 3] > 128) covered += weight;
    }
  }
  return total > 0 ? covered / total : 0;
}

/* ------------------------------------------------------------------------- */
/* Uncovered pixels: filled from the nearest covered row, then blurred        */
/* ------------------------------------------------------------------------- */

/**
 * Reads the coverage mask the normalize pass wrote into alpha and fills only
 * what the shots genuinely missed — no assumption about the lens. With caps
 * captured this usually touches nothing.
 */
function fillUncovered(source: HTMLCanvasElement, outWidth: number, outHeight: number): HTMLCanvasElement {
  const ctx = source.getContext('2d', { willReadFrequently: true })!;

  // Row coverage from a cheap downscale — gaps are whole latitude bands.
  const probeH = 256;
  const probe = document.createElement('canvas');
  probe.width = 8;
  probe.height = probeH;
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(source, 0, 0, 8, probeH);
  const pdata = pctx.getImageData(0, 0, 8, probeH).data;

  const rowCovered: boolean[] = [];
  for (let y = 0; y < probeH; y++) {
    let hits = 0;
    for (let x = 0; x < 8; x++) if (pdata[(y * 8 + x) * 4 + 3] > 128) hits++;
    rowCovered.push(hits >= 4);
  }

  const firstCovered = rowCovered.indexOf(true);
  const lastCovered = rowCovered.lastIndexOf(true);
  if (firstCovered < 0) return source; // nothing to work with

  const topRow = Math.round((firstCovered / probeH) * outHeight);
  const bottomRow = Math.round(((lastCovered + 1) / probeH) * outHeight);
  const band = Math.max(4, Math.round(outHeight * 0.01));

  // Stretch a heavily downscaled strip of the edge row across the gap: a cheap
  // large-radius blur that keeps the ambient colour without inventing detail.
  const strip = (srcY: number): HTMLCanvasElement => {
    const tiny = document.createElement('canvas');
    tiny.width = 64;
    tiny.height = 1;
    tiny.getContext('2d')!.drawImage(source, 0, srcY, outWidth, band, 0, 0, 64, 1);
    return tiny;
  };

  const top = topRow > 0 ? strip(topRow) : null;
  const bottom = bottomRow < outHeight ? strip(Math.max(0, bottomRow - band)) : null;

  // Painting UNDER the existing pixels fills the transparent gaps in place —
  // compositing onto a second full-size canvas would cost another 32 MB.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalCompositeOperation = 'destination-over';
  if (top) ctx.drawImage(top, 0, 0, 64, 1, 0, 0, outWidth, topRow + 2);
  if (bottom) {
    ctx.drawImage(bottom, 0, 0, 64, 1, 0, bottomRow - 2, outWidth, outHeight - bottomRow + 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  return source;
}
