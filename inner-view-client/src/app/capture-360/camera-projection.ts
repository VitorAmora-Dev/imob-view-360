import { Band, BAND_PITCH_DEG, LAT_SPAN_DEG, LON_SPAN_DEG } from './capture-360.types';

/**
 * Modelo pinhole da câmera posicionada no centro da esfera.
 *
 * ÚNICA fonte de verdade da projeção: a máscara (o que o usuário enquadra) e o
 * warp (o que o recorte extrai) importam daqui. Se as duas coisas usassem
 * modelos diferentes, o enquadramento e o recorte divergiriam.
 *
 * Convenções:
 * - Base da câmera com pitch φ0 (positivo = olhando para cima):
 *   forward f = (0, sinφ0, cosφ0), right r = (1, 0, 0), up u = (0, cosφ0, −sinφ0).
 * - Direção esférica: d(lon, lat) = (cosLat·sinLon, sinLat, cosLat·cosLon).
 * - Projeção normalizada: x = d·r/d·f, y = d·u/d·f (y cresce para CIMA).
 * - Pixel do frame (origem no topo-esquerdo, y de tela cresce para BAIXO):
 *   px = width/2 + focal·x ; py = height/2 − focal·y.
 * - focal = (height/2)/tan(vFov/2), em pixels quadrados (fx = fy).
 *
 * Consequências geométricas (cobertas por teste):
 * - O equador e os meridianos são grandes círculos pelo centro → projetam RETAS.
 * - O paralelo ±40° projeta uma CURVA côncava (bordas mais altas que o centro).
 * - A razão topo/base do gomo projetado é ~0.7515 — não cos40° = 0.766, que é a
 *   razão na superfície esférica; a perspectiva encurta um pouco mais.
 */
export interface CameraModel {
  /** +BAND_PITCH_DEG (faixa superior) ou −BAND_PITCH_DEG (inferior). */
  pitchDeg: number;
  vFovDeg: number;
  /** Dimensões do frame nativo do vídeo, em px. */
  width: number;
  height: number;
}

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** Retângulo em coordenadas do frame (para o fit-check contra a área visível pós object-fit: cover). */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEG = Math.PI / 180;
const EPS = 1e-9;

export function pitchForBand(band: Band): number {
  return band === 'upper' ? BAND_PITCH_DEG : -BAND_PITCH_DEG;
}

export function focalPx(cam: CameraModel): number {
  return cam.height / 2 / Math.tan((cam.vFovDeg / 2) * DEG);
}

/**
 * (lon, lat) em graus → pixel do frame. Retorna null se a direção estiver
 * atrás do plano da câmera (d·f ≤ 0) — não acontece dentro do gomo com os
 * pitches usados, mas a guarda evita divisão por ~0 em usos fora dele.
 */
export function projectLonLat(cam: CameraModel, lonDeg: number, latDeg: number): Point2 | null {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const phi = cam.pitchDeg * DEG;

  const dx = Math.cos(lat) * Math.sin(lon);
  const dy = Math.sin(lat);
  const dz = Math.cos(lat) * Math.cos(lon);

  const df = dy * Math.sin(phi) + dz * Math.cos(phi);
  if (df <= EPS) return null;
  const du = dy * Math.cos(phi) - dz * Math.sin(phi);

  const f = focalPx(cam);
  return {
    x: cam.width / 2 + f * (dx / df),
    y: cam.height / 2 - f * (du / df),
  };
}

/**
 * segments+1 pontos do paralelo latDeg entre lonMin..lonMax, em ordem.
 * É a amostragem usada para desenhar a borda curva da máscara.
 */
export function sampleParallel(
  cam: CameraModel,
  latDeg: number,
  lonMinDeg: number,
  lonMaxDeg: number,
  segments: number,
): Point2[] {
  const points: Point2[] = [];
  for (let k = 0; k <= segments; k++) {
    const lon = lonMinDeg + ((lonMaxDeg - lonMinDeg) * k) / segments;
    const p = projectLonLat(cam, lon, latDeg);
    if (!p) {
      throw new Error(`sampleParallel: direção fora do plano da câmera (lat ${latDeg}, lon ${lon})`);
    }
    points.push(p);
  }
  return points;
}

/**
 * Contorno do gomo da faixa: equador (reta) + meridianos (retas) + paralelo
 * curvo amostrado. Usado pela máscara e pelo fit-check — mesma amostragem.
 */
export function goreOutline(
  cam: CameraModel,
  band: Band,
  curveSamples = 16,
): { equatorLeft: Point2; equatorRight: Point2; parallel: Point2[] } {
  const halfLon = LON_SPAN_DEG / 2;
  const farLat = band === 'upper' ? LAT_SPAN_DEG : -LAT_SPAN_DEG;
  const equatorLeft = projectLonLat(cam, -halfLon, 0);
  const equatorRight = projectLonLat(cam, halfLon, 0);
  if (!equatorLeft || !equatorRight) {
    throw new Error('goreOutline: equador fora do plano da câmera');
  }
  return {
    equatorLeft,
    equatorRight,
    parallel: sampleParallel(cam, farLat, -halfLon, halfLon, curveSamples),
  };
}

/**
 * true se o contorno inteiro do gomo cabe em `visible` (por padrão, o frame
 * inteiro). O componente passa o retângulo visível pós object-fit: cover —
 * o que importa é o que o usuário consegue VER, não o que o sensor captura.
 */
export function maskFitsFrame(cam: CameraModel, band: Band, visible?: FrameRect): boolean {
  const rect: FrameRect = visible ?? { x: 0, y: 0, width: cam.width, height: cam.height };
  const { equatorLeft, equatorRight, parallel } = goreOutline(cam, band);
  const all = [equatorLeft, equatorRight, ...parallel];
  return all.every(
    (p) =>
      p.x >= rect.x &&
      p.x <= rect.x + rect.width &&
      p.y >= rect.y &&
      p.y <= rect.y + rect.height,
  );
}
