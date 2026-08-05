import { Component, ElementRef, NgZone, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { IonButton, IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cameraOutline, closeOutline, refreshOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Panorama } from '../../models/virtual-tour.model';
import { PanoramicViewerComponent } from '../panoramic-viewer/panoramic-viewer.component';
import { CaptureSession, DEFAULT_TUNING } from './capture-session';
import { CaptureTarget, PatternOptions, buildCapturePattern, buildRemainingPattern } from './capture-pattern';
import { directionForYawPitch } from './orientation-math';
import {
  CaptureCameraSource,
  CaptureOrientationSource,
  LensOption,
  OrientationReading,
  RealCameraSource,
  RealOrientationSource,
  SimCameraSource,
  SimOrientationSource,
} from './capture-sources';
import { SimEnvironment } from './sim-environment';
import {
  StitchShot, fitVfovFromShots, frameSideBudget, hfovFromSpec, hfovFromVfov, stitchEquirect,
} from './stitcher';

type CaptureState = 'intro' | 'capturing' | 'stitching' | 'preview' | 'error';

/**
 * Full-screen guided 360° capture modal (BANIB-style): horizon line, centre
 * reticle and aim points that close the whole sphere — a ring at eye level,
 * extra rings when the lens is narrow, and caps for ceiling and floor.
 * Holding the reticle on a point captures that angle; the set is stitched into
 * an equirectangular panorama returned as `{ imageData }` on dismiss.
 *
 * With `?sim=1` the camera and sensors are replaced by a synthetic Three.js
 * room driven by mouse/arrow keys, so the whole flow runs on desktop.
 *
 * The 60fps overlay is updated imperatively outside Angular; signals only
 * carry discrete state changes.
 */
@Component({
  selector: 'app-capture-360',
  templateUrl: './capture-360.component.html',
  styleUrls: ['./capture-360.component.scss'],
  standalone: true,
  imports: [IonButton, IonIcon, IonSpinner, TranslatePipe, PanoramicViewerComponent],
})
export class Capture360Component implements OnDestroy {
  @ViewChild('previewContainer') previewContainer?: ElementRef<HTMLElement>;
  @ViewChild('overlay') overlay?: ElementRef<HTMLElement>;
  @ViewChild('horizonEl') horizonEl?: ElementRef<HTMLElement>;
  @ViewChild('reticleEl') reticleEl?: ElementRef<HTMLElement>;
  @ViewChild('targetEl') targetEl?: ElementRef<HTMLElement>;
  @ViewChild('arrowEl') arrowEl?: ElementRef<HTMLElement>;
  @ViewChild('dwellCircle') dwellCircle?: ElementRef<SVGCircleElement>;

  readonly state = signal<CaptureState>('intro');
  readonly capturedCount = signal(0);
  readonly totalCount = signal(0);
  readonly hintKey = signal('CAPTURE.ALIGN_HINT');
  readonly errorKey = signal('CAPTURE.CAMERA_ERROR');
  readonly previewPanoramas = signal<Panorama[]>([]);
  readonly lenses = signal<LensOption[]>([]);
  readonly activeLensId = signal<string | null>(null);
  /** Set when the camera refused 4:3, which makes the capture much longer. */
  readonly narrowFrameWarning = signal(false);
  readonly simMode = new URLSearchParams(window.location.search).has('sim');

  private readonly modalCtrl = inject(ModalController);
  private readonly zone = inject(NgZone);

  private simEnv: SimEnvironment | null = null;
  private camera: CaptureCameraSource | null = null;
  private orientation: CaptureOrientationSource | null = null;
  private session: CaptureSession | null = null;
  private shots: StitchShot[] = [];
  private rafId: number | null = null;
  private viewport = { width: 0, height: 0 };
  private lastHint = '';
  private replanned = false;

  /** Dwell ring geometry: r=34 in an 80×80 viewBox. */
  readonly dwellCircumference = 2 * Math.PI * 34;

  constructor() {
    addIcons({ cameraOutline, closeOutline, refreshOutline });
    window.addEventListener('resize', this.onResize);
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.teardownSources();
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  usePanorama(): void {
    const imageData = this.previewPanoramas()[0]?.imageData;
    this.modalCtrl.dismiss(imageData ? { imageData } : null, imageData ? 'confirm' : 'cancel');
  }

  lensLabel(lens: LensOption): string {
    return lens.kind === 'ultrawide' ? '0,5×' : lens.kind === 'tele' ? '2×' : '1×';
  }

  async selectLens(lens: LensOption): Promise<void> {
    if (!this.camera || lens.deviceId === this.activeLensId()) return;
    try {
      await this.camera.switchLens(lens.deviceId);
      this.activeLensId.set(this.camera.activeLensId());
      this.rebuildPattern();
    } catch {
      this.fail('CAPTURE.CAMERA_ERROR');
    }
  }

  async begin(): Promise<void> {
    try {
      if (this.simMode) {
        this.simEnv = new SimEnvironment();
        this.camera = new SimCameraSource(this.simEnv);
        this.orientation = new SimOrientationSource(this.simEnv);
      } else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unsupported');
        this.camera = new RealCameraSource();
        this.orientation = new RealOrientationSource();
      }

      const sensorOk = await this.orientation.requestPermission();
      if (!sensorOk) {
        this.fail('CAPTURE.SENSOR_ERROR');
        return;
      }

      await this.camera.start();
      this.orientation.start();

      if (!(await this.waitForSensor())) {
        this.fail('CAPTURE.SENSOR_ERROR');
        return;
      }

      this.lenses.set(this.camera.lenses());
      this.activeLensId.set(this.camera.activeLensId());
      this.rebuildPattern();

      this.state.set('capturing');
      await new Promise((resolve) => setTimeout(resolve));

      this.camera.attach(this.previewContainer!.nativeElement);
      if (this.simEnv && this.overlay) this.simEnv.bindInput(this.overlay.nativeElement);
      this.onResize();
      this.orientation.rezero();
      this.startLoop();
    } catch {
      this.fail('CAPTURE.CAMERA_ERROR');
    }
  }

  /** Recomputes the aim points — the lens decides how many rings are needed. */
  private rebuildPattern(): void {
    const spec = this.camera!.getSpec();
    const targets = buildCapturePattern({
      vfovDeg: spec.vfovDeg ?? 65,
      hfovDeg: hfovFromSpec(spec),
      centerToleranceDeg: DEFAULT_TUNING.centerToleranceDeg,
    });
    this.session = new CaptureSession(targets, { dwellMs: this.dwellMs() });
    this.shots = [];
    this.replanned = false;
    this.totalCount.set(targets.length);
    this.capturedCount.set(0);
    // Warn rather than silently tripling the capture, which is what turned an
    // expected 8 shots into 22 on a phone whose camera refused 4:3.
    this.narrowFrameWarning.set(!spec.wideShapeAccepted);
  }

  /**
   * The opening plan is sized from a deliberately low FOV guess, which would
   * cost the user extra rings. Once the horizon ring is in hand its overlaps
   * reveal the real field of view, so the rest of the plan is rebuilt — almost
   * always shorter than advertised, never with a gap.
   */
  private replanFromFittedFov(): void {
    this.replanned = true;
    const spec = this.camera!.getSpec();
    const fitted = fitVfovFromShots(this.shots, spec);
    const options: PatternOptions = {
      vfovDeg: fitted,
      hfovDeg: hfovFromVfov(fitted, spec.frameAspect),
      centerToleranceDeg: DEFAULT_TUNING.centerToleranceDeg,
    };
    const donePitches = this.session!.capturedTargets()
      .filter((t) => t.kind === 'ring')
      .map((t) => t.pitchDeg);
    this.session!.retarget(buildRemainingPattern(options, donePitches));
    this.zone.run(() => this.totalCount.set(this.session!.total));
  }

  restart(): void {
    this.stopLoop();
    this.shots = [];
    this.session?.reset();
    this.orientation?.rezero();
    this.capturedCount.set(0);
    if (this.state() !== 'capturing') {
      this.state.set('capturing');
      setTimeout(() => {
        if (this.camera && this.previewContainer) {
          this.camera.attach(this.previewContainer.nativeElement);
          if (this.simEnv && this.overlay) this.simEnv.bindInput(this.overlay.nativeElement);
          this.onResize();
          this.startLoop();
        }
      });
    } else {
      this.startLoop();
    }
  }

  retryFromError(): void {
    this.teardownSources();
    this.state.set('intro');
  }

  private dwellMs(): number {
    // `?simDwell=300` speeds up automated runs of the simulated flow.
    const raw = new URLSearchParams(window.location.search).get('simDwell');
    const parsed = raw ? Number(raw) : NaN;
    return this.simMode && Number.isFinite(parsed) && parsed >= 100 ? parsed : DEFAULT_TUNING.dwellMs;
  }

  private async waitForSensor(): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      if (this.orientation?.sample()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  private startLoop(): void {
    this.stopLoop();
    this.zone.runOutsideAngular(() => {
      const loop = (now: number) => {
        this.rafId = requestAnimationFrame(loop);
        this.tick(now);
      };
      this.rafId = requestAnimationFrame(loop);
    });
  }

  private stopLoop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private tick(now: number): void {
    const reading = this.orientation?.sample();
    if (!reading || !this.session) return;

    const events = this.session.update(now, reading.ypr);
    this.paintOverlay(reading);
    if (this.simMode) {
      // Lets an automated run aim at the current point without guessing the plan.
      (window as unknown as Record<string, unknown>)['__captureTarget'] = this.session.snapshot.currentTarget;
    }

    for (const event of events) {
      if (event.type === 'capture') {
        this.captureShot(reading);
        if (!this.replanned && this.horizonRingComplete()) {
          this.replanFromFittedFov();
        }
      } else {
        this.stopLoop();
        this.zone.run(() => void this.stitch());
        return;
      }
    }
  }

  private horizonRingComplete(): boolean {
    const snap = this.session!.snapshot;
    // The plan always opens with the eye-level ring, so the ring is done the
    // moment the next target leaves pitch 0 — replan before shooting it. Once
    // the session is complete there is nothing left to plan.
    return snap.status !== 'complete'
      && snap.capturedCount >= 3
      && snap.currentTarget.pitchDeg !== 0;
  }

  private captureShot(reading: OrientationReading): void {
    if (!this.camera) return;
    // Frame size follows the plan: a long capture keeps smaller frames so the
    // whole set stays inside the memory a phone browser will grant the tab.
    const frame = this.camera.grabFrame(
      frameSideBudget(this.session!.total, this.camera.getSpec().frameAspect),
    );
    const q = reading.q;
    this.shots.push({ frame, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w } });
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => navigator.vibrate?.(40));
    this.zone.run(() => this.capturedCount.set(this.shots.length));
  }

  private async stitch(): Promise<void> {
    this.state.set('stitching');
    try {
      // Let the spinner paint before the heavy synchronous stretch begins.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const spec = this.camera!.getSpec();
      if (this.simMode) {
        // Keeps the frames alive so an automated run can re-stitch the same
        // capture with different settings and compare them fairly.
        const shots = this.shots;
        (window as unknown as Record<string, unknown>)['__restitch'] =
          (opts: Record<string, unknown>) =>
            stitchEquirect(shots, spec, { releaseFrames: false, ...opts });
      }
      const result = await stitchEquirect(this.shots, spec, {
        releaseFrames: !this.simMode,
      });
      if (this.simMode) {
        // Lets an automated run diff the stitch against SimEnvironment.groundTruth.
        (window as unknown as Record<string, unknown>)['__captureResult'] = result;
      }
      this.previewPanoramas.set([{
        id: 'capture-preview',
        roomName: '',
        imageData: result.imageData,
        order: 0,
        initialPanorama: true,
        originHotspots: [],
        measurements: [],
      }]);
      this.state.set('preview');
    } catch {
      this.fail('CAPTURE.STITCH_ERROR');
    }
  }

  private fail(key: string): void {
    this.zone.run(() => {
      this.errorKey.set(key);
      this.state.set('error');
    });
  }

  private teardownSources(): void {
    this.stopLoop();
    this.camera?.stop();
    this.orientation?.stop();
    this.camera = null;
    this.orientation = null;
    this.simEnv = null;
    this.session = null;
    this.shots = [];
  }

  private readonly onResize = (): void => {
    const el = this.overlay?.nativeElement;
    if (el) this.viewport = { width: el.clientWidth, height: el.clientHeight };
  };

  /** Imperative 60fps overlay update — no Angular change detection involved. */
  private paintOverlay(reading: OrientationReading): void {
    const snap = this.session!.snapshot;
    const { width, height } = this.viewport;
    if (!width || !height) {
      this.onResize();
      return;
    }

    const spec = this.camera!.getSpec();
    const vfov = spec.vfovDeg ?? 65;
    const hfov = hfovFromSpec(spec);
    // object-fit: cover — half-extent in px of the ±1 normalised frame axes.
    const halfX = Math.max(width, height * spec.frameAspect) / 2;
    const halfY = Math.max(width / spec.frameAspect, height) / 2;
    const tanHalfH = Math.tan((hfov * Math.PI) / 360);
    const tanHalfV = Math.tan((vfov * Math.PI) / 360);

    const ypr = reading.ypr;
    if (this.horizonEl) {
      const pxPerDegY = halfY / (vfov / 2);
      this.horizonEl.nativeElement.style.transform =
        `translateY(${(ypr.pitchDeg * pxPerDegY).toFixed(1)}px) rotate(${(-ypr.rollDeg).toFixed(1)}deg)`;
    }

    // Same projection the stitcher's shader uses, so the dot sits exactly where
    // the frame will land — a linear approximation breaks down for the caps.
    const target = snap.currentTarget;
    const dir = directionForYawPitch(target.yawDeg, target.pitchDeg);
    const cam = dir.clone().applyQuaternion(reading.q.clone().invert());
    const inFront = cam.z < -0.001;
    const dotX = inFront ? (cam.x / -cam.z / tanHalfH) * halfX : 0;
    const dotY = inFront ? -(cam.y / -cam.z / tanHalfV) * halfY : 0;
    const onScreen = inFront && Math.abs(dotX) < width * 0.62 && Math.abs(dotY) < height * 0.62;

    if (this.targetEl) {
      const el = this.targetEl.nativeElement;
      el.style.visibility = onScreen ? 'visible' : 'hidden';
      el.style.transform = `translate(${dotX.toFixed(1)}px, ${dotY.toFixed(1)}px)`;
      el.classList.toggle('target--locked', snap.withinTolerance);
    }

    if (this.arrowEl) {
      const el = this.arrowEl.nativeElement;
      el.style.visibility = onScreen ? 'hidden' : 'visible';
      // Point along the shortest turn toward the target, including up/down.
      const dirDeg = Math.atan2(-snap.offsetPitchDeg, snap.offsetYawDeg) * (180 / Math.PI);
      el.style.transform = `rotate(${dirDeg.toFixed(1)}deg)`;
    }

    if (this.reticleEl) {
      this.reticleEl.nativeElement.classList.toggle('reticle--locked', snap.withinTolerance);
    }

    if (this.dwellCircle) {
      this.dwellCircle.nativeElement.style.strokeDashoffset =
        String(this.dwellCircumference * (1 - snap.dwellProgress));
    }

    this.updateHint(snap, target);
  }

  private updateHint(snap: CaptureSession['snapshot'], target: CaptureTarget): void {
    const hint = snap.status === 'dwelling'
      ? 'CAPTURE.HOLD_HINT'
      : target.kind === 'cap'
        ? (target.pitchDeg > 0 ? 'CAPTURE.AIM_UP_HINT' : 'CAPTURE.AIM_DOWN_HINT')
        : !snap.steady
          ? 'CAPTURE.STEADY_HINT'
          : 'CAPTURE.ALIGN_HINT';
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      this.zone.run(() => this.hintKey.set(hint));
    }
  }
}
