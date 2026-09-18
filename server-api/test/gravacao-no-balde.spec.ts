import sharp from 'sharp';
import { CreatePanoramaService } from '../src/modules/panoramas/services/create-panorama.service';
import { UpdatePanoramaService } from '../src/modules/panoramas/services/update-panorama.service';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function dataUri(tom: number): Promise<string> {
  const bytes = await sharp({
    create: {
      width: 1600,
      height: 800,
      channels: 3,
      background: { r: tom, g: tom, b: tom },
    },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

describe('gravação de panorama no balde', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let criar: CreatePanoramaService;
  let atualizar: UpdatePanoramaService;
  let tourId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    const gravador = new GravadorDeImagens(balde);
    criar = new CreatePanoramaService(asPrismaService, gravador);
    atualizar = new UpdatePanoramaService(asPrismaService, gravador);
    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'DRAFT' },
    });
    tourId = tour.id;
  });

  it('criar grava a imagem e a capa no balde, e guarda a chave', async () => {
    const criado = await criar.execute(
      {
        tourId,
        roomName: 'Sala',
        imageData: await dataUri(90),
        measurements: [],
      } as never,
      tenants.a.admin,
    );

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id: criado!.id },
      select: { imageKey: true },
    });
    expect(linha.imageKey).toMatch(/^panoramas\/.+\/original\.jpg$/);
    expect(balde.tem(linha.imageKey!)).toBe(true);
    expect(balde.tem(chaveDaCapa(linha.imageKey!))).toBe(true);
  });

  it('a coluna continua sendo escrita durante a migração', async () => {
    // Escrita dupla é o passo 2: enquanto ela existe, um rollback de deploy
    // volta a servir sem perder nada. A coluna só para na etapa 5.
    const criado = await criar.execute(
      {
        tourId,
        roomName: 'Sala',
        imageData: await dataUri(90),
        measurements: [],
      } as never,
      tenants.a.admin,
    );

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id: criado!.id },
      select: { imageData: true },
    });
    expect(linha.imageData).toBeTruthy();
  });

  it('refotografar escreve uma chave NOVA e não sobrescreve a anterior', async () => {
    const criado = await criar.execute(
      {
        tourId,
        roomName: 'Sala',
        imageData: await dataUri(90),
        measurements: [],
      } as never,
      tenants.a.admin,
    );
    const antes = await prisma.panorama.findUniqueOrThrow({
      where: { id: criado!.id },
      select: { imageKey: true },
    });

    await new Promise((seguir) => setTimeout(seguir, 2));
    await atualizar.execute(
      criado!.id,
      { imageData: await dataUri(200) } as never,
      tenants.a.admin,
    );

    const depois = await prisma.panorama.findUniqueOrThrow({
      where: { id: criado!.id },
      select: { imageKey: true, treatedImageKey: true, treatmentStatus: true },
    });
    expect(depois.imageKey).not.toBe(antes.imageKey);
    expect(balde.tem(antes.imageKey!)).toBe(true);
    // A tratada da foto ANTERIOR deixa de descrever este cômodo: a regra já
    // existia para a coluna, e a chave tem de acompanhá-la.
    expect(depois.treatedImageKey).toBeNull();
    expect(depois.treatmentStatus).toBe('PENDING');
  });

  it('renomear o cômodo não escreve nada no balde', async () => {
    const criado = await criar.execute(
      {
        tourId,
        roomName: 'Sala',
        imageData: await dataUri(90),
        measurements: [],
      } as never,
      tenants.a.admin,
    );
    const gravacoes = balde.gravacoes;

    await atualizar.execute(
      criado!.id,
      { roomName: 'Cozinha' } as never,
      tenants.a.admin,
    );

    expect(balde.gravacoes).toBe(gravacoes);
  });

  it('se o banco falhar, nenhuma linha aponta para o nada', async () => {
    // O teste 6 da spec, e a decisão 10 inteira. O que sobra é um arquivo sem
    // dono — o lado barato do erro, que `varrer-orfaos` recolhe.
    jest
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('banco recusou'));

    await expect(
      criar.execute(
        {
          tourId,
          roomName: 'Sala',
          imageData: await dataUri(90),
          measurements: [],
        } as never,
        tenants.a.admin,
      ),
    ).rejects.toThrow('banco recusou');

    expect(
      await prisma.panorama.count({ where: { virtualTourId: tourId } }),
    ).toBe(0);
    // E o arquivo ESTÁ no balde: é isso que prova que a ordem foi balde→banco.
    expect(balde.gravacoes).toBeGreaterThan(0);
  });
});
