import {
  buildCapturePattern,
  minimumRingShots,
  ringReachDeg,
  ringShotCount,
  PatternOptions,
} from './capture-pattern';
import { hfovFromVfov } from './stitcher';

function optionsFor(vfovDeg: number, frameAspect = 3 / 4): PatternOptions {
  return { vfovDeg, hfovDeg: hfovFromVfov(vfovDeg, frameAspect), centerToleranceDeg: 5 };
}

describe('buildCapturePattern', () => {
  it('keeps the main camera at the original dozen shots', () => {
    // The 1x prior; this is the count the first working version used.
    expect(buildCapturePattern(optionsFor(62)).length).toBe(12);
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

  it('is a single ring at eye level — no caps, no extra rings', () => {
    for (const vfov of [50, 62, 95, 108]) {
      const targets = buildCapturePattern(optionsFor(vfov));
      expect(targets.every((t) => t.pitchDeg === 0))
        .withContext(`vfov ${vfov}° left the horizon`)
        .toBeTrue();
    }
  });

  it('spaces shots so neighbours overlap even at opposite tolerance edges', () => {
    for (const vfov of [50, 62, 95, 108]) {
      const options = optionsFor(vfov);
      const yaws = buildCapturePattern(options).map((t) => t.yawDeg);
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

  it('starts the ring at zero so the session re-zeroes onto the first target', () => {
    expect(buildCapturePattern(optionsFor(95))[0]).toEqual({ yawDeg: 0, pitchDeg: 0 });
  });
});
