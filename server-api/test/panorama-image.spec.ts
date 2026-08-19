import { NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { GetPanoramaImageService } from '../src/modules/panoramas/services/get-panorama-image.service';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { limparCacheDeMiniatura } from '../src/modules/panoramas/panorama-miniatura';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;
const imagem = new GetPanoramaImageService(
  asPrismaService,
  new PanoramaImageReader(asPrismaService),
);

async function jpegDe(
  largura: number,
  altura: number,
  tom: number,
): Promise<string> {
  const bytes = await sharp({
    create: {
      width: largura,
      height: altura,
      channels: 3,
      background: { r: tom, g: tom, b: tom },
    },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

async function seedPanorama(
  tenant: TenantFixture,
  status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED',
): Promise<{ panoramaId: string; originalBytes: number }> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId: tenant.propertyId, status },
  });
  const imageData = await jpegDe(1600, 800, 120);
  const panorama = await prisma.panorama.create({
    data: {
      roomName: 'Sala',
      imageData,
      virtualTourId: tour.id,
      initialPanorama: true,
    },
  });
  return { panoramaId: panorama.id, originalBytes: imageData.length };
}

describe('imagem de um panorama por URL própria', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    limparCacheDeMiniatura();
  });

  it('devolve o JPEG em tamanho original quando não se pede largura', async () => {
    // Sem `?w=` a rota tem de servir a panorâmica como ela está: é o que o
    // visualizador 360 consome, e reduzir aqui estragaria a esfera.
    const { panoramaId } = await seedPanorama(tenants.a);

    const { corpo } = await imagem.execute(panoramaId);

    const meta = await sharp(corpo!).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(800);
  });

  it('reduz quando se pede largura', async () => {
    const { panoramaId, originalBytes } = await seedPanorama(tenants.a);

    const { corpo } = await imagem.execute(panoramaId, { largura: 320 });

    const meta = await sharp(corpo!).metadata();
    expect(meta.width).toBe(320);
    expect(corpo!.length).toBeLessThan(originalBytes / 4);
  });

  it('ignora largura absurda em vez de mandar o sharp ampliar', async () => {
    // `?w=` é entrada de quem chama, numa rota pública sem autenticação. Sem
    // teto, um valor grande viraria trabalho de CPU por requisição.
    const { panoramaId } = await seedPanorama(tenants.a);

    const { corpo } = await imagem.execute(panoramaId, { largura: 999999 });

    const meta = await sharp(corpo!).metadata();
    expect(meta.width).toBe(1600);
  });

  it('não serve imagem de tour que não está publicado', async () => {
    // Mesma regra da rota pública de tour: sem isto, a foto de um rascunho
    // vazaria para quem souber o id.
    const { panoramaId } = await seedPanorama(tenants.a, 'DRAFT');

    await expect(imagem.execute(panoramaId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('não devolve corpo quando o cliente já tem aquela versão', async () => {
    const { panoramaId } = await seedPanorama(tenants.a);
    const { etag } = await imagem.execute(panoramaId);

    const revalidacao = await imagem.execute(panoramaId, {
      etagDoCliente: etag,
    });

    expect(revalidacao.etag).toBe(etag);
    expect(revalidacao.corpo).toBeUndefined();
  });

  it('dá ETags diferentes para larguras diferentes', async () => {
    // O ETag identifica os BYTES servidos, não o panorama. Sem a largura na
    // chave, pedir `?w=320` depois de `?w=640` receberia 304 e o navegador
    // ficaria com a imagem do tamanho errado.
    const { panoramaId } = await seedPanorama(tenants.a);

    const cheia = await imagem.execute(panoramaId);
    const reduzida = await imagem.execute(panoramaId, { largura: 320 });

    expect(reduzida.etag).not.toBe(cheia.etag);
  });

  it('prefere a imagem tratada pela IA quando ela existe', async () => {
    const { panoramaId } = await seedPanorama(tenants.a);
    await prisma.panorama.update({
      where: { id: panoramaId },
      data: {
        treatedImageData: await jpegDe(1600, 800, 240),
        treatmentStatus: 'DONE',
        treatedAt: new Date(),
      },
    });

    const { corpo } = await imagem.execute(panoramaId);

    const { channels } = await sharp(corpo!).stats();
    expect(channels[0].mean).toBeGreaterThan(200);
  });
});
