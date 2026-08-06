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
  arrowUndoOutline,
  cameraReverseOutline,
  checkmarkOutline,
  closeOutline,
} from 'ionicons/icons';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  Band,
  CapturedTile,
  DEFAULT_VFOV_DEG,
  TILES_PER_BAND,
  VFOV_STORAGE_KEY,
  ZoomCapableCapabilities,
  ZoomConstraintSet,
} from './capture-360.types';
import { CameraModel, maskFitsFrame, pitchForBand } from './camera-projection';
import {
  buildMaskGeometry,
  coverTransform,
  drawMaskOverlay,
  visibleFrameRect,
} from './spherical-mask';
import { warpFrameToTile } from './mesh-warp';
import { assembleEquirect } from './equirect-assembler';

const TOTAL_TILES = 2 * TILES_PER_BAND;
const TURN_HINT_MS = 2200;
const FLASH_MS = 130;

/**
 * Método 2 — captura guiada em grade esférica (16 fotos, 2 faixas × 8).
 *
 * Overlay em tela cheia renderizado condicionalmente pelo pai (não é rota):
 * todo o teardown vive em ngOnDestroy. Emite o equiretangular 4096×2048 montado
 * em `finished` — o pai o trata exatamente como uma imagem do input file do
 * Método 1.
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

  tiles: CapturedTile[] = [];
  initializing = true;
  permissionDenied = false;
  cameraError = false;
  lensTooNarrow = false;
  // Inicializado no campo (não no ngAfterViewInit): ler a orientação depois que
  // a primeira detecção de mudança já rodou mudaria o @if do banner entre a CD e
  // o checkNoChanges — o NG0100 clássico.
  isLandscape = matchMedia('(orientation: landscape)').matches;
  assembling = false;
  showTurnHint = false;
  flashing = false;
  backCameras: MediaDeviceInfo[] = [];

  /** 8 arcos do anel de progresso, pré-computados (d de <path>). */
  readonly compassSegments: string[] = buildCompassSegments();

  private vFovDeg = DEFAULT_VFOV_DEG;
  private stream: MediaStream | null = null;
  private currentDeviceId: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private turnHintTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lastMaskBand: Band | null = null;
  private progressKey = '';
  private progressParamsCache: { current: number; band: string } = { current: 1, band: '' };

  private readonly orientationQuery = matchMedia('(orientation: landscape)');
  private readonly onOrientationChange = (): void => {
    this.zone.run(() => {
      this.isLandscape = this.orientationQuery.matches;
      this.refreshMask();
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
    addIcons({ arrowUndoOutline, cameraReverseOutline, checkmarkOutline, closeOutline });
    const stored = Number.parseFloat(localStorage.getItem(VFOV_STORAGE_KEY) ?? '');
    if (Number.isFinite(stored) && stored >= 40 && stored <= 140) {
      this.vFovDeg = stored;
    }
  }

  // ---- estado derivado: uma única fonte de verdade (tiles.length) ----

  get band(): Band {
    return this.tiles.length < TILES_PER_BAND ? 'upper' : 'lower';
  }

  get indexInBand(): number {
    return this.tiles.length % TILES_PER_BAND;
  }

  get isComplete(): boolean {
    return this.tiles.length >= TOTAL_TILES;
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

  /**
   * Memoizado por estado: um getter que devolvesse um objeto literal novo a
   * cada acesso mudaria a referência de entrada do pipe `translate` em toda
   * detecção de mudanças, disparando ExpressionChangedAfterItHasBeenChecked.
   */
  get progressParams(): { current: number; band: string } {
    const key = `${this.indexInBand}|${this.band}`;
    if (key !== this.progressKey) {
      this.progressKey = key;
      this.progressParamsCache = {
        current: this.indexInBand + 1,
        band: this.translate.instant(
          this.band === 'upper' ? 'CAPTURE.BAND_UPPER' : 'CAPTURE.BAND_LOWER',
        ) as string,
      };
    }
    return this.progressParamsCache;
  }

  get tiltHintKey(): string {
    return this.band === 'upper' ? 'CAPTURE.HINT_TILT_UP' : 'CAPTURE.HINT_TILT_DOWN';
  }

  // ---- ciclo de vida ----

  ngAfterViewInit(): void {
    this.orientationQuery.addEventListener('change', this.onOrientationChange);

    this.resizeObserver = new ResizeObserver(() => this.zone.run(() => this.refreshMask()));
    this.resizeObserver.observe(this.overlayRef.nativeElement.parentElement as Element);

    void this.initCamera();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopStream();
    this.orientationQuery.removeEventListener('change', this.onOrientationChange);
    this.resizeObserver?.disconnect();
    if (this.turnHintTimer) clearTimeout(this.turnHintTimer);
    if (this.flashTimer) clearTimeout(this.flashTimer);
  }

  // ---- câmera ----

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

    // Rastreado num local desde o primeiro instante: qualquer falha depois daqui
    // (enumerateDevices, metadata, play) cai no catch, que para este stream —
    // sem isso, um erro entre a abertura e a atribuição a this.stream vazaria a
    // câmera, fora do alcance de stopStream/ngOnDestroy.
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

      // Só na primeira abertura (sem deviceId): procurar a ultrawide traseira.
      // enumerateDevices só entrega labels DEPOIS da permissão — por isso a
      // ordem getUserMedia → enumerate → reabrir.
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
          // Adquire o ultrawide ANTES de largar o stream que já funciona. Se o
          // re-open falhar (NotReadableError em multi-câmera Android, corrida de
          // liberação de hardware), fica com o stream de environment em vez de
          // matar uma câmera boa e cair num loop de erro→retry.
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
      this.refreshMask();
    } catch (err) {
      // Se a falha veio depois de abrir o stream mas antes de this.stream = stream
      // (ex.: enumerateDevices ou metadata), pare-o aqui: this.stream ainda é null,
      // então stopStream()/ngOnDestroy não o alcançariam.
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

  // ---- máscara ----

  /**
   * Redesenha o overlay. Chamado apenas em eventos que mudam a geometria
   * (câmera pronta, resize, troca de faixa) — a máscara é estática entre eles,
   * então não há loop de rAF.
   */
  private refreshMask(): void {
    const video = this.videoRef.nativeElement;
    const canvas = this.overlayRef.nativeElement;
    if (!video.videoWidth || !video.videoHeight) return;

    const host = canvas.parentElement as HTMLElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = host.clientWidth;
    const cssH = host.clientHeight;
    if (!cssW || !cssH) return;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    const cam: CameraModel = {
      pitchDeg: pitchForBand(this.band),
      vFovDeg: this.vFovDeg,
      width: video.videoWidth,
      height: video.videoHeight,
    };

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const t = coverTransform(cam.width, cam.height, canvas.width, canvas.height);
    const geo = buildMaskGeometry(cam, this.band);
    drawMaskOverlay(ctx, geo, t, primaryColor());

    // O que importa é caber no que o usuário VÊ (pós-crop do cover) — que é
    // subconjunto do frame, então esta checagem já cobre a do frame inteiro.
    const visible = visibleFrameRect(cam.width, cam.height, canvas.width, canvas.height);
    this.lensTooNarrow = !maskFitsFrame(cam, this.band, visible);
    this.lastMaskBand = this.band;
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

    const cam: CameraModel = {
      pitchDeg: pitchForBand(this.band),
      vFovDeg: this.vFovDeg,
      width: snap.width,
      height: snap.height,
    };
    const bandBefore = this.band;
    const tile = warpFrameToTile(frame, cam, bandBefore);
    this.tiles = [...this.tiles, { slot: { band: bandBefore, index: this.indexInBand }, tile }];

    this.flash();
    if (this.band !== this.lastMaskBand) {
      this.refreshMask();
    }
    if (!this.isComplete) {
      this.pulseTurnHint();
    }
  }

  redoLast(): void {
    if (this.tiles.length === 0 || this.assembling) return;
    this.tiles = this.tiles.slice(0, -1);
    if (this.band !== this.lastMaskBand) {
      this.refreshMask();
    }
  }

  finish(): void {
    if (!this.isComplete || this.assembling) return;
    this.assembling = true;
    // deixa o spinner pintar antes do trabalho síncrono de montagem
    setTimeout(() => {
      const dataUrl = assembleEquirect(this.tiles);
      this.finished.emit(dataUrl);
    }, 30);
  }

  async onClose(): Promise<void> {
    if (this.assembling) return;
    if (this.tiles.length === 0) {
      this.cancelled.emit();
      return;
    }
    const alert = await this.alertController.create({
      header: this.translate.instant('CAPTURE.CLOSE_CONFIRM_TITLE') as string,
      message: this.translate.instant('CAPTURE.CLOSE_CONFIRM_MSG', {
        count: this.tiles.length,
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

  segmentState(k: number): 'done' | 'current' | 'todo' {
    if (k < this.indexInBand || this.isComplete) return 'done';
    if (k === this.indexInBand) return 'current';
    return 'todo';
  }

  private pulseTurnHint(): void {
    if (this.turnHintTimer) clearTimeout(this.turnHintTimer);
    this.showTurnHint = true;
    this.turnHintTimer = setTimeout(() => {
      this.zone.run(() => (this.showTurnHint = false));
    }, TURN_HINT_MS);
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
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--ion-color-primary')
    .trim();
  return v || '#ff385c';
}

/** 8 arcos de 45° (com folga de 5°) num anel r=22 centrado em (28,28), começando no topo. */
function buildCompassSegments(): string[] {
  const cx = 28;
  const cy = 28;
  const r = 22;
  const segments: string[] = [];
  for (let k = 0; k < 8; k++) {
    const start = -90 + k * 45 + 2.5;
    const end = -90 + (k + 1) * 45 - 2.5;
    const sx = cx + r * Math.cos((start * Math.PI) / 180);
    const sy = cy + r * Math.sin((start * Math.PI) / 180);
    const ex = cx + r * Math.cos((end * Math.PI) / 180);
    const ey = cy + r * Math.sin((end * Math.PI) / 180);
    segments.push(`M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`);
  }
  return segments;
}
