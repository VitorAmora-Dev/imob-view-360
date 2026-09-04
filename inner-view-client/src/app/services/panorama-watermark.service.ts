import { Injectable } from '@angular/core';

const WATERMARK_ASSET = 'assets/brand/arp-vision-horizontal-white.svg';
const WATERMARK_WIDTH_RATIO = 0.18;
const WATERMARK_BACKDROP = 'rgba(0, 0, 0, 0.58)';
const JPEG_QUALITY = 0.92;

type DecodedImage = ImageBitmap | HTMLImageElement;

export interface WatermarkLayout {
  logoX: number;
  logoY: number;
  logoWidth: number;
  logoHeight: number;
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
  panelRadius: number;
}

/**
 * Calcula a assinatura proporcionalmente à foto, sem assumir uma resolução
 * específica. A altura também limita a logo para imagens fora do formato 2:1.
 */
export function calculateWatermarkLayout(
  imageWidth: number,
  imageHeight: number,
  logoAspectRatio: number,
): WatermarkLayout {
  const safeWidth = Math.max(1, imageWidth);
  const safeHeight = Math.max(1, imageHeight);
  const safeAspectRatio = Math.max(0.01, logoAspectRatio);
  const margin = Math.max(8, Math.round(Math.min(safeWidth, safeHeight) * 0.025));
  const logoWidth = Math.max(
    1,
    Math.round(Math.min(safeWidth * WATERMARK_WIDTH_RATIO, safeHeight * 0.6 * safeAspectRatio)),
  );
  const logoHeight = Math.max(1, Math.round(logoWidth / safeAspectRatio));
  const horizontalPadding = Math.max(6, Math.round(logoWidth * 0.055));
  const verticalPadding = Math.max(5, Math.round(logoHeight * 0.22));
  const panelWidth = logoWidth + horizontalPadding * 2;
  const panelHeight = logoHeight + verticalPadding * 2;
  const panelX = Math.max(0, safeWidth - margin - panelWidth);
  const panelY = Math.max(0, safeHeight - margin - panelHeight);

  return {
    logoX: panelX + horizontalPadding,
    logoY: panelY + verticalPadding,
    logoWidth,
    logoHeight,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    panelRadius: Math.max(4, Math.round(panelHeight * 0.18)),
  };
}

/** Gera uma cópia JPEG do panorama com a assinatura ARP VISION. */
@Injectable({ providedIn: 'root' })
export class PanoramaWatermarkService {
  /**
   * Aplica a marca a um `blob:` já pertencente ao cache autenticado.
   * A validação impede que este atalho vire, sem querer, uma segunda rota de
   * rede ou volte a usar a URL pública que não serve tours em rascunho.
   */
  async applyFromObjectUrl(sourceUrl: string): Promise<Blob> {
    if (!sourceUrl.startsWith('blob:')) {
      throw new Error('A origem da marca d\'água precisa ser um object URL');
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Falha ao ler panorama do cache: HTTP ${response.status}`);
    return this.apply(await response.blob());
  }

  async apply(sourceBlob: Blob): Promise<Blob> {
    const source = await decodeImage(sourceBlob);
    let logo: DecodedImage | null = null;
    const canvas = document.createElement('canvas');

    try {
      logo = await this.loadWatermark();
      canvas.width = source.width;
      canvas.height = source.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D indisponível');

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      const layout = calculateWatermarkLayout(
        canvas.width,
        canvas.height,
        logo.width / Math.max(1, logo.height),
      );

      context.save();
      roundedRectangle(
        context,
        layout.panelX,
        layout.panelY,
        layout.panelWidth,
        layout.panelHeight,
        layout.panelRadius,
      );
      context.fillStyle = WATERMARK_BACKDROP;
      context.fill();
      context.globalAlpha = 0.94;
      context.drawImage(
        logo,
        layout.logoX,
        layout.logoY,
        layout.logoWidth,
        layout.logoHeight,
      );
      context.restore();

      return await canvasToJpeg(canvas);
    } finally {
      closeDecodedImage(source);
      if (logo) closeDecodedImage(logo);
      // Solta imediatamente o backing store, relevante para panoramas 5K.
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  private async loadWatermark(): Promise<DecodedImage> {
    const response = await fetch(WATERMARK_ASSET);
    if (!response.ok) throw new Error(`Falha ao carregar marca d'água: HTTP ${response.status}`);
    return decodeImage(await response.blob());
  }
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // SVG em versões antigas do Safari precisa passar por HTMLImageElement.
    }
  }

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

function closeDecodedImage(image: DecodedImage): void {
  if ('close' in image && typeof image.close === 'function') image.close();
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Falha ao codificar panorama')),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

function roundedRectangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}
