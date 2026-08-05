import * as THREE from 'three';
import { CameraSpec } from './capture-sources';
import { quaternionFromYpr, wrapDeg180, yprFromQuaternion } from './orientation-math';

/**
 * Projects the captured shots onto an equirectangular canvas using the gyro
 * quaternion recorded with each one — no feature detection. Software steps
 * close the gap to a "real" stitcher:
 *   1. the camera's true field of view is FITTED from the data (the gyro knows
 *      the angle between shots, so the only unknown is the degrees-per-pixel),
 *   2. per-frame yaw touch-up and per-channel exposure gain from the overlaps,
 *   3. feathered weighted accumulation instead of hard seams.
 * Whatever the shots genuinely miss is filled from the coverage mask, not from
 * an assumed FOV — with caps captured there is usually nothing left to fill.
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

export interface StitchResult {
  imageData: string;
  /** Vertical FOV the fit settled on — surfaced for diagnostics and tests. */
  fittedVfovDeg: number;
  /** Fraction of the sphere covered by real pixels, 0..1. */
  coverage: number;
}

/** Used only until the fit runs; deliberately conservative (see PatternOptions). */
export const DEFAULT_VFOV_DEG = 65;

/** The fit refuses to leave this range — outside it, no phone lens exists. */
export const MIN_VFOV_DEG = 40;
export const MAX_VFOV_DEG = 130;

export function hfovFromVfov(vfovDeg: number, frameAspect: number): number {
  return (2 * Math.atan(Math.tan((vfovDeg * Math.PI) / 360) * frameAspect) * 180) / Math.PI;
}

export function hfovFromSpec(spec: CameraSpec): number {
  return hfovFromVfov(spec.vfovDeg ?? DEFAULT_VFOV_DEG, spec.frameAspect);
}

/**
 * Fits the true vertical FOV from shots already taken. Called mid-capture with
 * the first ring so the rest of the plan can be sized to the real lens, and
 * again inside the stitch. Returns the prior unchanged when the shots do not
 * give the fit enough to work with (too few, or a textureless wall).
 */
export function fitVfovFromShots(shots: StitchShot[], spec: CameraSpec): number {
  const prior = spec.vfovDeg ?? DEFAULT_VFOV_DEG;
  if (shots.length < 3) return prior;
  const adjusted = toAdjusted(shots, prior, spec.frameAspect);
  const profiles = adjusted.map((s) => buildFrameProfile(s.frame));
  return fitVerticalFov(adjusted, profiles, spec.frameAspect);
}

function toAdjusted(shots: StitchShot[], vfovDeg: number, frameAspect: number): AdjustedShot[] {
  return shots.map((s) => {
    const q = new THREE.Quaternion(s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w);
    return {
      frame: s.frame,
      q,
      ypr: yprFromQuaternion(q),
      gain: new THREE.Vector3(1, 1, 1),
      vfovDeg,
      hfovDeg: hfovFromVfov(vfovDeg, frameAspect),
    };
  });
}

export async function stitchEquirect(
  shots: StitchShot[],
  spec: CameraSpec,
  options: StitchOptions = {},
): Promise<StitchResult> {
  const report = options.onProgress ?? (() => undefined);
  const priorVfov = spec.vfovDeg ?? DEFAULT_VFOV_DEG;

  let adjusted = toAdjusted(shots, priorVfov, spec.frameAspect);

  report(0.05);
  let fittedVfov = priorVfov;
  if (options.refine !== false && shots.length >= 3) {
    const profiles = adjusted.map((s) => buildFrameProfile(s.frame));
    fittedVfov = fitVerticalFov(adjusted, profiles, spec.frameAspect);
    for (const s of adjusted) {
      s.vfovDeg = fittedVfov;
      s.hfovDeg = hfovFromVfov(fittedVfov, spec.frameAspect);
    }
    report(0.2);
    adjusted = refineRings(adjusted, profiles);
  }
  report(0.35);

  const { outWidth, outHeight } = pickOutputSize(options, spec);
  const { canvas, coverage } = renderEquirect(adjusted, outWidth, outHeight);
  report(0.85);

  const composed = fillUncovered(canvas, outWidth, outHeight);
  const imageData = composed.toDataURL('image/jpeg', 0.85);
  report(1);
  return { imageData, fittedVfovDeg: fittedVfov, coverage };
}

interface AdjustedShot {
  frame: HTMLCanvasElement;
  q: THREE.Quaternion;
  ypr: { yawDeg: number; pitchDeg: number; rollDeg: number };
  gain: THREE.Vector3;
  hfovDeg: number;
  vfovDeg: number;
}

/**
 * Ceiling for the equirect. A phone's GPU will happily report MAX_TEXTURE_SIZE
 * of 16384, but the limit that matters is the memory the browser lets the tab
 * keep: at 4096×2048 the half-float accumulation target costs 64 MB, and at
 * 6144×3072 it costs 144 MB — enough, with the frames, to get an iOS tab
 * terminated mid-stitch (which reloads the page and loses the capture).
 */
export const MAX_OUTPUT_WIDTH = 4096;

/** Total budget for the frames held in memory during a capture. */
export const FRAME_MEMORY_BUDGET_MB = 96;

/**
 * Longest side to keep per frame so the whole set fits the budget. More shots
 * means smaller frames — which costs nothing real, because a frame only has to
 * carry the pixels its own slice of the panorama can show.
 */
export function frameSideBudget(shotCount: number, frameAspect: number): number {
  const bytes = FRAME_MEMORY_BUDGET_MB * 1048576;
  // side² · aspect · 4 bytes · count ≤ bytes
  const side = Math.sqrt(bytes / (4 * Math.max(1, shotCount) * Math.max(0.1, frameAspect)));
  // The budget always wins: running out of memory loses the entire capture,
  // while a smaller frame only costs detail. It costs little in practice —
  // a plan with more shots gives each frame a narrower slice to carry.
  return Math.floor(Math.min(2048, Math.max(720, side)));
}

export function pickOutputSize(
  options: StitchOptions,
  spec: CameraSpec,
): { outWidth: number; outHeight: number } {
  if (options.outWidth && options.outHeight) {
    return { outWidth: options.outWidth, outHeight: options.outHeight };
  }
  void spec;
  return { outWidth: MAX_OUTPUT_WIDTH, outHeight: MAX_OUTPUT_WIDTH / 2 };
}

/* ------------------------------------------------------------------------- */
/* Frame profiles: sampled once in frame space, resampled per FOV candidate    */
/* ------------------------------------------------------------------------- */

const NDC_SAMPLES = 512;
const PROFILE_STEP_DEG = 0.25;
const MIN_CORRELATION = 0.45;
const MAX_YAW_CORRECTION_DEG = 3;
/**
 * Deadband. Correlation resolves angles to ~PROFILE_STEP_DEG at best, and on
 * low-texture walls the peak wanders further. Correcting inside that noise
 * floor degrades an already-good gyro instead of helping it, so small
 * disagreements are treated as measurement error and left alone.
 */
const YAW_DEADBAND_DEG = 0.75;

interface FrameProfile {
  /** Luminance vs normalised x ∈ [-1,1], averaged over the central band. */
  luma: Float32Array;
  /** Per-channel means over the same band — drives white-balance matching. */
  channels: [Float32Array, Float32Array, Float32Array];
}

/**
 * Sampling in frame space (not angle) means the FOV search can resample this
 * cheaply instead of re-rasterising the frame for every candidate.
 */
function buildFrameProfile(frame: HTMLCanvasElement): FrameProfile {
  const w = NDC_SAMPLES;
  const h = Math.max(32, Math.round((w * frame.height) / frame.width));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // Central half of the frame: away from the edges, where lens distortion and
  // vignetting are worst, and common to every candidate FOV.
  const rowStart = Math.round(h * 0.25);
  const rowEnd = Math.round(h * 0.75);

  const luma = new Float32Array(w);
  const channels: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(w), new Float32Array(w), new Float32Array(w),
  ];
  for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let row = rowStart; row < rowEnd; row += 2) {
      const i = (row * w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2];
      n++;
    }
    r /= n; g /= n; b /= n;
    channels[0][x] = r; channels[1][x] = g; channels[2][x] = b;
    luma[x] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { luma, channels };
}

/** Resamples a frame-space profile onto uniform view angles for a given FOV. */
function angularResample(source: Float32Array, hfovDeg: number): Float32Array {
  const tanHalf = Math.tan((hfovDeg * Math.PI) / 360);
  const samples = Math.round(hfovDeg / PROFILE_STEP_DEG);
  const out = new Float32Array(samples);
  for (let s = 0; s < samples; s++) {
    const angle = (-hfovDeg / 2 + s * PROFILE_STEP_DEG) * (Math.PI / 180);
    const ndc = Math.tan(angle) / tanHalf;
    const pos = (ndc * 0.5 + 0.5) * (source.length - 1);
    const i = Math.max(0, Math.min(source.length - 2, Math.floor(pos)));
    const t = pos - i;
    out[s] = source[i] * (1 - t) + source[i + 1] * t;
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* FOV fit: the angle the image reports must agree with the angle the gyro did */
/* ------------------------------------------------------------------------- */

interface RingPair {
  a: number;
  b: number;
  recordedDeg: number;
}

/** Consecutive same-ring neighbours; caps and lone shots contribute nothing. */
function ringPairs(shots: AdjustedShot[]): RingPair[] {
  const byPitch = new Map<number, number[]>();
  shots.forEach((s, i) => {
    if (Math.abs(s.ypr.pitchDeg) >= 70) return; // cap shot
    const key = Math.round(s.ypr.pitchDeg / 10) * 10;
    const list = byPitch.get(key) ?? [];
    list.push(i);
    byPitch.set(key, list);
  });

  const pairs: RingPair[] = [];
  for (const indices of byPitch.values()) {
    if (indices.length < 3) continue;
    const sorted = indices.sort((i, j) => shots[i].ypr.yawDeg - shots[j].ypr.yawDeg);
    for (let k = 0; k < sorted.length; k++) {
      const a = sorted[k];
      const b = sorted[(k + 1) % sorted.length];
      const recorded = Math.abs(wrapDeg180(shots[b].ypr.yawDeg - shots[a].ypr.yawDeg));
      // A ring's wrap-around pair spans the whole remaining arc; skip anything
      // too wide to overlap at any plausible FOV.
      if (recorded > 5 && recorded < MAX_VFOV_DEG) pairs.push({ a, b, recordedDeg: recorded });
    }
  }
  return pairs;
}

/**
 * Scans candidate FOVs and keeps the one where image-measured spacing best
 * matches gyro-recorded spacing, then polishes with the direct ratio solve
 * (assumed × recorded/measured ≈ true).
 */
export function fitVerticalFov(
  shots: AdjustedShot[],
  profiles: FrameProfile[],
  frameAspect: number,
): number {
  const pairs = ringPairs(shots);
  if (pairs.length < 2) return shots[0].vfovDeg;

  const score = (vfov: number): { err: number; n: number } => {
    const hfov = hfovFromVfov(vfov, frameAspect);
    // Search wide enough to still find the peak when the candidate is far off.
    const window = Math.max(8, hfov * 0.25);
    let err = 0;
    let n = 0;
    for (const p of pairs) {
      if (p.recordedDeg >= hfov) continue; // no overlap at this candidate
      const pa = angularResample(profiles[p.a].luma, hfov);
      const pb = angularResample(profiles[p.b].luma, hfov);
      const m = correlatePair(pa, pb, hfov, p.recordedDeg, window);
      if (!m.confident) continue;
      err += Math.abs(m.measuredDeg - p.recordedDeg);
      n++;
    }
    return { err, n };
  };

  let best = { vfov: shots[0].vfovDeg, mean: Infinity };
  for (let vfov = MIN_VFOV_DEG; vfov <= MAX_VFOV_DEG; vfov += 6) {
    const { err, n } = score(vfov);
    // Require most pairs to agree, otherwise a candidate that matched a single
    // lucky pair would win on a tiny error.
    if (n < Math.max(2, pairs.length * 0.4)) continue;
    const mean = err / n;
    if (mean < best.mean) best = { vfov, mean };
  }

  // Ratio polish: the residual bias maps directly onto a FOV scale factor.
  let vfov = best.vfov;
  for (let iter = 0; iter < 3; iter++) {
    const hfov = hfovFromVfov(vfov, frameAspect);
    const window = Math.max(6, hfov * 0.2);
    let sum = 0;
    let n = 0;
    for (const p of pairs) {
      if (p.recordedDeg >= hfov) continue;
      const m = correlatePair(
        angularResample(profiles[p.a].luma, hfov),
        angularResample(profiles[p.b].luma, hfov),
        hfov, p.recordedDeg, window,
      );
      if (!m.confident || m.measuredDeg <= 0.5) continue;
      sum += p.recordedDeg / m.measuredDeg;
      n++;
    }
    if (n < 2) break;
    const ratio = Math.min(1.3, Math.max(0.77, sum / n));
    if (Math.abs(ratio - 1) < 0.005) break;
    vfov = Math.min(MAX_VFOV_DEG, Math.max(MIN_VFOV_DEG, vfov * ratio));
  }
  return vfov;
}

/* ------------------------------------------------------------------------- */
/* Per-frame yaw touch-up and per-channel exposure                            */
/* ------------------------------------------------------------------------- */

interface PairMeasure {
  measuredDeg: number;
  confident: boolean;
  /** Overlap window in frame A / frame B, as profile index ranges. */
  overlapA: [number, number];
  overlapB: [number, number];
}

function refineRings(shots: AdjustedShot[], profiles: FrameProfile[]): AdjustedShot[] {
  const pairs = ringPairs(shots);
  const yawCorrection = new Array<number>(shots.length).fill(0);
  const gains = shots.map(() => new THREE.Vector3(1, 1, 1));

  const measured = pairs.map((p) => {
    const hfov = shots[p.a].hfovDeg;
    return correlatePair(
      angularResample(profiles[p.a].luma, hfov),
      angularResample(profiles[p.b].luma, hfov),
      hfov, p.recordedDeg, Math.max(6, hfov * 0.15),
    );
  });

  // Yaw: nudge each frame by the residual its own pair reports. Corrections
  // stay local (no accumulation) so one bad pair cannot skew the whole ring.
  pairs.forEach((p, i) => {
    const m = measured[i];
    if (!m.confident) return;
    const e = m.measuredDeg - p.recordedDeg;
    if (Math.abs(e) <= YAW_DEADBAND_DEG || Math.abs(e) > MAX_YAW_CORRECTION_DEG) return;
    // Shrink by the deadband so corrections enter continuously rather than
    // jumping the moment the threshold is crossed; split across both frames.
    const shrunk = (e - Math.sign(e) * YAW_DEADBAND_DEG) / 2;
    yawCorrection[p.b] += shrunk;
    yawCorrection[p.a] -= shrunk;
  });

  // Exposure and white balance: per channel, so a warm room next to a cool one
  // matches in colour and not merely in brightness.
  pairs.forEach((p, i) => {
    const m = measured[i];
    if (!m.confident) return;
    const hfov = shots[p.a].hfovDeg;
    for (let c = 0; c < 3; c++) {
      const ca = angularResample(profiles[p.a].channels[c], hfov);
      const cb = angularResample(profiles[p.b].channels[c], hfov);
      const meanA = meanOf(ca, m.overlapA);
      const meanB = meanOf(cb, m.overlapB);
      if (meanA < 4 || meanB < 4) continue;
      const ratio = Math.min(1.25, Math.max(0.8, meanA / meanB));
      gains[p.b].setComponent(c, gains[p.b].getComponent(c) * ratio);
    }
  });

  // Normalise so the set keeps its overall exposure instead of drifting.
  const geo = new THREE.Vector3(1, 1, 1);
  for (let c = 0; c < 3; c++) {
    const product = gains.reduce((acc, g) => acc * g.getComponent(c), 1);
    geo.setComponent(c, product ** (1 / gains.length));
  }

  return shots.map((s, i) => {
    const g = gains[i].clone().divide(geo);
    return {
      ...s,
      gain: new THREE.Vector3(
        clamp(g.x, 0.75, 1.35), clamp(g.y, 0.75, 1.35), clamp(g.z, 0.75, 1.35),
      ),
      q: quaternionFromYpr(yawCorrection[i], 0, 0).multiply(s.q),
    };
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function meanOf(arr: Float32Array, range: [number, number]): number {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, range[0]); i < Math.min(arr.length, range[1]); i++) {
    sum += arr[i];
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function correlatePair(
  a: Float32Array,
  b: Float32Array,
  hfovDeg: number,
  recordedDeg: number,
  windowDeg: number,
): PairMeasure {
  let best = {
    delta: recordedDeg, score: -Infinity,
    overlapA: [0, 0] as [number, number], overlapB: [0, 0] as [number, number],
  };

  const lo = Math.max(1, recordedDeg - windowDeg);
  const hi = Math.min(hfovDeg - 1, recordedDeg + windowDeg);

  for (let delta = lo; delta <= hi; delta += PROFILE_STEP_DEG) {
    // Frame A angle x maps to frame B angle x − delta; overlap window in A:
    const startDeg = Math.max(-hfovDeg / 2, delta - hfovDeg / 2);
    const s0 = Math.round((startDeg + hfovDeg / 2) / PROFILE_STEP_DEG);
    const s1 = a.length;
    const offsetB = Math.round(-delta / PROFILE_STEP_DEG);
    if (s1 - s0 < 12) continue;

    let sumA = 0, sumB = 0, count = 0;
    for (let s = s0; s < s1; s++) {
      const sb = s + offsetB;
      if (sb < 0 || sb >= b.length) continue;
      sumA += a[s]; sumB += b[sb]; count++;
    }
    if (count < 12) continue;
    const meanA = sumA / count, meanB = sumB / count;

    let num = 0, varA = 0, varB = 0;
    for (let s = s0; s < s1; s++) {
      const sb = s + offsetB;
      if (sb < 0 || sb >= b.length) continue;
      const da = a[s] - meanA, db = b[sb] - meanB;
      num += da * db; varA += da * da; varB += db * db;
    }
    const denom = Math.sqrt(varA * varB);
    const score = denom > 1e-3 ? num / denom : 0;
    if (score > best.score) {
      best = {
        delta, score,
        overlapA: [s0, s1],
        overlapB: [Math.max(0, s0 + offsetB), Math.min(b.length, s1 + offsetB)],
      };
    }
  }

  return {
    measuredDeg: best.delta,
    confident: best.score >= MIN_CORRELATION,
    overlapA: best.overlapA,
    overlapB: best.overlapB,
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
  uniform vec3 uGain;

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
    // Alpha carries the coverage mask into the 2D pass, which fills only the
    // pixels no shot actually reached.
    gl_FragColor = vec4(color, acc.a > 1e-4 ? 1.0 : 0.0);
  }
`;

function renderEquirect(
  shots: AdjustedShot[],
  outWidth: number,
  outHeight: number,
): { canvas: HTMLCanvasElement; coverage: number } {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    premultipliedAlpha: false,
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
      uGain: { value: new THREE.Vector3(1, 1, 1) },
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

    rotation.makeRotationFromQuaternion(shot.q.clone().invert());
    accumMaterial.uniforms['uFrame'].value = texture;
    (accumMaterial.uniforms['uWorldToCamera'].value as THREE.Matrix3).setFromMatrix4(rotation);
    (accumMaterial.uniforms['uTanHalfFov'].value as THREE.Vector2).set(
      Math.tan((shot.hfovDeg * Math.PI) / 360),
      Math.tan((shot.vfovDeg * Math.PI) / 360),
    );
    (accumMaterial.uniforms['uGain'].value as THREE.Vector3).copy(shot.gain);
    renderer.render(scene, camera);

    // The pixels now live in the texture, so the source canvas can go. On a
    // 22-shot capture this hands back well over 100 MB before the normalize
    // pass allocates its own buffers.
    texture.dispose();
    shot.frame.width = 0;
    shot.frame.height = 0;
  }

  const normalizeMaterial = new THREE.ShaderMaterial({
    vertexShader: PASS_VERTEX,
    fragmentShader: NORMALIZE_FRAGMENT,
    uniforms: { uAccum: { value: accumTarget.texture } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  mesh.material = normalizeMaterial;
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);
  renderer.render(scene, camera);

  // The GL canvas is drawn onto a 2D canvas in the same task, before disposal.
  const out = document.createElement('canvas');
  out.width = outWidth;
  out.height = outHeight;
  out.getContext('2d')!.drawImage(renderer.domElement, 0, 0);

  geometry.dispose();
  accumMaterial.dispose();
  normalizeMaterial.dispose();
  accumTarget.dispose();
  renderer.dispose();
  renderer.forceContextLoss();

  return { canvas: out, coverage: measureCoverage(out) };
}

/** Solid-angle weighted, so rows near the poles do not dominate the ratio. */
function measureCoverage(canvas: HTMLCanvasElement): number {
  const w = 256, h = 128;
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  let covered = 0, total = 0;
  for (let y = 0; y < h; y++) {
    const theta = ((y + 0.5) / h) * Math.PI;
    const weight = Math.sin(theta);
    for (let x = 0; x < w; x++) {
      total += weight;
      if (data[(y * w + x) * 4 + 3] > 128) covered += weight;
    }
  }
  return total > 0 ? covered / total : 0;
}

/* ------------------------------------------------------------------------- */
/* Uncovered pixels: filled from the nearest covered row, then blurred        */
/* ------------------------------------------------------------------------- */

/**
 * Reads the coverage mask the normalize pass wrote into alpha and fills only
 * what the shots genuinely missed — no assumption about the lens. With caps
 * captured this usually touches nothing.
 */
function fillUncovered(source: HTMLCanvasElement, outWidth: number, outHeight: number): HTMLCanvasElement {
  const ctx = source.getContext('2d', { willReadFrequently: true })!;

  // Row coverage from a cheap downscale — gaps are whole latitude bands.
  const probeH = 256;
  const probe = document.createElement('canvas');
  probe.width = 8;
  probe.height = probeH;
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(source, 0, 0, 8, probeH);
  const pdata = pctx.getImageData(0, 0, 8, probeH).data;

  const rowCovered: boolean[] = [];
  for (let y = 0; y < probeH; y++) {
    let hits = 0;
    for (let x = 0; x < 8; x++) if (pdata[(y * 8 + x) * 4 + 3] > 128) hits++;
    rowCovered.push(hits >= 4);
  }

  const firstCovered = rowCovered.indexOf(true);
  const lastCovered = rowCovered.lastIndexOf(true);
  if (firstCovered < 0) return source; // nothing to work with

  const topRow = Math.round((firstCovered / probeH) * outHeight);
  const bottomRow = Math.round(((lastCovered + 1) / probeH) * outHeight);
  const band = Math.max(4, Math.round(outHeight * 0.01));

  // Stretch a heavily downscaled strip of the edge row across the gap: a cheap
  // large-radius blur that keeps the ambient colour without inventing detail.
  const strip = (srcY: number): HTMLCanvasElement => {
    const tiny = document.createElement('canvas');
    tiny.width = 64;
    tiny.height = 1;
    tiny.getContext('2d')!.drawImage(source, 0, srcY, outWidth, band, 0, 0, 64, 1);
    return tiny;
  };

  const top = topRow > 0 ? strip(topRow) : null;
  const bottom = bottomRow < outHeight ? strip(Math.max(0, bottomRow - band)) : null;

  // Painting UNDER the existing pixels fills the transparent gaps in place —
  // compositing onto a second full-size canvas would cost another 32 MB.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalCompositeOperation = 'destination-over';
  if (top) ctx.drawImage(top, 0, 0, 64, 1, 0, 0, outWidth, topRow + 2);
  if (bottom) {
    ctx.drawImage(bottom, 0, 0, 64, 1, 0, bottomRow - 2, outWidth, outHeight - bottomRow + 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  return source;
}
