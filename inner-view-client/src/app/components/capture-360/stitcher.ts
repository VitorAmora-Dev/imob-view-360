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
import { directionForYawPitch, wrapDeg180, yprFromQuaternion } from './orientation-math';
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
  /**
   * Match exposure and divide out the lens falloff. On by default; off gives
   * the controlled comparison, since the FOV fit runs before this and so the
   * two runs cover exactly the same band.
   */
  photometry?: boolean;
  /**
   * Let the image-measured field of view override the lens prior. OFF by
   * default — see `fitVerticalFov` for the sweep that put it there. The fit
   * still runs and is still reported; it just no longer decides.
   */
  fitFov?: boolean;
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
  /** Vertical FOV the projection actually used: the lens prior, or the fit if asked. */
  vfovDeg: number;
  /**
   * What the image-based fit measured, whether or not it was applied. Kept
   * apart from `vfovDeg` on purpose: the two disagreeing in the field is the
   * signal that the fit is worth trusting again, or still is not.
   */
  measuredVfovDeg: number;
  /** Fraction of the sphere covered by real pixels, 0..1. */
  coverage: number;
  /**
   * Latitudes between which every column is a photographed pixel. Everything
   * outside was invented by the fill, and the AI step has no other way to tell
   * the difference — the fill is deliberately plausible.
   */
  coveredBand: CoveredBand;
  /**
   * Radial falloff the lens was measured to have, as `a` in `1 + a·r²`. Zero
   * means the overlaps gave no usable reading and nothing was divided out.
   */
  vignetteA: number;
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
  /**
   * The least territory any single photograph was left with, in degrees of
   * longitude. This is the number that says whether an object can be duplicated:
   * below the fade width, some direction is a blend of three frames; at or below
   * zero, two cuts crossed and a frame was squeezed out. Should stay comfortably
   * above `SEAM_MIN_ARC_DEG`.
   */
  narrowestArcDeg: number;
  /**
   * How much of the photographed band is drawn from more than one photograph.
   * See `measureBlendedShare`: `tripleShare` is the one that has to be zero.
   */
  blendedShare: number;
  tripleShare: number;
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
 * a ring, without stitching it. A diagnostic entry point: the stitch does its
 * own fit, and neither applies the answer unless asked to (see
 * `fitVerticalFov`). Returns the prior unchanged when the shots do not give the
 * fit enough to work with — too few, or a textureless wall.
 */
export function fitVfovFromShots(shots: StitchShot[], spec: CameraSpec): number {
  const prior = spec.vfovDeg ?? DEFAULT_VFOV_DEG;
  if (shots.length < 3) return prior;
  const adjusted = toAdjusted(shots, prior, spec.frameAspect);
  const profiles = adjusted.map((s) => buildFrameProfile(s.frame.thumbnail));
  return fitVerticalFov(adjusted, profiles, spec.frameAspect, prior);
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
  let measuredVfov = priorVfov;
  let usedVfov = priorVfov;
  let vignetteA = 0;
  let loopClosureDeg: AxisTriple = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
  if (options.refine !== false && shots.length >= 3) {
    const profiles = adjusted.map((s) => buildFrameProfile(s.frame.thumbnail));
    measuredVfov = fitVerticalFov(adjusted, profiles, spec.frameAspect, priorVfov);
    // Measured either way, applied only on request. Under hand-held parallax the
    // measurement is not trustworthy enough to override a known lens.
    usedVfov = options.fitFov ? measuredVfov : priorVfov;
    for (const s of adjusted) {
      s.vfovDeg = usedVfov;
      s.hfovDeg = hfovFromVfov(usedVfov, spec.frameAspect);
    }
    report(0.15);

    const aligned = alignRing(adjusted);
    loopClosureDeg = aligned.residual;
    if (options.align) adjusted = aligned.shots;
    report(0.3);

    // After alignment, so the overlap window the gain is read from is the one
    // the frames actually share rather than the one the gyro assumed.
    if (options.photometry !== false) {
      const photometry = matchExposure(adjusted, profiles);
      adjusted = photometry.shots;
      vignetteA = photometry.vignetteA;
    }
  }
  report(0.35);

  const blendMode = options.blendMode ?? 'seam';
  // Routing the cuts needs the frames read back, so it only happens when the
  // cuts are what the result is actually made of.
  const seams =
    blendMode === 'seam' && options.routeSeam !== false ? buildSeamMap(adjusted) : null;
  const seamK = options.seamK ?? DEFAULT_SEAM_K;
  const census =
    blendMode === 'seam'
      ? measureBlendedShare(adjusted, seams, seamK)
      : { blendedShare: 1, tripleShare: 1 };
  report(0.45);

  const { outWidth, outHeight } = pickOutputSize(options, spec);
  const { canvas, coverage } = await renderEquirect(
    adjusted, outWidth, outHeight, blendMode,
    seamK, seams, vignetteA,
    (fraction) => report(0.5 + fraction * 0.35),
  );
  report(0.85);

  const coveredBand = fillUncovered(canvas, outWidth, outHeight);
  const imageData = canvas.toDataURL('image/jpeg', 0.85);
  report(1);
  return {
    imageData,
    vfovDeg: usedVfov,
    measuredVfovDeg: measuredVfov,
    coverage,
    coveredBand,
    vignetteA,
    loopClosureDeg,
    seamSpreadDeg: seams?.spreadDeg ?? 0,
    narrowestArcDeg: seams?.narrowestArcDeg ?? 0,
    ...census,
  };
}

export interface AdjustedShot {
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

/**
 * Pitch past which a shot belongs to a cap rather than to the ring.
 *
 * Well below where the cap aims (70°) and well above where the ring can drift
 * (its targets are level, and the session only fires within 5° of them). The
 * old threshold sat exactly on the cap's aim, so a cap shot recorded at 69.8°
 * counted as ring, formed a second cycle of its own, and made the whole
 * exposure solve bail out — every frame back to gain 1.
 */
const CAP_PITCH_THRESHOLD_DEG = 30;

/** Consecutive same-ring neighbours; caps and lone shots contribute nothing. */
function ringPairs(shots: AdjustedShot[]): RingPair[] {
  const byPitch = new Map<number, number[]>();
  shots.forEach((s, i) => {
    if (Math.abs(s.ypr.pitchDeg) >= CAP_PITCH_THRESHOLD_DEG) return; // cap shot
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
 * How far the fit may stray from the lens prior — deliberately lopsided.
 *
 * The priors in capture-sources.ts are physical facts about phone lenses known
 * to roughly a tenth, not guesses, so the fit's job is to refine one, never to
 * halve it. Without a bound the ratio solve could compound its way to any
 * number the correlation asked for, and with hand-held parallax it asked for a
 * much too narrow lens every time.
 *
 * The danger is therefore entirely on the low side, and the room needed is
 * entirely on the high side: the priors are chosen to UNDER-state (95° against
 * an iPhone ultra-wide's true ~108° in portrait), so a symmetric bound would
 * sit almost exactly on the right answer and cap it. Hence 15% down, 25% up.
 */
export const FIT_PRIOR_TOLERANCE_DOWN = 0.15;
export const FIT_PRIOR_TOLERANCE_UP = 0.25;

/** Angular segments the overlap is measured in, and the rank taken across them. */
const FIT_SEGMENTS = 6;
const FIT_FAR_PERCENTILE = 0.25;
/**
 * A segment is a sixth of the overlap, so its correlation peak is far easier to
 * mis-lock than the whole window's — and a segment that locks onto the wrong
 * peak reports a spacing SMALLER than the rotation, which drags the low rank
 * down and inflates the fitted lens. Hence a bar well above `MIN_CORRELATION`,
 * and a minimum number of survivors before a pair is allowed an opinion:
 * blank wall genuinely has nothing to say about the lens.
 */
const SEGMENT_MIN_CORRELATION = 0.7;
const FIT_MIN_SEGMENTS = 3;

/**
 * Spacing between two neighbours, measured independently per angular segment of
 * their overlap.
 *
 * One correlation over the whole overlap returns a single number, and that
 * number is dominated by whatever carries the strongest edges — in a room,
 * usually the nearest object. Near objects are exactly the ones a hand-held
 * turn displaces most: rotating about the body swings the lens on a ~25 cm
 * radius, which at 30° apart moves it 12.9 cm and shifts something at 1 m by a
 * further 7.4° on top of the rotation. That extra always has the same sign, so
 * it is bias and not noise, and a median over pairs cannot remove it.
 *
 * Segments look at different parts of the scene at different distances. The
 * spread between them IS the parallax, and its low end is the content far
 * enough away to be moving by rotation alone — which is the only thing that
 * says anything about the lens.
 *
 * Costs the same as the single correlation it replaces: the same delta scan
 * over the same samples, partitioned rather than pooled.
 */
function correlateSegments(
  a: Float32Array,
  b: Float32Array,
  hfovDeg: number,
  recordedDeg: number,
  windowDeg: number,
  segments: number,
): number[] {
  // Segment bounds are pinned in frame-A coordinates at the nominal overlap, so
  // every candidate delta compares the same piece of scene.
  const nominalStart = Math.max(-hfovDeg / 2, recordedDeg - hfovDeg / 2);
  const s0 = Math.round((nominalStart + hfovDeg / 2) / PROFILE_STEP_DEG);
  const span = a.length - s0;
  if (span < 12 * segments) return [];

  const lo = Math.max(1, recordedDeg - windowDeg);
  const hi = Math.min(hfovDeg - 1, recordedDeg + windowDeg);

  const measured: number[] = [];
  for (let k = 0; k < segments; k++) {
    const from = s0 + Math.floor((k * span) / segments);
    const to = s0 + Math.floor(((k + 1) * span) / segments);
    let bestDelta = 0;
    let bestScore = -Infinity;

    for (let delta = lo; delta <= hi; delta += PROFILE_STEP_DEG) {
      const offsetB = Math.round(-delta / PROFILE_STEP_DEG);
      let sumA = 0, sumB = 0, count = 0;
      for (let s = from; s < to; s++) {
        const sb = s + offsetB;
        if (sb < 0 || sb >= b.length) continue;
        sumA += a[s]; sumB += b[sb]; count++;
      }
      if (count < 12) continue;
      const meanA = sumA / count, meanB = sumB / count;

      let num = 0, varA = 0, varB = 0;
      for (let s = from; s < to; s++) {
        const sb = s + offsetB;
        if (sb < 0 || sb >= b.length) continue;
        const da = a[s] - meanA, db = b[sb] - meanB;
        num += da * db; varA += da * da; varB += db * db;
      }
      const denom = Math.sqrt(varA * varB);
      const score = denom > 1e-3 ? num / denom : 0;
      if (score > bestScore) {
        bestScore = score;
        bestDelta = delta;
      }
    }

    if (bestScore >= SEGMENT_MIN_CORRELATION) measured.push(bestDelta);
  }
  return measured;
}

/** Far-field spacing for a pair: the low rank of its per-segment measurements. */
function farFieldSpacing(
  profiles: FrameProfile[],
  pair: RingPair,
  hfovDeg: number,
  windowDeg: number,
): number | null {
  const measured = correlateSegments(
    angularResample(profiles[pair.a].luma, hfovDeg),
    angularResample(profiles[pair.b].luma, hfovDeg),
    hfovDeg, pair.recordedDeg, windowDeg, FIT_SEGMENTS,
  );
  if (measured.length < FIT_MIN_SEGMENTS) return null;
  return percentileOf(measured, FIT_FAR_PERCENTILE);
}

/**
 * Scans candidate FOVs inside the prior's tolerance and keeps the one whose
 * far-field spacing best matches what the gyro recorded.
 *
 * MEASURES ONLY — `StitchOptions.fitFov` decides whether anything is done with
 * the answer, and it defaults to off. What follows is why.
 *
 * The version this replaced scanned 40°–130° on the raw correlation and then
 * iterated a ratio solve three times with a 0.77 floor. Both halves fed on the
 * parallax bias: measured spacing always came out larger than the gyro's, so
 * the ratio was always below one and pinned to the floor every iteration. 95°
 * of ultra-wide came out of the real captures as ~65°, leaving nearly half the
 * sphere to be invented by the fill.
 *
 * Two things were tried against that. Measuring per angular segment and taking
 * the low rank (`correlateSegments`) does reduce the bias, because the segments
 * looking furthest away move closest to pure rotation. Dropping the ratio solve
 * removes the amplifier. Both helped, and neither was enough: sweeping the
 * prior over the stored cozinha 2 capture, the fitted lens still followed the
 * prior — 80° gave 70°, 95° gave 81°, 110° gave 117°, 125° gave 116°. The low
 * priors sat on their own floor, which is the signature of an objective that
 * still wants to shrink whatever it is given.
 *
 * That is the same finding as the ring alignment in v4, in a different place:
 * with the phone in the hand, correlation measures parallax, and no amount of
 * care turns a translation into a rotation. So the lens prior decides, the fit
 * reports, and the two are compared in the field through the geometry stored
 * with each panorama.
 */
export function fitVerticalFov(
  shots: AdjustedShot[],
  profiles: FrameProfile[],
  frameAspect: number,
  priorVfovDeg: number,
): number {
  const loVfov = Math.max(MIN_VFOV_DEG, priorVfovDeg * (1 - FIT_PRIOR_TOLERANCE_DOWN));
  const hiVfov = Math.min(MAX_VFOV_DEG, priorVfovDeg * (1 + FIT_PRIOR_TOLERANCE_UP));
  const clamp = (v: number) => Math.min(hiVfov, Math.max(loVfov, v));

  const pairs = ringPairs(shots);
  if (pairs.length < 2) return priorVfovDeg;

  const score = (vfov: number): { err: number; n: number } => {
    const hfov = hfovFromVfov(vfov, frameAspect);
    // Search wide enough to still find the peak when the candidate is far off.
    const window = Math.max(8, hfov * 0.25);
    let err = 0;
    let n = 0;
    for (const p of pairs) {
      if (p.recordedDeg >= hfov) continue; // no overlap at this candidate
      const far = farFieldSpacing(profiles, p, hfov, window);
      if (far === null) continue;
      err += Math.abs(far - p.recordedDeg);
      n++;
    }
    return { err, n };
  };

  // A plain scan, and nothing after it. Measured spacing is proportional to the
  // assumed field, so `|measured − recorded|` is a V with one minimum and no way
  // to run away — whereas the ratio solve that used to polish this multiplies,
  // and a multiplier fed by one mis-locked segment moves the answer by tens of
  // degrees. Sweeping the prior over the real captures is what showed it: the
  // fitted lens tracked the prior instead of the photographs, reaching the 130°
  // ceiling from a prior of 110°. The 2° step is already finer than the fit is
  // accurate, so there is nothing left for a polish to add — and every extra
  // candidate is a full pass of correlations over every pair, which is seconds
  // of stitching on a phone.
  let best = { vfov: priorVfovDeg, mean: Infinity };
  for (let vfov = loVfov; vfov <= hiVfov + 1e-6; vfov += 2) {
    const { err, n } = score(vfov);
    // Require most pairs to agree, otherwise a candidate that matched a single
    // lucky pair would win on a tiny error.
    if (n < Math.max(2, pairs.length * 0.4)) continue;
    const mean = err / n;
    if (mean < best.mean) best = { vfov, mean };
  }
  if (!Number.isFinite(best.mean)) return priorVfovDeg;
  return clamp(best.vfov);
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

/**
 * Radial falloff coefficient `a` in `V(r) = 1 + a·r²`, `r` in NDC. Negative
 * darkens the edges, which is the only direction a lens goes.
 */
const VIGNETTE_MIN_A = -0.6;
const VIGNETTE_MAX_A = 0;

/** Normalised x of an angular profile sample — mirrors `angularResample`. */
function ndcOfSample(sample: number, hfovDeg: number): number {
  const angle = (-hfovDeg / 2 + sample * PROFILE_STEP_DEG) * (Math.PI / 180);
  return Math.tan(angle) / Math.tan((hfovDeg * Math.PI) / 360);
}

/**
 * Radial falloff of the lens, measured from the overlaps.
 *
 * The same piece of wall lands near the edge of one frame and closer to the
 * middle of its neighbour. Under `V(r) = 1 + a·r²` the log of their brightness
 * ratio is `a·(rA² − rB²)` plus a constant for the exposure difference between
 * the two frames — so a straight line through those points has the falloff as
 * its slope and the exposure step as its intercept. Fitting per pair keeps the
 * exposure out of the slope; the median across the ring keeps one bad overlap
 * out of the answer.
 *
 * This is the part a single gain per frame cannot do. A frame is darker at its
 * edges than at its centre and the cut runs along the edges, so matching two
 * frames on average still leaves a step exactly where the seam is.
 */
export function fitVignette(
  profiles: FrameProfile[],
  pairs: RingPair[],
  measured: PairMeasure[],
  hfovDeg: number,
): number {
  const slopes: number[] = [];

  pairs.forEach((p, i) => {
    const m = measured[i];
    if (!m.confident) return;
    const a = angularResample(profiles[p.a].luma, hfovDeg);
    const b = angularResample(profiles[p.b].luma, hfovDeg);
    const offsetB = Math.round(-m.measuredDeg / PROFILE_STEP_DEG);

    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let s = m.overlapA[0]; s < m.overlapA[1]; s++) {
      const sb = s + offsetB;
      if (sb < 0 || sb >= b.length) continue;
      // Mid-tones only: a blown window carries no ratio and near-black is noise.
      if (a[s] < 12 || b[sb] < 12 || a[s] > 240 || b[sb] > 240) continue;
      const ra = ndcOfSample(s, hfovDeg);
      const rb = ndcOfSample(sb, hfovDeg);
      const x = ra * ra - rb * rb;
      const y = Math.log(a[s] / b[sb]);
      sx += x; sy += y; sxx += x * x; sxy += x * y;
      n++;
    }
    if (n < 24) return;
    const denom = n * sxx - sx * sx;
    // Degenerate when both frames happen to sample the same radii.
    if (Math.abs(denom) < 1e-9) return;
    slopes.push((n * sxy - sx * sy) / denom);
  });

  if (slopes.length < 2) return 0;
  return clamp(medianOf(slopes, [0, slopes.length]), VIGNETTE_MIN_A, VIGNETTE_MAX_A);
}

/**
 * Per-node levels from per-edge differences around a closed ring.
 *
 * `deltas[k]` is `level[k] − level[k+1]` for the edge leaving node k, the last
 * one closing back onto node 0. Walking the ring accumulates whatever the
 * measurements disagree about into a single closure error at the join; spread
 * evenly instead, so no one seam inherits the whole discrepancy. Same shape as
 * `solveRingCorrections` in frame-align.ts, for a scalar instead of an axis
 * triple, and the reason for it is the same: a ring has one more measurement
 * than it has degrees of freedom, and that extra one is information.
 */
export function solveRingLevels(deltas: number[]): number[] {
  const n = deltas.length;
  if (!n) return [];

  const level = [0];
  for (let k = 0; k < n - 1; k++) level.push(level[k] - deltas[k]);
  // Where the walk lands after the closing edge; it should have landed on 0.
  const closure = level[n - 1] - deltas[n - 1];

  const spread = level.map((value, k) => value - (closure * k) / n);
  const mean = spread.reduce((acc, v) => acc + v, 0) / n;
  return spread.map((v) => v - mean);
}

/**
 * Exposure and white balance across the ring, plus the lens falloff underneath.
 *
 * The previous version did `gains[b] *= medA / medB` and never read `gains[a]`,
 * so every frame was matched against its neighbour's UNCORRECTED brightness.
 * Nothing propagated: correcting frame 4 moved it away from the value frame 5
 * had just been fitted to. Around a twelve-shot ring that leaves a step at
 * every join, which is the hard-edged patchwork visible across the white
 * ceilings and plain corridors of the real captures. Solving the ring as a loop
 * is what makes the corrections mutually consistent.
 */
function matchExposure(
  shots: AdjustedShot[],
  profiles: FrameProfile[],
): { shots: AdjustedShot[]; vignetteA: number } {
  const pairs = ringPairs(shots);
  if (pairs.length < 3) return { shots, vignetteA: 0 };

  // `solveRingLevels` assumes one closed walk. A single eye-level ring is the
  // only pattern that exists today; if that stops being true this bows out
  // rather than solving a concatenation of two cycles as though it were one.
  if (new Set(pairs.map((p) => p.a)).size !== pairs.length) {
    return { shots, vignetteA: 0 };
  }

  const hfov = shots[pairs[0].a].hfovDeg;
  const measured = pairs.map((p) =>
    correlatePair(
      angularResample(profiles[p.a].luma, hfov),
      angularResample(profiles[p.b].luma, hfov),
      hfov, p.recordedDeg, Math.max(6, hfov * 0.15),
    ),
  );

  const vignetteA = fitVignette(profiles, pairs, measured, hfov);

  /** A channel profile with the lens falloff already divided out. */
  const flattened = (shot: number, channel: number): Float32Array => {
    const raw = angularResample(profiles[shot].channels[channel], hfov);
    if (vignetteA === 0) return raw;
    const out = new Float32Array(raw.length);
    for (let s = 0; s < raw.length; s++) {
      const r = ndcOfSample(s, hfov);
      out[s] = raw[s] / Math.max(0.35, 1 + vignetteA * r * r);
    }
    return out;
  };

  // One log-difference per edge per channel; unmeasurable edges say nothing,
  // which for a level walk means "carry on unchanged".
  const levels: number[][] = [];
  for (let c = 0; c < 3; c++) {
    const deltas = pairs.map((p, i) => {
      const m = measured[i];
      if (!m.confident) return 0;
      // Median, not mean: a blown-out window inside the overlap hijacks a mean
      // and would drag the whole frame's gain with it.
      const medA = medianOf(flattened(p.a, c), m.overlapA);
      const medB = medianOf(flattened(p.b, c), m.overlapB);
      if (medA < 4 || medB < 4) return 0;
      return Math.log(medB) - Math.log(medA);
    });
    levels.push(solveRingLevels(deltas));
  }

  // The ring order `ringPairs` walked: edge k leaves the node it starts from.
  const gainOf = new Map<number, THREE.Vector3>();
  pairs.forEach((p, k) => {
    gainOf.set(
      p.a,
      new THREE.Vector3(
        clamp(Math.exp(levels[0][k]), GAIN_MIN, GAIN_MAX),
        clamp(Math.exp(levels[1][k]), GAIN_MIN, GAIN_MAX),
        clamp(Math.exp(levels[2][k]), GAIN_MIN, GAIN_MAX),
      ),
    );
  });

  matchCapGains(shots, gainOf, vignetteA);

  return {
    shots: shots.map((s, i) => ({ ...s, gain: gainOf.get(i) ?? s.gain })),
    vignetteA,
  };
}

/* ------------------------------------------------------------------------- */
/* Shots the ring solve cannot reach: the upward cap                          */
/* ------------------------------------------------------------------------- */

/** Where the cap and the ring look at the same thing: just inside the ring's top. */
const CAP_MATCH_BAND_DEG = 10;
const CAP_MATCH_LATITUDE_STEPS = 20;
const CAP_MATCH_LONGITUDE_STEPS = 72;

/** Per-channel samples of one shot at given world directions; NaN where it misses. */
function sampleShotChannels(
  shot: AdjustedShot,
  directions: THREE.Vector3[],
  vignetteA: number,
): [Float32Array, Float32Array, Float32Array] {
  const source = shot.frame.thumbnail;
  const pixels = source
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, source.width, source.height).data;

  const inverse = shot.q.clone().invert();
  const tanHalfH = Math.tan((shot.hfovDeg * Math.PI) / 360);
  const tanHalfV = Math.tan((shot.vfovDeg * Math.PI) / 360);
  const cam = new THREE.Vector3();
  const out: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(directions.length),
    new Float32Array(directions.length),
    new Float32Array(directions.length),
  ];

  directions.forEach((dir, i) => {
    const miss = () => {
      out[0][i] = NaN;
      out[1][i] = NaN;
      out[2][i] = NaN;
    };
    cam.copy(dir).applyQuaternion(inverse);
    if (cam.z >= -1e-4) return miss();
    const ndcX = cam.x / -cam.z / tanHalfH;
    const ndcY = cam.y / -cam.z / tanHalfV;
    if (Math.abs(ndcX) >= 1 || Math.abs(ndcY) >= 1) return miss();

    const px = Math.round((ndcX * 0.5 + 0.5) * (source.width - 1));
    const py = Math.round((0.5 - ndcY * 0.5) * (source.height - 1));
    const s = (py * source.width + px) * 4;
    // Same falloff the shader divides out, so the comparison is between two
    // frames rather than between two positions within a frame.
    const fall = Math.max(0.35, 1 + vignetteA * (ndcX * ndcX + ndcY * ndcY));
    out[0][i] = pixels[s] / fall;
    out[1][i] = pixels[s + 1] / fall;
    out[2][i] = pixels[s + 2] / fall;
  });
  return out;
}

/**
 * Brings the upward cap onto the ring's exposure scale.
 *
 * The ring is solved as a closed loop, which a cap shot can never join — it has
 * two or three neighbours below it and no cycle of its own. So it is hung off
 * the ring instead: sample both on the same world directions inside the band
 * where they overlap, and take the median of the ratio.
 *
 * Without this a cap shot keeps whatever the phone metered while pointed at a
 * lit ceiling, which is a different exposure from anything on the ring — and
 * the result would be a bright disc overhead. Trading the software cone for a
 * software-coloured ceiling would not be progress.
 *
 * Mutates `gainOf`, which already carries the ring's solved gains.
 */
export function matchCapGains(
  shots: AdjustedShot[],
  gainOf: Map<number, THREE.Vector3>,
  vignetteA: number,
): void {
  const orphans = shots
    .map((_, i) => i)
    .filter((i) => !gainOf.has(i) && Math.abs(shots[i].ypr.pitchDeg) >= CAP_PITCH_THRESHOLD_DEG);
  if (!orphans.length) return;

  const ring = [...gainOf.keys()];
  if (!ring.length) return;

  // A band just inside the ring's upper edge: high enough for a cap shot to
  // reach, low enough that the ring still has real pixels there.
  const top = shots[ring[0]].vfovDeg / 2;
  const directions: THREE.Vector3[] = [];
  for (let i = 0; i < CAP_MATCH_LATITUDE_STEPS; i++) {
    const lat = top - 2 - (CAP_MATCH_BAND_DEG * i) / CAP_MATCH_LATITUDE_STEPS;
    for (let j = 0; j < CAP_MATCH_LONGITUDE_STEPS; j++) {
      directions.push(directionForYawPitch((j * 360) / CAP_MATCH_LONGITUDE_STEPS, lat));
    }
  }

  const ringSamples = ring.map((i) => ({
    gain: gainOf.get(i)!,
    channels: sampleShotChannels(shots[i], directions, vignetteA),
  }));

  for (const index of orphans) {
    const cap = sampleShotChannels(shots[index], directions, vignetteA);
    const gain = new THREE.Vector3(1, 1, 1);

    for (let c = 0; c < 3; c++) {
      const ratios: number[] = [];
      for (let i = 0; i < directions.length; i++) {
        const mine = cap[c][i];
        if (!(mine > 4)) continue;
        for (const sample of ringSamples) {
          const theirs = sample.channels[c][i];
          if (!(theirs > 4)) continue;
          // Against the ring's CORRECTED brightness — the scale everything
          // else on the sphere has already been put on.
          ratios.push(Math.log((theirs * sample.gain.getComponent(c)) / mine));
        }
      }
      if (ratios.length < 24) continue;
      gain.setComponent(c, clamp(Math.exp(medianOf(ratios, [0, ratios.length])), GAIN_MIN, GAIN_MAX));
    }
    gainOf.set(index, gain);
  }
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

/**
 * Value at a fractional rank of a small sample.
 *
 * Used where the low end of a spread is the signal rather than its middle —
 * see `correlateSegments`, where the smallest measurements are the ones least
 * contaminated by parallax.
 */
export function percentileOf(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const rank = Math.round(fraction * (sorted.length - 1));
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
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

/**
 * Cross-fade across the chosen cut — a range, not a number.
 *
 * A join has two failure modes that pull in opposite directions. Too narrow and
 * whatever exposure difference the gain solve could not remove arrives in a
 * single column, which the eye reads as a line someone drew: that is what a
 * plain wall showed at every seam of the real captures. Too wide and parallax
 * doubles the content inside the fade — a hand-held turn swings the lens on a
 * ~25 cm radius, so at 30° apart something 1.5 m away is displaced by about 5°,
 * and blending across that draws it twice.
 *
 * Which failure is in play is not a property of the capture but of the place on
 * the cut, and the router has already measured it. The path was chosen to run
 * where the two photos agree, and where they agree there is nothing to double.
 * So the fade opens up along the quiet stretches — blank wall, ceiling, the
 * places an exposure step shows most — and closes wherever the path had to
 * cross something real.
 */
export const SEAM_FEATHER_DEG = 1.5;
export const SEAM_FEATHER_MAX_DEG = 6;

/**
 * Narrowest arc a frame may be left with, after both of its cuts have wandered
 * as far towards each other as they are allowed.
 *
 * Twice the widest fade: half a fade is spent on each side of a cut, so an arc
 * of exactly this width still has half of itself at full weight, owned by one
 * photograph alone. Anything less and the two fades meet in the middle and the
 * frame is never the only contributor anywhere — which is the same as not
 * having been photographed, except that its neighbours are now blended over the
 * top of each other.
 */
export const SEAM_MIN_ARC_DEG = 2 * SEAM_FEATHER_MAX_DEG;
/**
 * Doubled-edge cost, in luma levels per sample, at which the fade is back to its
 * narrow width. A step of a dozen levels across one sample of the seam grid is
 * an edge, not noise.
 */
const SEAM_GHOST_FULL = 12;
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
  /** Least territory any frame kept; see `narrowestArc`. */
  narrowestArcDeg: number;
}

/** Routes every cut in the ring; null when there is nothing to route. */
function buildSeamMap(shots: AdjustedShot[]): SeamMap | null {
  if (shots.length < 3) return null;
  const order = shots
    .map((_, index) => index)
    .sort((a, b) => shots[a].ypr.yawDeg - shots[b].ypr.yawDeg);

  const positionOf = new Array<number>(shots.length).fill(0);
  order.forEach((shotIndex, k) => (positionOf[shotIndex] = k));

  const { boundaries, spreadDeg, narrowestArcDeg } = buildSeamBoundaries(shots, order);
  return { boundaries, count: order.length, positionOf, spreadDeg, narrowestArcDeg };
}

/**
 * Where each cut is allowed to run, decided for the whole ring at once.
 *
 * One entry per neighbouring pair: `midYaw` is the geometric midpoint between
 * the two frames, `halfDeg` how far the routed cut may wander either side of
 * it, and `maxFeatherDeg` the widest fade that cut may ask for.
 *
 * This exists as its own function because deciding each cut in isolation — from
 * the spacing of its own pair alone, never looking at its neighbour — is what
 * let two cuts close in on each other until the frame between them had no
 * territory left. See `planSeamWindows`.
 */
export interface SeamWindow {
  midYaw: number;
  halfDeg: number;
  maxFeatherDeg: number;
}

/**
 * Fade width for each latitude of a chosen path, from how much the two photos
 * disagree there.
 *
 * Read over a window rather than at the path's own column, because the fade
 * spans that window: an edge half a fade away is still inside it and would still
 * be doubled. Then smoothed across latitude, since a width that changed sharply
 * from one bin to the next would draw a boundary of its own.
 */
export function featherAlongPath(
  ghost: Float32Array,
  path: Int32Array,
  columns: number,
  rows: number,
  degreesPerColumn: number,
  maxFeatherDeg: number,
): Float32Array {
  const reach = Math.max(1, Math.round(maxFeatherDeg / 2 / Math.max(1e-6, degreesPerColumn)));
  const raw = new Float32Array(rows);
  for (let row = 0; row < rows; row++) {
    const centre = path[row];
    let worst = 0;
    for (let col = Math.max(0, centre - reach); col <= Math.min(columns - 1, centre + reach); col++) {
      worst = Math.max(worst, ghost[row * columns + col]);
    }
    raw[row] = worst;
  }

  const SMOOTH = 3;
  const out = new Float32Array(rows);
  for (let row = 0; row < rows; row++) {
    let sum = 0;
    let n = 0;
    for (let k = row - SMOOTH; k <= row + SMOOTH; k++) {
      if (k < 0 || k >= rows) continue;
      sum += raw[k];
      n++;
    }
    const share = Math.min(1, sum / n / SEAM_GHOST_FULL);
    out[row] = maxFeatherDeg + (SEAM_FEATHER_DEG - maxFeatherDeg) * share;
  }
  return out;
}

/**
 * Plans every cut of the ring together, so no frame can be squeezed out.
 *
 * A frame owns the arc between the cut behind it and the cut in front, and each
 * cut is allowed to wander so it can dodge an object. Deciding how far it may
 * wander from the spacing of its own pair alone — which is what this code used
 * to do — takes no account of the cut on the other side of the frame doing the
 * same thing towards it. On the ultra-wide at twelve shots the two allowances
 * came to 14.6° each against a 30° spacing, leaving the frame between them as
 * little as 0.84°; at fourteen shots, or at twelve when the aim tolerance put a
 * pair 20° apart, the allowances overlapped and **the cuts crossed**.
 *
 * A frame with no arc left is not merely absent. Its neighbours' arcs then meet
 * or overlap, both claiming the same directions at full weight, each placing a
 * near object where its own viewpoint saw it — which is how a room with two
 * sofas came back with three. Even short of crossing, an arc narrower than the
 * fade means the frame never reaches full weight and both neighbours bleed
 * across the whole of it: three photographs summed into one pixel.
 *
 * So the allowance of every cut is capped by the arcs it borders:
 *
 *   halfDeg[k] ≤ (arc − SEAM_MIN_ARC_DEG) / 2   for both adjacent arcs
 *
 * Applied to both cuts of an arc, that guarantees `half + half ≤ arc − minimum`
 * in one pass, with no iteration and no ordering to get wrong. At twelve shots
 * it leaves ±9° of routing freedom instead of ±14.6° — still far more than the
 * few degrees a cut needs to step around a piece of furniture.
 */
export function planSeamWindows(longitudesDeg: number[], hfovDeg: number): SeamWindow[] {
  const count = longitudesDeg.length;
  if (count < 2) return [];

  // Signed, so the midpoint lands between the pair whichever way the ring was
  // walked; the spacing itself is the distance and has no direction.
  const step = longitudesDeg.map((lon, k) =>
    wrapDeg180(longitudesDeg[(k + 1) % count] - lon),
  );
  const spacing = step.map(Math.abs);
  const midYaw = longitudesDeg.map((lon, k) => lon + step[k] / 2);

  /** Width frame `i` would own if both its cuts stayed on their midpoints. */
  const nominalArc = (i: number) => (spacing[(i - 1 + count) % count] + spacing[i % count]) / 2;

  return longitudesDeg.map((_, k) => {
    const overlap = hfovDeg - spacing[k];
    if (overlap <= 4) {
      // Barely a shared field: cut down the middle and fade over what little of
      // it there is, rather than over a width the frames do not have.
      return {
        midYaw: midYaw[k],
        halfDeg: 0,
        maxFeatherDeg: Math.max(0.2, Math.min(SEAM_FEATHER_DEG, overlap * 0.5)),
      };
    }

    // What the overlap alone would allow, and what the two neighbouring arcs
    // can actually spare. The tighter of the two wins.
    const fromOverlap = Math.min((overlap / 2) * SEAM_SEARCH_FRACTION, 25);
    const fromArcs = Math.min(
      (nominalArc(k) - SEAM_MIN_ARC_DEG) / 2,
      (nominalArc(k + 1) - SEAM_MIN_ARC_DEG) / 2,
    );
    const halfDeg = Math.max(0, Math.min(fromOverlap, fromArcs));

    // Half a fade has to fit between the furthest the cut may wander and the
    // edge of the shared field, or the fade would run off the end of a frame
    // and leave the very step it was there to hide. And it can never be wider
    // than the narrowest arc it borders, which only bites on a ring so uneven
    // that the arcs could not reach the minimum in the first place.
    const realizedArc = Math.min(nominalArc(k), nominalArc(k + 1)) - 2 * halfDeg;
    return {
      midYaw: midYaw[k],
      halfDeg,
      maxFeatherDeg: Math.max(
        SEAM_FEATHER_DEG,
        Math.min(SEAM_FEATHER_MAX_DEG, 2 * (overlap / 2 - halfDeg), Math.max(0.2, realizedArc)),
      ),
    };
  });
}

/**
 * Stored as RGBA rather than a single channel: a one-channel float texture is
 * the kind of format a driver may quietly decline, and a silent zero here
 * reads as "no arc belongs to anyone", which looks exactly like the routing
 * having no effect at all. Red carries the yaw of the cut, green the width to
 * fade over it.
 */
function buildSeamBoundaries(
  shots: AdjustedShot[],
  order: number[],
): { boundaries: Float32Array; spreadDeg: number; narrowestArcDeg: number } {
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

  // Every cut planned against every other, before any of them is routed.
  const windows = planSeamWindows(order.map((index) => longitudeOf(shots[index])), shots[order[0]].hfovDeg);

  for (let k = 0; k < count; k++) {
    const a = shots[order[k]];
    const b = shots[order[(k + 1) % count]];
    const { midYaw, halfDeg: half, maxFeatherDeg } = windows[k];

    const write = (bin: number, yawDeg: number, featherDeg: number) => {
      const at = (k * SEAM_LAT_BINS + bin) * 4;
      boundaries[at] = ((yawDeg % 360) + 360) % 360;
      boundaries[at + 1] = featherDeg;
    };

    // No room to choose anything: cut down the middle and fade over what the
    // planner said this cut can afford.
    if (half <= 0) {
      for (let bin = 0; bin < SEAM_LAT_BINS; bin++) write(bin, midYaw, maxFeatherDeg);
      continue;
    }

    const from = midYaw - half;
    const to = midYaw + half;

    const gridA = sampleShotGrid(a, from, to, SEAM_COLUMNS, SEAM_LAT_BINS);
    const gridB = sampleShotGrid(b, from, to, SEAM_COLUMNS, SEAM_LAT_BINS);
    const { cost, ghost } = disagreementCost(gridA, gridB, SEAM_COLUMNS, SEAM_LAT_BINS);

    const centre = (SEAM_COLUMNS - 1) / 2;
    for (let row = 0; row < SEAM_LAT_BINS; row++) {
      for (let col = 0; col < SEAM_COLUMNS; col++) {
        cost[row * SEAM_COLUMNS + col] +=
          (SEAM_CENTRE_PULL * Math.abs(col - centre)) / centre;
      }
    }

    const path = shortestVerticalPath(cost, SEAM_COLUMNS, SEAM_LAT_BINS);
    const feather = featherAlongPath(
      ghost, path, SEAM_COLUMNS, SEAM_LAT_BINS,
      (to - from) / SEAM_COLUMNS, maxFeatherDeg,
    );
    for (let bin = 0; bin < SEAM_LAT_BINS; bin++) {
      const yawDeg = from + ((to - from) * (path[bin] + 0.5)) / SEAM_COLUMNS;
      write(bin, yawDeg, feather[bin]);
      spreadDeg = Math.max(spreadDeg, Math.abs(yawDeg - midYaw));
    }
  }
  return { boundaries, spreadDeg, narrowestArcDeg: narrowestArc(boundaries, count) };
}

/**
 * The least territory any frame was actually left with, at any latitude.
 *
 * Measured on the routed cuts rather than on the plan, because the plan only
 * bounds where they may go. Below the fade width in use it means two fades met
 * and some direction is a blend of three photographs; at or below zero it means
 * two cuts crossed and a frame was squeezed out entirely.
 */
function narrowestArc(boundaries: Float32Array, count: number): number {
  let narrowest = Infinity;
  for (let bin = 0; bin < SEAM_LAT_BINS; bin++) {
    for (let k = 0; k < count; k++) {
      const before = boundaries[(((k - 1 + count) % count) * SEAM_LAT_BINS + bin) * 4];
      const here = boundaries[(k * SEAM_LAT_BINS + bin) * 4];
      // Signed: a crossing shows as a negative arc rather than wrapping round
      // to a nearly-full turn, which is what makes it visible in the number.
      narrowest = Math.min(narrowest, wrapDeg180(here - before));
    }
  }
  return Number.isFinite(narrowest) ? narrowest : 0;
}

/* ------------------------------------------------------------------------- */
/* How much of the sphere is a blend, and of how many photographs             */
/* ------------------------------------------------------------------------- */

/** Weight at which a second photograph is contributing enough to be seen. */
const BLEND_SIGNIFICANT = 0.25;
const BLEND_LATITUDE_STEPS = 61;
const BLEND_LONGITUDE_STEPS = 181;

/**
 * Share of the photographed band where more than one frame contributes enough
 * to be visible — the duplication, measured.
 *
 * Blending two photographs of the same thing is only harmless when they agree,
 * and under parallax they do not: each places a near object where its own
 * viewpoint saw it, so wherever two frames are mixed the object is drawn twice.
 * A narrow fade along the cut is the price of hiding the exposure step and is
 * expected here; anything much beyond that means frames are overlapping where
 * they should not.
 *
 * Computed on the CPU by re-evaluating the same ownership rule the shader uses,
 * the same way `coversDirection` in capture-pattern.ts mirrors `projectPixel` —
 * planning, rendering and measurement have to agree on what a frame owns or the
 * number means nothing.
 */
export interface BlendCensus {
  /** Share where a second photograph contributes enough to be seen. */
  blendedShare: number;
  /**
   * Share where a THIRD one does. This is the one that has to be zero: a fade
   * between two neighbours is the deliberate cost of hiding the exposure step,
   * but three photographs summed into a pixel is a frame that lost its
   * territory, and a near object drawn three times.
   */
  tripleShare: number;
}

export function measureBlendedShare(
  shots: AdjustedShot[],
  seams: SeamMap | null,
  seamK: number,
): BlendCensus {
  if (!shots.length) return { blendedShare: 0, tripleShare: 0 };
  const reachDeg = Math.min(89, shots[0].vfovDeg / 2);
  const inverses = shots.map((s) => s.q.clone().invert());
  const tan = shots.map((s) => ({
    h: Math.tan((s.hfovDeg * Math.PI) / 360),
    v: Math.tan((s.vfovDeg * Math.PI) / 360),
  }));
  const cam = new THREE.Vector3();
  const weights = new Float64Array(shots.length);
  const qualities = new Float64Array(shots.length);

  /** Cut yaw and fade width for one boundary row, at a latitude 0..1 from the pole. */
  const seamAt = (row: number, lat: number): { yaw: number; feather: number } => {
    const bin = Math.min(SEAM_LAT_BINS - 1, Math.max(0, Math.floor(lat * SEAM_LAT_BINS)));
    const at = (row * SEAM_LAT_BINS + bin) * 4;
    return { yaw: seams!.boundaries[at], feather: seams!.boundaries[at + 1] };
  };
  const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  let blended = 0;
  let tripled = 0;
  let total = 0;
  for (let i = 0; i < BLEND_LATITUDE_STEPS; i++) {
    const latDeg = -reachDeg + (2 * reachDeg * i) / (BLEND_LATITUDE_STEPS - 1);
    // Equal-area weighting so the band's middle is not under-counted.
    const areaWeight = Math.cos((latDeg * Math.PI) / 180);
    const lat = (90 - latDeg) / 180;

    for (let j = 0; j < BLEND_LONGITUDE_STEPS; j++) {
      const lonDeg = (j * 360) / BLEND_LONGITUDE_STEPS;
      const phi = (lonDeg * Math.PI) / 180;
      const theta = ((90 - latDeg) * Math.PI) / 180;
      const dir = new THREE.Vector3(
        Math.cos(phi) * Math.sin(theta),
        Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
      );

      let best = 0;
      let seen = 0;
      for (let s = 0; s < shots.length; s++) {
        qualities[s] = -1;
        cam.copy(dir).applyQuaternion(inverses[s]);
        if (cam.z > -0.001) continue;
        const ndcX = cam.x / -cam.z / tan[s].h;
        const ndcY = cam.y / -cam.z / tan[s].v;
        if (Math.abs(ndcX) >= 1 || Math.abs(ndcY) >= 1) continue;
        qualities[s] = Math.min(1 - Math.abs(ndcX), 1 - Math.abs(ndcY));
        best = Math.max(best, qualities[s]);
        seen++;
      }
      if (!seen) continue;

      let sum = 0;
      for (let s = 0; s < shots.length; s++) {
        if (qualities[s] < 0) {
          weights[s] = 0;
          continue;
        }
        let weight = Math.exp(-seamK * Math.max(0, best - qualities[s]));
        if (seams) {
          const position = seams.positionOf[s];
          const before = (position - 1 + seams.count) % seams.count;
          const lo = seamAt(before, lat);
          const hi = seamAt(position, lat);
          // The same floor the shader puts under a zero-width fade.
          const halfLo = Math.max(0.05, lo.feather / 2);
          const halfHi = Math.max(0.05, hi.feather / 2);
          const owned =
            smoothstep(-halfLo, halfLo, wrapDeg180(lonDeg - lo.yaw)) *
            smoothstep(-halfHi, halfHi, wrapDeg180(hi.yaw - lonDeg));
          weight = owned + 0.001 * weight;
        }
        weights[s] = weight;
        sum += weight;
      }
      if (sum <= 0) continue;

      // The runners-up are what matter: a lone frame at weight 1 draws the room
      // once, two frames at half draw it twice, three draw it three times.
      let significant = 0;
      for (let s = 0; s < shots.length; s++) {
        if (weights[s] / sum >= BLEND_SIGNIFICANT) significant++;
      }
      total += areaWeight;
      if (significant >= 2) blended += areaWeight;
      if (significant >= 3) tripled += areaWeight;
    }
  }
  return total > 0
    ? { blendedShare: blended / total, tripleShare: tripled / total }
    : { blendedShare: 0, tripleShare: 0 };
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

  /** Shortest signed angle from b to a, in degrees. */
  float wrap180(float deg) {
    return mod(deg + 180.0, 360.0) - 180.0;
  }

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
  // Radial falloff of the lens, fitted from the overlaps. Divided out per pixel
  // because it varies across the frame and the cut runs along the edges, where
  // it is strongest — a single gain per frame cannot reach it.
  uniform float uVignetteA;

  // The two cuts this frame lies between, as rows of the boundary map. Each
  // texel carries the cut's yaw in red and the width to fade over it in green.
  // uSeamRows.x < 0 means no routed seam exists and the geometric rule stands.
  uniform sampler2D uSeams;
  uniform vec2 uSeamRows;

  void main() {
    vec2 ndc; float quality;
    if (!projectPixel(ndc, quality)) { discard; }

    float best = texture2D(uBestQuality, vUv).r;
    float seamWeight = exp(-uSeamK * max(best - quality, 0.0));

    if (uSeamRows.x >= 0.0) {
      // Latitude runs 0 at the north pole to 1 at the south, matching how the
      // boundary map was built.
      float lat = 1.0 - (uVRange.x + vUv.y * uVRange.y);
      vec2 lo = texture2D(uSeams, vec2(lat, uSeamRows.x)).rg;
      vec2 hi = texture2D(uSeams, vec2(lat, uSeamRows.y)).rg;

      // The cross-fade STRADDLES each cut: a frame keeps half a fade of reach
      // past its own boundary, and its neighbour reaches the same distance back
      // the other way, so inside that band both are present and the mix runs
      // 0→1. Both sides read the width from the same texel, so the two halves
      // are always the same size and the weights sum to one across the join.
      //
      // The version this replaces faded each frame to zero exactly AT its
      // boundary and started its neighbour from zero on the far side, so the two
      // never overlapped — the weights collapsed to the 0.001 fallback below and
      // the join came out 0.06° wide, a single pixel. That is why a couple of
      // levels of leftover exposure difference read as a hard line down a plain
      // wall, and why the routed path's latitude bins read as a staircase: a
      // one-pixel cut draws whatever shape it is given, exactly.
      float phi = vUv.x * 360.0;
      // Signed distances past the near cut and short of the far one. Safe to
      // wrap: projectPixel already rejected anything outside this frame, so phi
      // is within half a field of view of it and the shortest way round is the
      // only way round.
      float pastLo = wrap180(phi - lo.r);
      float toHi = wrap180(hi.r - phi);
      float halfLo = max(0.05, lo.g * 0.5);
      float halfHi = max(0.05, hi.g * 0.5);
      float owned = smoothstep(-halfLo, halfLo, pastLo)
                  * smoothstep(-halfHi, halfHi, toHi);
      // A whisper of the geometric rule underneath, so a pixel no arc happens
      // to claim still gets its best available frame instead of a hole.
      seamWeight = owned + 0.001 * seamWeight;
    }

    // uAverageMode reproduces the old wash for before/after measurements.
    float weight = mix(seamWeight, smoothstep(0.0, 0.35, quality), uAverageMode);

    // v = 0 is the frame's TOP row: an ImageBitmap ignores Texture.flipY, so
    // both decode paths are pinned to the same orientation here instead.
    vec3 color = texture2D(uFrame, vec2(ndc.x, -ndc.y) * 0.5 + 0.5).rgb * uGain;
    // Floor the divisor so a steep fit can never blow a corner out.
    color /= max(0.35, 1.0 + uVignetteA * dot(ndc, ndc));
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
  vignetteA: number,
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
      uVignetteA: { value: vignetteA },
      uSeams: { value: seamTexture },
      uSeamRows: { value: new THREE.Vector2(-1, -1) },
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

/** Columns and rows the coverage mask is probed at. */
const PROBE_COLUMNS = 256;
const PROBE_ROWS = 512;
/** Rows in the small canvas each cap's fill is painted at before upscaling. */
const FILL_ROWS = 128;
/** Probe rows sampled below a column's boundary to read its edge colour. */
const EDGE_SAMPLE_ROWS = 3;

/** Latitude range of the band every column covers with real pixels. */
export interface CoveredBand {
  topDeg: number;
  bottomDeg: number;
}

interface ColumnEdge {
  /** Probe row of the first/last confidently covered pixel, -1 if none. */
  row: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Reads the coverage mask the normalize pass wrote into alpha and fills only
 * what the shots genuinely missed — no assumption about the lens.
 *
 * Two things the previous version got wrong, both visible in the real captures:
 *
 * The boundary was ONE row for the whole image, decided by a majority of eight
 * probe columns. A hand-held ring tilts a little on every shot, so the real
 * boundary is wavy in yaw; every column whose coverage ended below that single
 * row kept its transparent pixels and came out as a black sliver along the
 * ceiling line. Here each column carries its own boundary, and because the
 * paint goes UNDER the existing pixels the region can be over-extended for
 * free — nothing can overwrite a real pixel, so erring deep is strictly safe.
 *
 * And the gap was filled by stretching one 64×1 strip over the whole cap. At
 * the pole all output columns converge on a single point while each still
 * carries its own colour, which is precisely a pinwheel of radial wedges. Here
 * every column fades to one shared pole colour, so the wedges cannot exist:
 * at the pole there is nothing left to disagree about.
 */
export function fillUncovered(
  source: HTMLCanvasElement,
  outWidth: number,
  outHeight: number,
): CoveredBand {
  const ctx = source.getContext('2d', { willReadFrequently: true })!;

  const probe = document.createElement('canvas');
  probe.width = PROBE_COLUMNS;
  probe.height = PROBE_ROWS;
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(source, 0, 0, PROBE_COLUMNS, PROBE_ROWS);
  const pdata = pctx.getImageData(0, 0, PROBE_COLUMNS, PROBE_ROWS).data;

  // Downscaling averages alpha, so a jagged boundary reads as a ramp. Only
  // near-opaque counts as covered, which puts the boundary just inside real
  // coverage — the safe side, given the paint lands under.
  const COVERED = 250;
  const at = (x: number, y: number) => (y * PROBE_COLUMNS + x) * 4;

  /** Walks a column from one end and reports where real pixels start. */
  const edgeOf = (x: number, fromTop: boolean): ColumnEdge => {
    const step = fromTop ? 1 : -1;
    const start = fromTop ? 0 : PROBE_ROWS - 1;
    for (let k = 0; k < PROBE_ROWS; k++) {
      const y = start + k * step;
      if (pdata[at(x, y) + 3] < COVERED) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let s = 0; s < EDGE_SAMPLE_ROWS; s++) {
        const sy = y + s * step;
        if (sy < 0 || sy >= PROBE_ROWS || pdata[at(x, sy) + 3] < COVERED) break;
        const i = at(x, sy);
        r += pdata[i]; g += pdata[i + 1]; b += pdata[i + 2]; n++;
      }
      return n ? { row: y, r: r / n, g: g / n, b: b / n } : { row: y, r: 0, g: 0, b: 0 };
    }
    return { row: -1, r: 0, g: 0, b: 0 };
  };

  const top = Array.from({ length: PROBE_COLUMNS }, (_, x) => edgeOf(x, true));
  const bottom = Array.from({ length: PROBE_COLUMNS }, (_, x) => edgeOf(x, false));
  const found = top.filter((e) => e.row >= 0);
  if (!found.length) return { topDeg: 90, bottomDeg: -90 }; // nothing to work with

  /**
   * Paints one cap into a small canvas and stretches it over the gap.
   * `edges` are that cap's per-column boundaries; `depth` is how many probe
   * rows the cap spans, measured from the pole.
   */
  const paintCap = (edges: ColumnEdge[], fromTop: boolean): void => {
    const covered = edges.filter((e) => e.row >= 0);
    if (!covered.length) return;
    // Deepest boundary among the columns: the rectangle has to reach past the
    // wobbliest column or that column keeps its tear.
    const depth = fromTop
      ? Math.max(...covered.map((e) => e.row)) + 2
      : PROBE_ROWS - Math.min(...covered.map((e) => e.row)) + 1;
    if (depth <= 0) return;

    // One colour for the whole pole. Every column ends here, so no two columns
    // can meet at the pole carrying different colours.
    const pole = covered.reduce(
      (acc, e) => ({ r: acc.r + e.r / covered.length, g: acc.g + e.g / covered.length, b: acc.b + e.b / covered.length }),
      { r: 0, g: 0, b: 0 },
    );

    const fill = document.createElement('canvas');
    fill.width = PROBE_COLUMNS;
    fill.height = FILL_ROWS;
    const fctx = fill.getContext('2d', { willReadFrequently: true })!;
    const image = fctx.createImageData(PROBE_COLUMNS, FILL_ROWS);

    for (let x = 0; x < PROBE_COLUMNS; x++) {
      const edge = edges[x].row >= 0 ? edges[x] : covered[0];
      // Where this column's own boundary falls inside the cap, 0..1 from pole.
      const boundary = fromTop ? edge.row + 2 : PROBE_ROWS - edge.row + 1;
      const span = Math.max(1, (boundary / depth) * FILL_ROWS);

      for (let row = 0; row < FILL_ROWS; row++) {
        // Row 0 is the pole in the cap's own orientation.
        const poleRow = fromTop ? row : FILL_ROWS - 1 - row;
        // Past its own boundary the column just carries its edge colour, which
        // is what any leftover tear down there should be filled with.
        const t = Math.max(0, Math.min(1, 1 - poleRow / span));
        const ease = t * t * (3 - 2 * t);
        const i = (row * PROBE_COLUMNS + x) * 4;
        image.data[i] = edge.r + (pole.r - edge.r) * ease;
        image.data[i + 1] = edge.g + (pole.g - edge.g) * ease;
        image.data[i + 2] = edge.b + (pole.b - edge.b) * ease;
        image.data[i + 3] = 255;
      }
    }
    fctx.putImageData(image, 0, 0);

    const rows = Math.ceil((depth / PROBE_ROWS) * outHeight);
    const destY = fromTop ? 0 : outHeight - rows;
    ctx.drawImage(fill, 0, 0, PROBE_COLUMNS, FILL_ROWS, 0, destY, outWidth, rows);
  };

  // Painting UNDER the existing pixels fills the transparent gaps in place —
  // compositing onto a second full-size canvas would cost another 32 MB.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalCompositeOperation = 'destination-over';
  paintCap(top, true);
  paintCap(bottom, false);
  ctx.globalCompositeOperation = 'source-over';

  // The honest band is the one EVERY column covers, so the AI step is never
  // told a pixel is real because most of its neighbours were.
  const deepestTop = Math.max(...found.map((e) => e.row));
  const shallowestBottom = Math.min(...bottom.filter((e) => e.row >= 0).map((e) => e.row));
  return {
    topDeg: 90 - (deepestTop / PROBE_ROWS) * 180,
    bottomDeg: 90 - ((shallowestBottom + 1) / PROBE_ROWS) * 180,
  };
}
