import * as THREE from 'three';
import { directionForYawPitch, quaternionFromYpr } from './orientation-math';
import { SimRoom, buildSimRoom } from './sim-room';
import type { LensOption } from './capture-sources';

/**
 * Desktop stand-in for phone + room. It renders a room WITH DEPTH, from a
 * camera that can be offset from the rotation axis — because the previous
 * version orbited a perfect nodal point inside a textured sphere, which is
 * invariant to translation and therefore could never reproduce the parallax
 * that wrecked the real captures.
 *
 * Three knobs mirror what a phone actually does:
 *   pivotRadiusM — 0 for a tripod, ~0.25 for a hand rotating at the wrist
 *   autoExposure — per-frame gain reacting to scene brightness, like the phone
 *   lens         — true field of view distinct from the prior handed to the app
 */
interface SimLens extends LensOption {
  trueVfovDeg: number;
  priorVfovDeg: number;
  frameWidth: number;
  frameHeight: number;
}

const SIM_LENSES: SimLens[] = [
  { deviceId: 'sim-ultrawide', label: 'Câmera Grande-Angular Traseira', kind: 'ultrawide', trueVfovDeg: 108, priorVfovDeg: 95, frameWidth: 1080, frameHeight: 1440 },
  { deviceId: 'sim-wide', label: 'Câmera Traseira', kind: 'wide', trueVfovDeg: 69, priorVfovDeg: 62, frameWidth: 1080, frameHeight: 1440 },
  // Reproduces the shape Safari hands back when it refuses 4:3.
  { deviceId: 'sim-ultrawide-169', label: 'Grande-Angular 16:9 (teste)', kind: 'ultrawide', trueVfovDeg: 108, priorVfovDeg: 95, frameWidth: 1080, frameHeight: 1920 },
];

export class SimEnvironment {
  get frameWidth(): number {
    return this.lens.frameWidth;
  }

  get frameHeight(): number {
    return this.lens.frameHeight;
  }

  yawDeg = 0;
  pitchDeg = 0;
  rollDeg = 0;

  /**
   * Distance from the rotation axis to the lens, in metres. A tripod head set
   * on the nodal point is 0; a hand turning at the wrist or waist is 0.2–0.3,
   * which is what produced the ghosting in the real captures.
   */
  pivotRadiusM = 0.25;

  /** Simulates the camera's automatic exposure reacting to what it sees. */
  autoExposure = true;

  /**
   * Error the orientation SENSOR reports, on top of where the camera really is.
   *
   * Without this the simulated gyro was perfect, which quietly made every
   * alignment measurement look useless: there was nothing to recover. A real
   * `deviceorientation` stream wanders — its tilt axes are fused with gravity
   * and settle within about a degree, while its heading has no absolute
   * reference at all and drifts through the capture.
   *
   * Modelled as a slow random walk rather than white noise, because that is
   * what a fused sensor does and it is the part alignment could ever fix; a
   * per-sample jitter would just be averaged away by the hold.
   */
  sensorTiltErrorDeg = 0;
  sensorYawDriftDegPerMin = 0;

  private sensorSeed = 1;
  private sensorWalk = { pitch: 0, roll: 0 };
  private sensorStartMs = 0;
  private sensorWalkMs = 0;

  /** Panorama rendered from the exact rotation centre — the honest reference. */
  groundTruth: HTMLCanvasElement | null = null;

  private lens: SimLens = SIM_LENSES[0];
  private room: SimRoom | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.PerspectiveCamera(108, 0.75, 0.05, 100);
  private rafId: number | null = null;
  private readonly keysDown = new Set<string>();
  private lastFrameMs = 0;
  private dragPointerId: number | null = null;
  private dragLast = { x: 0, y: 0 };
  private inputEl: HTMLElement | null = null;

  get lenses(): LensOption[] {
    return SIM_LENSES.map(({ deviceId, label, kind }) => ({ deviceId, label, kind }));
  }

  get activeLensId(): string {
    return this.lens.deviceId;
  }

  /** What the pipeline is told — an under-estimate, as on a real device. */
  get priorVfovDeg(): number {
    return this.lens.priorVfovDeg;
  }

  /**
   * Where the SENSOR says the camera is, which is not quite where it is. The
   * app only ever sees this; `yawDeg`/`pitchDeg`/`rollDeg` stay the truth the
   * measurements are scored against.
   */
  reportedOrientation(): { yawDeg: number; pitchDeg: number; rollDeg: number } {
    if (!this.sensorTiltErrorDeg && !this.sensorYawDriftDegPerMin) {
      return { yawDeg: this.yawDeg, pitchDeg: this.pitchDeg, rollDeg: this.rollDeg };
    }
    const now = performance.now();
    if (!this.sensorStartMs) {
      this.sensorStartMs = now;
      this.sensorWalkMs = now;
    }

    const step = () => {
      this.sensorSeed = (this.sensorSeed * 1103515245 + 12345) % 2147483648;
      return this.sensorSeed / 2147483648 - 0.5;
    };
    // Advanced on a clock, not per call. The app samples this at 60Hz, so a
    // step per call would be fast noise rather than a slow wander — and the
    // capture would read it as a shaking hand and never settle.
    const limit = this.sensorTiltErrorDeg;
    while (now - this.sensorWalkMs >= SENSOR_WALK_STEP_MS) {
      this.sensorWalkMs += SENSOR_WALK_STEP_MS;
      this.sensorWalk.pitch = clampWalk(this.sensorWalk.pitch + step() * limit * 0.4, limit);
      this.sensorWalk.roll = clampWalk(this.sensorWalk.roll + step() * limit * 0.4, limit);
    }

    const minutes = (now - this.sensorStartMs) / 60000;
    return {
      yawDeg: this.yawDeg + minutes * this.sensorYawDriftDegPerMin,
      pitchDeg: this.pitchDeg + this.sensorWalk.pitch,
      rollDeg: this.rollDeg + this.sensorWalk.roll,
    };
  }

  /** What the virtual camera actually sees; the fit must recover this. */
  get trueVfovDeg(): number {
    return this.lens.trueVfovDeg;
  }

  switchLens(deviceId: string): void {
    const found = SIM_LENSES.find((l) => l.deviceId === deviceId);
    if (!found) return;
    this.lens = found;
    this.applyLens();
    this.renderer?.setSize(found.frameWidth, found.frameHeight, false);
  }

  start(): void {
    if (this.renderer) return;
    this.room = buildSimRoom();
    this.applyLens();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.frameWidth, this.frameHeight, false);
    this.groundTruth = this.renderGroundTruth();
    (window as unknown as Record<string, unknown>)['__captureSim'] = this;
  }

  private applyLens(): void {
    this.camera.fov = this.lens.trueVfovDeg;
    this.camera.aspect = this.lens.frameWidth / this.lens.frameHeight;
    this.camera.updateProjectionMatrix();
  }

  attach(container: HTMLElement): void {
    this.start();
    const canvas = this.renderer!.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'cover';
    container.appendChild(canvas);

    this.lastFrameMs = performance.now();
    const loop = (now: number) => {
      this.stepInput((now - this.lastFrameMs) / 1000);
      this.lastFrameMs = now;
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  bindInput(el: HTMLElement): void {
    this.inputEl = el;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  grabFrame(maxSide = 2048): HTMLCanvasElement {
    this.render();
    const scale = Math.min(1, maxSide / Math.max(this.frameWidth, this.frameHeight));
    const copy = document.createElement('canvas');
    copy.width = Math.round(this.frameWidth * scale);
    copy.height = Math.round(this.frameHeight * scale);
    const ctx = copy.getContext('2d')!;

    if (this.autoExposure) {
      // The phone re-meters for every shot; a bright wall darkens the frame and
      // a dim corner lifts it. Applied as a draw filter so the stitcher has to
      // undo a genuine per-frame gain, exactly as it must on the real device.
      ctx.filter = `brightness(${this.exposureGain().toFixed(3)})`;
    }
    ctx.drawImage(this.renderer!.domElement, 0, 0, copy.width, copy.height);
    return copy;
  }

  /**
   * Metering stand-in: aiming at the bright ceiling stops the camera down,
   * aiming at the dark floor opens it up. Swing is ~2.4× end to end, in the
   * range a real room with a window and a lamp produces.
   */
  private exposureGain(): number {
    const pitch = THREE.MathUtils.clamp(this.pitchDeg, -90, 90);
    const yawTerm = Math.cos((this.yawDeg * Math.PI) / 180) * 0.18;
    return THREE.MathUtils.clamp(1 - pitch / 140 + yawTerm, 0.55, 1.35);
  }

  dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.inputEl) {
      this.inputEl.removeEventListener('pointerdown', this.onPointerDown);
      this.inputEl.removeEventListener('pointermove', this.onPointerMove);
      this.inputEl.removeEventListener('pointerup', this.onPointerUp);
      this.inputEl.removeEventListener('pointercancel', this.onPointerUp);
      this.inputEl = null;
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.room?.dispose();
    this.room = null;
    this.renderer?.domElement.remove();
    this.renderer?.dispose();
    this.renderer = null;
  }

  private render(): void {
    if (!this.renderer || !this.room) return;
    this.camera.quaternion.copy(quaternionFromYpr(this.yawDeg, this.pitchDeg, this.rollDeg));
    // The lens sits pivotRadiusM in FRONT of the rotation axis, which is what
    // happens when someone turns their body while holding the phone out.
    this.camera.position.copy(
      directionForYawPitch(this.yawDeg, this.pitchDeg).multiplyScalar(this.pivotRadiusM),
    );
    this.renderer.render(this.room.scene, this.camera);
  }

  /**
   * Equirectangular reference rendered from the rotation centre with no
   * exposure drift — what a perfect capture would produce.
   */
  private renderGroundTruth(width = 2048): HTMLCanvasElement {
    const height = width / 2;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d')!;

    // Six cube faces from the centre, resampled into equirect.
    const faceSize = 512;
    const faceRenderer = new THREE.WebGLRenderer({ antialias: true });
    faceRenderer.setSize(faceSize, faceSize, false);
    const faceCamera = new THREE.PerspectiveCamera(90, 1, 0.05, 100);
    faceCamera.position.set(0, 0, 0);

    const faces: { yaw: number; pitch: number; data: Uint8ClampedArray }[] = [];
    const dirs = [
      { yaw: 0, pitch: 0 }, { yaw: 90, pitch: 0 }, { yaw: 180, pitch: 0 },
      { yaw: 270, pitch: 0 }, { yaw: 0, pitch: 89.999 }, { yaw: 0, pitch: -89.999 },
    ];
    const scratch = document.createElement('canvas');
    scratch.width = faceSize;
    scratch.height = faceSize;
    const sctx = scratch.getContext('2d', { willReadFrequently: true })!;

    for (const d of dirs) {
      faceCamera.quaternion.copy(quaternionFromYpr(d.yaw, d.pitch, 0));
      faceRenderer.render(this.room!.scene, faceCamera);
      sctx.clearRect(0, 0, faceSize, faceSize);
      sctx.drawImage(faceRenderer.domElement, 0, 0);
      faces.push({ yaw: d.yaw, pitch: d.pitch, data: sctx.getImageData(0, 0, faceSize, faceSize).data });
    }

    const image = ctx.createImageData(width, height);
    const forward = new THREE.Vector3();
    for (let y = 0; y < height; y++) {
      const theta = ((y + 0.5) / height) * Math.PI;
      for (let x = 0; x < width; x++) {
        const phi = ((x + 0.5) / width) * 2 * Math.PI;
        forward.set(Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));

        let best = 0;
        let bestDot = -Infinity;
        for (let f = 0; f < faces.length; f++) {
          const fd = directionForYawPitch(faces[f].yaw, faces[f].pitch);
          const dot = fd.dot(forward);
          if (dot > bestDot) { bestDot = dot; best = f; }
        }
        const face = faces[best];
        const q = quaternionFromYpr(face.yaw, face.pitch, 0).invert();
        const cam = forward.clone().applyQuaternion(q);
        if (cam.z >= -1e-4) continue;
        const u = (cam.x / -cam.z) * 0.5 + 0.5;
        const v = 1 - ((cam.y / -cam.z) * 0.5 + 0.5);
        const px = Math.min(faceSize - 1, Math.max(0, Math.round(u * (faceSize - 1))));
        const py = Math.min(faceSize - 1, Math.max(0, Math.round(v * (faceSize - 1))));
        const si = (py * faceSize + px) * 4;
        const di = (y * width + x) * 4;
        image.data[di] = face.data[si];
        image.data[di + 1] = face.data[si + 1];
        image.data[di + 2] = face.data[si + 2];
        image.data[di + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);

    faceRenderer.dispose();
    faceRenderer.forceContextLoss();
    return out;
  }

  private stepInput(dtSeconds: number): void {
    const dt = Math.min(dtSeconds, 0.1);
    const turn = 45 * dt;
    if (this.keysDown.has('ArrowRight')) this.yawDeg += turn;
    if (this.keysDown.has('ArrowLeft')) this.yawDeg -= turn;
    if (this.keysDown.has('ArrowUp')) this.pitchDeg = Math.min(90, this.pitchDeg + turn);
    if (this.keysDown.has('ArrowDown')) this.pitchDeg = Math.max(-90, this.pitchDeg - turn);
    if (this.keysDown.has('KeyE')) this.rollDeg += turn;
    if (this.keysDown.has('KeyQ')) this.rollDeg -= turn;
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'KeyQ', 'KeyE'].includes(e.code)) {
      this.keysDown.add(e.code);
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.code);
  };

  private readonly onPointerDown = (e: PointerEvent) => {
    this.dragPointerId = e.pointerId;
    this.dragLast = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.dragPointerId) return;
    this.yawDeg += (e.clientX - this.dragLast.x) * 0.15;
    this.pitchDeg = THREE.MathUtils.clamp(this.pitchDeg + (e.clientY - this.dragLast.y) * -0.15, -90, 90);
    this.dragLast = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === this.dragPointerId) this.dragPointerId = null;
  };
}

/** How often the sensor's tilt reading wanders, independent of sampling rate. */
const SENSOR_WALK_STEP_MS = 250;

/** Keeps a random walk from wandering off; a fused sensor does not either. */
function clampWalk(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}
