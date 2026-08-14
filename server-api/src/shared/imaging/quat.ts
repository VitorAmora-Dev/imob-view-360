import { Vec3 } from './cubemap';

/**
 * O mínimo de álgebra de quaternion que os scripts precisam.
 *
 * Existe separado porque tanto a máscara de cobertura quanto a fotometria fazem
 * exatamente a mesma pergunta — "onde este frame enxerga esta direção?" — e uma
 * segunda cópia da rotação é o tipo de duplicação que só se descobre quando as
 * duas divergem.
 */

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Para quaternion unitário, a conjugada é a rotação inversa. */
export function conjugar(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** v' = q · v · q⁻¹. */
export function rotacionar(q: Quaternion, v: Vec3): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/**
 * Regra de projeção do stitcher (`PROJECT_GLSL` em capture-360/stitcher.ts):
 * a câmera olha para -Z e o pixel só existe se cair dentro do frame.
 *
 * `margem` encolhe o retângulo aceito — a fotometria usa isso para fugir da
 * vinheta da borda, enquanto a cobertura usa o frame inteiro.
 */
export function projetarNdc(
  conjugada: Quaternion,
  dir: Vec3,
  tanHalfH: number,
  tanHalfV: number,
  margem = 1,
): { x: number; y: number } | null {
  const cam = rotacionar(conjugada, dir);
  if (cam.z > -0.001) return null;

  const x = cam.x / -cam.z / tanHalfH;
  const y = cam.y / -cam.z / tanHalfV;
  if (Math.abs(x) >= margem || Math.abs(y) >= margem) return null;

  return { x, y };
}
