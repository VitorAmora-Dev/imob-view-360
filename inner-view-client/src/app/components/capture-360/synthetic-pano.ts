/**
 * Procedurally drawn equirectangular test environment for the capture
 * simulation mode. Labeled wall panels every 30° plus a lat/lon grid make any
 * stitching misalignment, mirroring or seam immediately visible when the
 * stitched output is compared against this ground truth.
 */
export function drawSyntheticPano(width = 4096, height = 2048): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const horizon = height / 2;

  // Ceiling and floor
  const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
  ceiling.addColorStop(0, '#dce9f2');
  ceiling.addColorStop(1, '#f6f9fb');
  ctx.fillStyle = ceiling;
  ctx.fillRect(0, 0, width, horizon);

  const floor = ctx.createLinearGradient(0, horizon, 0, height);
  floor.addColorStop(0, '#cbbba8');
  floor.addColorStop(1, '#8f7f6c');
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, width, height - horizon);

  // Wall band: 12 pastel panels, one per 30° sector, labeled with its yaw
  const wallTop = height * 0.28;
  const wallBottom = height * 0.72;
  const panels = 12;
  for (let i = 0; i < panels; i++) {
    const x0 = (i / panels) * width;
    const panelWidth = width / panels;
    ctx.fillStyle = `hsl(${(i * 360) / panels} 45% ${i % 2 === 0 ? 78 : 66}%)`;
    ctx.fillRect(x0, wallTop, panelWidth, wallBottom - wallTop);

    ctx.fillStyle = '#222222';
    ctx.font = `bold ${Math.round(height * 0.085)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String.fromCharCode(65 + i), x0 + panelWidth / 2, horizon - height * 0.06);
    ctx.font = `${Math.round(height * 0.035)}px Inter, sans-serif`;
    ctx.fillText(`${i * 30}°`, x0 + panelWidth / 2, horizon + height * 0.045);
  }

  // Lat/lon grid every 15° — thin, over everything
  ctx.strokeStyle = 'rgba(34, 34, 34, 0.25)';
  ctx.lineWidth = 2;
  for (let lon = 0; lon < 360; lon += 15) {
    const x = (lon / 360) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let lat = 15; lat < 180; lat += 15) {
    const y = (lat / 180) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Strong horizon line + seam marker at yaw 0 so orientation errors stand out
  ctx.strokeStyle = 'rgba(34, 34, 34, 0.6)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(width, horizon);
  ctx.stroke();

  drawPoleFeatures(ctx, width, height);

  return canvas;
}

/**
 * Ceiling and floor need real detail, otherwise a cap shot that landed in the
 * wrong place would still score well against a flat gradient and the coverage
 * check would pass on a broken stitch.
 */
function drawPoleFeatures(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const marks: ReadonlyArray<{ latDeg: number; label: string; color: string }> = [
    { latDeg: 20, label: 'TETO', color: '#2b4c7e' },
    { latDeg: 55, label: '▲', color: '#1f3557' },
    { latDeg: 160, label: 'CHAO', color: '#5b3a1f' },
    { latDeg: 125, label: '▼', color: '#7a5230' },
  ];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const mark of marks) {
    const y = (mark.latDeg / 180) * height;
    ctx.fillStyle = mark.color;
    ctx.font = `bold ${Math.round(height * 0.05)}px Inter, sans-serif`;
    // Repeated around the full turn: near the poles longitude compresses, so a
    // single label would occupy only a sliver of the sphere.
    for (let lon = 0; lon < 360; lon += 45) {
      ctx.fillText(mark.label, ((lon + 22.5) / 360) * width, y);
    }
  }

  // Bullseye rings centred on each pole, to expose cap rotation errors.
  ctx.strokeStyle = 'rgba(34, 34, 34, 0.45)';
  ctx.lineWidth = 3;
  for (const latDeg of [6, 12, 168, 174]) {
    const y = (latDeg / 180) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}
