import * as THREE from 'three';

/**
 * Shared orientation conventions for the guided 360° capture.
 *
 * World frame follows the panoramic viewer's Three.js scene: +Y up, and a
 * camera at identity looks down -Z. Angles exposed to the rest of the feature:
 *   yaw   — 0° at -Z, increases turning right (towards +X), wrapped to ±180°
 *   pitch — positive looking up
 *   roll  — 0° when the horizon is level; sign is locked by the round-trip
 *           spec, and every consumer derives it from the same quaternion.
 */
export interface Ypr {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

const DEG = Math.PI / 180;

/** Wraps any angle in degrees to the (-180, 180] interval. */
export function wrapDeg180(deg: number): number {
  const wrapped = ((deg % 360) + 540) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Builds the quaternion for a given yaw/pitch/roll in the world frame above. */
export function quaternionFromYpr(yawDeg: number, pitchDeg: number, rollDeg: number): THREE.Quaternion {
  // YXZ keeps yaw about world-Y, then pitch, then roll about the view axis.
  const euler = new THREE.Euler(pitchDeg * DEG, -yawDeg * DEG, -rollDeg * DEG, 'YXZ');
  return new THREE.Quaternion().setFromEuler(euler);
}

/** Inverse of quaternionFromYpr (away from pitch ±90°, which the ring never reaches). */
export function yprFromQuaternion(q: THREE.Quaternion): Ypr {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);

  const pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
  const yaw = Math.atan2(forward.x, -forward.z);
  const roll = -Math.atan2(right.y, up.y);

  return { yawDeg: yaw / DEG, pitchDeg: pitch / DEG, rollDeg: roll / DEG };
}

/** Unit direction for a point on the capture ring (used to project targets on screen). */
export function directionForYawPitch(yawDeg: number, pitchDeg: number): THREE.Vector3 {
  const yaw = yawDeg * DEG;
  const pitch = pitchDeg * DEG;
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
}

/**
 * Rotates a device quaternion into the session frame so that the heading the
 * user faced when the session started becomes yaw 0 (pitch/roll untouched).
 */
export function toSessionFrame(deviceQ: THREE.Quaternion, sessionZeroYawDeg: number): THREE.Quaternion {
  const undoYaw = quaternionFromYpr(-sessionZeroYawDeg, 0, 0);
  return undoYaw.multiply(deviceQ);
}

const SCREEN_TRANSFORM = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * W3C deviceorientation (alpha/beta/gamma, intrinsic ZXY) → world quaternion
 * for the REAR camera direction — the classic magic-window formula from
 * Three.js' retired DeviceOrientationControls. `screenAngleDeg` compensates
 * the UI rotation (screen.orientation.angle).
 */
export function quaternionFromDeviceOrientation(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
): THREE.Quaternion {
  const euler = new THREE.Euler(betaDeg * DEG, alphaDeg * DEG, -gammaDeg * DEG, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(euler);
  q.multiply(SCREEN_TRANSFORM);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -screenAngleDeg * DEG));
  return q;
}

/** Smallest rotation angle between two orientations, in degrees. */
export function angleBetweenDeg(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const dot = THREE.MathUtils.clamp(Math.abs(a.dot(b)), -1, 1);
  return (2 * Math.acos(dot)) / DEG;
}
