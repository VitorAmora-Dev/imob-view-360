import { Component, ElementRef, NgZone, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { IonButton, IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cameraOutline, closeOutline, refreshOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Panorama } from '../../models/virtual-tour.model';
import { PanoramicViewerComponent } from '../panoramic-viewer/panoramic-viewer.component';
import { CaptureSession, targetCountForHfov, DEFAULT_TUNING } from './capture-session';
import {
  CaptureCameraSource,
  CaptureOrientationSource,
  OrientationReading,
  RealCameraSource,
  RealOrientationSource,
  SimCameraSource,
  SimOrientationSource,
} from './capture-sources';
import { SimEnvironment } from './sim-environment';
import { StitchShot, hfovFromSpec, stitchEquirect } from './stitcher';

type CaptureState = 'intro' | 'capturing' | 'stitching' | 'preview' | 'error';

/**
 * Full-screen guided 360° capture modal (BANIB-style): horizon line, center
 * reticle and a ring of target dots; holding the reticle on a dot for the
 * dwell time captures that angle, and the ring of shots is stitched into an
 * equirectangular panorama returned as `{ imageData }` on dismiss.
 *
 * With `?sim=1` in the URL the camera and sensors are replaced by a synthetic
 * Three.js room driven by mouse/arrow keys, so the whole flow runs on desktop.
 *
 * The 60fps overlay (horizon/dots/dwell ring) is updated imperatively outside
 * Angular; signals only carry discrete state changes.
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
  readonly totalCount = signal(DEFAULT_TUNING.targetCount);
  readonly hintKey = signal('CAPTURE.ALIGN_HINT');
  readonly errorKey = signal('CAPTURE.CAMERA_ERROR');
  readonly previewPanoramas = signal<Panorama[]>([]);
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

  async begin(): Promise<void> {
    try {
      if (this.simMode) {
        this.simEnv = new SimEnvironment();
        this.camera = new SimCameraSource(this.simEnv);
        this.orientation = new SimOrientationSource(this.simEnv);
      } else {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('camera-unsupported');
        }
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

      const gotSensor = await this.waitForSensor();
      if (!gotSensor) {
        this.fail('CAPTURE.SENSOR_ERROR');
        return;
      }

      const spec = this.camera.getSpec();
      const targetCount = targetCountForHfov(hfovFromSpec(spec), DEFAULT_TUNING);
      this.session = new CaptureSession({ targetCount, dwellMs: this.dwellMs() });
      this.shots = [];
      this.totalCount.set(targetCount);
      this.capturedCount.set(0);

      this.state.set('capturing');
      await new Promise((resolve) => setTimeout(resolve));

      const container = this.previewContainer!.nativeElement;
      this.camera.attach(container);
      if (this.simEnv && this.overlay) {
        this.simEnv.bindInput(this.overlay.nativeElement);
      }
      this.onResize();
      this.orientation.rezero();
      this.startLoop();
    } catch {
      this.fail('CAPTURE.CAMERA_ERROR');
    }
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

    for (const event of events) {
      if (event.type === 'capture') {
        this.captureShot(reading);
      } else {
        this.stopLoop();
        this.zone.run(() => void this.stitch());
        return;
      }
    }
  }

  private captureShot(reading: OrientationReading): void {
    if (!this.camera) return;
    const frame = this.camera.grabFrame();
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
      const imageData = await stitchEquirect(this.shots, spec);
      if (this.simMode) {
        // Lets an automated run diff the stitch against SimEnvironment.groundTruth.
        (window as unknown as Record<string, unknown>)['__captureResult'] = imageData;
      }
      this.previewPanoramas.set([{
        id: 'capture-preview',
        roomName: '',
        imageData,
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
    if (el) {
      this.viewport = { width: el.clientWidth, height: el.clientHeight };
    }
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
    // object-fit: cover — angular density of the visible crop.
    const pxPerDegX = Math.max(width, height * spec.frameAspect) / hfov;
    const pxPerDegY = Math.max(width / spec.frameAspect, height) / vfov;

    const ypr = reading.ypr;
    if (this.horizonEl) {
      this.horizonEl.nativeElement.style.transform =
        `translateY(${(ypr.pitchDeg * pxPerDegY).toFixed(1)}px) rotate(${(-ypr.rollDeg).toFixed(1)}deg)`;
      this.horizonEl.nativeElement.classList.toggle('horizon--off', !snap.levelOk);
    }

    const dotX = snap.offsetYawDeg * pxPerDegX;
    const dotY = -snap.offsetPitchDeg * pxPerDegY;
    const onScreen = Math.abs(snap.offsetYawDeg) < hfov / 2 + 4;

    if (this.targetEl) {
      const el = this.targetEl.nativeElement;
      el.style.visibility = onScreen ? 'visible' : 'hidden';
      el.style.transform = `translate(${dotX.toFixed(1)}px, ${dotY.toFixed(1)}px)`;
      el.classList.toggle('target--locked', snap.withinTolerance);
    }

    if (this.arrowEl) {
      const el = this.arrowEl.nativeElement;
      el.style.visibility = onScreen ? 'hidden' : 'visible';
      el.classList.toggle('edge-arrow--left', snap.offsetYawDeg < 0);
    }

    if (this.reticleEl) {
      this.reticleEl.nativeElement.classList.toggle('reticle--locked', snap.withinTolerance);
    }

    if (this.dwellCircle) {
      this.dwellCircle.nativeElement.style.strokeDashoffset =
        String(this.dwellCircumference * (1 - snap.dwellProgress));
    }

    const hint = !snap.levelOk
      ? 'CAPTURE.LEVEL_HINT'
      : snap.status === 'dwelling'
        ? 'CAPTURE.HOLD_HINT'
        : 'CAPTURE.ALIGN_HINT';
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      this.zone.run(() => this.hintKey.set(hint));
    }
  }
}
