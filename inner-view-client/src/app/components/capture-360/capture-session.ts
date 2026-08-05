import { wrapDeg180 } from './orientation-math';

/**
 * Pure state machine for the guided ring capture (no DOM, no Three.js):
 * feed it timestamped orientation samples and it tells the UI where the next
 * target is, how far the dwell progressed and when to actually grab a frame.
 */
export interface CaptureTuning {
  /** Yellow dots on the ring. Derived from the camera FOV; 12 is the default. */
  targetCount: number;
  /** How close (deg) the reticle must be to the target, in yaw and pitch. */
  centerToleranceDeg: number;
  /** How level the phone must be (pitch of the ring is 0°). */
  pitchToleranceDeg: number;
  /** How long the user holds the target before the frame is captured. */
  dwellMs: number;
  /** Above this angular speed the dwell will not start (avoids motion blur). */
  maxAngularVelocityDegS: number;
}

export const DEFAULT_TUNING: CaptureTuning = {
  targetCount: 12,
  centerToleranceDeg: 5,
  pitchToleranceDeg: 7,
  dwellMs: 2000,
  maxAngularVelocityDegS: 8,
};

/**
 * Targets must overlap even when both neighbouring shots drift to opposite
 * tolerance edges, or the panorama gets a hole: spacing ≤ hfov − 2·tol − margin.
 */
export function targetCountForHfov(hfovDeg: number, tuning: Pick<CaptureTuning, 'centerToleranceDeg'>): number {
  const minOverlapDeg = 4;
  const usable = Math.max(10, hfovDeg - 2 * tuning.centerToleranceDeg - minOverlapDeg);
  return Math.max(12, Math.ceil(360 / usable));
}

export interface OrientationSample {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export type SessionEvent =
  | { type: 'capture'; targetIndex: number; targetYawDeg: number }
  | { type: 'complete' };

export interface SessionSnapshot {
  status: 'seeking' | 'dwelling' | 'complete';
  capturedCount: number;
  totalCount: number;
  /** Yaw of the target currently being hunted (session frame). */
  currentTargetYawDeg: number;
  /** Signed yaw distance reticle→target: positive = target is to the right. */
  offsetYawDeg: number;
  /** Signed pitch distance reticle→ring (ring sits at pitch 0). */
  offsetPitchDeg: number;
  withinTolerance: boolean;
  steady: boolean;
  levelOk: boolean;
  /** 0..1 while dwelling. */
  dwellProgress: number;
}

export class CaptureSession {
  private readonly tuning: CaptureTuning;
  private readonly targets: number[];
  private captured = 0;
  private dwellStartMs: number | null = null;
  private lastSample: OrientationSample | null = null;
  private lastSampleMs = 0;
  private velocityDegS = 0;
  private snapshotState: SessionSnapshot;

  constructor(tuning: Partial<CaptureTuning> = {}) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
    const spacing = 360 / this.tuning.targetCount;
    this.targets = Array.from({ length: this.tuning.targetCount }, (_, i) => wrapDeg180(i * spacing));
    this.snapshotState = this.buildSnapshot({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  }

  get snapshot(): SessionSnapshot {
    return this.snapshotState;
  }

  targetYaws(): number[] {
    return [...this.targets];
  }

  reset(): void {
    this.captured = 0;
    this.dwellStartMs = null;
    this.lastSample = null;
    this.velocityDegS = 0;
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

    if (snap.withinTolerance && snap.steady && snap.levelOk) {
      if (this.dwellStartMs === null) {
        this.dwellStartMs = nowMs;
      }
      const progress = (nowMs - this.dwellStartMs) / this.tuning.dwellMs;
      if (progress >= 1) {
        events.push({ type: 'capture', targetIndex: this.captured, targetYawDeg: this.targets[this.captured] });
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
        const speed = Math.hypot(dYaw, dPitch) / dt;
        // Light smoothing so a single noisy sensor event does not cancel a dwell.
        this.velocityDegS = this.velocityDegS * 0.6 + speed * 0.4;
      }
    }
    this.lastSample = sample;
    this.lastSampleMs = nowMs;
  }

  private buildSnapshot(sample: OrientationSample, nowMs?: number): SessionSnapshot {
    const done = this.captured >= this.targets.length;
    const targetYaw = done ? this.targets[this.targets.length - 1] : this.targets[this.captured];
    const offsetYaw = wrapDeg180(targetYaw - sample.yawDeg);
    const offsetPitch = -sample.pitchDeg;
    const withinTolerance =
      Math.abs(offsetYaw) <= this.tuning.centerToleranceDeg &&
      Math.abs(sample.pitchDeg) <= this.tuning.centerToleranceDeg;
    const levelOk = Math.abs(sample.pitchDeg) <= this.tuning.pitchToleranceDeg;
    const steady = this.velocityDegS <= this.tuning.maxAngularVelocityDegS;
    const dwelling = this.dwellStartMs !== null && nowMs !== undefined;

    return {
      status: done ? 'complete' : dwelling ? 'dwelling' : 'seeking',
      capturedCount: this.captured,
      totalCount: this.targets.length,
      currentTargetYawDeg: targetYaw,
      offsetYawDeg: offsetYaw,
      offsetPitchDeg: offsetPitch,
      withinTolerance,
      steady,
      levelOk,
      dwellProgress: dwelling
        ? Math.min(1, (nowMs! - this.dwellStartMs!) / this.tuning.dwellMs)
        : 0,
    };
  }
}
