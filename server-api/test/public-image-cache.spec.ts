import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GetPanoramaImageController } from '../src/modules/panoramas/controllers/get-panorama-image.controller';
import { GetPanoramaImageService } from '../src/modules/panoramas/services/get-panorama-image.service';
import { GetThumbnailController } from '../src/modules/virtual-tours/controllers/get-thumbnail.controller';
import { GetThumbnailService } from '../src/modules/virtual-tours/services/get-thumbnail.service';

describe('rotas alternativas à CDN nunca permitem cache externo de imagens', () => {
  let app: INestApplication;
  const service = { execute: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [GetPanoramaImageController, GetThumbnailController],
      providers: [
        { provide: GetPanoramaImageService, useValue: service },
        { provide: GetThumbnailService, useValue: service },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    service.execute.mockReset();
    service.execute.mockResolvedValue({
      etag: '"foto"',
      corpo: Buffer.from('jpeg'),
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  describe.each(['/panoramas/id/image', '/virtual-tours/id/thumbnail'])(
    '%s',
    (url) => {
      it('200 não fica cacheado no navegador/proxy', async () => {
        const response = await request(app.getHttpServer())
          .get(url)
          .expect(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers.etag).toBe('"foto"');
        expect(response.body).toEqual(Buffer.from('jpeg'));
      });
      it('HEAD também verifica o acesso e não permite cache externo', async () => {
        const response = await request(app.getHttpServer())
          .head(url)
          .expect(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(service.execute).toHaveBeenCalledTimes(1);
        expect(response.text).toBeUndefined();
      });
      it('304 continua sem cache externo', async () => {
        service.execute.mockResolvedValue({ etag: '"foto"' });
        const response = await request(app.getHttpServer())
          .get(url)
          .set('If-None-Match', '"foto"')
          .expect(304);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(service.execute).toHaveBeenCalledTimes(1);
      });
      it('404 de tour oculto/apagado não permite cache externo', async () => {
        service.execute.mockRejectedValue(new NotFoundException());
        const response = await request(app.getHttpServer())
          .get(url)
          .expect(404);
        expect(response.headers['cache-control']).toBe('no-store');
      });
    },
  );
});
