import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CameraSpec, ULTRAWIDE_PRIOR_VFOV } from './capture-sources';
import { CapturedFrame, frameFromBlob } from './frame-store';
import { BlendMode, StitchResult, StitchShot, stitchEquirect } from './stitcher';

/**
 * Re-stitches an archived capture, offline, from the folder the export script
 * writes.
 *
 * Every measurement that shaped this feature until now came from the simulated
 * room, and the simulation kept failing to reproduce what the phone actually
 * did — it could not show the FOV fit collapsing, or the exposure patchwork, or
 * the pinwheel at the poles. Those only appeared on real captures, which took a
 * phone, a room and a tunnel to produce.
 *
 * Keeping the original photos (with the orientation of each) was meant to buy
 * exactly this: the same capture can be stitched again, as many times as
 * wanted, with settings changed between runs and the numbers compared. No
 * device, no re-shoot, no network.
 *
 * Point it at `imagens-exportadas/fotos-originais/<capture>/`, which holds
 * `00.jpg`…`11.jpg` and `orientacoes.json`.
 */
interface LoadedCapture {
  name: string;
  shots: StitchShot[];
  frameAspect: number;
  frameSize: string;
}

interface RunResult {
  label: string;
  vfovDeg: number;
  measuredVfovDeg: number;
  coveredBandDeg: string;
  spherePhotographed: number;
  vignetteA: number;
  seamSpreadDeg: number;
  loopClosure: string;
  /** 99th percentile of low-frequency column-to-column brightness steps. */
  exposureStep: number;
  imageData: string;
  millis: number;
}

@Component({
  selector: 'app-restitch-harness',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './restitch-harness.component.scss',
  templateUrl: './restitch-harness.component.html',
})
export class RestitchHarnessComponent {
  readonly capture = signal<LoadedCapture | null>(null);
  readonly runs = signal<RunResult[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');

  priorVfov = ULTRAWIDE_PRIOR_VFOV;
  routeSeam = true;
  photometry = true;
  fitFov = false;
  blendMode: BlendMode = 'seam';
  outWidth = 4096;

  async onFolder(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    this.error.set('');
    this.busy.set(true);
    try {
      this.capture.set(await this.load(files));
      this.runs.set([]);
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : String(cause));
      this.capture.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(files: File[]): Promise<LoadedCapture> {
    const manifest = files.find((f) => f.name === 'orientacoes.json');
    if (!manifest) {
      throw new Error('orientacoes.json não encontrado — escolha a pasta de uma captura exportada');
    }

    const entries: { arquivo: string; quaternion: { x: number; y: number; z: number; w: number } }[] =
      JSON.parse(await manifest.text());

    const byName = new Map(files.map((f) => [f.name, f]));
    const frames: CapturedFrame[] = [];
    const shots: StitchShot[] = [];
    for (const entry of entries) {
      const file = byName.get(entry.arquivo);
      if (!file) throw new Error(`foto ${entry.arquivo} listada no manifesto mas ausente`);
      const frame = await frameFromBlob(file);
      frames.push(frame);
      shots.push({ frame, quaternion: entry.quaternion });
    }
    if (shots.length < 3) throw new Error('menos de 3 fotos: não há anel para medir');

    const first = frames[0];
    const folder = manifest.webkitRelativePath.split('/')[0] || 'captura';
    return {
      name: `${folder} — ${shots.length} fotos`,
      shots,
      frameAspect: first.width / first.height,
      frameSize: `${first.width}×${first.height}`,
    };
  }

  async run(): Promise<void> {
    const capture = this.capture();
    if (!capture || this.busy()) return;

    this.busy.set(true);
    this.error.set('');
    try {
      const spec: CameraSpec = {
        vfovDeg: this.priorVfov,
        frameAspect: capture.frameAspect,
        wideShapeAccepted: true,
      };
      const started = performance.now();
      const result = await stitchEquirect(capture.shots, spec, {
        blendMode: this.blendMode,
        routeSeam: this.routeSeam,
        photometry: this.photometry,
        fitFov: this.fitFov,
        outWidth: this.outWidth,
        outHeight: this.outWidth / 2,
      });
      const millis = performance.now() - started;
      const step = await exposureStep(result.imageData, result.coveredBand);

      this.runs.update((previous) => [
        ...previous,
        {
          label:
            `prior ${this.priorVfov}° · ${this.blendMode}` +
            `${this.routeSeam ? ' · emenda roteada' : ''}` +
            `${this.photometry ? ' · fotometria' : ' · SEM fotometria'}` +
            `${this.fitFov ? ' · FOV medido' : ' · FOV do prior'}`,
          vfovDeg: round(result.vfovDeg, 1),
          measuredVfovDeg: round(result.measuredVfovDeg, 1),
          coveredBandDeg: `${round(result.coveredBand.bottomDeg, 1)}° … ${round(result.coveredBand.topDeg, 1)}°`,
          spherePhotographed: round(fractionOfSphere(result.coveredBand) * 100, 1),
          vignetteA: round(result.vignetteA, 3),
          seamSpreadDeg: round(result.seamSpreadDeg, 2),
          loopClosure: axisLabel(result.loopClosureDeg),
          exposureStep: round(step, 2),
          imageData: result.imageData,
          millis: Math.round(millis),
        },
      ]);
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : String(cause));
    } finally {
      this.busy.set(false);
    }
  }

  clear(): void {
    this.runs.set([]);
  }

  download(run: RunResult): void {
    const link = document.createElement('a');
    link.href = run.imageData;
    link.download = `${this.capture()?.name.split(' ')[0] ?? 'panorama'}-${run.vfovDeg}.jpg`;
    link.click();
  }

  trackByLabel(index: number): number {
    return index;
  }
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function axisLabel(axes: { yawDeg: number; pitchDeg: number; rollDeg: number }): string {
  return `${round(axes.yawDeg, 2)}° / ${round(axes.pitchDeg, 2)}° / ${round(axes.rollDeg, 2)}°`;
}

/** Share of the sphere between two latitudes — the part that is real pixels. */
function fractionOfSphere(band: { topDeg: number; bottomDeg: number }): number {
  const sin = (deg: number) => Math.sin((deg * Math.PI) / 180);
  return Math.max(0, (sin(band.topDeg) - sin(band.bottomDeg)) / 2);
}

/**
 * The worst full-height brightness step in the panorama.
 *
 * The distinguishing feature of an exposure seam is not that it is a big jump —
 * a door frame against a lit window is a far bigger one — but that it runs the
 * WHOLE height of the image with the same sign, because it is the boundary
 * between two photographs rather than between two things in the room. So the
 * step is taken as the median down each column: real edges occupy part of a
 * column and wash out of a median, a seam does not.
 *
 * Reported as the worst column, in 0–255 levels. Roughly: under 2 is invisible,
 * over 6 is the hard-edged patchwork the real captures showed on white ceilings.
 */
async function exposureStep(
  imageData: string,
  band: { topDeg: number; bottomDeg: number },
): Promise<number> {
  const image = new Image();
  image.src = imageData;
  await image.decode();

  const width = 256;
  const height = 128;
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;

  // Only inside the photographed band: the fill is smooth by construction and
  // would flatter the number.
  const rowOf = (lat: number) => Math.round(((90 - lat) / 180) * height);
  const from = Math.max(1, rowOf(band.topDeg));
  const to = Math.min(height, rowOf(band.bottomDeg));

  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  if (to - from < 3) return 0;

  let worst = 0;
  for (let x = 0; x < width; x++) {
    const column: number[] = [];
    for (let y = from; y < to; y++) column.push(luma((x + 1) % width, y) - luma(x, y));
    column.sort((a, b) => a - b);
    worst = Math.max(worst, Math.abs(column[column.length >> 1]));
  }
  return worst;
}
