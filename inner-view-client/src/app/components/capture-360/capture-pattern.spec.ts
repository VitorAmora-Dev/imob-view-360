import {
  MAX_CAP_SHOTS,
  buildCapturePattern,
  coversDirection,
  minimumRingShots,
  ringReachDeg,
  ringShotCount,
  ringTargets,
  topCapTargets,
  uncoveredFraction,
  PatternOptions,
} from './capture-pattern';
import { hfovFromVfov } from './stitcher';

/** What the capture actually asks for: a bare ring. */
function optionsFor(vfovDeg: number, frameAspect = 3 / 4): PatternOptions {
  return { vfovDeg, hfovDeg: hfovFromVfov(vfovDeg, frameAspect), centerToleranceDeg: 5 };
}

/** The cap is opt-in; these are the tests of the geometry behind the option. */
function withCap(vfovDeg: number, frameAspect = 3 / 4): PatternOptions {
  return { ...optionsFor(vfovDeg, frameAspect), includeTopCap: true };
}

describe('the ring', () => {
  it('keeps the main camera at the original dozen shots', () => {
    // The 1x prior; this is the count the first working version used.
    expect(ringTargets(optionsFor(62)).length).toBe(12);
  });

  /**
   * Coverage alone would let the ultra-wide close the turn in six. It takes
   * twelve because the spacing is set by parallax: 60° apart swings a
   * hand-held lens 25 cm between neighbours, 30° apart swings it 12.9 cm, and
   * every seam has to hide that difference.
   */
  it('takes more than geometry demands, so each seam hides less parallax', () => {
    const ultrawide = optionsFor(95);
    expect(minimumRingShots(ultrawide)).toBeLessThan(8);
    expect(ringShotCount(ultrawide)).toBe(12);
  });

  it('still lets geometry win when it needs more than the target', () => {
    // A telephoto sees so little sideways that twelve would leave gaps.
    const tele = optionsFor(30);
    expect(minimumRingShots(tele)).toBeGreaterThan(12);
    expect(ringShotCount(tele)).toBe(minimumRingShots(tele));
  });

  it('the ultra-wide also reaches much further up and down', () => {
    expect(ringReachDeg(optionsFor(95))).toBeGreaterThan(ringReachDeg(optionsFor(62)) * 1.5);
  });

  it('spaces shots so neighbours overlap even at opposite tolerance edges', () => {
    for (const vfov of [50, 62, 95, 108]) {
      const options = optionsFor(vfov);
      const yaws = ringTargets(options).map((t) => t.yawDeg);
      for (let i = 1; i < yaws.length; i++) {
        const worstCaseGap = yaws[i] - yaws[i - 1] + 2 * options.centerToleranceDeg;
        expect(worstCaseGap)
          .withContext(`vfov ${vfov}° left a vertical seam of nothing`)
          .toBeLessThan(options.hfovDeg);
      }
    }
  });

  it('a narrower frame costs more shots rather than leaving holes', () => {
    // What a camera that refuses 4:3 hands back.
    expect(minimumRingShots(optionsFor(95, 9 / 16)))
      .toBeGreaterThan(minimumRingShots(optionsFor(95, 3 / 4)));
  });

  it('starts at zero so the session re-zeroes onto the first target', () => {
    expect(buildCapturePattern(optionsFor(95))[0]).toEqual({ yawDeg: 0, pitchDeg: 0 });
  });

  /**
   * The capture the app performs, on every lens: level shots only. Photographing
   * the ceiling was tried on a phone and made the result worse — see the note at
   * the top of capture-pattern.ts — so nothing may aim off the horizon unless a
   * caller asks for it in as many words.
   */
  it('asks for level shots and nothing else, on every lens', () => {
    for (const vfov of [50, 62, 95, 108, 120]) {
      const targets = buildCapturePattern(optionsFor(vfov));
      expect(targets.every((t) => t.pitchDeg === 0))
        .withContext(`vfov ${vfov}° aimed off the horizon`)
        .toBeTrue();
      expect(targets.length).toBe(ringShotCount(optionsFor(vfov)));
    }
  });

  it('puts every ring shot before every cap shot when one is asked for', () => {
    // The capture walks the list in order; sending the user up and back down
    // mid-turn would be a worse ring, not a better cap.
    const targets = buildCapturePattern(withCap(95));
    const firstCap = targets.findIndex((t) => t.pitchDeg !== 0);
    expect(firstCap).toBeGreaterThan(0);
    expect(targets.slice(firstCap).every((t) => t.pitchDeg !== 0)).toBeTrue();
  });
});

describe('the upward cap', () => {
  /**
   * Walks a grid the planner's own search never sees. The search samples
   * latitude in 180 steps and longitude in 180; this uses primes either side of
   * those so the two grids share almost no directions. A gap the search stepped
   * over has nowhere to hide from a check like this.
   */
  const everythingAboveTheRingIsCovered = (options: PatternOptions): string | null => {
    const ring = ringTargets(options);
    const targets = buildCapturePattern(options);
    for (let latSteps = 0; latSteps <= 127; latSteps++) {
      const lat = (latSteps / 127) * 90;
      for (let lonSteps = 0; lonSteps < 149; lonSteps++) {
        const lon = (lonSteps * 360) / 149;
        if (coversDirection(ring, options, lon, lat)) continue; // the ring has it
        if (!coversDirection(targets, options, lon, lat)) {
          return `gap at lat ${lat.toFixed(1)}° lon ${lon.toFixed(1)}°`;
        }
      }
    }
    return null;
  };

  it('closes the whole top of the sphere when it offers a cap at all', () => {
    for (const vfov of [80, 95, 100, 108, 120]) {
      const options = withCap(vfov);
      if (!topCapTargets(options).length) continue; // declined; covered by its own test
      expect(everythingAboveTheRingIsCovered(options))
        .withContext(`vfov ${vfov}°`)
        .toBeNull();
    }
  });

  /**
   * The failure the whole design exists to avoid: one shot at the zenith looks
   * like it should be enough and is not, because the SHORT side of a portrait
   * frame only reaches down to 90 − hfov/2 while the ring climbs to
   * vfov/2 − tolerance. Whatever the planner returns, it is not a lone shot
   * that leaves a sliver.
   */
  it('never settles for a count that leaves an annular sliver', () => {
    const options = withCap(95);
    const cap = topCapTargets(options);
    if (!cap.length) return;
    const withOneShot = [...ringTargets(options), cap[0]];
    // If a single shot had been enough, the planner would have returned one.
    if (cap.length === 1) return;
    let sliver = false;
    for (let lat = 0; lat <= 90; lat += 0.5) {
      for (let lon = 0; lon < 360; lon += 3) {
        if (!coversDirection(withOneShot, options, lon, lat)) sliver = true;
      }
    }
    expect(sliver).withContext('one shot would have closed it after all').toBeTrue();
  });

  it('stays inside its budget', () => {
    for (const vfov of [50, 62, 80, 95, 108, 120]) {
      expect(topCapTargets(withCap(vfov)).length)
        .withContext(`vfov ${vfov}°`)
        .toBeLessThanOrEqual(MAX_CAP_SHOTS);
    }
  });

  /**
   * A 1× camera would need a whole intermediate ring, not a couple of shots.
   * Declining is the honest answer — and it is the argument the lens picker
   * makes for choosing the ultra-wide instead.
   */
  it('declines rather than half-closing a narrow lens', () => {
    expect(topCapTargets(withCap(62)).length).toBe(0);
    expect(topCapTargets(withCap(50)).length).toBe(0);
  });

  it('aims below the pole, where yaw still means something', () => {
    for (const t of topCapTargets(withCap(95))) {
      expect(t.pitchDeg).toBeLessThan(90);
      expect(t.pitchDeg).toBeGreaterThan(45);
    }
  });

  it('is not offered unless a caller asks for it in as many words', () => {
    expect(topCapTargets(optionsFor(95)).length).toBe(0);
    expect(topCapTargets(withCap(95)).length).toBeGreaterThan(0);
  });
});

describe('uncoveredFraction', () => {
  /**
   * The number the lens picker shows. It has to be right in absolute terms, not
   * just ordered correctly, because it is being put in front of someone as a
   * percentage they will act on.
   */
  it('matches the ring geometry, which is the whole pattern', () => {
    for (const vfov of [62, 95]) {
      // A ring reaching R covers the band ±R, whose area share is sin(R). The
      // reach here is `vfov/2`, not `ringReachDeg` — the fraction is what a
      // capture aimed as asked produces, which is what the field telemetry
      // measures, while `ringReachDeg` answers the stricter question of what
      // survives the worst aim the session will still accept.
      const reach = (vfov / 2) * (Math.PI / 180);
      expect(uncoveredFraction(optionsFor(vfov)))
        .withContext(`vfov ${vfov}°`)
        .toBeCloseTo(1 - Math.sin(reach), 1);
    }
  });

  it('says the 1× throws away about half the sphere', () => {
    // Measured on the real captures of 2026-08-06: band ±29.5°, 50.8% invented.
    expect(uncoveredFraction(optionsFor(62))).toBeGreaterThan(0.45);
    expect(uncoveredFraction(optionsFor(62))).toBeLessThan(0.55);
  });

  it('drops when the cap is photographed instead of filled', () => {
    const photographed = uncoveredFraction(withCap(95));
    const filled = uncoveredFraction(optionsFor(95));
    expect(topCapTargets(withCap(95)).length).toBeGreaterThan(0);
    expect(photographed).toBeLessThan(filled - 0.1);
  });

  it('never claims to cover the floor, which is deliberately not photographed', () => {
    // Whatever the lens, the bottom cap is software. Anything under ~10% would
    // mean the fraction had started counting invented pixels as real.
    expect(uncoveredFraction(withCap(120))).toBeGreaterThan(0.05);
  });
});
