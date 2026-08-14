import * as THREE from 'three';
import {
  FIT_PRIOR_TOLERANCE_DOWN,
  FIT_PRIOR_TOLERANCE_UP,
  fitVerticalFov,
  fitVignette,
  hfovFromVfov,
  matchCapGains,
  percentileOf,
  solveRingLevels,
} from './stitcher';
import { quaternionFromYpr } from './orientation-math';

/**
 * The three pieces of new arithmetic behind v5, exercised on synthetic input
 * where the right answer is known: the FOV fit that stopped confusing parallax
 * with a narrow lens, the ring solve that makes the exposure corrections
 * mutually consistent, and the vignette regression that lets the seam match at
 * the frame edge instead of only on average.
 */

const NDC_SAMPLES = 512;
const RING_SHOTS = 12;
const SPACING_DEG = 360 / RING_SHOTS;
const PORTRAIT = 3 / 4;

/** Non-periodic brightness around the horizon, wrapping cleanly at 360°. */
function sceneSampler(seed: number, controlPoints = 180): (worldDeg: number) => number {
  const values: number[] = [];
  let s = seed;
  for (let i = 0; i < controlPoints; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    values.push(45 + (s / 2147483648) * 170);
  }
  return (worldDeg: number) => {
    const t = ((((worldDeg % 360) + 360) % 360) / 360) * controlPoints;
    const i = Math.floor(t);
    const f = t - i;
    const a = values[i % controlPoints];
    const b = values[(i + 1) % controlPoints];
    return a + (b - a) * (f * f * (3 - 2 * f));
  };
}

function profileOf(luma: Float32Array) {
  return { luma, channels: [luma, luma, luma] as [Float32Array, Float32Array, Float32Array] };
}

/** A shot the FOV fit can read: it only ever looks at `ypr`. */
function ringShot(yawDeg: number) {
  return {
    frame: {
      blob: new Blob(),
      thumbnail: document.createElement('canvas'),
      width: 3,
      height: 4,
    },
    q: new THREE.Quaternion(),
    ypr: { yawDeg, pitchDeg: 0, rollDeg: 0 },
    gain: new THREE.Vector3(1, 1, 1),
    hfovDeg: 0,
    vfovDeg: 0,
  };
}

/** Frame-space luminance for one shot: sample the scene through the lens. */
function frameLuma(
  yawDeg: number,
  hfovTrueDeg: number,
  sample: (worldDeg: number) => number,
): Float32Array {
  const luma = new Float32Array(NDC_SAMPLES);
  const tanHalf = Math.tan((hfovTrueDeg * Math.PI) / 360);
  for (let j = 0; j < NDC_SAMPLES; j++) {
    const ndc = (j / (NDC_SAMPLES - 1)) * 2 - 1;
    const view = (Math.atan(ndc * tanHalf) * 180) / Math.PI;
    luma[j] = sample(yawDeg + view);
  }
  return luma;
}

describe('percentileOf', () => {
  it('reads a rank rather than a middle', () => {
    expect(percentileOf([5, 1, 3, 9], 0)).toBe(1);
    expect(percentileOf([5, 1, 3, 9], 1)).toBe(9);
  });

  it('leans to the low end, which is where the far field sits', () => {
    // Five segments: one looking at a distant wall, four at near furniture.
    expect(percentileOf([30, 36, 37, 38, 39], 0.25)).toBe(36);
    expect(percentileOf([30, 36, 37, 38, 39], 0.5)).toBe(37);
  });

  it('survives a single sample and an empty one', () => {
    expect(percentileOf([7], 0.25)).toBe(7);
    expect(percentileOf([], 0.5)).toBe(0);
  });
});

describe('fitVerticalFov', () => {
  const hfovTrue = 78;
  const vfovTrue = (2 * Math.atan(Math.tan((hfovTrue * Math.PI) / 360) / PORTRAIT) * 180) / Math.PI;
  const PRIOR = 95;

  /**
   * Near objects are displaced by more than the rotation between two shots, and
   * always in the same direction, so the contamination is bias and not noise.
   * Modelled here as a ramp: content inside the "near" world bands slides by a
   * further `parallaxDeg` on every shot, which makes every neighbouring pair
   * disagree by exactly that much. That is the pessimistic shape — the real
   * swing is sinusoidal around the ring and partly cancels.
   */
  const buildRing = (parallaxDeg: number) => {
    const sample = sceneSampler(20260806);
    const near = (worldDeg: number) => Math.floor((((worldDeg % 360) + 360) % 360) / 30) % 2 === 0;

    const shots = Array.from({ length: RING_SHOTS }, (_, i) => ringShot(i * SPACING_DEG));
    const profiles = shots.map((_, i) =>
      profileOf(
        frameLuma(i * SPACING_DEG, hfovTrue, (worldDeg) =>
          sample(near(worldDeg) ? worldDeg + i * parallaxDeg : worldDeg),
        ),
      ),
    );
    return { shots, profiles };
  };

  it('recovers the lens when there is no parallax to confuse it', () => {
    const { shots, profiles } = buildRing(0);
    const fitted = fitVerticalFov(shots, profiles, PORTRAIT, PRIOR);
    expect(Math.abs(fitted - vfovTrue))
      .withContext(`fitted ${fitted.toFixed(1)}°, true ${vfovTrue.toFixed(1)}°`)
      .toBeLessThan(3);
  });

  /**
   * The defect this release exists for. With 6° of extra displacement on the
   * near half of the scene, the old fit read "the lens must be narrower" and
   * shrank 95° to about 65°, leaving nearly half the sphere for the fill to
   * invent. Measuring per segment and taking the low rank reads the far field
   * instead, which is the only content moving by rotation alone.
   */
  it('is not dragged down by parallax on the near half of the scene', () => {
    const { shots, profiles } = buildRing(6);
    const fitted = fitVerticalFov(shots, profiles, PORTRAIT, PRIOR);
    expect(Math.abs(fitted - vfovTrue))
      .withContext(`fitted ${fitted.toFixed(1)}°, true ${vfovTrue.toFixed(1)}°`)
      .toBeLessThan(5);
  });

  it('never leaves the prior, whatever the images say', () => {
    // Independent noise per frame: nothing correlates, so the objective is
    // meaningless and the only thing keeping the answer sane is the bound.
    const shots = Array.from({ length: RING_SHOTS }, (_, i) => ringShot(i * SPACING_DEG));
    const profiles = shots.map((_, i) =>
      profileOf(frameLuma(0, hfovTrue, sceneSampler(1000 + i * 7919))),
    );

    const fitted = fitVerticalFov(shots, profiles, PORTRAIT, PRIOR);
    expect(fitted).toBeGreaterThanOrEqual(PRIOR * (1 - FIT_PRIOR_TOLERANCE_DOWN) - 1e-6);
    expect(fitted).toBeLessThanOrEqual(PRIOR * (1 + FIT_PRIOR_TOLERANCE_UP) + 1e-6);
  });

  /**
   * The simulated ultra-wide is 108° behind a 95° prior, which is the real
   * relationship: the priors under-state on purpose. A symmetric bound would
   * land on 109.25° and cap the right answer by a hair, so the room to grow has
   * to be wider than the room to shrink.
   */
  it('can still reach a lens wider than its prior expected', () => {
    expect(95 * (1 + FIT_PRIOR_TOLERANCE_UP)).toBeGreaterThan(108);
    expect(62 * (1 + FIT_PRIOR_TOLERANCE_UP)).toBeGreaterThan(69);
  });

  it('returns the prior untouched when there is no ring to measure', () => {
    const shots = [ringShot(0), ringShot(30)];
    const profiles = shots.map(() => profileOf(new Float32Array(NDC_SAMPLES).fill(100)));
    expect(fitVerticalFov(shots, profiles, PORTRAIT, 95)).toBe(95);
  });
});

describe('solveRingLevels', () => {
  /** Rebuild the per-edge differences the solver is given from known levels. */
  const deltasFrom = (levels: number[]) =>
    levels.map((value, k) => value - levels[(k + 1) % levels.length]);

  it('recovers levels that are consistent all the way round', () => {
    const truth = [0.3, -0.1, -0.25, 0.4, -0.35, 0];
    const centred = truth.map((v) => v - truth.reduce((a, b) => a + b, 0) / truth.length);
    const solved = solveRingLevels(deltasFrom(centred));
    solved.forEach((v, i) => expect(v).toBeCloseTo(centred[i], 6));
  });

  /**
   * The reason the old code left a visible step at one join. Walking a ring
   * accumulates whatever the measurements disagree about, and it all lands at
   * the point where the walk closes. Spreading it means every seam carries a
   * twelfth of the discrepancy instead of one seam carrying all of it.
   */
  it('spreads the closure error instead of dumping it on the last join', () => {
    const n = 12;
    const bias = 0.12; // every edge over-reports by the same amount
    const solved = solveRingLevels(new Array(n).fill(bias));

    const steps = solved.map((v, k) => Math.abs(v - solved[(k + 1) % n]));
    const worst = Math.max(...steps);
    expect(worst)
      .withContext(`worst join ${worst.toFixed(4)} against a total of ${(bias * n).toFixed(2)}`)
      .toBeLessThan(1e-9);
  });

  it('leaves the overall exposure alone', () => {
    const solved = solveRingLevels([0.4, -0.2, 0.05, 0.1, -0.3, 0.2]);
    expect(solved.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
  });

  it('survives an empty ring', () => {
    expect(solveRingLevels([])).toEqual([]);
  });
});

describe('fitVignette', () => {
  const hfov = 78;
  const PROFILE_STEP_DEG = 0.25;

  /**
   * Overlap window in frame-A angular samples, matching what `correlatePair`
   * reports for a pair this far apart.
   */
  const overlapFor = (recordedDeg: number, samples: number): [number, number] => {
    const startDeg = Math.max(-hfov / 2, recordedDeg - hfov / 2);
    return [Math.round((startDeg + hfov / 2) / PROFILE_STEP_DEG), samples];
  };

  /**
   * Two neighbours of the same wall, each darkened by `V(r) = 1 + a·r²` at its
   * own radius and lit by its own automatic exposure. The falloff has to come
   * back out of the pair even though the exposure difference is larger than it.
   */
  const ringWithFalloff = (a: number) => {
    const sample = sceneSampler(4242);
    const shots = Array.from({ length: RING_SHOTS }, (_, i) => ringShot(i * SPACING_DEG));

    const profiles = shots.map((_, i) => {
      const luma = new Float32Array(NDC_SAMPLES);
      const tanHalf = Math.tan((hfov * Math.PI) / 360);
      const exposure = 1 + 0.25 * Math.sin((i / RING_SHOTS) * Math.PI * 2);
      for (let j = 0; j < NDC_SAMPLES; j++) {
        const ndc = (j / (NDC_SAMPLES - 1)) * 2 - 1;
        const view = (Math.atan(ndc * tanHalf) * 180) / Math.PI;
        luma[j] = sample(i * SPACING_DEG + view) * (1 + a * ndc * ndc) * exposure;
      }
      return profileOf(luma);
    });

    const samples = Math.round(hfov / PROFILE_STEP_DEG);
    const pairs = shots.map((_, i) => ({
      a: i,
      b: (i + 1) % RING_SHOTS,
      recordedDeg: SPACING_DEG,
    }));
    const measured = pairs.map(() => ({
      measuredDeg: SPACING_DEG,
      confident: true,
      overlapA: overlapFor(SPACING_DEG, samples),
      overlapB: [0, samples] as [number, number],
    }));

    return { profiles, pairs, measured };
  };

  it('recovers a known falloff through a larger exposure swing', () => {
    const { profiles, pairs, measured } = ringWithFalloff(-0.35);
    const fitted = fitVignette(profiles, pairs, measured, hfov);
    expect(fitted).withContext(`fitted ${fitted.toFixed(3)}`).toBeCloseTo(-0.35, 1);
  });

  it('reports no falloff for a lens that has none', () => {
    const { profiles, pairs, measured } = ringWithFalloff(0);
    expect(Math.abs(fitVignette(profiles, pairs, measured, hfov))).toBeLessThan(0.03);
  });

  /** Brightening the edges is not a thing lenses do; a fit that says so is wrong. */
  it('never returns a falloff that brightens the edges', () => {
    const { profiles, pairs, measured } = ringWithFalloff(0.4);
    expect(fitVignette(profiles, pairs, measured, hfov)).toBeLessThanOrEqual(0);
  });

  it('stays out of the way when nothing could be measured', () => {
    const { profiles, pairs, measured } = ringWithFalloff(-0.3);
    const blind = measured.map((m) => ({ ...m, confident: false }));
    expect(fitVignette(profiles, pairs, blind, hfov)).toBe(0);
  });
});

describe('matchCapGains', () => {
  const VFOV = 95;
  const HFOV = hfovFromVfov(VFOV, PORTRAIT);

  /** A shot whose frame is a single flat colour, so brightness is unambiguous. */
  function flatShot(yawDeg: number, pitchDeg: number, level: number) {
    const thumbnail = document.createElement('canvas');
    thumbnail.width = 64;
    thumbnail.height = 86;
    const ctx = thumbnail.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = `rgb(${level}, ${level}, ${level})`;
    ctx.fillRect(0, 0, thumbnail.width, thumbnail.height);

    const q = quaternionFromYpr(yawDeg, pitchDeg, 0);
    return {
      frame: { blob: new Blob(), thumbnail, width: 64, height: 86 },
      q,
      ypr: { yawDeg, pitchDeg, rollDeg: 0 },
      gain: new THREE.Vector3(1, 1, 1),
      hfovDeg: HFOV,
      vfovDeg: VFOV,
    };
  }

  /** Twelve level shots already on a common scale, plus one aimed upward. */
  function ringAndCap(capLevel: number, ringLevel = 120) {
    const shots = [
      ...Array.from({ length: RING_SHOTS }, (_, i) =>
        flatShot(i * SPACING_DEG, 0, ringLevel),
      ),
      flatShot(0, 70, capLevel),
    ];
    const gainOf = new Map<number, THREE.Vector3>();
    for (let i = 0; i < RING_SHOTS; i++) gainOf.set(i, new THREE.Vector3(1, 1, 1));
    return { shots, gainOf };
  }

  /**
   * The defect this exists to prevent. Pointing a phone at a lit ceiling
   * re-meters it, so the cap arrives on a different exposure from everything
   * else on the sphere — and with no cycle of its own it cannot join the ring
   * solve. Left alone it would keep gain 1 and read as a bright disc overhead.
   */
  it('pulls an over-exposed ceiling shot back onto the ring', () => {
    const { shots, gainOf } = ringAndCap(180);
    matchCapGains(shots, gainOf, 0);

    const cap = gainOf.get(RING_SHOTS);
    expect(cap).withContext('cap shot got no gain at all').toBeDefined();
    expect(cap!.x).toBeCloseTo(120 / 180, 2);
  });

  it('lifts an under-exposed one just the same', () => {
    const { shots, gainOf } = ringAndCap(80);
    matchCapGains(shots, gainOf, 0);
    expect(gainOf.get(RING_SHOTS)!.y).toBeCloseTo(120 / 80, 2);
  });

  it('leaves a cap that already matches alone', () => {
    const { shots, gainOf } = ringAndCap(120);
    matchCapGains(shots, gainOf, 0);
    expect(gainOf.get(RING_SHOTS)!.z).toBeCloseTo(1, 2);
  });

  /** The ring's own gains are the scale; a cap has to be hung off them, not off raw pixels. */
  it('measures against the ring after correction, not before', () => {
    const { shots, gainOf } = ringAndCap(120);
    // The ring was solved to half brightness; the cap must follow it there.
    for (let i = 0; i < RING_SHOTS; i++) gainOf.set(i, new THREE.Vector3(0.5, 0.5, 0.5));
    matchCapGains(shots, gainOf, 0);
    expect(gainOf.get(RING_SHOTS)!.x).toBeCloseTo(0.5, 2);
  });

  it('does nothing when there is no cap to correct', () => {
    const shots = Array.from({ length: RING_SHOTS }, (_, i) => flatShot(i * SPACING_DEG, 0, 120));
    const gainOf = new Map<number, THREE.Vector3>();
    for (let i = 0; i < RING_SHOTS; i++) gainOf.set(i, new THREE.Vector3(1, 1, 1));
    matchCapGains(shots, gainOf, 0);
    expect(gainOf.size).toBe(RING_SHOTS);
  });
});

describe('hfovFromVfov', () => {
  it('keeps the long side long on a portrait frame', () => {
    expect(hfovFromVfov(95, PORTRAIT)).toBeLessThan(95);
    expect(hfovFromVfov(95, PORTRAIT)).toBeGreaterThan(60);
  });
});
