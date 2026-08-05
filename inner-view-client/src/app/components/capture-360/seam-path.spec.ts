import { disagreementCost, shortestVerticalPath } from './seam-path';

function grid(rows: number[][]): { cost: Float32Array; width: number; height: number } {
  const height = rows.length;
  const width = rows[0].length;
  const cost = new Float32Array(width * height);
  rows.forEach((row, y) => row.forEach((value, x) => (cost[y * width + x] = value)));
  return { cost, width, height };
}

describe('shortestVerticalPath', () => {
  it('follows a cheap corridor even when it wanders', () => {
    // The zero column moves left then right; the path has to track it.
    const { cost, width, height } = grid([
      [9, 9, 0, 9, 9],
      [9, 0, 9, 9, 9],
      [0, 9, 9, 9, 9],
      [9, 0, 9, 9, 9],
      [9, 9, 0, 9, 9],
    ]);
    expect(Array.from(shortestVerticalPath(cost, width, height))).toEqual([2, 1, 0, 1, 2]);
  });

  /**
   * The whole point of the file: an expensive object sitting where the
   * midpoint would fall, and the cut goes round it instead of through it.
   */
  it('goes around an expensive object rather than through it', () => {
    const rows: number[][] = [];
    for (let y = 0; y < 9; y++) {
      const row = new Array(9).fill(1);
      // A costly blob straddling the middle columns.
      if (y >= 3 && y <= 5) for (let x = 3; x <= 5; x++) row[x] = 500;
      rows.push(row);
    }
    const { cost, width, height } = grid(rows);
    const path = shortestVerticalPath(cost, width, height);

    for (let y = 3; y <= 5; y++) {
      expect(path[y] < 3 || path[y] > 5)
        .withContext(`row ${y} cut straight through the object at column ${path[y]}`)
        .toBeTrue();
    }
  });

  it('never jumps more than a column, so the cut stays connected', () => {
    const rows: number[][] = [];
    let seed = 5;
    for (let y = 0; y < 40; y++) {
      const row: number[] = [];
      for (let x = 0; x < 30; x++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        row.push(seed / 2147483648);
      }
      rows.push(row);
    }
    const { cost, width, height } = grid(rows);
    const path = shortestVerticalPath(cost, width, height);
    for (let y = 1; y < height; y++) {
      expect(Math.abs(path[y] - path[y - 1]))
        .withContext(`row ${y} jumped from ${path[y - 1]} to ${path[y]}`)
        .toBeLessThanOrEqual(1);
    }
  });

  it('stays put when every route costs the same', () => {
    const rows = Array.from({ length: 6 }, () => new Array(7).fill(3));
    const { cost, width, height } = grid(rows);
    const path = shortestVerticalPath(cost, width, height);
    expect(new Set(Array.from(path)).size).toBe(1);
  });

  it('survives a strip one column wide', () => {
    const { cost, width, height } = grid([[1], [2], [3]]);
    expect(Array.from(shortestVerticalPath(cost, width, height))).toEqual([0, 0, 0]);
  });
});

describe('disagreementCost', () => {
  it('charges nothing where the two photos agree', () => {
    const a = new Float32Array([10, 20, 30, 40]);
    const cost = disagreementCost(a, a.slice(), 4, 1);
    expect(Array.from(cost)).toEqual([0, 0, 0, 0]);
  });

  /**
   * A ghost is the same edge in two places. Average brightness can match
   * perfectly while the edge is displaced, so brightness alone would call the
   * worst place on the strip free.
   */
  it('sees a displaced edge that brightness alone would miss', () => {
    const a = new Float32Array([0, 0, 0, 100, 100, 100]);
    const b = new Float32Array([0, 0, 100, 100, 100, 0]);
    const cost = disagreementCost(a, b, 6, 1);
    // Same mean, different edge position: the displaced edge must cost more
    // than the columns where both are flat.
    expect(cost[2]).toBeGreaterThan(cost[0]);
    expect(cost[2]).toBeGreaterThan(cost[4]);
  });

  it('makes a route through pixels no photo reached prohibitive', () => {
    const a = new Float32Array([10, NaN, 10]);
    const b = new Float32Array([10, 10, 10]);
    const cost = disagreementCost(a, b, 3, 1);
    expect(cost[1]).toBeGreaterThan(1000);
    expect(cost[0]).toBe(0);
  });
});
