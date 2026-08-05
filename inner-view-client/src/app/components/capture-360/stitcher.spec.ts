import { frameSideBudget, pickOutputSize, medianOf, FRAME_MEMORY_BUDGET_MB } from './stitcher';

describe('exposure matching', () => {
  /**
   * A window inside the overlap blows a handful of samples to 255. Averaging
   * lets those few pixels drag the whole frame's gain, which showed up as the
   * milky veil over the real captures.
   */
  it('a few blown samples do not steer the reading', () => {
    const wall = new Float32Array(100).fill(90);
    for (let i = 0; i < 8; i++) wall[i] = 255;

    const mean = wall.reduce((a, b) => a + b, 0) / wall.length;
    expect(mean).toBeGreaterThan(100);            // hijacked
    expect(medianOf(wall, [0, wall.length])).toBe(90); // holds
  });

  it('reads the requested window only', () => {
    const values = new Float32Array([10, 10, 10, 200, 200, 200]);
    expect(medianOf(values, [0, 3])).toBe(10);
    expect(medianOf(values, [3, 6])).toBe(200);
  });

  it('survives an empty or inverted window', () => {
    const values = new Float32Array([5, 5, 5]);
    expect(medianOf(values, [2, 2])).toBe(0);
    expect(medianOf(values, [3, 1])).toBe(0);
  });
});

/**
 * Regression guard for the iOS tab kill: a 22-shot capture at 6144×3072 put
 * the pipeline around 534 MB, which Safari terminates — the page reloads and
 * the whole capture is lost. Everything here is about staying inside a budget
 * a phone actually has.
 */
describe('stitcher memory budget', () => {
  const portrait16by9 = 9 / 16;
  const portrait4by3 = 3 / 4;

  const framesMB = (count: number, side: number, aspect: number) => {
    const h = side;
    const w = side * aspect;
    return (count * w * h * 4) / 1048576;
  };

  it('keeps retained frames inside the budget however many shots the plan needs', () => {
    for (const count of [7, 12, 22, 40]) {
      for (const aspect of [portrait4by3, portrait16by9]) {
        const side = frameSideBudget(count, aspect);
        expect(framesMB(count, side, aspect))
          .withContext(`${count} shots at aspect ${aspect.toFixed(3)}`)
          .toBeLessThanOrEqual(FRAME_MEMORY_BUDGET_MB);
      }
    }
  });

  it('still keeps enough pixels to feed the panorama at its output size', () => {
    // A frame spanning ~75° must carry at least as many pixels as those 75°
    // occupy in a 4096-wide equirect, or the stitch throws away real detail.
    const side = frameSideBudget(12, portrait16by9);
    const frameWidth = side * portrait16by9;
    const neededForHfov = (75 / 360) * 4096;
    expect(frameWidth).toBeGreaterThanOrEqual(neededForHfov);
  });

  it('does not let a generous GPU limit pick a ruinous output size', () => {
    // iPhones report MAX_TEXTURE_SIZE 16384; the old code read that as
    // permission to allocate a 6144×3072 half-float target (144 MB alone).
    const { outWidth, outHeight } = pickOutputSize(
      {},
      { vfovDeg: 108, frameAspect: portrait16by9, wideShapeAccepted: false },
    );
    expect(outWidth).toBeLessThanOrEqual(4096);
    expect(outHeight).toBe(outWidth / 2);
  });

  it('honours an explicit output size for tests and diagnostics', () => {
    const { outWidth, outHeight } = pickOutputSize(
      { outWidth: 1024, outHeight: 512 },
      { vfovDeg: 108, frameAspect: portrait4by3, wideShapeAccepted: true },
    );
    expect(outWidth).toBe(1024);
    expect(outHeight).toBe(512);
  });
});
