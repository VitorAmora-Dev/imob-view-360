import { Component, ElementRef, NgZone, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { IonButton, IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { OwlLoaderComponent } from '../owl-loader/owl-loader.component';
import { addIcons } from 'ionicons';
import { cameraOutline, closeOutline, refreshOutline } from 'ionicons/icons';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Panorama } from '../../models/virtual-tour.model';
import { PanoramicViewerComponent } from '../panoramic-viewer/panoramic-viewer.component';
import { CaptureSession, DEFAULT_TUNING } from './capture-session';
import { buildCapturePattern } from './capture-pattern';
import { directionForYawPitch } from './orientation-math';
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
import { CaptureFrameUpload, CaptureGeometry } from '../../services/virtual-tour.service';
import { releaseCanvas, sharpnessScore, storeFrame } from './frame-store';
import { StitchShot, hfovFromSpec, stitchEquirect } from './stitcher';

type CaptureState =
  | 'intro'
  | 'capturing'
  | 'stitching'
  | 'preview'
  | 'error';

/** O que o wizard devolve quando o cômodo termina de SUBIR. */
export interface EnvioDaCaptura {
  panoramaId: string;
  /**
   * A montagem por IA foi pedida e está a caminho.
   *
   * Falso quando o servidor vai dispensar por ter menos fotos de referência
   * que o mínimo: aí não há montagem para ninguém acompanhar, e o cômodo fica
   * com o panorama costurado mesmo.
   */
  tratamentoPedido: boolean;
}

interface Candidate {
  canvas: HTMLCanvasElement;
  reading: OrientationReading;
  sharpness: number;
}

/**
 * The hold lasts two seconds and the frame used to be whichever one the timer
 * happened to land on — including the ones where the hand was still settling.
 * Sampling the tail of the hold and keeping the sharpest costs a few
 * milliseconds and removes that lottery.
 */
const CANDIDATE_LIMIT = 4;
const CANDIDATE_INTERVAL_MS = 220;
/** Sampling starts once the hold is mostly through, where the hand is stillest. */
const CANDIDATE_START_PROGRESS = 0.4;

/**
 * Full-screen guided 360° capture modal (BANIB-style): horizon line, centre
 * reticle and a ring of aim points. Holding the reticle on a point captures
 * that angle; the ring is stitched into an equirectangular panorama returned
 * as `{ imageData }` on dismiss.
 *
 * The lens is chosen automatically, and not by the person holding the phone:
 * `RealCameraSource` already prefers the ultra-wide when the device has one
 * (it needs about half the shots) and remembers whatever a previous session
 * switched to. There used to be a screen for this — it named a real
 * trade-off, not a detail — but explaining "42% of this panorama will be
 * invented by software" earns its keep only for someone who can act on it,
 * and almost nobody holding a phone up in an empty room can.
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
  imports: [
    IonButton,
    IonIcon,
    IonSpinner,
    TranslatePipe,
    PanoramicViewerComponent,
    OwlLoaderComponent,
  ],
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
  private readonly translate = inject(TranslateService);

  /**
   * Nome do ambiente, escrito na tela de preview. Ver o comentário do template.
   *
   * NÃO é zerado no "Refazer": quem refaz está refazendo o MESMO cômodo, e
   * apagar o nome que a pessoa acabou de escolher seria cobrá-lo de novo por um
   * gesto que não mudou de assunto.
   */
  readonly roomName = signal('');

  /**
   * Sugestões de ambiente, para o toque resolver o caso comum.
   *
   * Vêm de UMA chave separada por vírgula, e não de uma chave por sugestão, de
   * propósito: assim o tradutor troca o conjunto inteiro pelo que faz sentido no
   * idioma dele — a lista de cômodos de uma casa não é a mesma em toda parte —
   * sem precisar de código novo para cada item.
   */
  readonly roomSuggestions = computed(() =>
    this.translate
      .instant('CAPTURE.ROOM_SUGGESTIONS')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
  );

  onRoomName(event: Event): void {
    this.roomName.set((event.target as HTMLInputElement).value);
  }

  /** Tocar de novo no chip aceso limpa o campo — é o desfazer óbvio. */
  pickRoom(nome: string): void {
    this.roomName.update((atual) => (atual === nome ? '' : nome));
  }

  readonly capturedCount = signal(0);
  readonly totalCount = signal(0);
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
  /**
   * Encoding a frame is asynchronous, so a shot is held as the promise of one.
   * Position in the array keeps the capture order without a queue.
   */
  private shots: Promise<StitchShot>[] = [];
  /** Resolved shots kept past the stitch so the originals can be archived. */
  private stitchedShots: StitchShot[] = [];
  /** What the stitch measured, saved with the panorama so the AI pass knows. */
  private geometry: CaptureGeometry | null = null;

  /**
   * O panorama como a costura o entregou, sempre.
   *
   * Separado do que a tela mostra: no preview o corretor vê a versão tratada
   * pela IA, mas é esta que sobe como `imageData` e é ela que o botão "ver
   * original" da etapa 2 exibe. O tratamento nunca substitui o que foi
   * fotografado.
   */
  private originalImageData = '';

  /** Id do panorama no servidor, criado pelo envio da captura. */
  private serverPanoramaId: string | null = null;

  /**
   * A IA não melhorou este cômodo — rede fora, tempo estourado ou dispensa do
   * servidor. O preview mostra o costurado e diz isso, em vez de calar: uma
   * espera que termina sem explicação é pior que não ter esperado.
   */
  readonly naoMelhorou = signal(false);

  /**
   * Quem sabe SUBIR a captura e pedir a montagem. Injetado pelo wizard via
   * `componentProps` em vez de resolvido por injeção: este modal é criado pelo
   * `ModalController`, que não enxerga os provedores da página do wizard —
   * `TourDraftStore` mora lá.
   *
   * Subir, e não tratar: a espera da IA deixou de acontecer aqui dentro.
   *
   * Ausente quando não há wizard por trás (bancada de diagnóstico). Aí o modal
   * pula direto para o preview, com o panorama costurado.
   */
  enviar?: (captura: {
    imageData: string;
    frames: CaptureFrameUpload[];
    geometry: CaptureGeometry | null;
  }) => Promise<EnvioDaCaptura | null>;

  /**
   * A foto tratada deste panorama, quando ficar pronta.
   *
   * Devolve `null` quando a IA não melhorou, falhou ou demorou demais — aí a
   * tela fica com o panorama costurado, que é servível, e diz isso.
   */
  aoTratar?: (panoramaId: string) => Promise<string | null>;

  /**
   * Avisa o wizard de que há alguém de olho numa espera de montagem.
   *
   * Só aperta o passo do acompanhamento enquanto esta tela está no ar, para
   * que a foto tratada troque enquanto a pessoa ainda pode vê-la trocar.
   */
  aoOlhar?: (olhando: boolean) => void;

  /** A IA ainda está montando este cômodo. Acende o selo sobre o preview. */
  readonly tratando = signal(false);

  /**
   * O envio em curso. `usePanorama` espera por ele, e SÓ por ele.
   *
   * Existe porque sair antes de o servidor responder deixaria a cena sem
   * `serverPanoramaId`, e o salvamento do rascunho — que cria um panorama para
   * toda cena que não tem um — criaria OUTRO para o mesmo cômodo. Na prática o
   * envio termina enquanto a pessoa digita o nome.
   */
  private envio: Promise<EnvioDaCaptura | null> | null = null;

  /**
   * A tratada, se ela chegou ANTES de o corretor confirmar.
   *
   * Viaja no `dismiss`: a cena nasce pronta e o acompanhamento do wizard não
   * precisa buscar nem baixar de novo o que esta tela já tem em mãos.
   */
  private treatedUrl = '';
  private candidates: Candidate[] = [];
  private lastCandidateMs = 0;
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
    // Aqui, e não no `dismiss`: fechar pelo X, pelo gesto de voltar do Android
    // e pelos botões são três caminhos, e só este passa por todos. Deixar
    // ligado prenderia o acompanhamento no passo rápido para sempre.
    this.aoOlhar?.(false);
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  /**
   * Confirma o cômodo. Com `continuar`, já reabre a câmera no próximo.
   *
   * Espera o ENVIO, e nunca a IA. Na prática ele terminou enquanto a pessoa
   * digitava o nome; quando não terminou, esperar aqui é o que impede a cena
   * de nascer sem `serverPanoramaId` — e o salvamento do rascunho, que cria um
   * panorama para toda cena que não tem um, de criar um SEGUNDO para o mesmo
   * cômodo. O tour saía com a sala duplicada, uma cópia tratada e outra crua.
   */
  async usePanorama(continuar = false): Promise<void> {
    // `originalImageData` e não o que está na tela: o preview pode já estar
    // mostrando a versão tratada, mas quem sobe e quem alimenta o "ver
    // original" da etapa 2 é o panorama como a costura o entregou.
    const imageData = this.originalImageData;
    if (!imageData) {
      this.modalCtrl.dismiss(null, 'cancel');
      return;
    }

    const enviado = this.envio ? await this.envio : null;
    this.serverPanoramaId = enviado?.panoramaId ?? this.serverPanoramaId;
    // The originals ride along so the caller can archive them once the
    // panorama has an id. They stay Blobs: expanding a whole capture to base64
    // here would cost more memory than the stitch itself.
    const frames: CaptureFrameUpload[] = this.stitchedShots.map((shot, index) => ({
      index,
      blob: shot.frame.blob,
      quaternion: shot.quaternion,
    }));
    this.modalCtrl.dismiss(
      {
        imageData,
        frames,
        geometry: this.geometry,
        room: this.roomName().trim(),
        // Já existe quando o envio rodou: o cômodo subiu antes de ter nome, e
        // o wizard não precisa subi-lo de novo no publicar.
        serverPanoramaId: this.serverPanoramaId,
        // Uma das duas, nunca as duas: ou a foto tratada já chegou nesta
        // tela e a cena nasce pronta, ou só a notícia de que há uma a caminho,
        // e aí o acompanhamento de fundo a busca.
        emTratamento: enviado?.tratamentoPedido ?? false,
        treatedUrl: this.treatedUrl,
        continuar,
      },
      'confirm',
    );
  }

  /** Abre a camera com a lente que ela mesma escolhe, e ja entra girando. */
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

      this.rebuildPattern();

      this.state.set('capturing');
      // The overlay and its guidance elements only exist after this turn renders.
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

  /**
   * Ring size asked for on the URL, for comparing counts in the field.
   *
   * The capture ships at `TARGET_RING_SHOTS`, and the reasoning behind that
   * number is written where it lives. What it has never had is a side-by-side
   * on a real room: `?ringShots=12` shoots the old count and `?ringShots=10`
   * the one in between, same room, same afternoon, so the trade can be looked
   * at instead of argued. The geometric minimum still wins if this is set too
   * low — `ringShotCount` sees to that, so the URL cannot ask for a ring with
   * holes.
   */
  private requestedRingShots(): number | undefined {
    const raw = new URLSearchParams(window.location.search).get('ringShots');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 3 && parsed <= 40 ? Math.round(parsed) : undefined;
  }

  /** Recomputes the ring for the active lens. */
  private rebuildPattern(): void {
    const spec = this.camera!.getSpec();
    const options = {
      vfovDeg: spec.vfovDeg ?? 65,
      hfovDeg: hfovFromSpec(spec),
      centerToleranceDeg: DEFAULT_TUNING.centerToleranceDeg,
      targetShotCount: this.requestedRingShots(),
    };
    const targets = buildCapturePattern(options);
    this.session = new CaptureSession(targets, { dwellMs: this.dwellMs() });
    this.shots = [];
    this.totalCount.set(targets.length);
    this.capturedCount.set(0);
  }

  restart(): void {
    this.stopLoop();
    this.discardCandidates();
    this.shots = [];
    this.stitchedShots = [];
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
    this.collectCandidate(now, reading);
    if (this.simMode) {
      // Lets an automated run aim at the current point without guessing the plan.
      (window as unknown as Record<string, unknown>)['__captureTarget'] = this.session.snapshot.currentTarget;
    }

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

  /** Samples the steady tail of a hold so the shot is a choice, not a lottery. */
  private collectCandidate(now: number, reading: OrientationReading): void {
    const snap = this.session!.snapshot;
    if (snap.status !== 'dwelling' || snap.dwellProgress < CANDIDATE_START_PROGRESS) return;
    if (this.candidates.length >= CANDIDATE_LIMIT) return;
    if (now - this.lastCandidateMs < CANDIDATE_INTERVAL_MS) return;

    this.lastCandidateMs = now;
    const canvas = this.camera!.grabFrame();
    this.candidates.push({ canvas, reading, sharpness: sharpnessScore(canvas) });
  }

  private captureShot(reading: OrientationReading): void {
    if (!this.camera) return;

    // The hold may have been cut short, in which case there is nothing banked
    // and the current frame is all there is.
    if (!this.candidates.length) {
      const canvas = this.camera.grabFrame();
      this.candidates.push({ canvas, reading, sharpness: sharpnessScore(canvas) });
    }

    let best = this.candidates[0];
    for (const candidate of this.candidates) {
      if (candidate.sharpness > best.sharpness) best = candidate;
    }
    for (const candidate of this.candidates) {
      if (candidate !== best) releaseCanvas(candidate.canvas);
    }
    this.candidates = [];

    const q = best.reading.q;
    const quaternion = { x: q.x, y: q.y, z: q.z, w: q.w };
    // storeFrame takes the canvas over: it encodes, keeps a thumbnail and frees
    // the pixels, so nothing full-size survives the capture uncompressed.
    this.shots.push(storeFrame(best.canvas).then((frame) => ({ frame, quaternion })));

    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => navigator.vibrate?.(40));
    this.zone.run(() => this.capturedCount.set(this.shots.length));
  }

  private async stitch(): Promise<void> {
    this.state.set('stitching');
    try {
      // Let the spinner paint before the heavy stretch begins.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const spec = this.camera!.getSpec();
      const shots = await Promise.all(this.shots);
      this.stitchedShots = shots;
      if (this.simMode) {
        // Re-stitching the same capture with different settings is free now
        // that the frames are kept as bytes rather than consumed as canvases.
        (window as unknown as Record<string, unknown>)['__restitch'] =
          (opts: Record<string, unknown>) => stitchEquirect(shots, spec, opts);
      }
      const result = await stitchEquirect(shots, spec);
      this.geometry = {
        fittedVfovDeg: result.vfovDeg,
        bandTopDeg: result.coveredBand.topDeg,
        bandBottomDeg: result.coveredBand.bottomDeg,
      };
      if (this.simMode) {
        // Lets an automated run diff the stitch against SimEnvironment.groundTruth.
        (window as unknown as Record<string, unknown>)['__captureResult'] = result;
      }
      this.originalImageData = result.imageData;
      await this.tratarEEntao(result.imageData);
    } catch {
      this.fail('CAPTURE.STITCH_ERROR');
    }
  }

  /**
   * Entrega o preview e deixa a IA para trás.
   *
   * Este método SEGURAVA a tela até a montagem terminar, para que o corretor
   * visse o resultado bom no instante de maior atenção — logo depois de girar
   * 360° com o celular. A razão era boa e o custo virou grande: a espera chega
   * a um minuto e meio por cômodo, paga uma vez por cômodo, em pé, dentro do
   * imóvel.
   *
   * Agora o preview entra com o panorama COSTURADO e um selo dizendo que a IA
   * ainda está melhorando, e a tratada troca a foto por baixo quando chega.
   * Isso responde à objeção que derrubou a primeira tentativa de segundo
   * plano: o que ela entregava era o cru SEM AVISO, e ele se lia como
   * resultado final. Com o selo, ele se lê como provisório — e quem esperar
   * dez segundos vê a foto boa aparecer sozinha.
   *
   * O ENVIO continua aguardado, só que em `usePanorama` e não aqui: ver o
   * campo `envio`.
   *
   * O caminho sem `enviar` existe para a bancada de diagnóstico, que abre este
   * modal fora do wizard.
   */
  private tratarEEntao(costurado: string): void {
    const frames: CaptureFrameUpload[] = this.stitchedShots.map((shot, index) => ({
      index,
      blob: shot.frame.blob,
      quaternion: shot.quaternion,
    }));

    if (!this.enviar || !frames.length) {
      this.zone.run(() => this.mostrarPreview(costurado));
      return;
    }

    this.zone.run(() => {
      this.tratando.set(true);
      // Alguém está de olho NESTA espera: aperta o passo do acompanhamento,
      // para que a troca da foto aconteça enquanto a pessoa ainda está aqui.
      this.aoOlhar?.(true);
      this.mostrarPreview(costurado);
    });

    // Sem `await`: é isto que devolve a tela ao corretor. O `catch` mora na
    // promessa guardada, e não num `try` aqui, porque quem a consome é
    // `usePanorama` — uma rejeição solta viraria `unhandledrejection`.
    this.envio = this.enviar({
      imageData: costurado,
      frames,
      geometry: this.geometry,
    }).catch(() => null);

    void this.trocarQuandoChegar();
  }

  /**
   * Espera a montagem sem prender ninguém, e troca a foto quando ela chega.
   *
   * É a outra metade do selo. Sem isto ele acende e NUNCA apaga — o cômodo
   * fica "melhorando com IA" para sempre na tela, e a promessa de ver a foto
   * boa trocar sozinha nunca se cumpre. Foi assim que este modal foi parar em
   * produção na primeira versão desta entrega.
   *
   * Quem sai antes não perde nada: o cômodo já subiu, o servidor termina
   * sozinho e o card da etapa 1 recebe a foto pelo acompanhamento de fundo.
   */
  private async trocarQuandoChegar(): Promise<void> {
    const enviado = this.envio ? await this.envio : null;

    // Sem montagem a caminho não há o que esperar: ou o envio falhou, ou o
    // servidor vai dispensar por ter poucas fotos de referência.
    if (!enviado?.tratamentoPedido || !this.aoTratar) {
      this.zone.run(() => {
        this.tratando.set(false);
        this.naoMelhorou.set(true);
      });
      return;
    }

    const url = await this.aoTratar(enviado.panoramaId).catch(() => null);

    this.zone.run(() => {
      this.tratando.set(false);
      this.naoMelhorou.set(!url);
      if (!url) return;
      this.treatedUrl = url;
      // O costurado continua guardado em `originalImageData`: é ele que sobe
      // e que alimenta o "ver original" da etapa 2.
      this.mostrarPreview(url);
    });
  }

  private mostrarPreview(imageUrl: string): void {
    this.previewPanoramas.set([{
      id: 'capture-preview',
      roomName: '',
      // Ou a dataURL local da costura, ou o `blob:` da tratada que veio do
      // servidor. `urlDaImagem` reconhece os dois e devolve como estão.
      imageUrl,
      order: 0,
      initialPanorama: true,
      originHotspots: [],
      measurements: [],
    }]);
    this.state.set('preview');
  }

  private fail(key: string): void {
    this.zone.run(() => {
      this.errorKey.set(key);
      this.state.set('error');
    });
  }

  private discardCandidates(): void {
    for (const candidate of this.candidates) releaseCanvas(candidate.canvas);
    this.candidates = [];
    this.lastCandidateMs = 0;
  }

  private teardownSources(): void {
    this.stopLoop();
    this.discardCandidates();
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

    this.updateHint(snap);
  }

  private updateHint(snap: CaptureSession['snapshot']): void {
    const hint = snap.status === 'dwelling'
      ? 'CAPTURE.HOLD_HINT'
      : !snap.steady
        ? 'CAPTURE.STEADY_HINT'
        : 'CAPTURE.ALIGN_HINT';
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      this.zone.run(() => this.hintKey.set(hint));
    }
  }
}
