import { Band } from './capture-360.types';
import { CameraModel, FrameRect, goreOutline, maskFitsFrame, Point2 } from './camera-projection';

export interface MaskGeometry {
  /** Contorno do gomo em coordenadas do FRAME (não do canvas). */
  path: Path2D;
  /** O contorno cabe no frame inteiro (sem considerar o crop do cover). */
  fits: boolean;
}

/** Mapeia coordenadas do frame para o canvas que exibe o vídeo com object-fit: cover. */
export interface CoverTransform {
  scale: number;
  dx: number;
  dy: number;
}

/**
 * Constrói o contorno do gomo. Equador e meridianos são grandes círculos pelo
 * centro da esfera → retas (lineTo). O paralelo ±40° projeta curva → um
 * quadraticCurveTo por par de amostras, com o ponto de controle
 * c = 2·M − (p0+p1)/2, que faz a quadrática passar exatamente pelo ponto
 * médio amostrado M (B(0.5) = ¼p0 + ½c + ¼p1).
 */
export function buildMaskGeometry(cam: CameraModel, band: Band, curveSegments = 8): MaskGeometry {
  const { equatorLeft, equatorRight, parallel } = goreOutline(cam, band, 2 * curveSegments);

  const path = new Path2D();
  path.moveTo(equatorLeft.x, equatorLeft.y);
  path.lineTo(equatorRight.x, equatorRight.y);
  // meridiano +22.5°: reta até a ponta direita do paralelo curvo
  const last = parallel[2 * curveSegments];
  path.lineTo(last.x, last.y);
  // paralelo: quadráticas da direita para a esquerda
  for (let k = curveSegments - 1; k >= 0; k--) {
    const p0 = parallel[2 * k + 2];
    const mid = parallel[2 * k + 1];
    const p1 = parallel[2 * k];
    const cx = 2 * mid.x - (p0.x + p1.x) / 2;
    const cy = 2 * mid.y - (p0.y + p1.y) / 2;
    path.quadraticCurveTo(cx, cy, p1.x, p1.y);
  }
  path.closePath(); // meridiano −22.5°: reta de volta ao início

  return { path, fits: maskFitsFrame(cam, band) };
}

/**
 * object-fit: cover — o vídeo é escalado para COBRIR o canvas, cortando as
 * sobras. scale = max dos dois eixos; offsets centralizam (ficam negativos no
 * eixo cortado). canvasPx = framePx·scale + offset.
 */
export function coverTransform(
  frameW: number,
  frameH: number,
  canvasW: number,
  canvasH: number,
): CoverTransform {
  const scale = Math.max(canvasW / frameW, canvasH / frameH);
  return {
    scale,
    dx: (canvasW - frameW * scale) / 2,
    dy: (canvasH - frameH * scale) / 2,
  };
}

/** Região do frame que sobrevive ao crop do cover — é contra ela que o fit-check roda. */
export function visibleFrameRect(
  frameW: number,
  frameH: number,
  canvasW: number,
  canvasH: number,
): FrameRect {
  const { scale, dx, dy } = coverTransform(frameW, frameH, canvasW, canvasH);
  return {
    x: -dx / scale,
    y: -dy / scale,
    width: canvasW / scale,
    height: canvasH / scale,
  };
}

/**
 * Desenha o véu translúcido com a janela do gomo recortada e a borda.
 * O ctx deve estar com transform identidade; o path está em coordenadas do
 * frame e entra pelo setTransform do cover.
 */
export function drawMaskOverlay(
  ctx: CanvasRenderingContext2D,
  geo: MaskGeometry,
  t: CoverTransform,
  strokeColor = '#ff385c',
): void {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, width, height);

  ctx.setTransform(t.scale, 0, 0, t.scale, t.dx, t.dy);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.fill(geo.path);

  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 3 / t.scale;
  ctx.stroke(geo.path);
  ctx.restore();
}

/** Ponto médio do gomo projetado — âncora para posicionar hints sobre a janela. */
export function maskAnchor(cam: CameraModel, band: Band): Point2 {
  const { equatorLeft, equatorRight, parallel } = goreOutline(cam, band, 2);
  const mid = parallel[1];
  return {
    x: (equatorLeft.x + equatorRight.x + 2 * mid.x) / 4,
    y: (equatorLeft.y + equatorRight.y + 2 * mid.y) / 4,
  };
}
