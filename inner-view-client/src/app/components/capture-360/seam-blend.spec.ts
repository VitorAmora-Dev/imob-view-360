import { storeFrame } from './frame-store';
import { quaternionFromYpr } from './orientation-math';
import {
  SEAM_FEATHER_DEG,
  SEAM_FEATHER_MAX_DEG,
  StitchShot,
  featherAlongPath,
  stitchEquirect,
} from './stitcher';

/**
 * How wide the join between two photographs actually is, measured on the
 * finished panorama.
 *
 * Twelve flat frames around a ring, one of them brighter than the rest, and the
 * exposure matching turned off so the difference survives to the output. There
 * is nothing in the scene for a real edge to be confused with, so every change
 * in brightness along the equator IS the join, and counting the columns it takes
 * measures the cross-fade directly.
 *
 * This exists because the constant said 1.5° and the shader delivered 0.06°: a
 * frame's weight fell to zero exactly AT its boundary and its neighbour's rose
 * from zero on the other side, so the two never overlapped and the "cross-fade"
 * only ever faded a frame against the 0.001 fallback. That is a one-pixel cut,
 * which is why a couple of levels of leftover exposure difference read as a hard
 * line, and why the routed path's latitude steps read as a staircase.
 */
const RING_SHOTS = 12;
const VFOV_DEG = 95;
const PORTRAIT_4_BY_3 = 3 / 4;
const OUT_WIDTH = 2048;
const DARK = 140;
const BRIGHT = 200;

async function flatShot(yawDeg: number, level: number): Promise<StitchShot> {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `rgb(${level},${level},${level})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const frame = await storeFrame(canvas);
  const q = quaternionFromYpr(yawDeg, 0, 0);
  return { frame, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w } };
}

/** Luma along the equator of a finished panorama. */
async function equatorProfile(imageData: string, width: number): Promise<Float32Array> {
  const image = new Image();
  image.src = imageData;
  await image.decode();

  const strip = document.createElement('canvas');
  strip.width = width;
  strip.height = 1;
  const ctx = strip.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, Math.floor(image.height / 2), image.width, 1, 0, 0, width, 1);
  const data = ctx.getImageData(0, 0, width, 1).data;

  const out = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const i = x * 4;
    out[x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

/**
 * Widest run of columns sitting between the two plateaus — the join, in columns.
 * Measured on the 10–90% band so JPEG ringing at the plateaus is not counted.
 */
function transitionColumns(profile: Float32Array): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of profile) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  const from = lo + 0.1 * (hi - lo);
  const to = hi - 0.1 * (hi - lo);

  let widest = 0;
  let run = 0;
  // Twice around, so a join straddling the panorama's wrap is still one run.
  for (let k = 0; k < profile.length * 2; k++) {
    const value = profile[k % profile.length];
    run = value > from && value < to ? run + 1 : 0;
    widest = Math.max(widest, run);
  }
  return Math.min(widest, profile.length);
}

describe('the join between two photographs', () => {
  let profile: Float32Array;

  beforeAll(async () => {
    const shots: StitchShot[] = [];
    for (let k = 0; k < RING_SHOTS; k++) {
      // One bright frame among dark ones: two joins, both with a known step.
      shots.push(await flatShot((k * 360) / RING_SHOTS, k === 0 ? BRIGHT : DARK));
    }
    const result = await stitchEquirect(
      shots,
      { vfovDeg: VFOV_DEG, frameAspect: PORTRAIT_4_BY_3, wideShapeAccepted: true },
      // No refinement: the exposure solve would match the frames and erase the
      // very step being measured, and flat frames give it nothing to work with.
      { outWidth: OUT_WIDTH, outHeight: OUT_WIDTH / 2, refine: false },
    );
    profile = await equatorProfile(result.imageData, OUT_WIDTH);
  }, 120000);

  it('carries the brightness difference into the panorama', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const value of profile) {
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
    expect(hi - lo).withContext('the step never reached the output').toBeGreaterThan(30);
  });

  /**
   * Flat frames have no edge anywhere to be doubled, which is the case the fade
   * is allowed to open up for. A join that still arrived narrow here would mean
   * the width never left its floor.
   */
  it('opens the fade wide where the photos have nothing to disagree about', () => {
    const spanDeg = (transitionColumns(profile) * 360) / OUT_WIDTH;
    // A smoothstep spends its ends sitting near the plateaus, so the 10-90% band
    // is always narrower than the fade itself.
    expect(spanDeg)
      .withContext(`join spans ${spanDeg.toFixed(2)}°, floor is ${SEAM_FEATHER_DEG}°`)
      .toBeGreaterThan(SEAM_FEATHER_MAX_DEG * 0.4);
  });
});

describe('how wide the join fades', () => {
  const COLUMNS = 64;
  const ROWS = 16;
  const DEG_PER_COLUMN = 0.25;

  /** A path straight down the middle, which is where a flat cost puts it. */
  const middle = () => new Int32Array(ROWS).fill(COLUMNS / 2);

  it('opens to the maximum where the two photos agree', () => {
    const quiet = new Float32Array(COLUMNS * ROWS);
    const feather = featherAlongPath(quiet, middle(), COLUMNS, ROWS, DEG_PER_COLUMN, SEAM_FEATHER_MAX_DEG);
    for (const width of feather) expect(width).toBeCloseTo(SEAM_FEATHER_MAX_DEG, 5);
  });

  it('closes to the floor where an edge would be doubled', () => {
    const busy = new Float32Array(COLUMNS * ROWS).fill(80);
    const feather = featherAlongPath(busy, middle(), COLUMNS, ROWS, DEG_PER_COLUMN, SEAM_FEATHER_MAX_DEG);
    for (const width of feather) expect(width).toBeCloseTo(SEAM_FEATHER_DEG, 5);
  });

  /**
   * The fade reaches sideways, so an edge half a fade away is still inside it.
   * Reading only the path's own column would call this stretch quiet and then
   * blend the edge twice.
   */
  it('sees an edge standing beside the path, not only on it', () => {
    const beside = new Float32Array(COLUMNS * ROWS);
    for (let row = 0; row < ROWS; row++) {
      // Two columns to the left of the cut: 0.5°, well inside a 6° fade.
      beside[row * COLUMNS + COLUMNS / 2 - 2] = 80;
    }
    const feather = featherAlongPath(beside, middle(), COLUMNS, ROWS, DEG_PER_COLUMN, SEAM_FEATHER_MAX_DEG);
    for (const width of feather) expect(width).toBeLessThan(SEAM_FEATHER_MAX_DEG * 0.5);
  });

  it('never returns a width the caller did not allow', () => {
    const mixed = new Float32Array(COLUMNS * ROWS);
    for (let i = 0; i < mixed.length; i++) mixed[i] = (i % 7) * 6;
    const cap = 2.5;
    const feather = featherAlongPath(mixed, middle(), COLUMNS, ROWS, DEG_PER_COLUMN, cap);
    for (const width of feather) {
      expect(width).toBeLessThanOrEqual(cap + 1e-6);
      expect(width).toBeGreaterThanOrEqual(Math.min(SEAM_FEATHER_DEG, cap) - 1e-6);
    }
  });
});
