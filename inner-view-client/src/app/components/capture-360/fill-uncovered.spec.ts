import { fillUncovered } from './stitcher';

/**
 * The two defects the real captures showed at the poles, as tests.
 *
 * Both came out of the same function. The fill used one global boundary row for
 * the whole image, so every column whose coverage ended lower kept transparent
 * pixels and read as a black sliver along the ceiling line. And it stretched a
 * single 64×1 strip over the cap, so the columns arrived at the pole still
 * carrying different colours — which, at a point every column converges on, is
 * exactly a pinwheel.
 */

const WIDTH = 512;
const HEIGHT = 256;

/**
 * A stand-in for the render output: an opaque band around the horizon with a
 * WAVY edge, and transparent caps. The waviness is the point — a hand-held ring
 * tilts a little on every shot, so the real boundary is never one row.
 */
function bandedCanvas(options: {
  topRow: (x: number) => number;
  bottomRow: (x: number) => number;
  colour?: (x: number, y: number) => [number, number, number];
}): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.createImageData(WIDTH, HEIGHT);

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      if (y < options.topRow(x) || y >= options.bottomRow(x)) continue; // transparent
      const [r, g, b] = options.colour?.(x, y) ?? [120, 130, 140];
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function pixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  return canvas
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, canvas.width, canvas.height).data;
}

describe('fillUncovered', () => {
  /** A boundary that wanders by 12 rows, which one global row cannot follow. */
  const wavyTop = (x: number) => 60 + Math.round(12 * Math.sin((x / WIDTH) * Math.PI * 6));
  const wavyBottom = (x: number) => 196 - Math.round(10 * Math.cos((x / WIDTH) * Math.PI * 4));

  it('leaves no transparent pixel behind, however the boundary wanders', () => {
    const canvas = bandedCanvas({ topRow: wavyTop, bottomRow: wavyBottom });
    fillUncovered(canvas, WIDTH, HEIGHT);

    const data = pixels(canvas);
    let clear = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) clear++;
    expect(clear).withContext(`${clear} pixels would render as black tears`).toBe(0);
  });

  /**
   * The pinwheel, measured. Every output column meets its neighbours at the
   * pole, so if they arrive carrying different colours the difference has to go
   * somewhere — and where it goes is a radial wedge.
   */
  it('brings every column to the same colour at the poles', () => {
    const canvas = bandedCanvas({
      topRow: wavyTop,
      bottomRow: wavyBottom,
      // A strongly coloured band, so disagreement between columns is loud.
      colour: (x) => [40 + ((x * 7) % 200), 200 - ((x * 3) % 180), (x * 11) % 255],
    });
    fillUncovered(canvas, WIDTH, HEIGHT);

    const data = pixels(canvas);
    const spread = (row: number): number => {
      let min = 255;
      let max = 0;
      for (let x = 0; x < WIDTH; x++) {
        const value = data[(row * WIDTH + x) * 4];
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      return max - min;
    };

    expect(spread(0)).withContext('north pole row').toBeLessThan(8);
    expect(spread(HEIGHT - 1)).withContext('south pole row').toBeLessThan(8);
    // Immediately outside the photographed band the fill should still carry the
    // local colour, or it would be a flat disc pasted over the ceiling.
    expect(spread(48)).withContext('just above the band').toBeGreaterThan(40);
  });

  it('never paints over a photographed pixel', () => {
    const marker: [number, number, number] = [11, 22, 33];
    const canvas = bandedCanvas({
      topRow: wavyTop,
      bottomRow: wavyBottom,
      colour: () => marker,
    });
    fillUncovered(canvas, WIDTH, HEIGHT);

    const data = pixels(canvas);
    for (let x = 0; x < WIDTH; x += 17) {
      const y = wavyTop(x) + 3;
      const i = (y * WIDTH + x) * 4;
      expect([data[i], data[i + 1], data[i + 2]])
        .withContext(`column ${x}, row ${y}`)
        .toEqual(marker);
    }
  });

  it('reports the band every column actually covers', () => {
    const canvas = bandedCanvas({ topRow: wavyTop, bottomRow: wavyBottom });
    const band = fillUncovered(canvas, WIDTH, HEIGHT);

    // The deepest top boundary is row 72 of 256, the shallowest bottom row 186.
    const latOf = (row: number) => 90 - (row / HEIGHT) * 180;
    expect(band.topDeg).toBeLessThanOrEqual(latOf(70));
    expect(band.topDeg).toBeGreaterThan(latOf(80));
    expect(band.bottomDeg).toBeGreaterThanOrEqual(latOf(192));
    expect(band.bottomDeg).toBeLessThan(latOf(180));
  });

  it('says the whole sphere is real when nothing is missing', () => {
    const canvas = bandedCanvas({ topRow: () => 0, bottomRow: () => HEIGHT });
    const band = fillUncovered(canvas, WIDTH, HEIGHT);
    expect(band.topDeg).toBeCloseTo(90, 0);
    expect(band.bottomDeg).toBeCloseTo(-90, 0);
  });

  it('gives up quietly on a canvas with no coverage at all', () => {
    const canvas = bandedCanvas({ topRow: () => HEIGHT, bottomRow: () => HEIGHT });
    expect(fillUncovered(canvas, WIDTH, HEIGHT)).toEqual({ topDeg: 90, bottomDeg: -90 });
  });
});
