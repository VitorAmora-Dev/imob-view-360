import * as THREE from 'three';
import {
  Ypr,
  quaternionFromDeviceOrientation,
  quaternionFromYpr,
  toSessionFrame,
  wrapDeg180,
  yprFromQuaternion,
} from './orientation-math';
import { SimEnvironment } from './sim-environment';

/**
 * The capture modal talks to a camera and an orientation sensor through these
 * two interfaces; the real pair uses getUserMedia + deviceorientation, and the
 * sim pair reads from a shared SimEnvironment so the exact same guidance and
 * stitching code runs on a desktop with no hardware.
 */
export interface CameraSpec {
  /**
   * Vertical FOV in degrees. Before the stitcher fits the real value this is
   * only a prior, and it is deliberately an UNDER-estimate: guessing narrow
   * yields extra overlap, which is harmless, while guessing wide leaves holes.
   */
  vfovDeg: number | null;
  /** Frame width/height ratio (< 1 in portrait). */
  frameAspect: number;
}

export interface LensOption {
  deviceId: string;
  label: string;
  /** Best guess from the (localised, unreliable) label — UI hint only. */
  kind: 'ultrawide' | 'wide' | 'tele' | 'unknown';
}

export interface CaptureCameraSource {
  start(): Promise<void>;
  attach(container: HTMLElement): void;
  /** Grabs the current frame, already downscaled and upright for stitching. */
  grabFrame(): HTMLCanvasElement;
  getSpec(): CameraSpec;
  /** Back cameras the browser exposed; empty when there is no choice to make. */
  lenses(): LensOption[];
  activeLensId(): string | null;
  switchLens(deviceId: string): Promise<void>;
  stop(): void;
}

export interface OrientationReading {
  /** Session-frame orientation (yaw 0 = where the session was re-zeroed). */
  q: THREE.Quaternion;
  ypr: Ypr;
}

export interface CaptureOrientationSource {
  /** iOS requires a user-gesture permission request; elsewhere resolves true. */
  requestPermission(): Promise<boolean>;
  start(): void;
  /** Makes the current heading yaw 0 for the rest of the session. */
  rezero(): void;
  /** Latest reading, or null while the sensor has not produced data yet. */
  sample(): OrientationReading | null;
  stop(): void;
}

/** Longest frame side kept for stitching. */
const MAX_FRAME_SIDE = 2048;

const LENS_PREFERENCE_KEY = 'capture360.lensId';

/**
 * Conservative priors, well under the real figures (~108° / ~69° in portrait
 * on an iPhone) because the stitcher fits the true value later and a narrow
 * guess only costs a little extra overlap.
 */
export const ULTRAWIDE_PRIOR_VFOV = 95;
export const WIDE_PRIOR_VFOV = 62;

/**
 * Labels are localised by iOS and Android, so this covers the common
 * spellings in the languages the app ships in. It only seeds the default
 * selection — geometry never trusts it, and the user can always switch.
 */
function classifyLens(label: string): LensOption['kind'] {
  const l = label.toLowerCase();
  if (/ultra|grande.?angular|gran.?angular|0[.,]5/.test(l)) return 'ultrawide';
  if (/tele|zoom|[23][.,]?[05]?x/.test(l)) return 'tele';
  if (/wide|larga|traseira|back|rear|posterior/.test(l)) return 'wide';
  return 'unknown';
}

export class RealCameraSource implements CaptureCameraSource {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private available: LensOption[] = [];
  private activeId: string | null = null;

  async start(): Promise<void> {
    // First stream doubles as the permission prompt: enumerateDevices only
    // reveals labels (and the extra back cameras) once access is granted.
    await this.open(undefined);
    await this.discoverLenses();

    const preferred = this.pickPreferredLens();
    if (preferred && preferred !== this.activeId) {
      await this.switchLens(preferred);
    }
  }

  private async open(deviceId: string | undefined): Promise<void> {
    const video: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: 'environment' } };
    // 4:3 is the sensor-native shape; in portrait it gives the widest vertical
    // field, which is the scarce resource for a panorama.
    video.width = { ideal: 2048 };
    video.height = { ideal: 1536 };
    video.aspectRatio = { ideal: 4 / 3 };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    this.activeId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? null;

    const el = this.video ?? document.createElement('video');
    el.playsInline = true;
    el.muted = true;
    el.autoplay = true;
    el.srcObject = stream;
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.objectFit = 'cover';
    this.video = el;

    await new Promise<void>((resolve, reject) => {
      if (el.readyState >= 1) return resolve();
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error('camera stream failed'));
    });
    await el.play();
  }

  private async discoverLenses(): Promise<void> {
    if (!navigator.mediaDevices.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.available = devices
      .filter((d) => d.kind === 'videoinput')
      .filter((d) => !/front|frontal|face|selfie/i.test(d.label))
      .map((d) => ({ deviceId: d.deviceId, label: d.label, kind: classifyLens(d.label) }));
  }

  private pickPreferredLens(): string | null {
    const remembered = localStorage.getItem(LENS_PREFERENCE_KEY);
    if (remembered && this.available.some((l) => l.deviceId === remembered)) return remembered;
    // Widest available is the right default for a single-ring capture.
    return this.available.find((l) => l.kind === 'ultrawide')?.deviceId ?? null;
  }

  lenses(): LensOption[] {
    return [...this.available];
  }

  activeLensId(): string | null {
    return this.activeId;
  }

  async switchLens(deviceId: string): Promise<void> {
    await this.open(deviceId);
    localStorage.setItem(LENS_PREFERENCE_KEY, deviceId);
  }

  attach(container: HTMLElement): void {
    if (this.video) container.appendChild(this.video);
  }

  grabFrame(): HTMLCanvasElement {
    const video = this.video!;
    const rotation = this.frameRotationDeg();
    const swap = rotation === 90 || rotation === 270;
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const outW = swap ? srcH : srcW;
    const outH = swap ? srcW : srcH;

    const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(outW, outH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(outW * scale);
    canvas.height = Math.round(outH * scale);

    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(video, -(srcW * scale) / 2, -(srcH * scale) / 2, srcW * scale, srcH * scale);
    return canvas;
  }

  /**
   * Some browsers hand over a landscape stream while the phone is held
   * upright. Left uncorrected the projection would place every frame on its
   * side, so the frame is rotated to match how the user is actually holding
   * the device before it reaches the stitcher.
   */
  private frameRotationDeg(): number {
    const video = this.video;
    if (!video || !video.videoHeight) return 0;
    const streamIsLandscape = video.videoWidth > video.videoHeight;
    const angle = (screen.orientation?.angle ?? 0) as number;
    const uiIsLandscape = angle === 90 || angle === 270;
    if (streamIsLandscape === uiIsLandscape) return 0;
    return 90;
  }

  getSpec(): CameraSpec {
    const rotation = this.frameRotationDeg();
    const swap = rotation === 90 || rotation === 270;
    const video = this.video;
    if (!video || !video.videoHeight) return { vfovDeg: WIDE_PRIOR_VFOV, frameAspect: 3 / 4 };

    const w = swap ? video.videoHeight : video.videoWidth;
    const h = swap ? video.videoWidth : video.videoHeight;
    const active = this.available.find((l) => l.deviceId === this.activeId);
    return {
      vfovDeg: active?.kind === 'ultrawide' ? ULTRAWIDE_PRIOR_VFOV : WIDE_PRIOR_VFOV,
      frameAspect: w / h,
    };
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video?.remove();
    this.video = null;
  }
}

interface DeviceOrientationEventStatic {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export class RealOrientationSource implements CaptureOrientationSource {
  private smoothed: THREE.Quaternion | null = null;
  private zeroYawDeg = 0;
  private hasReading = false;

  async requestPermission(): Promise<boolean> {
    const doe = DeviceOrientationEvent as unknown as DeviceOrientationEventStatic;
    if (typeof doe.requestPermission === 'function') {
      try {
        return (await doe.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  start(): void {
    // Plain `deviceorientation` is the gyro-fused RELATIVE stream on both
    // Android Chrome and iOS Safari — smooth and compass-jump free, which is
    // what a session-relative ring wants (absolute north is irrelevant here).
    window.addEventListener('deviceorientation', this.onOrientation);
  }

  rezero(): void {
    if (this.smoothed) {
      this.zeroYawDeg = yprFromQuaternion(this.smoothed).yawDeg;
    }
  }

  sample(): OrientationReading | null {
    if (!this.hasReading || !this.smoothed) return null;
    const q = toSessionFrame(this.smoothed.clone(), this.zeroYawDeg);
    return { q, ypr: yprFromQuaternion(q) };
  }

  stop(): void {
    window.removeEventListener('deviceorientation', this.onOrientation);
  }

  private readonly onOrientation = (event: DeviceOrientationEvent) => {
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    const screenAngle = (screen.orientation?.angle ?? 0) as number;
    const q = quaternionFromDeviceOrientation(event.alpha, event.beta, event.gamma, screenAngle);
    if (!this.smoothed) {
      this.smoothed = q;
    } else {
      // Low-pass against sensor jitter; ~60Hz events keep this responsive.
      this.smoothed.slerp(q, 0.35);
    }
    this.hasReading = true;
  };
}

export class SimCameraSource implements CaptureCameraSource {
  constructor(private readonly env: SimEnvironment) {}

  async start(): Promise<void> {
    this.env.start();
  }

  attach(container: HTMLElement): void {
    this.env.attach(container);
  }

  grabFrame(): HTMLCanvasElement {
    return this.env.grabFrame();
  }

  getSpec(): CameraSpec {
    // Reports the same conservative prior a real device would, so the FOV fit
    // is exercised rather than handed the answer.
    return {
      vfovDeg: this.env.priorVfovDeg,
      frameAspect: this.env.frameWidth / this.env.frameHeight,
    };
  }

  lenses(): LensOption[] {
    return this.env.lenses;
  }

  activeLensId(): string | null {
    return this.env.activeLensId;
  }

  async switchLens(deviceId: string): Promise<void> {
    this.env.switchLens(deviceId);
  }

  stop(): void {
    this.env.dispose();
  }
}

export class SimOrientationSource implements CaptureOrientationSource {
  private zeroYawDeg = 0;

  constructor(private readonly env: SimEnvironment) {}

  async requestPermission(): Promise<boolean> {
    return true;
  }

  start(): void {}

  rezero(): void {
    this.zeroYawDeg = this.env.yawDeg;
  }

  sample(): OrientationReading | null {
    const yawDeg = wrapDeg180(this.env.yawDeg - this.zeroYawDeg);
    const ypr: Ypr = { yawDeg, pitchDeg: this.env.pitchDeg, rollDeg: this.env.rollDeg };
    return { q: quaternionFromYpr(ypr.yawDeg, ypr.pitchDeg, ypr.rollDeg), ypr };
  }

  stop(): void {}
}
