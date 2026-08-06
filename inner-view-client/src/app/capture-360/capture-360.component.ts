import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { IonButton, IonIcon, IonSpinner, AlertController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  arrowDownOutline,
  arrowForwardOutline,
  arrowUndoOutline,
  arrowUpOutline,
  cameraReverseOutline,
  checkmarkOutline,
  closeOutline,
} from 'ionicons/icons';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  Band,
  CaptureStep,
  CapturedTile,
  DEFAULT_VFOV_DEG,
  VFOV_STORAGE_KEY,
  ZoomCapableCapabilities,
  ZoomConstraintSet,
} from './capture-360.types';
import { CameraModel, maskFitsFrame } from './camera-projection';
import {
  buildMaskGeometry,
  coverTransform,
  drawDiscOverlay,
  drawMaskOverlay,
  visibleFrameRect,
} from './spherical-mask';
import { warpFrameToTile } from './mesh-warp';
import { warpNadir, warpZenith } from './pole-warp';
import { assembleEquirect, PoleStrips } from './equirect-assembler';
import { buildCapturePlan, TOTAL_STEPS } from './capture-plan';
import { drawDomeMap } from './dome-map';

const FLASH_MS = 130;
const DISC_RADIUS_FRACTION = 0.38;

/**
 * Método 2 — captura guiada 360° com overlay ESTÁTICO (sem giroscópio).
 *
 * O fluxo é dirigido por um plano linear de 18 passos (8 faixa superior, 8
 * inferior, zênite, nadir). Em cada passo o overlay desenha o visor do passo
 * (gomo ou disco) e um mapa de domo com o progresso, e a instrução diz para
 * onde girar/inclinar. A captura warpa o frame atual e avança sozinha.
 *
 * Renderizado condicionalmente pelo pai (não é rota): todo o teardown vive em
 * ngOnDestroy. Emite o equiretangular 4096×2048 montado em `finished`.
 */
@Component({
  selector: 'app-capture-360',
  templateUrl: './capture-360.component.html',
  styleUrls: ['./capture-360.component.scss'],
  standalone: true,
  imports: [IonButton, IonIcon, IonSpinner, TranslatePipe],
})
export class Capture360Component implements AfterViewInit, OnDestroy {
  @Output() finished = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('video', { static: true }) videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('overlay', { static: true }) overlayRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('map', { static: true }) mapRef!: ElementRef<HTMLCanvasElement>;

  readonly plan: CaptureStep[] = buildCapturePlan();
  readonly totalSteps = TOTAL_STEPS;

  initializing = true;
  permissionDenied = false;
  cameraError = false;
  lensTooNarrow = false;
  // Inicializado no campo (não no ngAfterViewInit): ler a orientação depois da
  // primeira detecção de mudança dispararia ExpressionChanged no banner.
  isLandscape = matchMedia('(orientation: landscape)').matches;
  assembling = false;
  flashing = false;
  backCameras: MediaDeviceInfo[] = [];

  private results = new Map<string, ImageData>();
  private vFovDeg = DEFAULT_VFOV_DEG;
  private stream: MediaStream | null = null;
  private currentDeviceId: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private progressKey = '';
  private progressParamsCache = { current: 1, total: TOTAL_STEPS };

  private readonly orientationQuery = matchMedia('(orientation: landscape)');
  private readonly onOrientationChange = (): void => {
    this.zone.run(() => {
      this.isLandscape = this.orientationQuery.matches;
      this.redraw();
    });
  };
  private readonly onTrackEnded = (): void => {
    this.zone.run(() => {
      if (!this.destroyed) this.cameraError = true;
    });
  };

  private zone = inject(NgZone);
  private alertController = inject(AlertController);
  private translate = inject(TranslateService);

  constructor() {
    addIcons({
      arrowBackOutline,
      arrowDownOutline,
      arrowForwardOutline,
      arrowUndoOutline,
      arrowUpOutline,
      cameraReverseOutline,
      checkmarkOutline,
      closeOutline,
    });
    const stored = Number.parseFloat(localStorage.getItem(VFOV_STORAGE_KEY) ?? '');
    if (Number.isFinite(stored) && stored >= 40 && stored <= 140) {
      this.vFovDeg = stored;
    }
  }

  // ---- estado derivado do plano (fonte de verdade: results.size) ----

  get capturedCount(): number {
    return this.results.size;
  }

  get isComplete(): boolean {
    return this.results.size >= TOTAL_STEPS;
  }

  /** Passo atual = primeiro ainda não capturado (o fluxo é linear). */
  get currentStep(): CaptureStep {
    return this.plan[Math.min(this.results.size, TOTAL_STEPS - 1)];
  }

  get canCapture(): boolean {
    return (
      !this.initializing &&
      !this.permissionDenied &&
      !this.cameraError &&
      !this.isLandscape &&
      !this.assembling &&
      !this.isComplete &&
      this.stream !== null
    );
  }

  /** Memoizado por contagem: objeto novo a cada CD dispararia ExpressionChanged no pipe. */
  get progressParams(): { current: number; total: number } {
    const key = String(this.capturedCount);
    if (key !== this.progressKey) {
      this.progressKey = key;
      this.progressParamsCache = {
        current: Math.min(this.capturedCount + 1, TOTAL_STEPS),
        total: TOTAL_STEPS,
      };
    }
    return this.progressParamsCache;
  }

  get arrowIcon(): string | null {
    switch (this.currentStep.arrow) {
      case 'right':
        return 'arrow-forward-outline';
      case 'up':
        return 'arrow-up-outline';
      case 'down':
        return 'arrow-down-outline';
      default:
        return null;
    }
  }

  // ---- ciclo de vida ----

  ngAfterViewInit(): void {
    this.orientationQuery.addEventListener('change', this.onOrientationChange);
    this.resizeObserver = new ResizeObserver(() => this.zone.run(() => this.redraw()));
    this.resizeObserver.observe(this.overlayRef.nativeElement.parentElement as Element);
    void this.initCamera();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopStream();
    this.orientationQuery.removeEventListener('change', this.onOrientationChange);
    this.resizeObserver?.disconnect();
    if (this.flashTimer) clearTimeout(this.flashTimer);
  }

  // ---- câmera (reaproveitada da v1, com os fixes de robustez) ----

  async retryCamera(): Promise<void> {
    await this.initCamera();
  }

  async switchCamera(): Promise<void> {
    if (this.backCameras.length < 2 || this.initializing) return;
    const idx = this.backCameras.findIndex((d) => d.deviceId === this.currentDeviceId);
    const next = this.backCameras[(idx + 1) % this.backCameras.length];
    await this.initCamera(next.deviceId);
  }

  private async initCamera(deviceId?: string): Promise<void> {
    this.initializing = true;
    this.permissionDenied = false;
    this.cameraError = false;
    this.stopStream();

    // Rastreado desde o primeiro instante: qualquer falha depois daqui cai no
    // catch, que para este stream — sem isso vazaria a câmera se enumerateDevices
    // ou o metadata falhassem antes de this.stream receber o stream.
    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
      });

      if (!deviceId) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        this.backCameras = devices.filter(
          (d) => d.kind === 'videoinput' && !/front|frontal|user/i.test(d.label),
        );
        const ultra = this.backCameras.find((d) =>
          /ultra[- ]?wide|0[.,]5|grande[- ]?angular/i.test(d.label),
        );
        const currentId = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (ultra?.deviceId && ultra.deviceId !== currentId) {
          // Adquire o ultrawide ANTES de largar o stream que já funciona.
          try {
            const ultraStream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: { deviceId: { exact: ultra.deviceId } },
            });
            stream.getTracks().forEach((t) => t.stop());
            stream = ultraStream;
          } catch {
            /* mantém o stream de environment */
          }
        }
      }

      if (this.destroyed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      this.currentDeviceId = track?.getSettings().deviceId ?? null;
      if (track) {
        track.addEventListener('ended', this.onTrackEnded);
        this.tryMinZoom(track);
      }

      const video = this.videoRef.nativeElement;
      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resolve();
        else video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
      await video.play().catch(() => undefined);

      this.initializing = false;
      this.redraw();
    } catch (err) {
      if (stream && this.stream !== stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      this.initializing = false;
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        this.permissionDenied = true;
      } else {
        this.cameraError = true;
      }
    }
  }

  /** Android: várias traseiras expõem zoom < 1 (ultrawide via zoom óptico). */
  private tryMinZoom(track: MediaStreamTrack): void {
    const caps = track.getCapabilities?.() as ZoomCapableCapabilities | undefined;
    if (caps?.zoom && caps.zoom.min < 1) {
      const constraint: ZoomConstraintSet = { zoom: caps.zoom.min };
      void track.applyConstraints({ advanced: [constraint] }).catch(() => undefined);
    }
  }

  private stopStream(): void {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) {
      track.removeEventListener('ended', this.onTrackEnded);
      track.stop();
    }
    this.stream = null;
    this.videoRef.nativeElement.srcObject = null;
  }

  // ---- desenho do overlay (estático; redesenha em mudança de passo/resize) ----

  private redraw(): void {
    this.drawViewfinder();
    this.drawMap();
  }

  private drawViewfinder(): void {
    const video = this.videoRef.nativeElement;
    const canvas = this.overlayRef.nativeElement;
    const host = canvas.parentElement as HTMLElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = host.clientWidth;
    const cssH = host.clientHeight;
    if (!cssW || !cssH) return;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const step = this.currentStep;
    if (step.kind === 'pole') {
      // disco centrado; a lente estreita não impede polo (a UI orienta ultrawide)
      const r = Math.min(canvas.width, canvas.height) * DISC_RADIUS_FRACTION;
      drawDiscOverlay(ctx, canvas.width / 2, canvas.height / 2, r, primaryColor());
      this.lensTooNarrow = false;
      return;
    }

    if (!video.videoWidth || !video.videoHeight) return;
    const band = step.band as Band;
    const cam: CameraModel = {
      pitchDeg: step.pitchDeg,
      vFovDeg: this.vFovDeg,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    const t = coverTransform(cam.width, cam.height, canvas.width, canvas.height);
    drawMaskOverlay(ctx, buildMaskGeometry(cam, band), t, primaryColor());

    const visible = visibleFrameRect(cam.width, cam.height, canvas.width, canvas.height);
    this.lensTooNarrow = !maskFitsFrame(cam, band, visible);
  }

  private drawMap(): void {
    const canvas = this.mapRef.nativeElement;
    const dpr = window.devicePixelRatio || 1;
    const size = 88;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawDomeMap(ctx, { capturedKeys: new Set(this.results.keys()), currentKey: this.currentStep.key });
  }

  // ---- captura ----

  onCapture(): void {
    if (!this.canCapture) return;

    const video = this.videoRef.nativeElement;
    const snap = document.createElement('canvas');
    snap.width = video.videoWidth;
    snap.height = video.videoHeight;
    const sctx = snap.getContext('2d', { willReadFrequently: true });
    if (!sctx) return;
    sctx.drawImage(video, 0, 0);
    const frame = sctx.getImageData(0, 0, snap.width, snap.height);

    const step = this.currentStep;
    if (step.kind === 'band') {
      const cam: CameraModel = {
        pitchDeg: step.pitchDeg,
        vFovDeg: this.vFovDeg,
        width: snap.width,
        height: snap.height,
      };
      this.results.set(step.key, warpFrameToTile(frame, cam, step.band as Band));
    } else {
      const strip = step.pole === 'zenith' ? warpZenith(frame, this.vFovDeg) : warpNadir(frame, this.vFovDeg);
      this.results.set(step.key, strip);
    }

    this.flash();
    this.redraw();
  }

  redoLast(): void {
    if (this.results.size === 0 || this.assembling) return;
    const lastKey = this.plan[this.results.size - 1].key;
    this.results.delete(lastKey);
    this.redraw();
  }

  finish(): void {
    if (!this.isComplete || this.assembling) return;
    this.assembling = true;
    // deixa o spinner pintar antes do trabalho síncrono de montagem
    setTimeout(() => {
      if (this.destroyed) return;
      const tiles: CapturedTile[] = [];
      for (const step of this.plan) {
        if (step.kind !== 'band') continue;
        const tile = this.results.get(step.key);
        if (tile) tiles.push({ slot: { band: step.band as Band, index: step.index as number }, tile });
      }
      const poles: PoleStrips = {
        zenith: this.results.get('zenith'),
        nadir: this.results.get('nadir'),
      };
      this.finished.emit(assembleEquirect(tiles, poles));
    }, 30);
  }

  async onClose(): Promise<void> {
    if (this.assembling) return;
    if (this.results.size === 0) {
      this.cancelled.emit();
      return;
    }
    const alert = await this.alertController.create({
      header: this.translate.instant('CAPTURE.CLOSE_CONFIRM_TITLE') as string,
      message: this.translate.instant('CAPTURE.CLOSE_CONFIRM_MSG', {
        count: this.results.size,
      }) as string,
      buttons: [
        { text: this.translate.instant('CAPTURE.CLOSE_CONFIRM_KEEP') as string, role: 'cancel' },
        {
          text: this.translate.instant('CAPTURE.CLOSE_CONFIRM_DISCARD') as string,
          role: 'destructive',
          handler: () => this.cancelled.emit(),
        },
      ],
    });
    await alert.present();
  }

  private flash(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashing = true;
    this.flashTimer = setTimeout(() => {
      this.zone.run(() => (this.flashing = false));
    }, FLASH_MS);
  }
}

// ---- helpers puros do componente ----

function primaryColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ion-color-primary').trim();
  return v || '#ff385c';
}
