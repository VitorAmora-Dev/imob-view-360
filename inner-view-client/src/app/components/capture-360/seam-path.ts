/**
 * Chooses WHERE two overlapping photos are cut apart.
 *
 * Parallax cannot be removed — a hand-held turn photographs the room from
 * slightly different places, and no rotation reconciles that (see the
 * measurements in `alignRing`). What is left is choosing where the resulting
 * mismatch lands. Cutting at the geometric midpoint, which is what the stitch
 * did before, puts it wherever the midpoint happens to fall: through the bed,
 * through the television, through a guitar on the wall.
 *
 * So the cut is routed instead: down the path where the two photos disagree
 * least, which is blank wall and existing edges rather than the middle of an
 * object. It is what Photoshop, ICE and Street View all do, and with twelve
 * shots on the ultra-wide there are around sixty degrees of overlap for the
 * path to wander through.
 */

/**
 * Least-cost path from the top row to the bottom row, stepping at most one
 * column per row. Returns the column chosen for each row.
 *
 * The one-column-per-row limit is what makes the result a CUT rather than a
 * selection: the two sides stay connected, so no island of one photo appears
 * marooned inside the other.
 */
export function shortestVerticalPath(
  cost: Float32Array,
  width: number,
  height: number,
): Int32Array {
  const path = new Int32Array(height);
  if (width <= 0 || height <= 0) return path;
  if (width === 1) return path;

  const best = new Float32Array(width * height);
  // Which of the three cells above was taken, as −1, 0 or +1.
  const step = new Int8Array(width * height);

  for (let x = 0; x < width; x++) best[x] = cost[x];

  for (let y = 1; y < height; y++) {
    const row = y * width;
    const prev = row - width;
    for (let x = 0; x < width; x++) {
      let from = 0;
      let value = best[prev + x];
      if (x > 0 && best[prev + x - 1] < value) {
        value = best[prev + x - 1];
        from = -1;
      }
      if (x + 1 < width && best[prev + x + 1] < value) {
        value = best[prev + x + 1];
        from = 1;
      }
      best[row + x] = cost[row + x] + value;
      step[row + x] = from;
    }
  }

  const last = (height - 1) * width;
  let end = 0;
  for (let x = 1; x < width; x++) if (best[last + x] < best[last + end]) end = x;

  path[height - 1] = end;
  for (let y = height - 1; y > 0; y--) {
    end += step[y * width + end];
    path[y - 1] = end;
  }
  return path;
}

export interface Disagreement {
  /** What the path minimises: brightness difference plus doubled edges. */
  cost: Float32Array;
  /**
   * The doubled-edge term on its own.
   *
   * Separate because the two answer different questions. The path wants the
   * total, since either kind of mismatch is ugly to cut through. How WIDE to
   * cross-fade at a point on the path depends only on this one: a brightness
   * difference is exactly what a wide fade is for, while a displaced edge is
   * what a wide fade turns into a ghost.
   */
  ghost: Float32Array;
}

/**
 * Disagreement between two overlapping samples, as a cost the path avoids.
 *
 * Both terms matter and they catch different failures: the plain difference
 * finds where the two photos show different things, and the gradient
 * difference finds where they show the SAME thing in different places — the
 * doubled edge that reads as a ghost. A cut through flat wall costs nothing
 * under either.
 */
export function disagreementCost(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  /** Cost charged where one of the photos does not reach. */
  missingCost = 1e4,
): Disagreement {
  const cost = new Float32Array(width * height);
  const ghost = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const va = a[i];
      const vb = b[i];
      if (Number.isNaN(va) || Number.isNaN(vb)) {
        cost[i] = missingCost;
        // Nothing to fade into where one photo is absent, so this reads as the
        // worst case rather than as agreement.
        ghost[i] = missingCost;
        continue;
      }
      // Horizontal gradient of each, compared: a doubled edge shows here even
      // when the average brightness matches.
      const ga = x > 0 && !Number.isNaN(a[i - 1]) ? va - a[i - 1] : 0;
      const gb = x > 0 && !Number.isNaN(b[i - 1]) ? vb - b[i - 1] : 0;
      ghost[i] = Math.abs(ga - gb);
      cost[i] = Math.abs(va - vb) + 2 * ghost[i];
    }
  }
  return { cost, ghost };
}
