import * as THREE from 'three';
import {
  AxisTriple,
  BandShift,
  FrameView,
  RelativeCorrection,
  applyCorrection,
  correlateShift,
  fitRelativeCorrection,
  loopClosureResidual,
  measurePair,
  solveRingCorrections,
} from './frame-align';
import { quaternionFromYpr } from './orientation-math';

function band(dxDeg: number, dyDeg: number, heightDeg: number, score = 0.9): BandShift {
  return { dxDeg, dyDeg, heightDeg, score };
}

describe('fitRelativeCorrection', () => {
  it('reads a shift every band agrees on as yaw, with no roll invented', () => {
    const fit = fitRelativeCorrection([band(1.2, 0, 10), band(1.2, 0, 0), band(1.2, 0, -10)]);
    expect(fit.yawDeg).toBeGreaterThan(0.9);
    expect(fit.pitchDeg).toBe(0);
    expect(fit.rollDeg).toBe(0);
  });

  it('reads a vertical shift as pitch', () => {
    const fit = fitRelativeCorrection([band(0, -0.8, 10), band(0, -0.8, 0), band(0, -0.8, -10)]);
    expect(fit.pitchDeg).toBeLessThan(-0.5);
    expect(fit.yawDeg).toBe(0);
  });

  /**
   * The whole reason the bands exist. A single profile could never tell this
   * apart from yaw — and it is what tilts a horizon and steps a wall corner.
   */
  it('reads a shift that grows with height as roll, not as yaw', () => {
    // Top pushed left, bottom pushed right by the same amount: the frame is
    // tilted, and the average shift is zero — so yaw must stay at zero too.
    const fit = fitRelativeCorrection([band(-0.5, 0, 10), band(0, 0, 0), band(0.5, 0, -10)]);
    expect(Math.abs(fit.rollDeg)).toBeGreaterThan(2);
    expect(fit.yawDeg).toBe(0);
  });

  it('refuses to correct anything from bands that did not match', () => {
    const fit = fitRelativeCorrection([band(3, 3, 10, 0.05), band(3, 3, 0, 0.1)]);
    expect(fit.confidence).toBe(0);
    expect(fit.yawDeg).toBe(0);
  });

  it('leaves disagreements inside the noise floor alone', () => {
    // Correlation cannot resolve this, and "correcting" it would only add noise
    // to a gyro reading that was already better than the measurement.
    const fit = fitRelativeCorrection([band(0.05, 0.05, 10), band(0.05, 0.05, -10)]);
    expect(fit.yawDeg).toBe(0);
    expect(fit.pitchDeg).toBe(0);
  });

  it('discards a match so far off it must be wrong', () => {
    const fit = fitRelativeCorrection([band(30, 0, 10), band(30, 0, -10)]);
    expect(fit.yawDeg).toBe(0);
  });
});

describe('solveRingCorrections', () => {
  const measure = (yawDeg: number, confidence = 0.9): RelativeCorrection => ({
    yawDeg, pitchDeg: 0, rollDeg: 0, confidence,
  });

  /** What is still wrong at each join once the corrections are applied. */
  function leftoverPerJoin(
    measurements: (RelativeCorrection | null)[],
    corrections: AxisTriple[],
  ): number[] {
    return measurements.map((m, i) => {
      const next = corrections[(i + 1) % corrections.length];
      return (m ? m.yawDeg : 0) + corrections[i].yawDeg - next.yawDeg;
    });
  }

  it('spreads the closing error evenly instead of dumping it at the wrap', () => {
    // Eleven joins agree; the twelfth says the turn is 6° short of closing.
    const measurements = [...Array(11).fill(measure(0)), measure(6)];
    const leftover = leftoverPerJoin(measurements, solveRingCorrections(measurements, ['yawDeg']));

    // The optimum for a closed ring: every join keeps an equal share.
    for (const value of leftover) expect(value).toBeCloseTo(6 / 12, 6);
    // And no join carries anything like the whole 6°.
    expect(Math.max(...leftover.map(Math.abs))).toBeLessThan(1);
  });

  it('pushes the error onto the join that could not be measured', () => {
    // Eleven confident joins each report half a degree, so the turn overshoots
    // by 5.5°; the twelfth is a blank wall with nothing to match. The error
    // belongs on the join nobody could measure, not spread over the good ones.
    const measurements: (RelativeCorrection | null)[] = [
      ...Array(11).fill(measure(0.5, 0.95)), null,
    ];
    const leftover = leftoverPerJoin(measurements, solveRingCorrections(measurements, ['yawDeg']));

    expect(Math.abs(leftover[11])).toBeGreaterThan(Math.abs(leftover[0]) * 5);
  });

  it('holds the first frame fixed, so the panorama does not swing', () => {
    const measurements = [...Array(11).fill(measure(0)), measure(6)];
    expect(solveRingCorrections(measurements, ['yawDeg'])[0]).toEqual({
      yawDeg: 0, pitchDeg: 0, rollDeg: 0,
    });
  });

  it('reports how far the ring is from closing', () => {
    const measurements = [measure(1), measure(1), measure(-0.5), null];
    expect(loopClosureResidual(measurements).yawDeg).toBeCloseTo(1.5, 9);
  });

  /**
   * The finding that shaped this file. A hand swings the lens sideways between
   * shots, so what correlation reads as a horizontal disagreement is mostly
   * parallax, which no rotation can fix. Measured on the simulated room: the
   * ring failed to close by 0.23° on a tripod and by 14.87° hand-held, and
   * acting on that made the result measurably worse. So yaw is measured and
   * reported, but the gyro keeps the last word on it.
   */
  it('leaves yaw to the gyro by default, and still corrects pitch and roll', () => {
    const drifted: RelativeCorrection[] = [
      ...Array(11).fill({ yawDeg: 1.2, pitchDeg: 0, rollDeg: 0, confidence: 0.9 }),
      { yawDeg: 1.2, pitchDeg: 2.4, rollDeg: 1.2, confidence: 0.9 },
    ];
    const corrections = solveRingCorrections(drifted);

    expect(corrections.every((c) => c.yawDeg === 0)).toBeTrue();
    expect(corrections.some((c) => c.pitchDeg !== 0)).toBeTrue();
    expect(corrections.some((c) => c.rollDeg !== 0)).toBeTrue();
    // The measurement is still reported, so a real capture can be judged on it.
    expect(loopClosureResidual(drifted).yawDeg).toBeCloseTo(14.4, 6);
  });
});

describe('correlateShift', () => {
  /**
   * Deterministic value noise, sampled continuously so a fractional shift is
   * meaningful. It must NOT be periodic: a repeating pattern makes correlation
   * genuinely ambiguous, which would be testing the signal rather than the code.
   */
  function ramp(width: number, height: number, shiftX: number, shiftY: number): Float32Array {
    const hash = (x: number, y: number) => {
      const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const noise = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const tx = smooth(x - xi), ty = smooth(y - yi);
      const top = hash(xi, yi) * (1 - tx) + hash(xi + 1, yi) * tx;
      const bottom = hash(xi, yi + 1) * (1 - tx) + hash(xi + 1, yi + 1) * tx;
      return top * (1 - ty) + bottom * ty;
    };

    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = (x - shiftX) / 3.5;
        const sy = (y - shiftY) / 3.5;
        data[y * width + x] = 40 + 180 * (0.7 * noise(sx, sy) + 0.3 * noise(sx * 2.3, sy * 2.3));
      }
    }
    return data;
  }

  it('finds a known whole-pixel shift', () => {
    const w = 80, h = 48;
    const found = correlateShift(ramp(w, h, 0, 0), ramp(w, h, 5, -3), w, h, 12);
    expect(found.dx).toBeCloseTo(5, 1);
    expect(found.dy).toBeCloseTo(-3, 1);
    expect(found.score).toBeGreaterThan(0.9);
  });

  it('resolves below a whole pixel', () => {
    const w = 80, h = 48;
    const found = correlateShift(ramp(w, h, 0, 0), ramp(w, h, 2.5, 0), w, h, 12);
    expect(found.dx).toBeGreaterThan(2.15);
    expect(found.dx).toBeLessThan(2.85);
  });

  it('skips the pixels no frame reached', () => {
    const w = 80, h = 48;
    const a = ramp(w, h, 0, 0);
    const b = ramp(w, h, 4, 0);
    // A corner of the patch that one of the frames never saw.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) b[y * w + x] = NaN;
    expect(correlateShift(a, b, w, h, 12).dx).toBeCloseTo(4, 1);
  });
});

/* ------------------------------------------------------------------------- */

describe('measurePair', () => {
  /** A frame full of deterministic detail, so correlation has something to bite. */
  function texturedFrame(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 520;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#404450';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let seed = 3;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `hsl(${Math.floor(rand() * 360)}, 70%, ${30 + rand() * 50}%)`;
      ctx.fillRect(rand() * canvas.width, rand() * canvas.height, 4 + rand() * 14, 4 + rand() * 14);
    }
    return canvas;
  }

  function view(image: HTMLCanvasElement, ypr: AxisTriple): FrameView {
    return {
      image,
      quaternion: quaternionFromYpr(ypr.yawDeg, ypr.pitchDeg, ypr.rollDeg),
      hfovDeg: 92,
      vfovDeg: 108,
    };
  }

  const level: AxisTriple = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };

  it('reports nothing to fix when the two agree', () => {
    const image = texturedFrame();
    const measured = measurePair(view(image, level), view(image, level));
    expect(Math.abs(measured.yawDeg)).toBeLessThan(0.3);
    expect(Math.abs(measured.pitchDeg)).toBeLessThan(0.3);
  });

  /**
   * The sign convention, pinned by its purpose rather than by derivation:
   * applying what the measurement returns has to make the disagreement go
   * away. An inverted sign doubles the error instead, and fails here.
   */
  for (const wrong of [
    { yawDeg: 1.5, pitchDeg: 0, rollDeg: 0 },
    { yawDeg: 0, pitchDeg: 1.2, rollDeg: 0 },
    { yawDeg: 0, pitchDeg: -1.4, rollDeg: 0 },
    { yawDeg: -1.1, pitchDeg: 0.9, rollDeg: 0 },
  ]) {
    it(`corrects a frame recorded ${JSON.stringify(wrong)} off`, () => {
      const image = texturedFrame();
      const truth = view(image, level);
      const drifted = view(image, wrong);

      const measured = measurePair(truth, drifted);
      expect(measured.confidence).toBeGreaterThan(0.3);

      const fixed: FrameView = {
        ...drifted,
        quaternion: applyCorrection(drifted.quaternion, measured),
      };
      const residual = measurePair(truth, fixed);

      const before = Math.hypot(measured.yawDeg, measured.pitchDeg);
      const after = Math.hypot(residual.yawDeg, residual.pitchDeg);
      expect(after).withContext(`before ${before}, after ${after}`).toBeLessThan(before / 3);
    });
  }
});
