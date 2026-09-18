import sharp from 'sharp';
import { GetPanoramaPreviewService } from '../src/modules/panoramas/services/get-panorama-preview.service';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function jpeg(largura: number, tom: number): Promise<Buffer> {
  return sharp({
    create: {
      width: largura,
      height: largura / 2,
      channels: 3,
      background: { r: tom, g: tom, b: tom },
    },
  })
    .jpeg()
    .toBuffer();
}

async function seedPanorama(
  propertyId: string,
  dados: object,
): Promise<string> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId, status: 'DRAFT' },
  });
  const panorama = await prisma.panorama.create({
    data: { roomName: 'Sala', virtualTourId: tour.id, ...dados },
  });
  return panorama.id;
}

describe('preview do rascunho', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  it('com balde que assina, responde desvio para o link assinado', async () => {
    // Teste 4 da spec. `ArmazenamentoEmMemoria` com base assina; sem base, não.
    const balde = new ArmazenamentoEmMemoria('https://balde.teste');
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const id = await seedPanorama(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const r = await servico.execute(id, tenants.a.admin, {
      variante: 'original',
    });

    expect(r.tipo).toBe('desvio');
    expect((r as { url: string }).url).toContain('panoramas/p/1/original.jpg');
  });

  it('com largura, o desvio aponta para a capa', async () => {
    const balde = new ArmazenamentoEmMemoria('https://balde.teste');
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    await balde.gravar(
      chaveDaCapa('panoramas/p/1/original.jpg'),
      await jpeg(640, 95),
    );
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const id = await seedPanorama(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const r = await servico.execute(id, tenants.a.admin, {
      variante: 'original',
      largura: 320,
    });

    expect((r as { url: string }).url).toContain('panoramas/p/1/capa.jpg');
  });

  it('sem balde que assine, continua servindo os bytes', async () => {
    // Desenvolvimento e teste: o disco local não assina, e a API serve. Sem
    // esta queda, o wizard abriria em branco na máquina de quem desenvolve.
    const balde = new ArmazenamentoEmMemoria();
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const id = await seedPanorama(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const r = await servico.execute(id, tenants.a.admin, {
      variante: 'original',
    });

    expect(r.tipo).toBe('bytes');
    expect((r as { corpo?: Buffer }).corpo).toBeDefined();
  });

  it('linha não migrada continua servindo os bytes da coluna', async () => {
    const balde = new ArmazenamentoEmMemoria('https://balde.teste');
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const bytes = await jpeg(2048, 200);
    const id = await seedPanorama(tenants.a.propertyId, {
      imageData: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    });

    const r = await servico.execute(id, tenants.a.admin, {
      variante: 'original',
    });

    expect(r.tipo).toBe('bytes');
  });

  it('panorama de outra agência continua em 404, sem desvio nenhum', async () => {
    // Teste 4 da spec, segunda metade. A autorização NÃO saiu do lugar: se o
    // desvio fosse emitido antes da checagem, um uuid vazaria a foto de outra
    // imobiliária sem nem passar pelo guard.
    const balde = new ArmazenamentoEmMemoria('https://balde.teste');
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const id = await seedPanorama(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    await expect(
      servico.execute(id, tenants.b.admin, { variante: 'original' }),
    ).rejects.toThrow('Panorama not found');
  });
});
