import * as THREE from 'three';
import { quaternionFromYpr } from './orientation-math';
import { drawSyntheticPano } from './synthetic-pano';

/**
 * Desktop stand-in for phone + room: renders a synthetic equirectangular
 * "room" on the same inverted sphere the real viewer uses, from a virtual
 * phone camera driven by mouse drag / arrow keys (Q/E tilt). Both the camera
 * preview and the orientation sensor read from this single state, and the
 * synthetic pano doubles as ground truth for verifying the stitcher.
 */
export class SimEnvironment {
  /** Virtual portrait camera: 4:3 sensor like most phone main cameras. */
  readonly vfovDeg = 65;
  readonly frameWidth = 1080;
  readonly frameHeight = 1440;

  yawDeg = 0;
  pitchDeg = 0;
  rollDeg = 0;

  /** The equirectangular the virtual room is built from — stitching ground truth. */
  groundTruth: HTMLCanvasElement | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(this.vfovDeg, this.frameWidth / this.frameHeight, 0.1, 1100);
  private texture: THREE.CanvasTexture | null = null;
  private rafId: number | null = null;
  private readonly keysDown = new Set<string>();
  private lastFrameMs = 0;
  private dragPointerId: number | null = null;
  private dragLast = { x: 0, y: 0 };
  private inputEl: HTMLElement | null = null;

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

  grabFrame(): HTMLCanvasElement {
    this.render();
    const copy = document.createElement('canvas');
    copy.width = this.frameWidth;
    copy.height = this.frameHeight;
    copy.getContext('2d')!.drawImage(this.renderer!.domElement, 0, 0);
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
    if (this.keysDown.has('ArrowUp')) this.pitchDeg = Math.min(80, this.pitchDeg + turn);
    if (this.keysDown.has('ArrowDown')) this.pitchDeg = Math.max(-80, this.pitchDeg - turn);
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
    this.pitchDeg = THREE.MathUtils.clamp(this.pitchDeg + (e.clientY - this.dragLast.y) * -0.15, -80, 80);
    this.dragLast = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === this.dragPointerId) this.dragPointerId = null;
  };
}
