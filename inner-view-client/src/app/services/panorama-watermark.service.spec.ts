import { TestBed } from '@angular/core/testing';
import {
  calculateWatermarkLayout,
  PanoramaWatermarkService,
} from './panorama-watermark.service';

describe('PanoramaWatermarkService', () => {
  describe('calculateWatermarkLayout', () => {
    it('posiciona a assinatura no canto inferior direito de um panorama 4K', () => {
      const layout = calculateWatermarkLayout(3840, 1920, 4);

      expect(layout.logoWidth).toBe(691);
      expect(layout.logoHeight).toBe(173);
      expect(layout.panelX + layout.panelWidth).toBe(3840 - 48);
      expect(layout.panelY + layout.panelHeight).toBe(1920 - 48);
    });

    it('mantém painel e logo dentro de uma imagem pequena', () => {
      const layout = calculateWatermarkLayout(160, 80, 4);

      expect(layout.panelX).toBeGreaterThanOrEqual(0);
      expect(layout.panelY).toBeGreaterThanOrEqual(0);
      expect(layout.panelX + layout.panelWidth).toBeLessThanOrEqual(160);
      expect(layout.panelY + layout.panelHeight).toBeLessThanOrEqual(80);
    });
  });

  describe('apply', () => {
    let originalCreateElement: typeof document.createElement;

    afterEach(() => {
      TestBed.resetTestingModule();
    });

    it('desenha foto, base de contraste e logo, preservando as dimensões', async () => {
      const sourceBlob = new Blob(['source'], { type: 'image/jpeg' });
      const logoBlob = new Blob(['logo'], { type: 'image/svg+xml' });
      const outputBlob = new Blob(['watermarked'], { type: 'image/jpeg' });
      const sourceClose = jasmine.createSpy('sourceClose');
      const logoClose = jasmine.createSpy('logoClose');
      const source = { width: 3840, height: 1920, close: sourceClose } as unknown as ImageBitmap;
      const logo = { width: 1297, height: 324, close: logoClose } as unknown as ImageBitmap;
      const drawImage = jasmine.createSpy('drawImage');
      const fill = jasmine.createSpy('fill');
      const context = {
        drawImage,
        fill,
        save: jasmine.createSpy('save'),
        restore: jasmine.createSpy('restore'),
        beginPath: jasmine.createSpy('beginPath'),
        moveTo: jasmine.createSpy('moveTo'),
        lineTo: jasmine.createSpy('lineTo'),
        quadraticCurveTo: jasmine.createSpy('quadraticCurveTo'),
        closePath: jasmine.createSpy('closePath'),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        fillStyle: '',
        globalAlpha: 1,
      } as unknown as CanvasRenderingContext2D;
      const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: jasmine.createSpy('getContext').and.returnValue(context),
        toBlob: (callback: BlobCallback, type?: string) => {
          expect(type).toBe('image/jpeg');
          callback(outputBlob);
        },
      } as unknown as HTMLCanvasElement;

      spyOn(window, 'fetch').and.resolveTo(new Response(logoBlob, { status: 200 }));
      spyOn(window, 'createImageBitmap').and.returnValues(
        Promise.resolve(source),
        Promise.resolve(logo),
      );
      originalCreateElement = document.createElement.bind(document);
      spyOn(document, 'createElement').and.callFake(((tagName: string) =>
        tagName.toLowerCase() === 'canvas'
          ? fakeCanvas
          : originalCreateElement(tagName)) as typeof document.createElement);

      const result = await TestBed.inject(PanoramaWatermarkService).apply(sourceBlob);

      expect(result).toBe(outputBlob);
      expect(drawImage.calls.argsFor(0)).toEqual([source, 0, 0, 3840, 1920]);
      expect(drawImage.calls.argsFor(1)[0]).toBe(logo);
      expect(fill).toHaveBeenCalled();
      expect(sourceClose).toHaveBeenCalled();
      expect(logoClose).toHaveBeenCalled();
      expect(fakeCanvas.width).toBe(1);
      expect(fakeCanvas.height).toBe(1);
    });

    it('falha sem gerar foto quando o ativo oficial não pode ser carregado', async () => {
      spyOn(window, 'fetch').and.resolveTo(new Response('', { status: 404 }));
      const close = jasmine.createSpy('close');
      const source = {
        width: 100,
        height: 50,
        close,
      } as unknown as ImageBitmap;
      spyOn(window, 'createImageBitmap').and.resolveTo(source);

      await expectAsync(
        TestBed.inject(PanoramaWatermarkService).apply(new Blob(['source'])),
      ).toBeRejectedWithError(/HTTP 404/);
      expect(close).toHaveBeenCalled();
    });
  });

  describe('applyFromObjectUrl', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('lê somente o blob local do cache antes de aplicar a marca', async () => {
      const service = TestBed.inject(PanoramaWatermarkService);
      const source = new Blob(['source'], { type: 'image/jpeg' });
      const output = new Blob(['watermarked'], { type: 'image/jpeg' });
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(new Response(source, { status: 200 }));
      const applySpy = spyOn(service, 'apply').and.resolveTo(output);

      const result = await service.applyFromObjectUrl('blob:cena-1');

      expect(result).toBe(output);
      expect(fetchSpy).toHaveBeenCalledOnceWith('blob:cena-1');
      expect(applySpy).toHaveBeenCalled();
    });

    it('recusa uma URL de rede', async () => {
      const fetchSpy = spyOn(window, 'fetch');

      await expectAsync(
        TestBed.inject(PanoramaWatermarkService).applyFromObjectUrl('/panoramas/cena-1/image'),
      ).toBeRejectedWithError(/object URL/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
