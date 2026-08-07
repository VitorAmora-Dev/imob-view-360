import { wrapDeg180 } from './orientation-math';
import { CaptureTarget } from './capture-pattern';

/**
 * Pure state machine for the guided capture (no DOM, no Three.js): feed it
 * timestamped orientation samples and it tells the UI where the next target
 * is, how far the dwell progressed and when to actually grab a frame.
 */
export interface CaptureTuning {
  /** How close (deg) the reticle must be to the target, in yaw and pitch. */
  centerToleranceDeg: number;
  /** How long the user holds the target before the frame is captured. */
  dwellMs: number;
  /** Above this angular speed the dwell will not start (avoids motion blur). */
  maxAngularVelocityDegS: number;
}

const DEG = Math.PI / 180;

/**
 * Angle between two aim directions, in degrees.
 *
 * Kept as plain trigonometry so this module stays free of Three.js: it is the
 * one piece of the capture that runs on every sensor event.
 */
export function separationDeg(
  a: { yawDeg: number; pitchDeg: number },
  b: { yawDeg: number; pitchDeg: number },
): number {
  const cos =
    Math.sin(a.pitchDeg * DEG) * Math.sin(b.pitchDeg * DEG) +
    Math.cos(a.pitchDeg * DEG) * Math.cos(b.pitchDeg * DEG) * Math.cos((a.yawDeg - b.yawDeg) * DEG);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

export const DEFAULT_TUNING: CaptureTuning = {
  centerToleranceDeg: 5,
  dwellMs: 2000,
  maxAngularVelocityDegS: 8,
};

export interface OrientationSample {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export type SessionEvent =
  | { type: 'capture'; targetIndex: number; target: CaptureTarget }
  | { type: 'complete' };

export interface SessionSnapshot {
  status: 'seeking' | 'dwelling' | 'complete';
  capturedCount: number;
  totalCount: number;
  /** The target currently being hunted. */
  currentTarget: CaptureTarget;
  /** Signed yaw distance reticle→target: positive = target is to the right. */
  offsetYawDeg: number;
  /** Signed pitch distance reticle→target: positive = target is above. */
  offsetPitchDeg: number;
  withinTolerance: boolean;
  steady: boolean;
  /** 0..1 while dwelling. */
  dwellProgress: number;
}

export class CaptureSession {
  private readonly tuning: CaptureTuning;
  private readonly targets: CaptureTarget[];
  private readonly initialTargets: CaptureTarget[];
  private captured = 0;
  private dwellStartMs: number | null = null;
  private lastSample: OrientationSample | null = null;
  private lastSampleMs = 0;
  private velocityDegS = 0;
  private snapshotState: SessionSnapshot;

  constructor(targets: CaptureTarget[], tuning: Partial<CaptureTuning> = {}) {
    if (targets.length === 0) throw new Error('capture session needs at least one target');
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
    this.targets = [...targets];
    this.initialTargets = [...targets];
    this.snapshotState = this.buildSnapshot({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  }

  get snapshot(): SessionSnapshot {
    return this.snapshotState;
  }

  get total(): number {
    return this.targets.length;
  }

  allTargets(): CaptureTarget[] {
    return [...this.targets];
  }

  reset(): void {
    this.captured = 0;
    this.dwellStartMs = null;
    this.lastSample = null;
    this.velocityDegS = 0;
    // A retry starts from the conservative plan again; the fit will re-run.
    this.targets.length = 0;
    this.targets.push(...this.initialTargets);
    this.snapshotState = this.buildSnapshot({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  }

  update(nowMs: number, sample: OrientationSample): SessionEvent[] {
    const events: SessionEvent[] = [];
    if (this.captured >= this.targets.length) {
      this.snapshotState = this.buildSnapshot(sample);
      return events;
    }

    this.trackVelocity(nowMs, sample);
    const snap = this.buildSnapshot(sample);

    if (snap.withinTolerance && snap.steady) {
      if (this.dwellStartMs === null) {
        this.dwellStartMs = nowMs;
      }
      if ((nowMs - this.dwellStartMs) / this.tuning.dwellMs >= 1) {
        events.push({ type: 'capture', targetIndex: this.captured, target: this.targets[this.captured] });
        this.captured += 1;
        this.dwellStartMs = null;
        if (this.captured >= this.targets.length) {
          events.push({ type: 'complete' });
        }
      }
    } else {
      // Drifted out mid-hold: the ring restarts from zero, like BANIB's loader.
      this.dwellStartMs = null;
    }

    this.snapshotState = this.buildSnapshot(sample, nowMs);
    return events;
  }

  private trackVelocity(nowMs: number, sample: OrientationSample): void {
    if (this.lastSample) {
      const dt = (nowMs - this.lastSampleMs) / 1000;
      if (dt > 0.001) {
        const dYaw = wrapDeg180(sample.yawDeg - this.lastSample.yawDeg);
        const dPitch = sample.pitchDeg - this.lastSample.pitchDeg;
        // Yaw sweeps a smaller arc near the poles; weighting by cos keeps the
        // steadiness test from rejecting a nearly still phone aimed upward.
        const cos = Math.cos((sample.pitchDeg * Math.PI) / 180);
        const speed = Math.hypot(dYaw * cos, dPitch) / dt;
        // Light smoothing so a single noisy sensor event does not cancel a dwell.
        this.velocityDegS = this.velocityDegS * 0.6 + speed * 0.4;
      }
    }
    this.lastSample = sample;
    this.lastSampleMs = nowMs;
  }

  private buildSnapshot(sample: OrientationSample, nowMs?: number): SessionSnapshot {
    const done = this.captured >= this.targets.length;
    const target = done ? this.targets[this.targets.length - 1] : this.targets[this.captured];

    const offsetYaw = wrapDeg180(target.yawDeg - sample.yawDeg);
    const offsetPitch = target.pitchDeg - sample.pitchDeg;

    // The tolerance is an ANGLE between two directions, not a box in yaw and
    // pitch. The two agree near the horizon, but yaw compresses towards the
    // poles: aiming at the cap's 70°, five degrees of yaw is only 5·cos(70°) =
    // 1.7° of real movement, so a box would quietly make the hardest shot of
    // the capture three times stricter than every other one. The steadiness
    // test above already carries the same cosine, for the same reason.
    const withinTolerance = separationDeg(target, sample) <= this.tuning.centerToleranceDeg;
    const steady = this.velocityDegS <= this.tuning.maxAngularVelocityDegS;
    const dwelling = this.dwellStartMs !== null && nowMs !== undefined;

    return {
      status: done ? 'complete' : dwelling ? 'dwelling' : 'seeking',
      capturedCount: this.captured,
      totalCount: this.targets.length,
      currentTarget: target,
      offsetYawDeg: offsetYaw,
      offsetPitchDeg: offsetPitch,
      withinTolerance,
      steady,
      dwellProgress: dwelling
        ? Math.min(1, (nowMs! - this.dwellStartMs!) / this.tuning.dwellMs)
        : 0,
    };
  }
}
