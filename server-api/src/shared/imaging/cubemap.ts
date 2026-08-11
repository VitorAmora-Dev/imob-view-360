/**
 * Conversão entre o equirretangular e as seis faces de um cubemap.
 *
 * Existe por um motivo só: nenhum modelo generativo entende projeção
 * equirretangular. Mandar o equirect inteiro faz o modelo "corrigir" a curvatura
 * senoidal — que está certa —, esticar os polos e ignorar que a coluna 0 encosta
 * na coluna N. Uma face de cubemap é uma imagem em perspectiva comum, de 90°,
 * que é o domínio em que esses modelos foram treinados.
 *
 * A convenção de esfera é a MESMA do stitcher do cliente (`PROJECT_GLSL` em
 * capture-360/stitcher.ts), senão o que volta não assenta sobre o que saiu:
 *
 *   phi   = u * 2π          (u = 0 na coluna 0, cresce para a direita)
 *   theta = v_topo * π      (0 no polo norte, π no polo sul)
 *   dir   = (cos φ · sin θ,  cos θ,  sin φ · sin θ)
 *
 * ou seja +Y é para cima e φ=0 aponta para +X.
 */

export interface Raster {
  /** RGBA, 4 bytes por pixel, linha a linha do topo para baixo. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Faces pelo eixo que olham. `py` é o teto (zênite) e `ny` o chão (nadir). */
export type FaceName = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

export const FACE_NAMES: readonly FaceName[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

/** As quatro faces laterais — as que nunca são reescritas pela IA. */
export const LATERAL_FACES: readonly FaceName[] = ['px', 'nx', 'pz', 'nz'];

/** As duas faces que concentram o buraco de cobertura. */
export const POLE_FACES: readonly FaceName[] = ['py', 'ny'];

export type Cubemap = Record<FaceName, Raster>;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Direção do centro do pixel (x, y) de uma face, na convenção padrão de cubemap
 * (a mesma do OpenGL, para que as faces exportadas sejam legíveis em qualquer
 * visualizador). `s` e `t` correm em [-1, 1] com t crescendo para baixo.
 */
export function directionForFacePixel(face: FaceName, x: number, y: number, size: number): Vec3 {
  const s = (2 * (x + 0.5)) / size - 1;
  const t = (2 * (y + 0.5)) / size - 1;

  switch (face) {
    case 'px':
      return normalize({ x: 1, y: -t, z: -s });
    case 'nx':
      return normalize({ x: -1, y: -t, z: s });
    case 'py':
      return normalize({ x: s, y: 1, z: t });
    case 'ny':
      return normalize({ x: s, y: -1, z: -t });
    case 'pz':
      return normalize({ x: s, y: -t, z: 1 });
    case 'nz':
      return normalize({ x: -s, y: -t, z: -1 });
  }
}

/** Face que uma direção atinge, mais as coordenadas (s, t) dentro dela. */
export function faceForDirection(dir: Vec3): { face: FaceName; s: number; t: number } {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);

  if (ax >= ay && ax >= az) {
    return dir.x > 0
      ? { face: 'px', s: -dir.z / ax, t: -dir.y / ax }
      : { face: 'nx', s: dir.z / ax, t: -dir.y / ax };
  }
  if (ay >= az) {
    return dir.y > 0
      ? { face: 'py', s: dir.x / ay, t: dir.z / ay }
      : { face: 'ny', s: dir.x / ay, t: -dir.z / ay };
  }
  return dir.z > 0
    ? { face: 'pz', s: dir.x / az, t: -dir.y / az }
    : { face: 'nz', s: -dir.x / az, t: -dir.y / az };
}

/** Direção do centro do pixel (x, y) de um equirect — inverso do mapeamento do stitcher. */
export function directionForEquirectPixel(x: number, y: number, width: number, height: number): Vec3 {
  const phi = ((x + 0.5) / width) * 2 * Math.PI;
  const theta = ((y + 0.5) / height) * Math.PI;
  const sinTheta = Math.sin(theta);
  return {
    x: Math.cos(phi) * sinTheta,
    y: Math.cos(theta),
    z: Math.sin(phi) * sinTheta,
  };
}

/**
 * Lado de face que preserva a resolução do original: uma face cobre 90° de
 * longitude, que é um quarto da largura do equirect. Fica preso ao teto de 2048
 * porque é o que os modelos aceitam nativamente — acima disso a API reamostra e
 * o ganho evapora.
 */
export function faceSizeFor(equirectWidth: number, max = 2048, min = 512): number {
  return Math.max(min, Math.min(max, Math.round(equirectWidth / 4)));
}

/* -------------------------------------------------------------------------- */
/* Amostragem                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Bilinear com wrap em x e clamp em y. O wrap é o que impede uma emenda nova
 * de nascer na borda do equirect, que é o defeito clássico de quem trata
 * panorama como imagem comum.
 */
export function sampleEquirectBilinear(src: Raster, fx: number, fy: number, out: Uint8ClampedArray, at: number): void {
  const { width, height, data } = src;

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const xa = ((x0 % width) + width) % width;
  const xb = ((x0 + 1) % width + width) % width;
  const ya = Math.max(0, Math.min(height - 1, y0));
  const yb = Math.max(0, Math.min(height - 1, y0 + 1));

  const i00 = (ya * width + xa) * 4;
  const i10 = (ya * width + xb) * 4;
  const i01 = (yb * width + xa) * 4;
  const i11 = (yb * width + xb) * 4;

  for (let c = 0; c < 4; c++) {
    const top = data[i00 + c] * (1 - tx) + data[i10 + c] * tx;
    const bottom = data[i01 + c] * (1 - tx) + data[i11 + c] * tx;
    out[at + c] = top * (1 - ty) + bottom * ty;
  }
}

/** Bilinear numa face, com clamp nos dois eixos (faces não dão a volta). */
export function sampleFaceBilinear(src: Raster, fx: number, fy: number, out: Uint8ClampedArray, at: number): void {
  const { width, height, data } = src;

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const xa = Math.max(0, Math.min(width - 1, x0));
  const xb = Math.max(0, Math.min(width - 1, x0 + 1));
  const ya = Math.max(0, Math.min(height - 1, y0));
  const yb = Math.max(0, Math.min(height - 1, y0 + 1));

  const i00 = (ya * width + xa) * 4;
  const i10 = (ya * width + xb) * 4;
  const i01 = (yb * width + xa) * 4;
  const i11 = (yb * width + xb) * 4;

  for (let c = 0; c < 4; c++) {
    const top = data[i00 + c] * (1 - tx) + data[i10 + c] * tx;
    const bottom = data[i01 + c] * (1 - tx) + data[i11 + c] * tx;
    out[at + c] = top * (1 - ty) + bottom * ty;
  }
}

/* -------------------------------------------------------------------------- */
/* Ida e volta                                                                 */
/* -------------------------------------------------------------------------- */

/** Recorta o equirect nas seis faces. `nearest` é para máscaras, que não podem borrar. */
export function equirectToCubemap(src: Raster, size: number, nearest = false): Cubemap {
  const faces = {} as Cubemap;

  for (const face of FACE_NAMES) {
    const data = new Uint8ClampedArray(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dir = directionForFacePixel(face, x, y, size);
        const { fx, fy } = equirectCoordsFor(dir, src.width, src.height);
        const at = (y * size + x) * 4;

        if (nearest) {
          copyNearestEquirect(src, fx, fy, data, at);
        } else {
          sampleEquirectBilinear(src, fx, fy, data, at);
        }
      }
    }

    faces[face] = { data, width: size, height: size };
  }

  return faces;
}

/**
 * Reprojeta faces de volta sobre o equirect original.
 *
 * `replace` é a garantia de fidelidade do pipeline inteiro: só os pixels cuja
 * direção cai numa face listada são reamostrados. Todo o resto é cópia byte a
 * byte do `base`, então uma face lateral fotografada volta idêntica — a IA não
 * tem como reescrever o imóvel por acidente.
 */
export function composeEquirect(base: Raster, faces: Partial<Cubemap>, replace: readonly FaceName[]): Raster {
  const out = new Uint8ClampedArray(base.data);
  const replaceable = new Set(replace);

  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const dir = directionForEquirectPixel(x, y, base.width, base.height);
      const { face, s, t } = faceForDirection(dir);
      if (!replaceable.has(face)) continue;

      const src = faces[face];
      if (!src) continue;

      const fx = ((s + 1) / 2) * src.width - 0.5;
      const fy = ((t + 1) / 2) * src.height - 0.5;
      sampleFaceBilinear(src, fx, fy, out, (y * base.width + x) * 4);
    }
  }

  return { data: out, width: base.width, height: base.height };
}

/* -------------------------------------------------------------------------- */

function equirectCoordsFor(dir: Vec3, width: number, height: number): { fx: number; fy: number } {
  const theta = Math.acos(Math.max(-1, Math.min(1, dir.y)));
  let phi = Math.atan2(dir.z, dir.x);
  if (phi < 0) phi += 2 * Math.PI;

  return {
    fx: (phi / (2 * Math.PI)) * width - 0.5,
    fy: (theta / Math.PI) * height - 0.5,
  };
}

function copyNearestEquirect(src: Raster, fx: number, fy: number, out: Uint8ClampedArray, at: number): void {
  const x = ((Math.round(fx) % src.width) + src.width) % src.width;
  const y = Math.max(0, Math.min(src.height - 1, Math.round(fy)));
  const i = (y * src.width + x) * 4;
  out[at] = src.data[i];
  out[at + 1] = src.data[i + 1];
  out[at + 2] = src.data[i + 2];
  out[at + 3] = src.data[i + 3];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
