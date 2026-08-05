/**
 * Builds the set of aim points that close the full sphere for a given camera.
 *
 * The vertical field of view is the scarce resource: a ring shot at pitch 0
 * only reaches ±vfov/2, so how many rings (and whether caps are needed) falls
 * out of the lens. A true 108° ultra-wide closes the sphere with one ring plus
 * two caps; a narrower lens earns extra rings instead of leaving holes.
 */
export interface CaptureTarget {
  yawDeg: number;
  pitchDeg: number;
  /** Caps are aimed straight up/down, where yaw is meaningless. */
  kind: 'ring' | 'cap';
}

export interface PatternOptions {
  /** Vertical FOV of the frame, in degrees. */
  vfovDeg: number;
  /** Horizontal FOV of the frame, in degrees. */
  hfovDeg: number;
  /** Aim tolerance; shots must still overlap at opposite tolerance edges. */
  centerToleranceDeg: number;
}

/** Guaranteed overlap between neighbours after worst-case aim drift. */
const MIN_OVERLAP_DEG = 8;
/** Rings steeper than this are awkward to aim; caps take over beyond it. */
const MAX_RING_PITCH_DEG = 60;
/** Slack so a lens that only just closes the sphere is not pushed to an extra ring. */
const CLOSURE_GRACE_DEG = 1;

/** How far above/below its aim point a ring shot is guaranteed to reach. */
function ringReach(options: PatternOptions): number {
  return options.vfovDeg / 2 - options.centerToleranceDeg;
}

/**
 * How far from the pole a cap shot is guaranteed to reach. A frame aimed at
 * the pole covers a rectangle around it, so the guaranteed cone is set by the
 * frame's NARROW dimension — the horizontal one in portrait, not the vertical.
 */
function capReach(options: PatternOptions): number {
  return Math.min(options.hfovDeg, options.vfovDeg) / 2 - options.centerToleranceDeg;
}

/**
 * Angular spacing that keeps MIN_OVERLAP_DEG even when two neighbouring shots
 * drift to opposite edges of the tolerance.
 */
function spacingFor(fovDeg: number, toleranceDeg: number): number {
  return Math.max(10, fovDeg - 2 * toleranceDeg - MIN_OVERLAP_DEG);
}

/** Evenly spaced yaws covering the full turn, starting at 0. */
function ringYaws(options: PatternOptions, pitchDeg: number): number[] {
  // A ring at pitch p sweeps a smaller circle, so one frame spans more
  // longitude — divide by cos(p). Guarded so it cannot blow up near a pole.
  const widening = Math.min(3, 1 / Math.max(0.34, Math.cos((pitchDeg * Math.PI) / 180)));
  const spacing = spacingFor(options.hfovDeg, options.centerToleranceDeg) * widening;
  const count = Math.max(3, Math.ceil(360 / spacing));
  return Array.from({ length: count }, (_, i) => (i * 360) / count);
}

/**
 * Ring pitches, from the horizon outward, stopping as soon as the outermost
 * ring meets what the caps can reach.
 */
export function ringPitchesFor(options: PatternOptions): number[] {
  const reach = ringReach(options);
  const needed = Math.max(0, 90 - capReach(options) - reach - CLOSURE_GRACE_DEG);
  if (needed <= 0) return [0];

  const spacing = spacingFor(options.vfovDeg, options.centerToleranceDeg);
  const outermost = Math.min(MAX_RING_PITCH_DEG, needed);
  const steps = Math.max(1, Math.ceil(outermost / spacing));

  const pitches = [0];
  for (let i = 1; i <= steps; i++) {
    const p = (outermost * i) / steps;
    pitches.push(p, -p);
  }
  return pitches;
}

export function buildCapturePattern(options: PatternOptions): CaptureTarget[] {
  // Shoot the horizon ring first: it carries the content users actually look
  // at, so a session abandoned halfway still yields the useful band — and it
  // is the data the FOV fit needs before the rest of the plan is settled.
  const pitches = ringPitchesFor(options).sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
  return ringTargets(options, pitches).concat(capTargets(options, pitches));
}

/**
 * Re-plans what is left once the true FOV is known, keeping the rings already
 * shot. The initial plan is built from a deliberately conservative prior, so
 * this usually REMOVES work rather than adding it.
 */
export function buildRemainingPattern(options: PatternOptions, donePitches: number[]): CaptureTarget[] {
  const wanted = ringPitchesFor(options);
  const isDone = (p: number) => donePitches.some((d) => Math.abs(d - p) < 1);
  const todo = wanted.filter((p) => !isDone(p)).sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
  // Caps close whatever the full ring set — shot and pending — cannot reach.
  return ringTargets(options, todo).concat(capTargets(options, [...donePitches, ...wanted]));
}

function ringTargets(options: PatternOptions, pitches: number[]): CaptureTarget[] {
  const targets: CaptureTarget[] = [];
  for (const pitchDeg of pitches) {
    for (const yawDeg of ringYaws(options, pitchDeg)) {
      targets.push({ yawDeg, pitchDeg, kind: 'ring' });
    }
  }
  return targets;
}

function capTargets(options: PatternOptions, pitches: number[]): CaptureTarget[] {
  const outermost = Math.max(...pitches.map((p) => Math.abs(p)));
  if (outermost + ringReach(options) >= 90) return [];
  return [
    { yawDeg: 0, pitchDeg: 90, kind: 'cap' },
    { yawDeg: 0, pitchDeg: -90, kind: 'cap' },
  ];
}

/** True when the pattern's rings plus caps leave no gap. */
export function patternClosesSphere(targets: CaptureTarget[], options: PatternOptions): boolean {
  const reach = ringReach(options);
  const ringPitches = [...new Set(targets.filter((t) => t.kind === 'ring').map((t) => t.pitchDeg))]
    .sort((a, b) => a - b);
  if (ringPitches.length === 0) return false;

  // Vertical continuity between neighbouring rings.
  for (let i = 1; i < ringPitches.length; i++) {
    if (ringPitches[i] - ringPitches[i - 1] > 2 * reach) return false;
  }

  const top = Math.max(...ringPitches) + reach;
  const bottom = Math.min(...ringPitches) - reach;
  if (targets.some((t) => t.kind === 'cap')) {
    const fromPole = 90 - capReach(options) - CLOSURE_GRACE_DEG;
    return top >= fromPole && bottom <= -fromPole;
  }
  return top >= 90 && bottom <= -90;
}
