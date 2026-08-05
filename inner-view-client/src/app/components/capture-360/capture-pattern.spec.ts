import { buildCapturePattern, patternClosesSphere, PatternOptions } from './capture-pattern';
import { hfovFromVfov } from './stitcher';

function optionsFor(vfovDeg: number, frameAspect = 1080 / 1440): PatternOptions {
  return { vfovDeg, hfovDeg: hfovFromVfov(vfovDeg, frameAspect), centerToleranceDeg: 5 };
}

describe('buildCapturePattern', () => {
  it('closes the sphere for lenses from narrow to ultra-wide', () => {
    for (const vfov of [50, 62, 69, 95, 108, 120]) {
      const options = optionsFor(vfov);
      const targets = buildCapturePattern(options);
      expect(patternClosesSphere(targets, options))
        .withContext(`vfov ${vfov}° left a gap`)
        .toBeTrue();
    }
  });

  it('an ultra-wide closes the sphere with one ring plus two caps', () => {
    const targets = buildCapturePattern(optionsFor(108));
    const ringPitches = new Set(targets.filter((t) => t.kind === 'ring').map((t) => t.pitchDeg));
    expect(ringPitches).toEqual(new Set([0]));
    expect(targets.filter((t) => t.kind === 'cap').length).toBe(2);
  });

  it('a narrow lens earns extra rings instead of leaving holes', () => {
    const wide = buildCapturePattern(optionsFor(108));
    const narrow = buildCapturePattern(optionsFor(50));
    const ringsOf = (ts: ReturnType<typeof buildCapturePattern>) =>
      new Set(ts.filter((t) => t.kind === 'ring').map((t) => t.pitchDeg)).size;
    expect(ringsOf(narrow)).toBeGreaterThan(ringsOf(wide));
    expect(narrow.length).toBeGreaterThan(wide.length);
  });

  it('keeps the ultra-wide capture at or below the v1 count of 12 shots', () => {
    // The whole point of the wider lens: full coverage for less user effort.
    expect(buildCapturePattern(optionsFor(108)).length).toBeLessThanOrEqual(12);
  });

  it('shoots the horizon ring first so an abandoned session still has the useful band', () => {
    const targets = buildCapturePattern(optionsFor(62));
    const firstRingPitch = targets[0].pitchDeg;
    expect(firstRingPitch).toBe(0);
    expect(targets[targets.length - 1].kind).toBe('cap');
  });

  it('caps are aimed straight up and straight down', () => {
    const caps = buildCapturePattern(optionsFor(95)).filter((t) => t.kind === 'cap');
    expect(caps.map((c) => c.pitchDeg).sort((a, b) => a - b)).toEqual([-90, 90]);
  });

  it('spaces ring shots so neighbours always overlap', () => {
    const options = optionsFor(108);
    const yaws = buildCapturePattern(options)
      .filter((t) => t.kind === 'ring' && t.pitchDeg === 0)
      .map((t) => t.yawDeg)
      .sort((a, b) => a - b);

    for (let i = 1; i < yaws.length; i++) {
      // Even if both neighbours drift to opposite tolerance edges, they must
      // still share image; otherwise the panorama gets a vertical seam of nothing.
      const worstCaseGap = yaws[i] - yaws[i - 1] + 2 * options.centerToleranceDeg;
      expect(worstCaseGap).toBeLessThan(options.hfovDeg);
    }
  });
});
