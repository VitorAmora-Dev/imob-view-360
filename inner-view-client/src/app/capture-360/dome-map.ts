import { TILES_PER_BAND } from './capture-360.types';

/**
 * Mapa de progresso do domo, em anel (visão de cima) — inspirado no inset
 * "Formação do Círculo 360°" da referência. Oito fatias; cada fatia tem o anel
 * externo (faixa superior) e o interno (faixa inferior). Zênite e nadir são os
 * dois discos concêntricos no centro. Verde = capturada, branco = a atual,
 * tênue = a fazer.
 *
 * Puro (só desenha no ctx recebido) — o componente decide onde e quando chamar.
 */
export interface DomeMapState {
  capturedKeys: ReadonlySet<string>;
  currentKey: string;
}

const GREEN = 'rgba(34,197,94,0.85)';
const CURRENT = 'rgba(255,255,255,0.95)';
const TODO = 'rgba(255,255,255,0.18)';
const STROKE = 'rgba(255,255,255,0.5)';

function fillFor(key: string, s: DomeMapState): string {
  if (key === s.currentKey) return CURRENT;
  if (s.capturedKeys.has(key)) return GREEN;
  return TODO;
}

function annularSector(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  a0: number,
  a1: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, rOut, a0, a1);
  ctx.arc(cx, cy, rIn, a1, a0, true);
  ctx.closePath();
}

export function drawDomeMap(ctx: CanvasRenderingContext2D, state: DomeMapState): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const outerR = Math.min(w, h) * 0.46;
  const midR = outerR * 0.7;
  const innerR = outerR * 0.44;
  const nadirR = outerR * 0.28;
  const zenithR = outerR * 0.15;

  const seg = (2 * Math.PI) / TILES_PER_BAND;
  const gap = seg * 0.06;

  for (let k = 0; k < TILES_PER_BAND; k++) {
    // fatia k centrada no topo (−90°) girando no sentido horário
    const a0 = -Math.PI / 2 + k * seg + gap;
    const a1 = -Math.PI / 2 + (k + 1) * seg - gap;

    annularSector(ctx, cx, cy, midR, outerR, a0, a1);
    ctx.fillStyle = fillFor(`upper:${k}`, state);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = STROKE;
    ctx.stroke();

    annularSector(ctx, cx, cy, innerR, midR, a0, a1);
    ctx.fillStyle = fillFor(`lower:${k}`, state);
    ctx.fill();
    ctx.stroke();
  }

  // nadir: anel; zênite: disco central
  ctx.beginPath();
  ctx.arc(cx, cy, nadirR, 0, 2 * Math.PI);
  ctx.arc(cx, cy, zenithR, 0, 2 * Math.PI, true);
  ctx.fillStyle = fillFor('nadir', state);
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, zenithR, 0, 2 * Math.PI);
  ctx.fillStyle = fillFor('zenith', state);
  ctx.fill();
  ctx.stroke();
}
