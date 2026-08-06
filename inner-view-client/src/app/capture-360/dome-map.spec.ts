import { drawDomeMap } from './dome-map';

function ctx(w = 200, h = 200): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d')!;
}

/** Conta pixels com um canal verde dominante (a cor de "capturada"). */
function greenPixels(g: CanvasRenderingContext2D): number {
  const d = g.getImageData(0, 0, g.canvas.width, g.canvas.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0 && d[i + 1] > 120 && d[i + 1] > d[i] + 40 && d[i + 1] > d[i + 2] + 40) n++;
  }
  return n;
}

describe('dome-map', () => {
  it('desenha algo (não fica em branco)', () => {
    const g = ctx();
    drawDomeMap(g, { capturedKeys: new Set(), currentKey: 'upper:0' });
    const any = g.getImageData(0, 0, 200, 200).data.some((v, i) => i % 4 === 3 && v > 0);
    expect(any).toBeTrue();
  });

  it('mostra mais verde conforme mais células são capturadas', () => {
    const none = ctx();
    drawDomeMap(none, { capturedKeys: new Set(), currentKey: 'upper:0' });

    const some = ctx();
    drawDomeMap(some, {
      capturedKeys: new Set(['upper:0', 'upper:1', 'lower:0', 'zenith']),
      currentKey: 'upper:2',
    });

    expect(greenPixels(some)).toBeGreaterThan(greenPixels(none));
  });

  it('destaca a célula atual em branco (distinta de capturada e de a-fazer)', () => {
    const g = ctx();
    drawDomeMap(g, { capturedKeys: new Set(['upper:0']), currentKey: 'upper:1' });
    const d = g.getImageData(0, 0, 200, 200).data;
    let whitish = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 200 && d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) whitish++;
    }
    expect(whitish).toBeGreaterThan(0); // a célula atual sólida branca
  });
});
