import * as THREE from 'three';
import { directionForYawPitch, quaternionFromYpr } from './orientation-math';

/**
 * Aim points for the capture: a ring at eye level, and nothing else.
 *
 * The planner can also close the top of the sphere with real photographs, and
 * the geometry for it is here and tested — but it is OFF, because it was tried
 * on a phone and made the panorama worse rather than better. Photographing the
 * ceiling puts a frame metered for a lit ceiling next to frames metered for the
 * room, at the one place on the sphere where the ring has the least overlap to
 * hide the difference; a smooth invented cone turned out to read better than a
 * real ceiling with a boundary around it.
 *
 * That is a verdict on the JOIN, not on the idea, and the join is what this
 * round of work is about. So the code stays, with the measurement it earned —
 * three extra shots on an ultra-wide cut the invented share of the sphere from
 * 27% to 13% — and one flag decides whether it is used.
 *
 * The floor stays software-filled for a different and permanent reason: aiming
 * a phone straight down photographs the operator's own feet.
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
  /**
   * Close the top of the sphere with real photos where the lens allows it.
   * Opt-in: see the note at the top of this file for why the capture does not.
   */
  includeTopCap?: boolean;
}

const DEG = Math.PI / 180;

/** Overlap kept between neighbours after worst-case aim drift. */
const MIN_OVERLAP_DEG = 6;

/**
 * Shots around the ring, unless geometry demands more.
 *
 * This is deliberately well above the minimum that closes the turn, and the
 * reason is parallax rather than coverage. A hand turns about the wrist or the
 * body, so the lens swings on a radius of roughly 25 cm: between two shots
 * `t` apart the camera moves `2·0.25·sin(t/2)` metres, which displaces an
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

/**
 * How high the cap shots aim.
 *
 * Not 90°. At the pole yaw is degenerate, so the reticle and the direction
 * arrow lose their reference and `CaptureSession` measures a yaw offset that
 * swings wildly for a millimetre of hand movement. Aiming below the pole keeps
 * the guidance meaningful, and a frame this wide still covers the pole itself
 * comfortably.
 */
export const CAP_PITCH_DEG = 70;

/**
 * Most extra shots the cap may cost.
 *
 * Past this the lens is telling us something: a 1x camera would need a whole
 * intermediate ring to close the top, which is a different capture, not a
 * longer one.
 */
export const MAX_CAP_SHOTS = 3;

/** How far above and below the horizon the ring reaches, worst case. */
export function ringReachDeg(options: PatternOptions): number {
  return options.vfovDeg / 2 - options.centerToleranceDeg;
}

/** Fewest shots that close the turn without leaving a vertical gap. */
export function minimumRingShots(options: PatternOptions): number {
  const spacing = Math.max(10, options.hfovDeg - 2 * options.centerToleranceDeg - MIN_OVERLAP_DEG);
  return Math.max(3, Math.ceil(360 / spacing));
}

/** Shots the ring will actually ask for. */
export function ringShotCount(options: PatternOptions): number {
  return Math.max(minimumRingShots(options), options.targetShotCount ?? TARGET_RING_SHOTS);
}

export function ringTargets(options: PatternOptions): CaptureTarget[] {
  const count = ringShotCount(options);
  return Array.from({ length: count }, (_, i) => ({
    yawDeg: (i * 360) / count,
    pitchDeg: 0,
  }));
}

/* ------------------------------------------------------------------------- */
/* Coverage: the same projection the stitcher uses, asked as a yes/no          */
/* ------------------------------------------------------------------------- */

/**
 * Half-angles of the frame, at the aim the shot was asked for.
 *
 * Deliberately NOT eroded by the aim tolerance, and the asymmetry with
 * `minimumRingShots` — which does erode — is the point. A gap in the ring is a
 * vertical stripe of nothing down the middle of the panorama, so the ring is
 * planned for the worst aim the session will accept. A gap in the cap is a thin
 * annulus near the top, which `fillUncovered` absorbs exactly as it absorbs the
 * whole cap today. One degrades gracefully and the other does not.
 *
 * Insisting on the guarantee for the cap as well was measured, and it costs a
 * fourth shot on the ultra-wide: eroding 5° off both axes shrinks each shot's
 * azimuthal reach at the ring's edge from about 60° to about 49°, which is the
 * difference between three shots closing the top and four. Four is a longer
 * capture than was agreed, bought for a sliver that gets filled anyway.
 */
function frameTangents(options: PatternOptions): { tanH: number; tanV: number } {
  return {
    tanH: Math.tan(Math.max(1, options.hfovDeg / 2) * DEG),
    tanV: Math.tan(Math.max(1, options.vfovDeg / 2) * DEG),
  };
}

/** World to camera for a target, ready to be applied to many directions. */
function inverseOf(target: CaptureTarget): THREE.Quaternion {
  return quaternionFromYpr(target.yawDeg, target.pitchDeg, 0).invert();
}

/**
 * Whether a direction falls inside a shot's frame — the yes/no form of
 * `projectPixel` in the stitcher's shader, so planning and rendering agree on
 * what "covered" means.
 */
function seenBy(
  inverse: THREE.Quaternion,
  dir: THREE.Vector3,
  tanH: number,
  tanV: number,
  scratch: THREE.Vector3,
): boolean {
  scratch.copy(dir).applyQuaternion(inverse);
  if (scratch.z >= -1e-6) return false; // behind the camera
  const depth = -scratch.z;
  return Math.abs(scratch.x) <= tanH * depth && Math.abs(scratch.y) <= tanV * depth;
}

/**
 * Directions spread evenly over the sphere BY AREA, so counting them gives a
 * fraction rather than a number weighted towards the poles.
 */
function sampleDirections(
  latitudeSteps: number,
  longitudeSteps: number,
  minLatitudeDeg = -90,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < latitudeSteps; i++) {
    const sinLat = -1 + (2 * i + 1) / latitudeSteps;
    const latDeg = (Math.asin(sinLat) * 180) / Math.PI;
    if (latDeg < minLatitudeDeg) continue;
    for (let j = 0; j < longitudeSteps; j++) {
      out.push(directionForYawPitch((j * 360) / longitudeSteps, latDeg));
    }
  }
  return out;
}

/** True when at least one of the targets frames the direction. */
function coveredBy(
  inverses: THREE.Quaternion[],
  dir: THREE.Vector3,
  tanH: number,
  tanV: number,
  scratch: THREE.Vector3,
): boolean {
  for (const inverse of inverses) {
    if (seenBy(inverse, dir, tanH, tanV, scratch)) return true;
  }
  return false;
}

/**
 * Whether a pattern photographs a given direction.
 *
 * Exported because the planner's own search samples the sphere on one grid, and
 * a promise that a pattern closes the cap is only worth as much as a check on a
 * DIFFERENT grid — a search can only ever miss a gap its sampling stepped over.
 */
export function coversDirection(
  targets: CaptureTarget[],
  options: PatternOptions,
  yawDeg: number,
  pitchDeg: number,
): boolean {
  const { tanH, tanV } = frameTangents(options);
  return coveredBy(
    targets.map(inverseOf),
    directionForYawPitch(yawDeg, pitchDeg),
    tanH,
    tanV,
    new THREE.Vector3(),
  );
}

/* ------------------------------------------------------------------------- */
/* The upward cap                                                             */
/* ------------------------------------------------------------------------- */

/** Latitude resolution of the cap search; the gaps being hunted are narrow. */
const SEARCH_LATITUDE_STEPS = 180;
const SEARCH_LONGITUDE_STEPS = 180;

/**
 * Aim points that close the top of the sphere, or an empty list when this lens
 * cannot do it within `MAX_CAP_SHOTS`.
 *
 * A single shot straight up is not enough, and the reason is the shape of the
 * frame rather than its size: held in portrait and pointed at the zenith, the
 * SHORT side of the frame only reaches down to `90 - hfov/2` — about 51° on an
 * ultra-wide at 95° — while the ring only climbs to `vfov/2`, about 47°. That
 * leaves an annular sliver at four azimuths. Extra shots at different yaws
 * close it because each one's long axis lies across the previous one's short
 * axis.
 *
 * So the count is searched rather than assumed, against the same coverage test
 * the renderer will use.
 */
export function topCapTargets(options: PatternOptions): CaptureTarget[] {
  if (!options.includeTopCap) return [];

  const { tanH, tanV } = frameTangents(options);
  const ring = ringTargets(options).map(inverseOf);
  const scratch = new THREE.Vector3();

  // Everything the ring leaves above the horizon is the cap's problem.
  const orphans = sampleDirections(SEARCH_LATITUDE_STEPS, SEARCH_LONGITUDE_STEPS, 0).filter(
    (dir) => !coveredBy(ring, dir, tanH, tanV, scratch),
  );
  if (!orphans.length) return []; // the ring already reaches the pole

  for (let count = 1; count <= MAX_CAP_SHOTS; count++) {
    const cap = Array.from({ length: count }, (_, i) => ({
      yawDeg: (i * 360) / count,
      pitchDeg: CAP_PITCH_DEG,
    }));
    const inverses = cap.map(inverseOf);
    if (orphans.every((dir) => coveredBy(inverses, dir, tanH, tanV, scratch))) return cap;
  }
  return [];
}

export function buildCapturePattern(options: PatternOptions): CaptureTarget[] {
  return [...ringTargets(options), ...topCapTargets(options)];
}

/* ------------------------------------------------------------------------- */
/* What the pattern costs, in sphere                                          */
/* ------------------------------------------------------------------------- */

/** Coarser than the cap search: this feeds a rounded percentage on screen. */
const FRACTION_LATITUDE_STEPS = 60;
const FRACTION_LONGITUDE_STEPS = 120;

/**
 * Share of the sphere this pattern will NOT photograph, 0..1.
 *
 * The number the lens picker should be showing. "Reaches 42° above the horizon"
 * means nothing to someone choosing a camera; "31% of this panorama will be
 * filled in by software" is the same fact in the units of the decision, and the
 * gap between the two lenses is large enough to change the answer — roughly a
 * third against roughly a half.
 *
 * Computed at the aim the shots were asked for, which is what the stored
 * telemetry from real captures agrees with: the 1x captures of 2026-08-06 came
 * back with a band of ±29.5° against the ±31° this predicts, because the
 * operator aimed well inside the 5° the session allows.
 */
export function uncoveredFraction(options: PatternOptions): number {
  const { tanH, tanV } = frameTangents(options);
  const inverses = buildCapturePattern(options).map(inverseOf);
  const scratch = new THREE.Vector3();

  const directions = sampleDirections(FRACTION_LATITUDE_STEPS, FRACTION_LONGITUDE_STEPS);
  let missed = 0;
  for (const dir of directions) {
    if (!coveredBy(inverses, dir, tanH, tanV, scratch)) missed++;
  }
  return missed / directions.length;
}
