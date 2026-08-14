import {
  FALLBACK_OUTPUT_WIDTH,
  PREFERRED_OUTPUT_WIDTH,
  TILE_MEMORY_BUDGET_MB,
  medianOf,
  pickOutputSize,
  tileHeightFor,
} from './stitcher';

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
 * the whole capture is lost. The defence is no longer a frame budget (frames
 * are JPEG bytes now) but the band: only one band's worth of render target is
 * ever allocated, whatever the output size.
 */
describe('stitcher memory budget', () => {
  const portrait16by9 = 9 / 16;
  const portrait4by3 = 3 / 4;

  /** Half-float accumulator (8 B/px) plus the byte-sized quality map (4 B/px). */
  const bandMB = (width: number, height: number) => (width * height * 12) / 1048576;

  it('keeps one band inside the budget at every output size it can pick', () => {
    for (const width of [FALLBACK_OUTPUT_WIDTH, PREFERRED_OUTPUT_WIDTH, 8192]) {
      const height = width / 2;
      expect(bandMB(width, tileHeightFor(width, height)))
        .withContext(`${width}×${height}`)
        .toBeLessThanOrEqual(TILE_MEMORY_BUDGET_MB);
    }
  });

  it('covers the output exactly, with the overhang only in the last band', () => {
    for (const width of [FALLBACK_OUTPUT_WIDTH, PREFERRED_OUTPUT_WIDTH]) {
      const height = width / 2;
      const band = tileHeightFor(width, height);
      const bands = Math.ceil(height / band);
      expect(bands * band).withContext(`${width}`).toBeGreaterThanOrEqual(height);
      expect((bands - 1) * band).withContext(`${width}`).toBeLessThan(height);
    }
  });

  it('takes the tallest band the budget allows, to decode frames fewer times', () => {
    // Every band re-decodes every frame it touches, so a needlessly short band
    // is paid for in seconds of stitching.
    const height = PREFERRED_OUTPUT_WIDTH / 2;
    const band = tileHeightFor(PREFERRED_OUTPUT_WIDTH, height);
    expect(bandMB(PREFERRED_OUTPUT_WIDTH, band)).toBeGreaterThan(TILE_MEMORY_BUDGET_MB / 2);
  });

  it('picks an output size the device will actually allocate', () => {
    const { outWidth, outHeight } = pickOutputSize(
      {},
      { vfovDeg: 108, frameAspect: portrait16by9, wideShapeAccepted: false },
    );
    expect([FALLBACK_OUTPUT_WIDTH, PREFERRED_OUTPUT_WIDTH]).toContain(outWidth);
    expect(outHeight).toBe(outWidth / 2);

    const probe = document.createElement('canvas');
    probe.width = outWidth;
    probe.height = outHeight;
    expect(probe.width).withContext('chosen size was refused').toBe(outWidth);
    probe.width = 0;
    probe.height = 0;
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
