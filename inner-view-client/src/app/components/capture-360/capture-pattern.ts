/**
 * Aim points for the capture: a single ring at eye level, like the original
 * version of this feature.
 *
 * Full-sphere patterns (extra rings plus zenith/nadir caps) were tried and
 * removed. Closing the poles is geometrically possible, but only just: with a
 * phone's ultra-wide the sphere closes at ~108° of vertical field, and one
 * degree below that the planner had to add a whole pair of rings — twelve more
 * photos. Real captures landed on the wrong side of that edge and turned into
 * 20+ shot sessions, which is worse for the user than a blurred ceiling.
 *
 * So the ring covers ±(vfov/2) around the horizon, which is where the content
 * people actually look at, and whatever the shots miss above and below is
 * filled from the coverage mask at stitch time.
 */
export interface CaptureTarget {
  yawDeg: number;
  pitchDeg: number;
}

export interface PatternOptions {
  /** Vertical FOV of the frame, in degrees. */
  vfovDeg: number;
  /** Horizontal FOV of the frame, in degrees. */
  hfovDeg: number;
  /** Aim tolerance; shots must still overlap at opposite tolerance edges. */
  centerToleranceDeg: number;
  /** Overrides the default ring size; the geometric minimum still wins if larger. */
  targetShotCount?: number;
}

/** Overlap kept between neighbours after worst-case aim drift. */
const MIN_OVERLAP_DEG = 6;

/**
 * Shots around the ring, unless geometry demands more.
 *
 * This is deliberately well above the minimum that closes the turn, and the
 * reason is parallax rather than coverage. A hand turns about the wrist or the
 * body, so the lens swings on a radius of roughly 25 cm: between two shots
 * `θ` apart the camera moves `2·0.25·sin(θ/2)` metres, which displaces an
 * object at 1.5 m by that distance over its own range. At 60° apart (the six
 * shots the ultra-wide's geometry alone would ask for) that is 25 cm and a
 * 9.5° mismatch; at 30° it is 12.9 cm and 4.9°.
 *
 * Halving the spacing halves the error every seam has to hide, and leaves far
 * more overlap for the seam to be routed through. That trade only became worth
 * paying once the stitch stopped averaging overlapping frames — while it
 * averaged, extra overlap made things worse, which is why the count used to be
 * driven down to the minimum.
 */
export const TARGET_RING_SHOTS = 12;

/** How far above and below the horizon the ring reaches, worst case. */
export function ringReachDeg(options: PatternOptions): number {
  return options.vfovDeg / 2 - options.centerToleranceDeg;
}

/** Fewest shots that close the turn without leaving a vertical gap. */
export function minimumRingShots(options: PatternOptions): number {
  const spacing = Math.max(10, options.hfovDeg - 2 * options.centerToleranceDeg - MIN_OVERLAP_DEG);
  return Math.max(3, Math.ceil(360 / spacing));
}

/** Shots the capture will actually ask for. */
export function ringShotCount(options: PatternOptions): number {
  return Math.max(minimumRingShots(options), options.targetShotCount ?? TARGET_RING_SHOTS);
}

export function buildCapturePattern(options: PatternOptions): CaptureTarget[] {
  const count = ringShotCount(options);
  return Array.from({ length: count }, (_, i) => ({
    yawDeg: (i * 360) / count,
    pitchDeg: 0,
  }));
}
