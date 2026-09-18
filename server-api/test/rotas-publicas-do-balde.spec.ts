import sharp from 'sharp';
import { GetPanoramaImageService } from '../src/modules/panoramas/services/get-panorama-image.service';
import { GetThumbnailService } from '../src/modules/virtual-tours/services/get-thumbnail.service';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { limparCacheDeCapa } from '../src/modules/panoramas/capa-do-panorama';
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

async function tomDe(bytes: Buffer): Promise<number> {
  const { channels } = await sharp(bytes).stats();
  return Math.round(channels[0].mean);
}

describe('rotas públicas servindo do balde', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let imagem: GetPanoramaImageService;
  let miniatura: GetThumbnailService;
  let tourId: string;
  let panoramaId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    limparCacheDeCapa();
    const leitor = new PanoramaImageReader(asPrismaService, balde);
    imagem = new GetPanoramaImageService(asPrismaService, leitor);
    miniatura = new GetThumbnailService(asPrismaService, leitor);

    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'PUBLISHED' },
    });
    tourId = tour.id;

    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    await balde.gravar(
      chaveDaCapa('panoramas/p/1/original.jpg'),
      await jpeg(640, 95),
    );

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: tour.id,
        initialPanorama: true,
        imageKey: 'panoramas/p/1/original.jpg',
      },
    });
    panoramaId = panorama.id;
  });

  it('sem largura, serve a imagem inteira do balde', async () => {
    const { corpo } = await imagem.execute(panoramaId);

    expect((await sharp(corpo!).metadata()).width).toBe(2048);
  });

  it('com largura, serve a capa GRAVADA e não redimensiona', async () => {
    // O tom 95 só existe na capa: se a resposta viesse de um sharp sobre a
    // original, ela sairia com 90 — e o teste pegaria o redimensionamento
    // continuando a acontecer sem ninguém perceber.
    const { corpo } = await imagem.execute(panoramaId, { largura: 292 });

    expect((await sharp(corpo!).metadata()).width).toBe(640);
    expect(await tomDe(corpo!)).toBe(95);
  });

  it('qualquer largura pedida cai na mesma capa de 640', async () => {
    // Um tamanho só: 640 cobre o card de imóvel e a faixa de cenas, e a
    // diferença de banda não paga manter duas.
    const a = await imagem.execute(panoramaId, { largura: 292 });
    const b = await imagem.execute(panoramaId, { largura: 320 });

    expect(a.etag).toBe(b.etag);
  });

  it('largura acima do teto continua servindo a original', async () => {
    const { corpo } = await imagem.execute(panoramaId, { largura: 999999 });

    expect((await sharp(corpo!).metadata()).width).toBe(2048);
  });

  it('linha ainda não migrada continua reduzindo sob demanda', async () => {
    // O caminho de queda. Sem ele, todo tour publicado ficaria sem card entre
    // o deploy e o fim do `migrar-imagens`.
    const bytes = await jpeg(2048, 200);
    const legado = await prisma.panorama.create({
      data: {
        roomName: 'Quarto',
        virtualTourId: tourId,
        order: 1,
        imageData: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      },
    });

    const { corpo } = await imagem.execute(legado.id, { largura: 292 });

    expect((await sharp(corpo!).metadata()).width).toBe(640);
    expect(await tomDe(corpo!)).toBe(200);
  });

  it('a capa do tour vem do balde, sem redimensionar', async () => {
    const { corpo } = await miniatura.execute(tourId);

    expect((await sharp(corpo!).metadata()).width).toBe(640);
    expect(await tomDe(corpo!)).toBe(95);
  });

  it('tour não publicado continua respondendo 404', async () => {
    // A rota é sem guard: é o filtro por PUBLISHED que a protege, e ele não
    // pode ter se perdido na troca de fonte dos bytes.
    const rascunho = await prisma.virtualTour.create({
      data: { propertyId: tenants.b.propertyId, status: 'DRAFT' },
    });
    const escondido = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: rascunho.id,
        imageKey: 'panoramas/p/1/original.jpg',
      },
    });

    await expect(imagem.execute(escondido.id)).rejects.toThrow(
      'Panorama not found',
    );
  });
});
