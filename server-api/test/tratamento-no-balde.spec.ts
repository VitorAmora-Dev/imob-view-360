import sharp from 'sharp';
import { TreatPanoramaService } from '../src/modules/panoramas/services/treat-panorama.service';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
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

describe('tratamento com as imagens no balde', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let servico: TreatPanoramaService;
  let panoramaId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    servico = new TreatPanoramaService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      new GravadorDeImagens(balde),
      balde,
    );

    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'DRAFT' },
    });
    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: tour.id,
        imageKey: 'panoramas/p/1/original.jpg',
      },
    });
    panoramaId = panorama.id;
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
  });

  it('dispensa sem fotos de referência suficientes, e não grava nada', async () => {
    // Menos de 4 referências: sem verdade de campo o modelo repintaria o cômodo
    // a partir da própria imagem, que é o caso reprovado no bake-off.
    const gravacoes = balde.gravacoes;

    const r = await servico.execute(panoramaId);

    expect(r.status).toBe('SKIPPED');
    expect(balde.gravacoes).toBe(gravacoes);
  });

  it('grava a tratada e a capa no balde e guarda a chave', async () => {
    // O modelo é dublado: esta suíte não gasta US$ 0,19 por execução.
    jest
      .spyOn(
        servico as unknown as {
          pedirMontagem: (...args: unknown[]) => Promise<unknown>;
        },
        'pedirMontagem',
      )
      .mockImplementation(async () => {
        return {
          r: {
            imagem: await sharp(await jpeg(2048, 200))
              .png()
              .toBuffer(),
            ms: 1,
            custoUSD: 0,
            tentativas: 1,
          },
          largura: 2048,
          altura: 1024,
          quantasFotos: 8,
        };
      });

    for (let i = 0; i < 8; i++) {
      await prisma.captureFrame.create({
        data: {
          panoramaId,
          index: i,
          qx: 0,
          qy: 0,
          qz: 0,
          qw: 1,
          imageKey: `capturas/${panoramaId}/${i}.jpg`,
        },
      });
      await balde.gravar(
        `capturas/${panoramaId}/${i}.jpg`,
        await jpeg(256, 100 + i),
      );
    }

    await servico.execute(panoramaId);

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id: panoramaId },
      select: { treatedImageKey: true },
    });
    expect(linha.treatedImageKey).toMatch(/tratada\.jpg$/);
    expect(balde.tem(chaveDaCapa(linha.treatedImageKey!))).toBe(true);
  });

  it('lê as fotos de referência do balde, uma por vez', async () => {
    for (let i = 0; i < 6; i++) {
      await prisma.captureFrame.create({
        data: {
          panoramaId,
          index: i,
          qx: 0,
          qy: 0,
          qz: 0,
          qw: 1,
          imageKey: `capturas/${panoramaId}/${i}.jpg`,
        },
      });
      await balde.gravar(
        `capturas/${panoramaId}/${i}.jpg`,
        await jpeg(256, 100 + i),
      );
    }

    const fotos = await (
      servico as never as {
        referencias(ids: string[]): Promise<Buffer[]>;
      }
    ).referencias(
      (
        await prisma.captureFrame.findMany({
          where: { panoramaId },
          select: { id: true },
          orderBy: { index: 'asc' },
        })
      ).map((f) => f.id),
    );

    expect(fotos).toHaveLength(6);
  });

  it('lê a foto de referência da coluna quando ela ainda não migrou', async () => {
    // A queda vale aqui também: um rascunho capturado antes do deploy tem as
    // referências só na coluna, e tratá-lo não pode falhar por isso.
    const bytes = await jpeg(256, 140);
    await prisma.captureFrame.create({
      data: {
        panoramaId,
        index: 0,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        imageData: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      },
    });

    const linha = await prisma.captureFrame.findFirstOrThrow({
      where: { panoramaId },
      select: { id: true },
    });
    const fotos = await (
      servico as never as {
        referencias(ids: string[]): Promise<Buffer[]>;
      }
    ).referencias([linha.id]);

    expect(fotos).toHaveLength(1);
  });
});
