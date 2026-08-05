import * as THREE from 'three';

/**
 * Measures how far each shot's recorded orientation is from where its pixels
 * actually say it is, and spreads the disagreement around the ring.
 *
 * What this replaces mattered: the previous refinement compared a single
 * one-dimensional luminance profile per frame, which can only ever see YAW.
 * Pitch and roll errors — the ones that bend a wall corner and step a vertical
 * edge — were invisible to it, and yaw error accumulated shot by shot until the
 * last frame met the first with whatever had piled up.
 *
 * Here a pair is compared as an image, in three horizontal bands. Three shifts
 * at three heights separate the three axes: a constant horizontal shift is yaw,
 * a constant vertical shift is pitch, and a horizontal shift that GROWS with
 * height is roll. Then the ring is solved as a loop, so the closing error is
 * distributed rather than dumped on the final seam.
 *
 * Assumes a ring near the horizon, which is the only pattern this app captures:
 * the shared view direction is then horizontal, so the patch's own axes line up
 * with yaw and pitch. A pattern with poles would need the general form.
 */

/** Field the comparison patch covers, in degrees from its centre. */
const PATCH_HALF_WIDTH_DEG = 14;
const PATCH_HALF_HEIGHT_DEG = 21;
/** Patch sampling density. Correlation resolves well below one pixel. */
const PATCH_PIXELS_PER_DEG = 4;
const BAND_COUNT = 3;
/** Largest disagreement worth believing; past this it is a failed match. */
export const MAX_CORRECTION_DEG = 4;
/** Correlation below this is noise — a blank wall matches everything equally. */
const MIN_BAND_SCORE = 0.35;
/**
 * Correlation cannot resolve angle indefinitely, and on low-texture walls the
 * peak wanders. Correcting inside that floor degrades a good gyro reading.
 */
const DEADBAND_DEG = 0.15;

export interface FrameView {
  /** Small decoded copy of the frame. */
  image: HTMLCanvasElement;
  /** Session-frame orientation recorded with the shot. */
  quaternion: THREE.Quaternion;
  hfovDeg: number;
  vfovDeg: number;
}

export interface RelativeCorrection {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /** 0..1; zero means the pair could not be matched and must not be trusted. */
  confidence: number;
}

export interface BandShift {
  /** Horizontal disagreement in degrees, positive = b sits to the right of a. */
  dxDeg: number;
  dyDeg: number;
  /** Band centre height above the patch centre, in degrees. */
  heightDeg: number;
  score: number;
}

/* ------------------------------------------------------------------------- */
/* Sampling a shared patch out of two frames                                  */
/* ------------------------------------------------------------------------- */

interface Patch {
  data: Float32Array;
  width: number;
  height: number;
  /** Fraction of pixels that fell inside the frame. */
  filled: number;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, -1);

export function forwardOf(quaternion: THREE.Quaternion): THREE.Vector3 {
  return WORLD_FORWARD.clone().applyQuaternion(quaternion);
}

/**
 * Each frame is sampled once per neighbour, and reading a thumbnail back costs
 * a full copy of it every time. Holding the pixels weakly keeps that to one
 * read per frame without keeping anything alive past the stitch.
 */
const pixelCache = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();

function pixelsOf(source: HTMLCanvasElement): Uint8ClampedArray {
  const cached = pixelCache.get(source);
  if (cached) return cached;
  const pixels = source
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, source.width, source.height).data;
  pixelCache.set(source, pixels);
  return pixels;
}

/**
 * Rectilinear window centred on `centre`, sampled from one frame. Pixels the
 * frame does not reach are left at NaN so the correlation can skip them.
 */
export function samplePatch(
  view: FrameView,
  centre: THREE.Vector3,
  pixelsPerDeg = PATCH_PIXELS_PER_DEG,
): Patch {
  const width = Math.max(8, Math.round(2 * PATCH_HALF_WIDTH_DEG * pixelsPerDeg));
  const height = Math.max(8, Math.round(2 * PATCH_HALF_HEIGHT_DEG * pixelsPerDeg));

  const right = new THREE.Vector3().crossVectors(centre, WORLD_UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, centre).normalize();

  const tanW = Math.tan((PATCH_HALF_WIDTH_DEG * Math.PI) / 180);
  const tanH = Math.tan((PATCH_HALF_HEIGHT_DEG * Math.PI) / 180);
  const tanHalfH = Math.tan((view.hfovDeg * Math.PI) / 360);
  const tanHalfV = Math.tan((view.vfovDeg * Math.PI) / 360);

  const source = view.image;
  const pixels = pixelsOf(source);

  const inverse = view.quaternion.clone().invert();
  const ray = new THREE.Vector3();
  const data = new Float32Array(width * height);
  let filled = 0;

  for (let y = 0; y < height; y++) {
    // Row 0 is the TOP of the patch, so v runs from +1 down to −1.
    const v = 1 - (2 * (y + 0.5)) / height;
    for (let x = 0; x < width; x++) {
      const u = (2 * (x + 0.5)) / width - 1;
      ray.copy(centre)
        .addScaledVector(right, tanW * u)
        .addScaledVector(up, tanH * v)
        .normalize()
        .applyQuaternion(inverse);

      const index = y * width + x;
      if (ray.z >= -1e-4) { data[index] = NaN; continue; }
      const ndcX = ray.x / -ray.z / tanHalfH;
      const ndcY = ray.y / -ray.z / tanHalfV;
      if (Math.abs(ndcX) >= 1 || Math.abs(ndcY) >= 1) { data[index] = NaN; continue; }

      const px = Math.round((ndcX * 0.5 + 0.5) * (source.width - 1));
      const py = Math.round((0.5 - ndcY * 0.5) * (source.height - 1));
      const s = (py * source.width + px) * 4;
      data[index] = 0.299 * pixels[s] + 0.587 * pixels[s + 1] + 0.114 * pixels[s + 2];
      filled++;
    }
  }

  return { data, width, height, filled: filled / (width * height) };
}

/* ------------------------------------------------------------------------- */
/* Correlation: coarse pass over a downsample, then a local refinement        */
/* ------------------------------------------------------------------------- */

export interface ShiftMeasure {
  dx: number;
  dy: number;
  score: number;
}

/**
 * Best (dx, dy) aligning `b` onto `a`, in patch pixels. Searched on a quarter
 * -scale copy first: a full search at the range this needs would be a thousand
 * candidates over every pixel, which is seconds of a phone's time per pair.
 */
export function correlateShift(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  maxShift: number,
): ShiftMeasure {
  const factor = 4;
  const coarseW = Math.floor(width / factor);
  const coarseH = Math.floor(height / factor);
  let best: ShiftMeasure = { dx: 0, dy: 0, score: -Infinity };

  if (coarseW >= 4 && coarseH >= 4) {
    const ca = downsample(a, width, height, factor);
    const cb = downsample(b, width, height, factor);
    const coarseRange = Math.max(1, Math.round(maxShift / factor));
    const coarse = searchShift(ca, cb, coarseW, coarseH, coarseRange, 0, 0, 1);
    best = { dx: coarse.dx * factor, dy: coarse.dy * factor, score: coarse.score };
  }

  const refined = searchShift(a, b, width, height, factor, best.dx, best.dy, 1);
  return subPixel(a, b, width, height, refined);
}

function downsample(
  source: Float32Array,
  width: number,
  height: number,
  factor: number,
): Float32Array {
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const v = source[(y * factor + dy) * width + x * factor + dx];
          if (!Number.isNaN(v)) { sum += v; n++; }
        }
      }
      // A block that is mostly outside the frame stays unusable rather than
      // being filled in with the little that happened to land inside it.
      out[y * w + x] = n > (factor * factor) / 2 ? sum / n : NaN;
    }
  }
  return out;
}

function searchShift(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  range: number,
  centerX: number,
  centerY: number,
  step: number,
): ShiftMeasure {
  let best: ShiftMeasure = { dx: centerX, dy: centerY, score: -Infinity };
  for (let dy = centerY - range; dy <= centerY + range; dy += step) {
    for (let dx = centerX - range; dx <= centerX + range; dx += step) {
      const score = correlationAt(a, b, width, height, dx, dy);
      if (score > best.score) best = { dx, dy, score };
    }
  }
  return best;
}

/** Zero-mean normalised correlation over the pixels both patches reach. */
function correlationAt(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): number {
  let sumA = 0, sumB = 0, count = 0;
  for (let y = 0; y < height; y++) {
    const yb = y + dy;
    if (yb < 0 || yb >= height) continue;
    for (let x = 0; x < width; x++) {
      const xb = x + dx;
      if (xb < 0 || xb >= width) continue;
      const va = a[y * width + x];
      const vb = b[yb * width + xb];
      if (Number.isNaN(va) || Number.isNaN(vb)) continue;
      sumA += va; sumB += vb; count++;
    }
  }
  if (count < 32) return -Infinity;

  const meanA = sumA / count, meanB = sumB / count;
  let num = 0, varA = 0, varB = 0;
  for (let y = 0; y < height; y++) {
    const yb = y + dy;
    if (yb < 0 || yb >= height) continue;
    for (let x = 0; x < width; x++) {
      const xb = x + dx;
      if (xb < 0 || xb >= width) continue;
      const va = a[y * width + x];
      const vb = b[yb * width + xb];
      if (Number.isNaN(va) || Number.isNaN(vb)) continue;
      const da = va - meanA, db = vb - meanB;
      num += da * db; varA += da * da; varB += db * db;
    }
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 1e-6 ? num / denom : 0;
}

/** Parabola through the peak and its two neighbours, per axis. */
function subPixel(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  peak: ShiftMeasure,
): ShiftMeasure {
  const axis = (horizontal: boolean): number => {
    const at = (offset: number) =>
      correlationAt(
        a, b, width, height,
        peak.dx + (horizontal ? offset : 0),
        peak.dy + (horizontal ? 0 : offset),
      );
    const left = at(-1), right = at(1);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
    const denom = left - 2 * peak.score + right;
    if (Math.abs(denom) < 1e-9) return 0;
    // Clamped: a flat correlation surface can otherwise throw the vertex far
    // outside the bracket it was fitted from.
    return Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denom));
  };
  return { dx: peak.dx + axis(true), dy: peak.dy + axis(false), score: peak.score };
}

/* ------------------------------------------------------------------------- */
/* From band shifts to a three-axis correction                                */
/* ------------------------------------------------------------------------- */

/**
 * Separates the three axes. Yaw and pitch are what every band agrees on; roll
 * is what makes the horizontal shift depend on the band's height.
 */
export function fitRelativeCorrection(bands: BandShift[]): RelativeCorrection {
  const usable = bands.filter((band) => band.score >= MIN_BAND_SCORE);
  if (!usable.length) return { yawDeg: 0, pitchDeg: 0, rollDeg: 0, confidence: 0 };

  const mean = (pick: (band: BandShift) => number) =>
    usable.reduce((sum, band) => sum + pick(band), 0) / usable.length;

  const yawDeg = mean((band) => band.dxDeg);
  const pitchDeg = mean((band) => band.dyDeg);

  // Roll needs bands at different heights to be visible at all.
  let rollDeg = 0;
  if (usable.length >= 2) {
    const meanHeight = mean((band) => band.heightDeg);
    let num = 0, den = 0;
    for (const band of usable) {
      const h = band.heightDeg - meanHeight;
      num += h * (band.dxDeg - yawDeg);
      den += h * h;
    }
    // dx grows with height at −roll: rolling the frame anticlockwise pushes the
    // top to the left and the bottom to the right.
    if (den > 1e-6) rollDeg = (-num / den) * (180 / Math.PI);
  }

  const confidence = mean((band) => band.score) * (usable.length / bands.length);
  return {
    yawDeg: deadband(yawDeg),
    pitchDeg: deadband(pitchDeg),
    rollDeg: deadband(rollDeg),
    confidence,
  };
}

function deadband(value: number): number {
  if (Math.abs(value) <= DEADBAND_DEG) return 0;
  if (Math.abs(value) > MAX_CORRECTION_DEG) return 0;
  // Shrunk by the deadband so corrections enter continuously rather than
  // jumping the moment the threshold is crossed.
  return value - Math.sign(value) * DEADBAND_DEG;
}

/* ------------------------------------------------------------------------- */
/* Closing the ring                                                           */
/* ------------------------------------------------------------------------- */

export interface AxisTriple {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

const AXES = ['yawDeg', 'pitchDeg', 'rollDeg'] as const;

/**
 * Yaw is measured but never corrected, and the reason is worth stating because
 * it is the opposite of what this whole file looks like it is for.
 *
 * A hand turns the phone about the wrist or the body, so the lens swings on a
 * horizontal arc: between neighbours it moves sideways by ~13 cm. That
 * displacement makes near objects and far objects disagree by different
 * amounts, and no rotation reconciles them. Correlation nonetheless returns the
 * single shift that best matches the overlap — dominated by whatever is
 * nearest — and rotating the frame to satisfy it throws the rest of the scene
 * off instead.
 *
 * Measured on the simulated room, same capture, same code: with a tripod the
 * ring failed to close by 0.23°, and with 25 cm of hand movement by 14.87°.
 * The difference is not drift, it is parallax being read as rotation, and
 * acting on it pushed the median displacement from the truth from 0.35° to
 * 1.76°.
 *
 * Pitch and roll survive because the movement is sideways: the same run showed
 * 0.87° and 1.35° across the whole turn, against yaw's 14.87°. Those are the
 * axes that bend a wall corner and tilt a horizon, which is what the captures
 * actually showed — so they are corrected, and yaw is left to the gyro, which
 * has no depth to be confused by.
 */
const CORRECTED_AXES = ['pitchDeg', 'rollDeg'] as const;

/**
 * How much the ring fails to close: the sum of every measured step around the
 * full turn, which should be zero and is not. Reported for diagnostics — a
 * number the previous refinement had no way to even compute.
 */
export function loopClosureResidual(
  measurements: readonly (RelativeCorrection | null)[],
): AxisTriple {
  const total: AxisTriple = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
  for (const m of measurements) {
    if (!m) continue;
    for (const axis of AXES) total[axis] += m[axis];
  }
  return total;
}

/**
 * Per-frame corrections from the measured steps between neighbours.
 *
 * `measurements[i]` is how much frame i+1 disagrees with frame i (the last
 * entry wraps back to frame 0). Chaining them naively would leave the entire
 * accumulated error at the wrap, which is exactly the visible break the old
 * per-pair nudging produced. Instead the closing error is pushed back into the
 * ring in proportion to how UNSURE each pair was, so the joins that could not
 * be measured absorb what the confident ones should not have to.
 */
export function solveRingCorrections(
  measurements: readonly (RelativeCorrection | null)[],
  axes: readonly (keyof AxisTriple)[] = CORRECTED_AXES,
): AxisTriple[] {
  const count = measurements.length;
  const corrections: AxisTriple[] = Array.from({ length: count }, () => ({
    yawDeg: 0, pitchDeg: 0, rollDeg: 0,
  }));
  if (count < 2) return corrections;

  // Uncertainty per join; a join with no measurement is free to take up the
  // whole residual, which is the right place to put it.
  const slack = measurements.map((m) => (m ? 1 - Math.min(0.95, m.confidence) : 1));
  const slackTotal = slack.reduce((sum, s) => sum + s, 0);

  for (const axis of axes) {
    const residual = measurements.reduce((sum, m) => sum + (m ? m[axis] : 0), 0);
    let running = 0;
    for (let i = 0; i < count; i++) {
      const m = measurements[i];
      const share = slackTotal > 1e-9 ? slack[i] / slackTotal : 1 / count;
      running += (m ? m[axis] : 0) - residual * share;
      // Entry i is the step from frame i to frame i+1, so it lands on i+1;
      // frame 0 stays fixed as the reference the whole ring is expressed in.
      if (i + 1 < count) corrections[i + 1][axis] = running;
    }
  }
  return corrections;
}

/**
 * Applies a measured correction to a recorded orientation.
 *
 * The axes are the ones the measurement is expressed in: yaw about world up,
 * pitch about the frame's own right axis, roll about where it is pointing.
 * Near the horizon — the only place this ring puts a frame — those are the
 * same axes the patch comparison measured along.
 */
export function applyCorrection(
  quaternion: THREE.Quaternion,
  correction: AxisTriple,
): THREE.Quaternion {
  const forward = forwardOf(quaternion);
  const right = new THREE.Vector3().crossVectors(forward, WORLD_UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();

  const toRad = Math.PI / 180;
  const delta = new THREE.Quaternion()
    .setFromAxisAngle(WORLD_UP, correction.yawDeg * toRad)
    .multiply(new THREE.Quaternion().setFromAxisAngle(right, correction.pitchDeg * toRad))
    .multiply(new THREE.Quaternion().setFromAxisAngle(forward, correction.rollDeg * toRad));
  return delta.multiply(quaternion);
}

/* ------------------------------------------------------------------------- */
/* Putting it together for a pair of frames                                   */
/* ------------------------------------------------------------------------- */

/** Compares two overlapping frames and reports how far apart they really are. */
export function measurePair(a: FrameView, b: FrameView): RelativeCorrection {
  const centre = forwardOf(a.quaternion).add(forwardOf(b.quaternion));
  if (centre.lengthSq() < 1e-6) return { yawDeg: 0, pitchDeg: 0, rollDeg: 0, confidence: 0 };
  centre.normalize();

  const patchA = samplePatch(a, centre);
  const patchB = samplePatch(b, centre);
  if (patchA.filled < 0.25 || patchB.filled < 0.25) {
    return { yawDeg: 0, pitchDeg: 0, rollDeg: 0, confidence: 0 };
  }

  const { width, height } = patchA;
  const bandHeight = Math.floor(height / BAND_COUNT);
  const maxShift = Math.round(MAX_CORRECTION_DEG * PATCH_PIXELS_PER_DEG);

  const bands: BandShift[] = [];
  for (let band = 0; band < BAND_COUNT; band++) {
    const top = band * bandHeight;
    const sliceA = patchA.data.slice(top * width, (top + bandHeight) * width);
    const sliceB = patchB.data.slice(top * width, (top + bandHeight) * width);
    const shift = correlateShift(sliceA, sliceB, width, bandHeight, maxShift);
    bands.push({
      dxDeg: shift.dx / PATCH_PIXELS_PER_DEG,
      // Both axes keep the patch's own sign. The convention is fixed by the
      // requirement in the spec — applying the result must cancel the error,
      // not double it — rather than by reasoning about which way rows run.
      dyDeg: shift.dy / PATCH_PIXELS_PER_DEG,
      heightDeg: (height / 2 - (top + bandHeight / 2)) / PATCH_PIXELS_PER_DEG,
      score: shift.score,
    });
  }
  return fitRelativeCorrection(bands);
}
