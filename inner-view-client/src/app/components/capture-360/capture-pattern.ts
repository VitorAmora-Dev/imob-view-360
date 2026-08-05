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
}

/**
 * Overlap kept between neighbours after worst-case aim drift. Small on
 * purpose: the stitch takes each pixel from a single frame, so redundancy buys
 * nothing beyond a safe seam and every extra shot is more work for the user.
 */
const MIN_OVERLAP_DEG = 6;

/** How far above and below the horizon the ring reaches, worst case. */
export function ringReachDeg(options: PatternOptions): number {
  return options.vfovDeg / 2 - options.centerToleranceDeg;
}

/** Number of shots needed to close the turn without leaving a vertical gap. */
export function ringShotCount(options: PatternOptions): number {
  const spacing = Math.max(10, options.hfovDeg - 2 * options.centerToleranceDeg - MIN_OVERLAP_DEG);
  return Math.max(3, Math.ceil(360 / spacing));
}

export function buildCapturePattern(options: PatternOptions): CaptureTarget[] {
  const count = ringShotCount(options);
  return Array.from({ length: count }, (_, i) => ({
    yawDeg: (i * 360) / count,
    pitchDeg: 0,
  }));
}
