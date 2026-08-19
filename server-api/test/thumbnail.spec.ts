import { NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { GetThumbnailService } from '../src/modules/virtual-tours/services/get-thumbnail.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { limparCacheDeMiniatura } from '../src/modules/panoramas/panorama-miniatura';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;
const miniatura = new GetThumbnailService(asPrismaService);

/**
 * JPEG de verdade: o serviço decodifica e redimensiona com sharp, então uma
 * string qualquer em base64 não exercita nada do que importa aqui.
 *
 * 1600×800 é a proporção 2:1 de uma equirretangular, o que faz a asserção de
 * largura provar também que a proporção sobreviveu.
 */
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

async function seedTour(
  tenant: TenantFixture,
  status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED',
): Promise<{ tourId: string; panoramaId: string; originalBytes: number }> {
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
  return {
    tourId: tour.id,
    panoramaId: panorama.id,
    originalBytes: imageData.length,
  };
}

describe('capa do tour', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    // O cache é global ao processo: sem limpar, um caso serviria a imagem do
    // anterior e o teste passaria sem tocar no banco.
    limparCacheDeMiniatura();
  });

  it('devolve uma imagem reduzida, não a panorâmica inteira', async () => {
    // O defeito que originou isto: a rota devolvia a panorâmica em resolução
    // plena. Uma "miniatura" pesava 20 MB, e a lista de imóveis baixava isso
    // por card.
    const { tourId, originalBytes } = await seedTour(tenants.a);

    const { corpo } = await miniatura.execute(tourId);

    expect(corpo).toBeDefined();
    const meta = await sharp(corpo!).metadata();
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(320);
    expect(corpo!.length).toBeLessThan(originalBytes / 4);
  });

  it('não serve capa de tour que não está publicado', async () => {
    // Mesma regra da rota pública de tour. Sem isto, a capa vazaria o rascunho
    // de um imóvel que ninguém publicou.
    const { tourId } = await seedTour(tenants.a, 'DRAFT');

    await expect(miniatura.execute(tourId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('não devolve corpo quando o cliente já tem aquela versão', async () => {
    const { tourId } = await seedTour(tenants.a);
    const { etag } = await miniatura.execute(tourId);

    const revalidacao = await miniatura.execute(tourId, etag);

    expect(revalidacao.etag).toBe(etag);
    expect(revalidacao.corpo).toBeUndefined();
  });

  it('troca o ETag quando a foto do cômodo muda', async () => {
    // Este é o teste que protege o modo de falha silencioso: se o ETag não
    // acompanhar a imagem, o navegador serve a foto antiga para sempre e nada
    // na tela denuncia.
    const { tourId, panoramaId } = await seedTour(tenants.a);
    const { etag: antes } = await miniatura.execute(tourId);

    await prisma.panorama.update({
      where: { id: panoramaId },
      data: { imageData: await jpegDe(1600, 800, 30) },
    });

    const { etag: depois } = await miniatura.execute(tourId, antes);
    expect(depois).not.toBe(antes);
  });

  it('prefere a imagem tratada pela IA quando ela existe', async () => {
    // `imagemServivel` prefere a tratada, e a capa é a primeira coisa que o
    // comprador vê — servir o original aqui mostraria os polos borrados que o
    // tratamento existe para consertar.
    const { tourId, panoramaId } = await seedTour(tenants.a);
    await prisma.panorama.update({
      where: { id: panoramaId },
      data: {
        treatedImageData: await jpegDe(1600, 800, 240),
        treatmentStatus: 'DONE',
        treatedAt: new Date(),
      },
    });

    const { corpo } = await miniatura.execute(tourId);

    // O tom claro só existe na versão tratada; o original é cinza médio.
    const { channels } = await sharp(corpo!).stats();
    expect(channels[0].mean).toBeGreaterThan(200);
  });
});
