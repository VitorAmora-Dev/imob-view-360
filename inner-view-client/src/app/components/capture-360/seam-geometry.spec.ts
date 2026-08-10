import {
  SEAM_FEATHER_MAX_DEG,
  SEAM_MIN_ARC_DEG,
  SeamWindow,
  hfovFromVfov,
  planSeamWindows,
} from './stitcher';

/**
 * Every photograph has to keep a piece of the sphere that is its own.
 *
 * A frame owns the arc between the cut behind it and the cut in front. Both
 * cuts are allowed to wander so they can dodge an object, and if that allowance
 * is decided for each cut in isolation the two can close in on each other until
 * the frame between them owns nothing. Then its neighbours' arcs meet, both
 * claim the same directions at full weight, and each draws a near object where
 * its own viewpoint saw it — a room with two sofas comes back with three.
 *
 * That is exactly what the ultra-wide at twelve shots was doing, and it is why
 * the duplication grew with the number of photographs: the more of them, the
 * narrower the spacing, while the allowance grows with the overlap.
 */

const PORTRAIT_4_BY_3 = 3 / 4;
/** The two lenses the app offers, as horizontal fields in portrait. */
const ULTRAWIDE_HFOV = hfovFromVfov(95, PORTRAIT_4_BY_3);
const WIDE_HFOV = hfovFromVfov(62, PORTRAIT_4_BY_3);

/** An evenly spaced ring, optionally jittered the way the aim tolerance allows. */
function ring(count: number, jitterDeg = 0): number[] {
  // A fixed, ugly pattern rather than random: a spec that fails once a week is
  // worse than one that never does.
  const wobble = [0, 1, -1, 0.6, -0.8, 0.9, -0.4, 0.2, -1, 0.5, -0.6, 0.7, -0.3, 1];
  return Array.from(
    { length: count },
    (_, i) => (i * 360) / count + wobble[i % wobble.length] * jitterDeg,
  );
}

/** Signed gap from one cut to the next; negative means they crossed. */
function arcsOf(windows: SeamWindow[], atExtreme: 'in' | 'out'): number[] {
  const count = windows.length;
  // Worst case for a frame is both its cuts wandering towards each other.
  const edge = (k: number, side: 1 | -1) =>
    windows[k].midYaw + side * windows[k].halfDeg * (atExtreme === 'in' ? 1 : 0);
  return windows.map((_, k) => {
    const before = edge((k - 1 + count) % count, +1);
    const here = edge(k, -1);
    let arc = here - before;
    while (arc < -180) arc += 360;
    while (arc > 180) arc -= 360;
    return arc;
  });
}

/** What the code did before: each cut sized from its own pair, alone. */
function windowsTheOldWay(longitudes: number[], hfovDeg: number): SeamWindow[] {
  const count = longitudes.length;
  return longitudes.map((lon, k) => {
    let step = longitudes[(k + 1) % count] - lon;
    while (step < -180) step += 360;
    while (step > 180) step -= 360;
    const spacing = Math.abs(step);
    const overlap = hfovDeg - spacing;
    return {
      midYaw: lon + step / 2,
      halfDeg: Math.max(0, Math.min((overlap / 2) * 0.6, 25)),
      maxFeatherDeg: SEAM_FEATHER_MAX_DEG,
    };
  });
}

describe('planning where the cuts may run', () => {
  const cases = [
    { name: 'ultra-wide, 12 shots', count: 12, hfov: ULTRAWIDE_HFOV },
    { name: 'ultra-wide, 14 shots', count: 14, hfov: ULTRAWIDE_HFOV },
    { name: 'ultra-wide, 8 shots', count: 8, hfov: ULTRAWIDE_HFOV },
    { name: 'ultra-wide, 6 shots', count: 6, hfov: ULTRAWIDE_HFOV },
    { name: 'main camera, 12 shots', count: 12, hfov: WIDE_HFOV },
    { name: 'main camera, 16 shots', count: 16, hfov: WIDE_HFOV },
  ];

  /**
   * The regression, kept as a counter-example rather than as a memory. The aim
   * tolerance is ±5°, so a jittered ring is not a pathological input — it is
   * what every hand-held capture produces.
   */
  it('the old rule really did squeeze frames out, and the new one does not', () => {
    const longitudes = ring(12, 5);
    const worstOld = Math.min(...arcsOf(windowsTheOldWay(longitudes, ULTRAWIDE_HFOV), 'in'));
    const worstNew = Math.min(...arcsOf(planSeamWindows(longitudes, ULTRAWIDE_HFOV), 'in'));

    expect(worstOld)
      .withContext(`old rule left ${worstOld.toFixed(1)}° — it used to cross`)
      .toBeLessThan(0);
    expect(worstNew)
      .withContext(`new rule left ${worstNew.toFixed(1)}°`)
      .toBeGreaterThanOrEqual(SEAM_MIN_ARC_DEG - 1e-6);
  });

  for (const { name, count, hfov } of cases) {
    for (const jitter of [0, 5]) {
      it(`keeps every frame a territory of its own — ${name}, aim off by ${jitter}°`, () => {
        const windows = planSeamWindows(ring(count, jitter), hfov);
        expect(windows.length).toBe(count);

        for (const arc of arcsOf(windows, 'in')) {
          expect(arc)
            .withContext(`a frame was left ${arc.toFixed(2)}° of its own`)
            .toBeGreaterThanOrEqual(SEAM_MIN_ARC_DEG - 1e-6);
        }
      });

      it(`never fades wider than the arc it borders — ${name}, aim off by ${jitter}°`, () => {
        const windows = planSeamWindows(ring(count, jitter), hfov);
        const arcs = arcsOf(windows, 'in');
        windows.forEach((window, k) => {
          // The cut sits between two frames; half a fade reaches into each.
          const neighbours = [arcs[k], arcs[(k + 1) % count]];
          for (const arc of neighbours) {
            expect(window.maxFeatherDeg)
              .withContext(`${window.maxFeatherDeg.toFixed(2)}° of fade into a ${arc.toFixed(2)}° arc`)
              .toBeLessThanOrEqual(Math.max(0.2, arc) + 1e-6);
          }
        });
      });
    }
  }

  // The point of routing is to walk around furniture. Tightening the rule must
  // not tighten it into a fixed midpoint cut — at the count the capture ships
  // with, nor at the one it can still be asked for on the URL.
  for (const count of [8, 12]) {
    it(`still leaves the cut room to dodge an object at ${count} shots`, () => {
      const windows = planSeamWindows(ring(count), ULTRAWIDE_HFOV);
      for (const window of windows) {
        expect(window.halfDeg)
          .withContext(`only ${window.halfDeg.toFixed(1)}° of freedom left`)
          .toBeGreaterThan(6);
      }
    });
  }

  /**
   * Why the ring stops at eight rather than climbing for less parallax: past
   * ten shots the arc floor, not the shared field, is what limits the cut, and
   * every extra shot from there buys parallax by spending routing freedom.
   */
  it('is limited by the overlap at eight shots and by the arc floor at twelve', () => {
    const eight = planSeamWindows(ring(8), ULTRAWIDE_HFOV);
    const twelve = planSeamWindows(ring(12), ULTRAWIDE_HFOV);
    expect(Math.min(...arcsOf(eight, 'in'))).toBeGreaterThan(SEAM_MIN_ARC_DEG + 1);
    expect(Math.min(...arcsOf(twelve, 'in'))).toBeCloseTo(SEAM_MIN_ARC_DEG, 6);
    expect(eight[0].halfDeg).toBeGreaterThan(twelve[0].halfDeg);
  });

  it('cuts down the middle when two frames barely share a field', () => {
    // Nearly no overlap: there is nothing to choose between, and nothing to
    // fade over either.
    const windows = planSeamWindows(ring(5), WIDE_HFOV);
    for (const window of windows) {
      expect(window.halfDeg).toBe(0);
      expect(window.maxFeatherDeg).toBeGreaterThan(0);
    }
  });

  /** Two shots almost on top of each other, which a retry can produce. */
  it('survives a ring where one pair is nearly coincident', () => {
    const longitudes = [0, 30, 60, 61, 120, 150, 180, 210, 240, 270, 300, 330];
    const windows = planSeamWindows(longitudes, ULTRAWIDE_HFOV);
    for (const window of windows) {
      expect(Number.isFinite(window.midYaw)).toBeTrue();
      expect(window.halfDeg).toBeGreaterThanOrEqual(0);
      expect(window.maxFeatherDeg).toBeGreaterThan(0);
    }
    // The frame with no room of its own cannot be given a fade wider than it is.
    const arcs = arcsOf(windows, 'in');
    windows.forEach((window, k) => {
      const tightest = Math.min(arcs[k], arcs[(k + 1) % windows.length]);
      if (tightest > 0.2) expect(window.maxFeatherDeg).toBeLessThanOrEqual(tightest + 1e-6);
    });
  });
});
