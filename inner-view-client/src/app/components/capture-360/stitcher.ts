import * as THREE from 'three';
import { CameraSpec } from './capture-sources';
import { quaternionFromYpr, wrapDeg180, yprFromQuaternion } from './orientation-math';

/**
 * Projects the captured ring of photos onto an equirectangular canvas using
 * the gyro quaternion recorded with each shot — no feature detection. Three
 * cheap software refinements close the gap to a "real" stitcher:
 *   1. per-pair yaw + global FOV correction via 1D correlation of overlaps,
 *   2. per-frame exposure gain matched on overlap luminance,
 *   3. feathered accumulation (weighted average) instead of hard seams.
 * Poles (outside the single ring's vertical FOV) get a blurred edge fill; the
 * future server-side AI stage can outpaint them properly.
 */
export interface StitchShot {
  frame: HTMLCanvasElement;
  /** Session-frame camera orientation at the moment of capture. */
  quaternion: { x: number; y: number; z: number; w: number };
}

export interface StitchOptions {
  outWidth?: number;
  outHeight?: number;
  /** Disable the correlation refinement (used by tests / troubleshooting). */
  refine?: boolean;
  onProgress?: (fraction: number) => void;
}

/** Phone main cameras cluster around this vertical FOV in portrait. */
export const DEFAULT_VFOV_DEG = 65;

export function hfovFromSpec(spec: CameraSpec): number {
  const vfov = spec.vfovDeg ?? DEFAULT_VFOV_DEG;
  return (2 * Math.atan(Math.tan((vfov * Math.PI) / 360) * spec.frameAspect) * 180) / Math.PI;
}

export async function stitchEquirect(
  shots: StitchShot[],
  spec: CameraSpec,
  options: StitchOptions = {},
): Promise<string> {
  const outWidth = options.outWidth ?? 4096;
  const outHeight = options.outHeight ?? 2048;
  const vfovDeg = spec.vfovDeg ?? DEFAULT_VFOV_DEG;
  const hfovDeg = hfovFromSpec(spec);
  const report = options.onProgress ?? (() => undefined);

  let adjusted = shots.map((s) => ({
    frame: s.frame,
    q: new THREE.Quaternion(s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w),
    gain: 1,
    hfovDeg,
    vfovDeg,
  }));

  report(0.05);
  if (options.refine !== false && shots.length >= 3) {
    adjusted = refineRing(adjusted);
  }
  report(0.3);

  const glCanvas = renderEquirect(adjusted, outWidth, outHeight);
  report(0.8);

  const composed = fillPoles(glCanvas, outWidth, outHeight, vfovDeg);
  const dataUrl = composed.toDataURL('image/jpeg', 0.85);
  report(1);
  return dataUrl;
}

interface AdjustedShot {
  frame: HTMLCanvasElement;
  q: THREE.Quaternion;
  gain: number;
  hfovDeg: number;
  vfovDeg: number;
}

/* ------------------------------------------------------------------------- */
/* Refinement: 1D angular luminance profiles correlated across overlaps       */
/* ------------------------------------------------------------------------- */

const PROFILE_STEP_DEG = 0.25;
const SEARCH_RANGE_DEG = 6;
const MAX_YAW_CORRECTION_DEG = 3;
const MIN_CORRELATION = 0.5;
/**
 * Deadbands. Correlation resolves angles to ~PROFILE_STEP_DEG at best, and on
 * low-texture walls the peak wanders further. Correcting inside that noise
 * floor degrades an already-good gyro instead of helping it, so small
 * disagreements are treated as measurement error and left alone.
 */
const YAW_DEADBAND_DEG = 0.75;
const FOV_DEADBAND_RATIO = 0.02;

function refineRing(shots: AdjustedShot[]): AdjustedShot[] {
  const n = shots.length;
  const yaws = shots.map((s) => yprFromQuaternion(s.q).yawDeg);

  const firstPass = measurePairs(shots, yaws);

  // A consistent bias between gyro spacing and image spacing means the FOV
  // guess is off: the same pixel shift reads as a different angle.
  const valid = firstPass.filter((p) => p.confident);
  if (valid.length >= Math.ceil(n / 2)) {
    const ratio =
      valid.reduce((acc, p) => acc + p.recordedDeg / p.measuredDeg, 0) / valid.length;
    if (Math.abs(ratio - 1) > FOV_DEADBAND_RATIO) {
      const clamped = Math.min(1.15, Math.max(0.85, ratio));
      for (const s of shots) {
        s.hfovDeg *= clamped;
        s.vfovDeg *= clamped;
      }
    }
  }

  const pairs = measurePairs(shots, yaws);

  // Per-frame yaw residuals, accumulated around the ring then closed so the
  // 360° total is preserved (the gyro is trusted for the global loop).
  const corrections = new Array<number>(n).fill(0);
  let running = 0;
  let closure = 0;
  const residuals = pairs.map((p) => {
    if (!p.confident) return 0;
    const e = p.measuredDeg - p.recordedDeg;
    if (Math.abs(e) <= YAW_DEADBAND_DEG || Math.abs(e) > MAX_YAW_CORRECTION_DEG) return 0;
    // Shrink by the deadband so corrections enter continuously rather than
    // jumping by 0.75° the moment the threshold is crossed.
    return e - Math.sign(e) * YAW_DEADBAND_DEG;
  });
  closure = residuals.reduce((a, b) => a + b, 0);
  for (let i = 1; i < n; i++) {
    running += residuals[i - 1] - closure / n;
    corrections[i] = running;
  }

  // Exposure: chain overlap luminance ratios, then normalize the ring.
  const gains = new Array<number>(n).fill(1);
  for (let i = 1; i < n; i++) {
    const p = pairs[i - 1];
    const ratio = p.confident && p.lumaB > 1 ? p.lumaA / p.lumaB : 1;
    gains[i] = gains[i - 1] * Math.min(1.25, Math.max(0.8, ratio));
  }
  const mean = gains.reduce((a, b) => a * b, 1) ** (1 / n);

  return shots.map((s, i) => ({
    ...s,
    gain: Math.min(1.35, Math.max(0.75, gains[i] / mean)),
    q: quaternionFromYpr(corrections[i], 0, 0).multiply(s.q),
  }));
}

interface PairMeasure {
  recordedDeg: number;
  measuredDeg: number;
  confident: boolean;
  lumaA: number;
  lumaB: number;
}

function measurePairs(shots: AdjustedShot[], yaws: number[]): PairMeasure[] {
  const profiles = shots.map((s) => angularProfile(s.frame, s.hfovDeg, s.vfovDeg));
  const out: PairMeasure[] = [];
  for (let i = 0; i < shots.length; i++) {
    const j = (i + 1) % shots.length;
    const recorded = Math.abs(wrapDeg180(yaws[j] - yaws[i]));
    out.push(correlatePair(profiles[i], profiles[j], shots[i].hfovDeg, recorded));
  }
  return out;
}

/** Mean luminance per horizontal view angle, averaged over the central band. */
function angularProfile(frame: HTMLCanvasElement, hfovDeg: number, vfovDeg: number): Float32Array {
  const w = 256;
  const h = Math.max(32, Math.round((w * frame.height) / frame.width));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const tanHalfH = Math.tan((hfovDeg * Math.PI) / 360);
  const bandHalf = Math.min(0.9, Math.tan((15 * Math.PI) / 180) / Math.tan((vfovDeg * Math.PI) / 360));
  const rowStart = Math.round(((1 - bandHalf) / 2) * h);
  const rowEnd = Math.round(((1 + bandHalf) / 2) * h);

  const samples = Math.round(hfovDeg / PROFILE_STEP_DEG);
  const profile = new Float32Array(samples);
  for (let s = 0; s < samples; s++) {
    const angle = -hfovDeg / 2 + s * PROFILE_STEP_DEG;
    const ndcX = Math.tan((angle * Math.PI) / 180) / tanHalfH;
    const px = Math.min(w - 1, Math.max(0, Math.round((ndcX * 0.5 + 0.5) * (w - 1))));
    let sum = 0;
    let count = 0;
    for (let row = rowStart; row < rowEnd; row += 2) {
      const idx = (row * w + px) * 4;
      sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      count++;
    }
    profile[s] = count > 0 ? sum / count : 0;
  }
  return profile;
}

function correlatePair(
  a: Float32Array,
  b: Float32Array,
  hfovDeg: number,
  recordedDeg: number,
): PairMeasure {
  let best = { delta: recordedDeg, score: -Infinity, lumaA: 0, lumaB: 0 };

  for (let delta = recordedDeg - SEARCH_RANGE_DEG; delta <= recordedDeg + SEARCH_RANGE_DEG; delta += PROFILE_STEP_DEG) {
    // Frame A angle x maps to frame B angle x − delta; overlap window in A:
    const startDeg = Math.max(-hfovDeg / 2, delta - hfovDeg / 2);
    const endDeg = hfovDeg / 2;
    if (endDeg - startDeg < 3) continue;

    const offsetB = Math.round(-delta / PROFILE_STEP_DEG);
    const s0 = Math.round((startDeg + hfovDeg / 2) / PROFILE_STEP_DEG);
    const s1 = Math.round((endDeg + hfovDeg / 2) / PROFILE_STEP_DEG);

    let sumA = 0, sumB = 0, count = 0;
    for (let s = s0; s < s1; s++) {
      const sb = s + offsetB;
      if (sb < 0 || sb >= b.length || s >= a.length) continue;
      sumA += a[s];
      sumB += b[sb];
      count++;
    }
    if (count < 8) continue;
    const meanA = sumA / count;
    const meanB = sumB / count;

    let num = 0, varA = 0, varB = 0;
    for (let s = s0; s < s1; s++) {
      const sb = s + offsetB;
      if (sb < 0 || sb >= b.length || s >= a.length) continue;
      const da = a[s] - meanA;
      const db = b[sb] - meanB;
      num += da * db;
      varA += da * da;
      varB += db * db;
    }
    const denom = Math.sqrt(varA * varB);
    const score = denom > 1e-3 ? num / denom : 0;
    if (score > best.score) {
      best = { delta, score, lumaA: meanA, lumaB: meanB };
    }
  }

  return {
    recordedDeg,
    measuredDeg: best.delta,
    confident: best.score >= MIN_CORRELATION,
    lumaA: best.lumaA,
    lumaB: best.lumaB,
  };
}

/* ------------------------------------------------------------------------- */
/* WebGL projection: one feathered additive pass per frame, then normalize    */
/* ------------------------------------------------------------------------- */

const PASS_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const ACCUM_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uFrame;
  uniform mat3 uWorldToCamera;
  uniform vec2 uTanHalfFov; // (tan(hfov/2), tan(vfov/2))
  uniform float uGain;

  const float PI = 3.14159265358979;

  void main() {
    // Output pixel → world direction, inverse of the viewer's sphere mapping.
    float phi = vUv.x * 2.0 * PI;
    float theta = (1.0 - vUv.y) * PI;
    vec3 dir = vec3(cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));

    vec3 cam = uWorldToCamera * dir;
    if (cam.z > -0.001) { discard; }

    vec2 ndc = vec2(cam.x / -cam.z / uTanHalfFov.x, cam.y / -cam.z / uTanHalfFov.y);
    if (abs(ndc.x) >= 1.0 || abs(ndc.y) >= 1.0) { discard; }

    float edge = min(1.0 - abs(ndc.x), 1.0 - abs(ndc.y));
    float weight = smoothstep(0.0, 0.35, edge);
    vec3 color = texture2D(uFrame, ndc * 0.5 + 0.5).rgb * uGain;
    gl_FragColor = vec4(color * weight, weight);
  }
`;

const NORMALIZE_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uAccum;

  void main() {
    vec4 acc = texture2D(uAccum, vUv);
    vec3 color = acc.a > 1e-4 ? acc.rgb / acc.a : vec3(0.0);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function renderEquirect(shots: AdjustedShot[], outWidth: number, outHeight: number): HTMLCanvasElement {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(outWidth, outHeight, false);
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);

  const accumTarget = new THREE.WebGLRenderTarget(outWidth, outHeight, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  accumTarget.texture.minFilter = THREE.NearestFilter;
  accumTarget.texture.magFilter = THREE.NearestFilter;

  const accumMaterial = new THREE.ShaderMaterial({
    vertexShader: PASS_VERTEX,
    fragmentShader: ACCUM_FRAGMENT,
    uniforms: {
      uFrame: { value: null },
      uWorldToCamera: { value: new THREE.Matrix3() },
      uTanHalfFov: { value: new THREE.Vector2(1, 1) },
      uGain: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geometry, accumMaterial);
  scene.add(mesh);

  const rotation = new THREE.Matrix4();
  const textures: THREE.Texture[] = [];

  renderer.setRenderTarget(accumTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);

  for (const shot of shots) {
    // Working in stored sRGB end to end: no decode on sample, no encode on
    // write — ShaderMaterial passes values through untouched.
    const texture = new THREE.CanvasTexture(shot.frame);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    textures.push(texture);

    rotation.makeRotationFromQuaternion(shot.q.clone().invert());
    accumMaterial.uniforms['uFrame'].value = texture;
    (accumMaterial.uniforms['uWorldToCamera'].value as THREE.Matrix3).setFromMatrix4(rotation);
    (accumMaterial.uniforms['uTanHalfFov'].value as THREE.Vector2).set(
      Math.tan((shot.hfovDeg * Math.PI) / 360),
      Math.tan((shot.vfovDeg * Math.PI) / 360),
    );
    accumMaterial.uniforms['uGain'].value = shot.gain;
    renderer.render(scene, camera);
  }

  const normalizeMaterial = new THREE.ShaderMaterial({
    vertexShader: PASS_VERTEX,
    fragmentShader: NORMALIZE_FRAGMENT,
    uniforms: { uAccum: { value: accumTarget.texture } },
    depthTest: false,
    depthWrite: false,
  });
  mesh.material = normalizeMaterial;
  renderer.setRenderTarget(null);
  renderer.clear(true, false, false);
  renderer.render(scene, camera);

  // The GL canvas is drawn onto a 2D canvas in the same task, before disposal.
  const out = document.createElement('canvas');
  out.width = outWidth;
  out.height = outHeight;
  out.getContext('2d')!.drawImage(renderer.domElement, 0, 0);

  textures.forEach((t) => t.dispose());
  geometry.dispose();
  accumMaterial.dispose();
  normalizeMaterial.dispose();
  accumTarget.dispose();
  renderer.dispose();
  renderer.forceContextLoss();

  return out;
}

/* ------------------------------------------------------------------------- */
/* Poles: stretch + blur the coverage edge into the empty caps                */
/* ------------------------------------------------------------------------- */

function fillPoles(
  source: HTMLCanvasElement,
  outWidth: number,
  outHeight: number,
  vfovDeg: number,
): HTMLCanvasElement {
  const ctx = source.getContext('2d')!;

  // Conservative coverage: half the vertical FOV minus pitch-drift margin.
  const coveredLatDeg = Math.max(20, vfovDeg / 2 - 6);
  const topRow = Math.round(((90 - coveredLatDeg) / 180) * outHeight);
  const bottomRow = Math.round(((90 + coveredLatDeg) / 180) * outHeight);
  const bandRows = Math.max(4, Math.round(outHeight * 0.01));

  const blurredStrip = (srcY: number): HTMLCanvasElement => {
    // Downscale-upscale acts as a cheap large-radius blur.
    const tiny = document.createElement('canvas');
    tiny.width = 64;
    tiny.height = 1;
    const tctx = tiny.getContext('2d')!;
    tctx.drawImage(source, 0, srcY, outWidth, bandRows, 0, 0, 64, 1);
    return tiny;
  };

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (topRow > 0) {
    ctx.drawImage(blurredStrip(topRow), 0, 0, 64, 1, 0, 0, outWidth, topRow + 2);
    const fade = ctx.createLinearGradient(0, 0, 0, topRow);
    fade.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, outWidth, topRow);
  }

  if (bottomRow < outHeight) {
    ctx.drawImage(blurredStrip(bottomRow - bandRows), 0, 0, 64, 1, 0, bottomRow - 2, outWidth, outHeight - bottomRow + 2);
    const fade = ctx.createLinearGradient(0, bottomRow, 0, outHeight);
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, bottomRow, outWidth, outHeight - bottomRow);
  }

  return source;
}
