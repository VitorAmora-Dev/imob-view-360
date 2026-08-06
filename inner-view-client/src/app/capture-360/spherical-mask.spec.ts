import { CameraModel, goreOutline } from './camera-projection';
import {
  buildMaskGeometry,
  coverTransform,
  drawMaskOverlay,
  visibleFrameRect,
} from './spherical-mask';

describe('spherical-mask', () => {
  const cam: CameraModel = { pitchDeg: 20, vFovDeg: 100, width: 1080, height: 1920 };

  function ctx2d(w: number, h: number): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas.getContext('2d')!;
  }

  describe('buildMaskGeometry', () => {
    it('marca fits conforme a lente', () => {
      expect(buildMaskGeometry(cam, 'upper').fits).toBeTrue();
      expect(buildMaskGeometry({ ...cam, vFovDeg: 60 }, 'upper').fits).toBeFalse();
    });

    it('contém o interior do gomo e exclui o exterior (isPointInPath)', () => {
      const ctx = ctx2d(cam.width, cam.height);
      const { path } = buildMaskGeometry(cam, 'upper');
      const { equatorLeft, equatorRight, parallel } = goreOutline(cam, 'upper');

      // centro do gomo: entre o equador e o meio do paralelo
      const centerX = (equatorLeft.x + equatorRight.x) / 2;
      const midParallel = parallel[Math.floor(parallel.length / 2)];
      const centerY = (equatorLeft.y + midParallel.y) / 2;
      expect(ctx.isPointInPath(path, centerX, centerY)).toBeTrue();

      // fora: canto do frame e um ponto acima do paralelo
      expect(ctx.isPointInPath(path, 5, 5)).toBeFalse();
      expect(ctx.isPointInPath(path, centerX, midParallel.y - 50)).toBeFalse();
      // fora: abaixo do equador (a janela termina na reta do equador)
      expect(ctx.isPointInPath(path, centerX, equatorLeft.y + 50)).toBeFalse();
    });

    it('espelha a faixa inferior (janela abaixo do equador)', () => {
      const lower: CameraModel = { ...cam, pitchDeg: -20 };
      const ctx = ctx2d(cam.width, cam.height);
      const { path } = buildMaskGeometry(lower, 'lower');
      const { equatorLeft, equatorRight, parallel } = goreOutline(lower, 'lower');
      const centerX = (equatorLeft.x + equatorRight.x) / 2;
      const midParallel = parallel[Math.floor(parallel.length / 2)];
      const centerY = (equatorLeft.y + midParallel.y) / 2;
      expect(midParallel.y).toBeGreaterThan(equatorLeft.y);
      expect(ctx.isPointInPath(path, centerX, centerY)).toBeTrue();
      expect(ctx.isPointInPath(path, centerX, equatorLeft.y - 50)).toBeFalse();
    });
  });

  describe('coverTransform / visibleFrameRect', () => {
    it('é identidade quando frame e canvas coincidem', () => {
      const t = coverTransform(1080, 1920, 1080, 1920);
      expect(t.scale).toBe(1);
      expect(t.dx).toBe(0);
      expect(t.dy).toBe(0);
      const r = visibleFrameRect(1080, 1920, 1080, 1920);
      // toBeCloseTo e não toEqual: -dx/scale produz -0 IEEE quando dx = 0,
      // indistinguível de 0 em qualquer aritmética de pixel.
      expect(r.x).toBeCloseTo(0, 9);
      expect(r.y).toBeCloseTo(0, 9);
      expect(r.width).toBeCloseTo(1080, 9);
      expect(r.height).toBeCloseTo(1920, 9);
    });

    it('corta as laterais de um frame paisagem exibido em canvas retrato', () => {
      const t = coverTransform(1920, 1080, 390, 844);
      expect(t.scale).toBeCloseTo(844 / 1080, 9);
      expect(t.dy).toBeCloseTo(0, 6);
      expect(t.dx).toBeLessThan(0);

      const r = visibleFrameRect(1920, 1080, 390, 844);
      expect(r.y).toBeCloseTo(0, 6);
      expect(r.height).toBeCloseTo(1080, 6);
      expect(r.width).toBeCloseTo(390 / t.scale, 6);
      // região visível é central
      expect(r.x).toBeCloseTo((1920 - r.width) / 2, 6);
    });

    it('corta topo/baixo de um frame retrato em canvas mais largo', () => {
      const t = coverTransform(1080, 1920, 800, 600);
      expect(t.scale).toBeCloseTo(800 / 1080, 9);
      expect(t.dx).toBeCloseTo(0, 6);
      expect(t.dy).toBeLessThan(0);
    });

    it('mapeia frame→canvas de forma consistente com o rect visível', () => {
      const t = coverTransform(1920, 1080, 390, 844);
      const r = visibleFrameRect(1920, 1080, 390, 844);
      // canto esquerdo visível do frame deve cair no x=0 do canvas
      expect(r.x * t.scale + t.dx).toBeCloseTo(0, 6);
      // canto direito visível → x=canvasW
      expect((r.x + r.width) * t.scale + t.dx).toBeCloseTo(390, 6);
    });
  });

  describe('drawMaskOverlay', () => {
    it('abre a janela transparente no gomo e escurece o resto', () => {
      const ctx = ctx2d(cam.width, cam.height);
      const geo = buildMaskGeometry(cam, 'upper');
      drawMaskOverlay(ctx, geo, { scale: 1, dx: 0, dy: 0 });

      const { equatorLeft, equatorRight, parallel } = goreOutline(cam, 'upper');
      const centerX = Math.round((equatorLeft.x + equatorRight.x) / 2);
      const midParallel = parallel[Math.floor(parallel.length / 2)];
      const centerY = Math.round((equatorLeft.y + midParallel.y) / 2);

      const inside = ctx.getImageData(centerX, centerY, 1, 1).data;
      const outside = ctx.getImageData(5, 5, 1, 1).data;
      expect(inside[3]).toBe(0); // janela: totalmente transparente
      expect(outside[3]).toBeGreaterThan(100); // véu: ~55% de alpha
    });
  });
});
