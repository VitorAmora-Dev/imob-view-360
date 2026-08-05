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
  /** Vertical FOV in degrees, or null when unknown (real phones don't expose it). */
  vfovDeg: number | null;
  /** Frame width/height ratio (< 1 in portrait). */
  frameAspect: number;
}

export interface CaptureCameraSource {
  start(): Promise<void>;
  attach(container: HTMLElement): void;
  /** Grabs the current frame, already downscaled for stitching. */
  grabFrame(): HTMLCanvasElement;
  getSpec(): CameraSpec;
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

/** Longest frame side kept for stitching — plenty for a 4096×2048 output. */
const MAX_FRAME_SIDE = 1536;

export class RealCameraSource implements CaptureCameraSource {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  async start(): Promise<void> {
    // 4:3 preferred: it is the sensor-native shape and its wider portrait FOV
    // keeps the ring at the default 12 targets.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 2048 },
        height: { ideal: 1536 },
        aspectRatio: { ideal: 4 / 3 },
      },
    });

    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.srcObject = this.stream;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    this.video = video;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('camera stream failed'));
    });
    await video.play();
  }

  attach(container: HTMLElement): void {
    if (this.video) container.appendChild(this.video);
  }

  grabFrame(): HTMLCanvasElement {
    const video = this.video!;
    const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  getSpec(): CameraSpec {
    const video = this.video;
    return {
      vfovDeg: null,
      frameAspect: video && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 3 / 4,
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
    return { vfovDeg: this.env.vfovDeg, frameAspect: this.env.frameWidth / this.env.frameHeight };
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
