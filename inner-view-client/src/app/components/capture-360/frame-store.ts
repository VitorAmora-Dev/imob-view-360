/**
 * Captured frames are held as JPEG bytes, never as decoded canvases.
 *
 * A 1536×2048 frame costs ~12 MB as RGBA and ~0.6 MB as JPEG. Holding a dozen
 * of them decoded is what forced every frame to be shrunk to fit a memory
 * budget, and what put a longer capture over the limit at which iOS terminates
 * the tab (which reloads the page and loses everything). Keeping the bytes
 * compressed removes that ceiling: frames stay at full resolution, they are
 * already in the shape the upload wants, and the stitch decodes them one at a
 * time.
 *
 * Every analysis pass — profiles, alignment, sharpness — reads the small
 * decoded thumbnail instead. None of them needs more pixels than that.
 */
export interface CapturedFrame {
  /** Full-resolution JPEG: the only complete copy that survives the capture. */
  readonly blob: Blob;
  /** Small decoded copy the analysis passes read. */
  readonly thumbnail: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
}

/**
 * Short side of the thumbnail. The angular profile samples ~0.25°/step over a
 * ~92° frame, so anything past ~400 px along that axis is wasted; 512 leaves
 * headroom for the 2-D alignment search without the set costing more than a
 * couple of the full frames it replaces.
 */
export const THUMBNAIL_MIN_SIDE = 512;

/**
 * Quality for the retained bytes. These are re-projected, not viewed directly,
 * and they are what a later pass (or the AI step) has to work from, so this
 * sits above the 0.85 used for the finished panorama.
 */
export const CAPTURE_JPEG_QUALITY = 0.9;

/**
 * Takes ownership of `canvas`: encodes it, builds the thumbnail, then releases
 * the pixels. The caller must not use the canvas afterwards.
 */
export async function storeFrame(
  canvas: HTMLCanvasElement,
  quality = CAPTURE_JPEG_QUALITY,
): Promise<CapturedFrame> {
  const width = canvas.width;
  const height = canvas.height;
  const blob = await toJpegBlob(canvas, quality);
  const thumbnail = shrinkToShortSide(canvas, THUMBNAIL_MIN_SIDE);
  releaseCanvas(canvas);
  return { blob, thumbnail, width, height };
}

/** Caller owns the result and must `close()` it. */
export function decodeFrame(frame: CapturedFrame): Promise<ImageBitmap | HTMLImageElement> {
  return decodeBlob(frame.blob);
}

async function decodeBlob(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  // Older Safari has no createImageBitmap; an <img> is a valid texture source
  // too, it just cannot be closed explicitly.
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Rebuilds a frame from bytes that were already encoded — an archived original,
 * read back so a capture can be stitched again without being retaken.
 *
 * The bytes are passed through untouched, so a re-stitch starts from exactly
 * what the camera produced; only the thumbnail is decoded, and straight at its
 * final size rather than through a full-resolution canvas.
 */
export async function frameFromBlob(blob: Blob): Promise<CapturedFrame> {
  const decoded = await decodeBlob(blob);
  const width = decoded.width;
  const height = decoded.height;

  const scale = Math.min(1, THUMBNAIL_MIN_SIDE / Math.max(1, Math.min(width, height)));
  const thumbnail = document.createElement('canvas');
  thumbnail.width = Math.max(1, Math.round(width * scale));
  thumbnail.height = Math.max(1, Math.round(height * scale));
  const ctx = thumbnail.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded, 0, 0, thumbnail.width, thumbnail.height);
  closeDecoded(decoded);

  return { blob, thumbnail, width, height };
}

export function closeDecoded(decoded: ImageBitmap | HTMLImageElement): void {
  if ('close' in decoded) decoded.close();
}

/**
 * Sum of absolute neighbour differences on a downscaled luma copy — a plain
 * sharpness reading. Only ever compared between candidates of the same scene
 * within the same instant, so it needs to rank, not to have a unit.
 */
export function sharpnessScore(canvas: HTMLCanvasElement): number {
  const small = shrinkToShortSide(canvas, 192);
  const w = small.width;
  const h = small.height;
  const data = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  const luma = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  let energy = 0;
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4;
      const here = luma(i);
      energy += Math.abs(here - luma(i - 4)) + Math.abs(here - luma(i - w * 4));
    }
  }
  releaseCanvas(small);
  return energy / ((w - 1) * (h - 1));
}

/** Frees the backing store of a canvas that is no longer needed. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function shrinkToShortSide(source: HTMLCanvasElement, shortSide: number): HTMLCanvasElement {
  const scale = Math.min(1, shortSide / Math.max(1, Math.min(source.width, source.height)));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('frame encoding failed'))),
      'image/jpeg',
      quality,
    );
  });
}
