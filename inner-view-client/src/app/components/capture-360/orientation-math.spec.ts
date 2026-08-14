import {
  directionForYawPitch,
  quaternionFromDeviceOrientation,
  quaternionFromYpr,
  toSessionFrame,
  wrapDeg180,
  yprFromQuaternion,
} from './orientation-math';

describe('orientation-math', () => {
  it('wraps angles to (-180, 180]', () => {
    expect(wrapDeg180(0)).toBe(0);
    expect(wrapDeg180(190)).toBe(-170);
    expect(wrapDeg180(-190)).toBe(170);
    expect(wrapDeg180(540)).toBe(180);
    expect(wrapDeg180(180)).toBe(180);
    expect(wrapDeg180(-180)).toBe(180);
  });

  it('round-trips yaw/pitch/roll through the quaternion', () => {
    for (const yaw of [-150, -90, -30, 0, 45, 120, 179]) {
      for (const pitch of [-60, -15, 0, 30, 60]) {
        for (const roll of [-40, 0, 25]) {
          const ypr = yprFromQuaternion(quaternionFromYpr(yaw, pitch, roll));
          expect(ypr.yawDeg).toBeCloseTo(yaw, 4);
          expect(ypr.pitchDeg).toBeCloseTo(pitch, 4);
          expect(ypr.rollDeg).toBeCloseTo(roll, 4);
        }
      }
    }
  });

  it('yaw 0 looks down -Z and yaw 90 looks down +X', () => {
    const front = directionForYawPitch(0, 0);
    expect(front.x).toBeCloseTo(0, 6);
    expect(front.z).toBeCloseTo(-1, 6);

    const right = directionForYawPitch(90, 0);
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.z).toBeCloseTo(0, 6);
  });

  it('re-zeroing shifts yaw only', () => {
    const q = quaternionFromYpr(72, 12, -5);
    const rel = yprFromQuaternion(toSessionFrame(q, 72));
    expect(rel.yawDeg).toBeCloseTo(0, 4);
    expect(rel.pitchDeg).toBeCloseTo(12, 4);
    expect(rel.rollDeg).toBeCloseTo(-5, 4);
  });

  describe('deviceorientation formula', () => {
    it('an upright phone points the rear camera at the horizon', () => {
      const ypr = yprFromQuaternion(quaternionFromDeviceOrientation(0, 90, 0, 0));
      expect(ypr.pitchDeg).toBeCloseTo(0, 3);
      expect(Math.abs(ypr.rollDeg)).toBeCloseTo(0, 3);
    });

    it('rotating the device counterclockwise (alpha+) turns the view left (yaw−)', () => {
      const at0 = yprFromQuaternion(quaternionFromDeviceOrientation(0, 90, 0, 0));
      const at30 = yprFromQuaternion(quaternionFromDeviceOrientation(30, 90, 0, 0));
      expect(wrapDeg180(at30.yawDeg - at0.yawDeg)).toBeCloseTo(-30, 3);
    });

    it('tilting the phone up raises pitch', () => {
      const ypr = yprFromQuaternion(quaternionFromDeviceOrientation(0, 110, 0, 0));
      expect(ypr.pitchDeg).toBeCloseTo(20, 3);
    });
  });
});
