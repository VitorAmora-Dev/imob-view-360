import * as THREE from 'three';
import { quaternionFromYpr } from './orientation-math';
import { drawSyntheticPano } from './synthetic-pano';
import type { LensOption } from './capture-sources';

/**
 * Desktop stand-in for phone + room: renders a synthetic equirectangular
 * "room" on the same inverted sphere the real viewer uses, from a virtual
 * phone camera driven by mouse drag / arrow keys (Q/E tilt). Both the camera
 * preview and the orientation sensor read from this single state, and the
 * synthetic pano doubles as ground truth for verifying the stitcher.
 *
 * The virtual lenses carry a TRUE field of view that is deliberately different
 * from the prior handed to the pipeline, so the FOV fit has to actually work
 * for the stitch to come out aligned.
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
  // Reproduces the shape Safari hands back when it refuses 4:3: the vertical
  // field survives but the horizontal is cropped, which costs two extra rings.
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

  /** The equirectangular the virtual room is built from — stitching ground truth. */
  groundTruth: HTMLCanvasElement | null = null;

  private lens: SimLens = SIM_LENSES[0];

  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(108, 1080 / 1440, 0.1, 1100);
  private texture: THREE.CanvasTexture | null = null;
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

  /** What the virtual camera actually sees; the fit must recover this. */
  get trueVfovDeg(): number {
    return this.lens.trueVfovDeg;
  }

  switchLens(deviceId: string): void {
    const found = SIM_LENSES.find((l) => l.deviceId === deviceId);
    if (!found) return;
    this.lens = found;
    this.camera.fov = found.trueVfovDeg;
    this.camera.aspect = found.frameWidth / found.frameHeight;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(found.frameWidth, found.frameHeight, false);
  }

  start(): void {
    if (this.renderer) return;

    const pano = drawSyntheticPano();
    this.groundTruth = pano;
    this.texture = new THREE.CanvasTexture(pano);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // Same geometry as PanoramicViewerComponent, so the stitched output can be
    // compared 1:1 against the synthetic source.
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);
    this.scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: this.texture })));

    this.camera.fov = this.lens.trueVfovDeg;
    this.camera.aspect = this.frameWidth / this.frameHeight;
    this.camera.updateProjectionMatrix();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.frameWidth, this.frameHeight, false);

    // Deterministic hook for automated tests (only exists in ?sim=1 sessions).
    (window as unknown as Record<string, unknown>)['__captureSim'] = this;
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

  /** Input listeners go on the overlay element that sits above the preview. */
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
    copy.getContext('2d')!.drawImage(this.renderer!.domElement, 0, 0, copy.width, copy.height);
    return copy;
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
    this.texture?.dispose();
    this.renderer?.domElement.remove();
    this.renderer?.dispose();
    this.renderer = null;
  }

  private render(): void {
    if (!this.renderer) return;
    this.camera.quaternion.copy(quaternionFromYpr(this.yawDeg, this.pitchDeg, this.rollDeg));
    this.renderer.render(this.scene, this.camera);
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
    // Dragging right turns right, like panning a phone.
    this.yawDeg += (e.clientX - this.dragLast.x) * 0.15;
    this.pitchDeg = THREE.MathUtils.clamp(this.pitchDeg + (e.clientY - this.dragLast.y) * -0.15, -90, 90);
    this.dragLast = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === this.dragPointerId) this.dragPointerId = null;
  };
}
