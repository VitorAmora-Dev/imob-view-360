import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PrismaModule } from '../src/infra/prisma/prisma.module';
import { PublicImagesModule } from '../src/modules/public-images/public-images.module';
import { AuthorizePublicImageService } from '../src/modules/public-images/authorize-public-image.service';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { prisma } from './setup/prisma';
import { seedTwoTenants } from './fixtures';

const SECRET = 'gateway-de-teste-'.repeat(4);

describe('autorização de imagem pública para o gateway', () => {
  let app: INestApplication;
  let service: AuthorizePublicImageService;
  let config: ConfigService;
  let id: string;
  let tourId: string;
  let original: string;
  let tratada: string;

  beforeAll(async () => {
    config = new ConfigService({ PUBLIC_IMAGE_GATEWAY_SECRET: SECRET });
    const module = await Test.createTestingModule({
      imports: [
        PrismaModule,
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PublicImagesModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ConfigService)
      .useValue(config)
      .compile();
    // PrismaModule e ConfigModule são globais na aplicação real. Aqui ficam
    // explícitos para testar o módulo sem ler .env nem credenciais externas.
    app = module.createNestApplication();
    service = module.get(AuthorizePublicImageService);
    await app.init();
  });

  beforeEach(async () => {
    const tenants = await seedTwoTenants();
    id = randomUUID();
    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'PUBLISHED' },
    });
    tourId = tour.id;
    original = `panoramas/${id}/1710000000000/original.jpg`;
    tratada = `panoramas/${id}/1710000000001/tratada.jpg`;
    await prisma.panorama.create({
      data: {
        id,
        virtualTourId: tourId,
        roomName: 'Sala',
        imageKey: original,
        treatedImageKey: tratada,
        treatmentStatus: 'DONE',
      },
    });
    config.set('PUBLIC_IMAGE_GATEWAY_SECRET', SECRET);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it('libera apenas a variante atual publicada e sua capa, sem ler bytes', async () => {
    const consultas = jest.spyOn(prisma.panorama, 'findFirst');
    await expect(service.execute(tratada)).resolves.toBeUndefined();
    await expect(
      service.execute(chaveDaCapa(tratada)),
    ).resolves.toBeUndefined();
    expect(consultas).toHaveBeenCalledWith({
      where: { id, virtualTour: { status: 'PUBLISHED' } },
      select: { imageKey: true, treatedImageKey: true, treatmentStatus: true },
    });
    await expect(service.execute(original)).rejects.toThrow();
    await expect(service.execute(chaveDaCapa(original))).rejects.toThrow();
  });

  it('sem tratamento concluído libera somente o original e sua capa', async () => {
    await prisma.panorama.update({
      where: { id },
      data: { treatmentStatus: 'PENDING' },
    });
    await expect(service.execute(original)).resolves.toBeUndefined();
    await expect(
      service.execute(chaveDaCapa(original)),
    ).resolves.toBeUndefined();
    await expect(service.execute(tratada)).rejects.toThrow();
  });

  it.each(['DRAFT', 'ARCHIVED'] as const)(
    'revoga links quando o tour vira %s',
    async (status) => {
      await service.execute(tratada);
      await prisma.virtualTour.update({
        where: { id: tourId },
        data: { status },
      });
      await expect(service.execute(tratada)).rejects.toThrow();
      await expect(service.execute(chaveDaCapa(tratada))).rejects.toThrow();
    },
  );

  it('revoga links após apagar o tour', async () => {
    await service.execute(tratada);
    await prisma.virtualTour.delete({ where: { id: tourId } });
    await expect(service.execute(tratada)).rejects.toThrow();
  });

  it('revoga versões anteriores após refotografar', async () => {
    await prisma.panorama.update({
      where: { id },
      data: {
        imageKey: `panoramas/${id}/1710000000002/original.jpg`,
        treatedImageKey: null,
        treatmentStatus: 'PENDING',
      },
    });
    await expect(service.execute(tratada)).rejects.toThrow();
    await expect(service.execute(original)).rejects.toThrow();
  });

  it.each([
    'capturas/x/0.jpg',
    'panoramas/../../original.jpg',
    'https://outro.test/a.jpg',
    'panoramas/%2f/1/capa.jpg',
  ])('nega caminho não publicável: %s', async (key) => {
    const consultas = jest.spyOn(prisma.panorama, 'findFirst');
    await expect(service.execute(key)).rejects.toThrow();
    expect(consultas).not.toHaveBeenCalled();
  });

  it('não publica o original quando a tratada só existe na coluna legada', async () => {
    await prisma.panorama.update({
      where: { id },
      data: { treatedImageKey: null, treatedImageData: 'legado' },
    });
    await expect(service.execute(original)).rejects.toThrow();
  });

  it('endpoint interno exige segredo, nunca um token do usuário', async () => {
    const consultas = jest.spyOn(prisma.panorama, 'findFirst');
    for (const secret of [
      '',
      'jwt-de-usuario-'.repeat(4),
      'errado-'.repeat(8),
    ]) {
      const call = request(app.getHttpServer())
        .post('/internal/public-images/authorize')
        .send({ key: tratada });
      if (secret) call.set('Authorization', 'Bearer ' + secret);
      const response = await call.expect(401);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(consultas).not.toHaveBeenCalled();
  });

  it('segredo válido recebe 204 ou 404 sem decisões cacheáveis', async () => {
    const call = (key: string) =>
      request(app.getHttpServer())
        .post('/internal/public-images/authorize')
        .set('Authorization', 'Bearer ' + SECRET)
        .send({ key });
    expect((await call(tratada).expect(204)).headers['cache-control']).toBe(
      'no-store',
    );
    expect((await call(original).expect(404)).headers['cache-control']).toBe(
      'no-store',
    );
  });

  it('segredo ausente desabilita o endpoint e corpo não aceita campos extras', async () => {
    config.set('PUBLIC_IMAGE_GATEWAY_SECRET', '');
    await request(app.getHttpServer())
      .post('/internal/public-images/authorize')
      .set('Authorization', 'Bearer ' + SECRET)
      .send({ key: tratada })
      .expect(401);
    config.set('PUBLIC_IMAGE_GATEWAY_SECRET', SECRET);
    await request(app.getHttpServer())
      .post('/internal/public-images/authorize')
      .set('Authorization', 'Bearer ' + SECRET)
      .send({ key: tratada, url: 'https://outro.test' })
      .expect(400);
  });
});
