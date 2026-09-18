import { FindVirtualTourService } from '../src/modules/virtual-tours/services/find-virtual-tour.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function seedTour(
  propertyId: string,
  panorama: object,
): Promise<{ tourId: string; panoramaId: string }> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId, status: 'PUBLISHED' },
  });
  const criado = await prisma.panorama.create({
    data: { roomName: 'Sala', virtualTourId: tour.id, ...panorama },
  });
  return { tourId: tour.id, panoramaId: criado.id };
}

describe('endereço da foto no payload do tour', () => {
  it('a miniatura absoluta aponta para a capa, não para a imagem inteira', async () => {
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });
    const tour = await new FindVirtualTourService(
      asPrismaService,
      balde,
    ).execute(tourId);
    expect(tour.panoramas[0].thumbnailUrl).toBe(
      'https://fotos.teste/panoramas/p/1/capa.jpg',
    );
  });

  it('sem origem pública a miniatura é relativa com w=640', async () => {
    const { tourId, panoramaId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });
    const tour = await new FindVirtualTourService(
      asPrismaService,
      new ArmazenamentoEmMemoria(),
    ).execute(tourId);
    expect(tour.panoramas[0].thumbnailUrl).toMatch(
      new RegExp(`^/panoramas/${panoramaId}/image\\?v=\\d+&w=640$`),
    );
  });

  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  it('com endereço público configurado, emite o absoluto da CDN', async () => {
    // Teste 3 da spec, primeira metade.
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const tour = await new FindVirtualTourService(
      asPrismaService,
      balde,
    ).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toBe(
      'https://fotos.teste/panoramas/p/1/original.jpg',
    );
  });

  it('com a chave preenchida mas SEM configuração, emite o relativo', async () => {
    // É a entrega A inteira: as chaves já estão no banco, o domínio ainda não
    // existe, e a API continua servindo. Se o gatilho fosse a chave, este é o
    // caso que teria derrubado a tela.
    const balde = new ArmazenamentoEmMemoria();
    const { tourId, panoramaId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const tour = await new FindVirtualTourService(
      asPrismaService,
      balde,
    ).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toMatch(
      new RegExp(`^/panoramas/${panoramaId}/image\\?v=\\d+$`),
    );
  });

  it('sem chave, emite o relativo mesmo com a CDN configurada', async () => {
    // Tour antigo e tour migrado convivem na mesma tela durante a migração.
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId, panoramaId } = await seedTour(tenants.a.propertyId, {
      imageData: 'AAAA',
    });

    const tour = await new FindVirtualTourService(
      asPrismaService,
      balde,
    ).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toMatch(
      new RegExp(`^/panoramas/${panoramaId}/image\\?v=\\d+$`),
    );
  });

  it('com tratamento pronto, aponta para a TRATADA', async () => {
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
      treatedImageKey: 'panoramas/p/2/tratada.jpg',
      treatmentStatus: 'DONE',
    });

    const tour = await new FindVirtualTourService(
      asPrismaService,
      balde,
    ).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toBe(
      'https://fotos.teste/panoramas/p/2/tratada.jpg',
    );
  });

  it('com a tratada só na coluna, volta ao relativo em vez de apontar para o original', async () => {
    // O caso que a migração cria. Apontar a CDN para `imageKey` aqui publicaria
    // o cômodo SEM tratamento, e nada na tela denunciaria.
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId, panoramaId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
      treatedImageData: 'ainda-na-coluna',
      treatmentStatus: 'DONE',
    });

    const tour = await new FindVirtualTourService(
      asPrismaService,
      balde,
    ).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toMatch(
      new RegExp(`^/panoramas/${panoramaId}/image\\?v=\\d+$`),
    );
  });

  it('o payload não devolve chave nem bytes', async () => {
    // As chaves são detalhe de armazenamento; as colunas são TOAST de dezenas
    // de MB. Nenhuma das duas tem o que fazer num JSON público.
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const tour = await new FindVirtualTourService(
      asPrismaService,
      balde,
    ).execute(tourId);

    const panorama = tour.panoramas[0] as Record<string, unknown>;
    expect(panorama.imageKey).toBeUndefined();
    expect(panorama.treatedImageKey).toBeUndefined();
    expect(panorama.imageData).toBeUndefined();
    expect(panorama.treatedImageData).toBeUndefined();
  });
});
