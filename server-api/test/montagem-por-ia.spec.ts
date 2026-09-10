import sharp from 'sharp';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { TreatPanoramaService } from '../src/modules/panoramas/services/treat-panorama.service';
import { base64Puro } from '../src/modules/panoramas/panorama-image';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

/**
 * A chamada ao modelo é a única coisa dublada aqui: ela custa US$ 0,19 e leva
 * um minuto. Todo o resto — Prisma, sharp, a costura da volta — é o de verdade,
 * porque é justamente no caminho dos dados que estava o defeito.
 */
jest.mock('../src/shared/imaging/montagem-360', () => {
  const real = jest.requireActual('../src/shared/imaging/montagem-360');
  return { ...real, montarPanorama: jest.fn() };
});

import {
  amostrarAnel,
  montarPanorama,
} from '../src/shared/imaging/montagem-360';

const pedirMontagem = montarPanorama as jest.MockedFunction<
  typeof montarPanorama
>;

/** Uma consulta que o serviço fez, do jeito que ele a fez. */
interface ConsultaObservada {
  readonly model?: string;
  readonly operation: string;
  readonly args: Record<string, unknown>;
}

const consultas: ConsultaObservada[] = [];

/**
 * O mesmo banco de teste, com um gravador no meio.
 *
 * É o que permite afirmar QUAIS colunas o serviço pediu, e não só que o
 * resultado saiu certo. A regressão que este arquivo existe para pegar —
 * carregar de volta o `imageData` de fotos que vão ser descartadas — não muda
 * nenhuma saída: ela só volta a estourar a memória em produção.
 */
const observado = prisma.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      consultas.push({
        model,
        operation,
        args: args as Record<string, unknown>,
      });
      return query(args);
    },
  },
});

const servico = new TreatPanoramaService(observado as unknown as PrismaService);

/** Um JPEG de verdade, porque o sharp vai lê-lo. */
async function jpeg(
  largura: number,
  altura: number,
  tom: number,
): Promise<string> {
  const buffer = await sharp({
    create: {
      width: largura,
      height: altura,
      channels: 3,
      background: { r: tom, g: tom, b: tom },
    },
  })
    .jpeg()
    .toBuffer();

  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

const SAIDA_DO_MODELO = { largura: 384, altura: 192 };

/**
 * O original é maior que a saída do modelo de propósito: é a proporção real,
 * onde o stitcher entrega 5120×2560 e o modelo devolve 3840×1920.
 */
const ORIGINAL_PADRAO = { largura: 512, altura: 256 };

async function seedCaptura(
  tenant: TenantFixture,
  quantasFotos: number,
  original = ORIGINAL_PADRAO,
): Promise<string> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId: tenant.propertyId },
  });
  const panorama = await prisma.panorama.create({
    data: {
      roomName: 'Sala',
      imageData: await jpeg(original.largura, original.altura, 120),
      virtualTourId: tour.id,
      initialPanorama: true,
    },
  });

  for (let index = 0; index < quantasFotos; index++) {
    await prisma.captureFrame.create({
      data: {
        panoramaId: panorama.id,
        index,
        // Tom distinto por foto: se algum dia a ordem angular se perder, o
        // conteúdo continua rastreável na mão.
        imageData: await jpeg(32, 48, index * 7),
        qx: 0,
        qy: Math.sin(index),
        qz: 0,
        qw: Math.cos(index),
      },
    });
  }

  return panorama.id;
}

describe('montagem por IA — o que sai do banco', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    pedirMontagem.mockReset();
    pedirMontagem.mockImplementation(async () => ({
      imagem: await sharp({
        create: {
          width: SAIDA_DO_MODELO.largura,
          height: SAIDA_DO_MODELO.altura,
          channels: 3,
          background: { r: 90, g: 90, b: 90 },
        },
      })
        .png()
        .toBuffer(),
      ms: 10,
      custoUSD: 0.19,
      tentativas: 1,
    }));
  });

  it('não carrega a imagem de foto que vai descartar', async () => {
    // Vinte e quatro fotos, quinze cabem na requisição: nove são descartadas.
    // A consulta antiga trazia as vinte e quatro imagens para jogar nove fora,
    // e cada uma é um JPEG de 1536×2048.
    const panoramaId = await seedCaptura(tenants.a, 24);
    consultas.length = 0;

    await servico.execute(panoramaId);

    const comImagem = consultas.filter(
      (c) =>
        c.model === 'CaptureFrame' &&
        JSON.stringify(c.args).includes('"imageData":true'),
    );

    expect(comImagem).toHaveLength(1);
    const where = comImagem[0].args['where'] as { id: { in: string[] } };
    expect(where.id.in).toHaveLength(15);
  });

  it('as fotos escolhidas cobrem a volta, e na ordem do disparo', async () => {
    // O prompt afirma que a referência k cobre a k-ésima fatia da largura.
    // Se a escolha ou a ordem mudarem, essa afirmação passa a apontar para o
    // lugar errado — e o modelo procura emenda onde não há.
    const panoramaId = await seedCaptura(tenants.a, 24);

    const todas = await prisma.captureFrame.findMany({
      where: { panoramaId },
      select: { id: true },
      orderBy: { index: 'asc' },
    });
    const esperadas = amostrarAnel(todas).map((f) => f.id);

    consultas.length = 0;
    await servico.execute(panoramaId);

    const pedido = consultas.find(
      (c) =>
        c.model === 'CaptureFrame' &&
        JSON.stringify(c.args).includes('"imageData":true'),
    );
    const where = pedido!.args['where'] as { id: { in: string[] } };

    expect(where.id.in).toEqual(esperadas);
  });

  it('a consulta do panorama não arrasta as fotos junto', async () => {
    const panoramaId = await seedCaptura(tenants.a, 8);
    consultas.length = 0;

    await servico.execute(panoramaId);

    const doPanorama = consultas.filter(
      (c) => c.model === 'Panorama' && c.operation.startsWith('find'),
    );

    expect(doPanorama.length).toBeGreaterThan(0);
    for (const consulta of doPanorama) {
      expect(JSON.stringify(consulta.args)).not.toContain('captureFrames');
    }
  });

  it('conta as fotos que MANDOU, não as que a captura tinha', async () => {
    const panoramaId = await seedCaptura(tenants.a, 24);

    const r = await servico.execute(panoramaId);

    expect(r.status).toBe('DONE');
    expect(r.fotos).toBe(15);

    const salvo = await prisma.panorama.findUniqueOrThrow({
      where: { id: panoramaId },
      select: { treatmentStatus: true, treatmentMeta: true },
    });
    expect(salvo.treatmentStatus).toBe('DONE');
    expect((salvo.treatmentMeta as { fotos: number }).fotos).toBe(15);
  });

  it('captura curta é dispensada sem chamar o modelo', async () => {
    // Menos de quatro referências e não há verdade de campo: tratar às cegas é
    // o caso que o bake-off reprovou.
    const panoramaId = await seedCaptura(tenants.a, 3);

    const r = await servico.execute(panoramaId);

    expect(r.status).toBe('SKIPPED');
    expect(pedirMontagem).not.toHaveBeenCalled();
  });

  /** As dimensões REAIS do que ficou guardado, lidas da própria imagem. */
  async function tamanhoDaTratada(
    panoramaId: string,
  ): Promise<{ width?: number; height?: number }> {
    const { treatedImageData } = await prisma.panorama.findUniqueOrThrow({
      where: { id: panoramaId },
      select: { treatedImageData: true },
    });
    const meta = await sharp(
      Buffer.from(base64Puro(treatedImageData!), 'base64'),
    ).metadata();
    return { width: meta.width, height: meta.height };
  }

  it('grava no tamanho que o modelo devolveu, sem ampliar de volta', async () => {
    // A rota esticava 3840×1920 de volta para 5120×2560. Isso não acrescentava
    // detalhe — interpolava o que já tinha vindo — e era o pico de memória da
    // montagem inteira, medido em 198 MB contra 127 MB sem a ampliação. Foi ela
    // que estourou os 512 MB da instância em 10/09/2026.
    const panoramaId = await seedCaptura(tenants.a, 8);

    await servico.execute(panoramaId);

    expect(await tamanhoDaTratada(panoramaId)).toEqual({
      width: SAIDA_DO_MODELO.largura,
      height: SAIDA_DO_MODELO.altura,
    });
  });

  it('encolhe quando o original é MENOR que a saída do modelo', async () => {
    // O contrário do caso acima, e o motivo de o redimensionamento continuar
    // existindo: gravar 384 de largura a partir de um original de 256 seria
    // inventar pixel do mesmo jeito.
    const menor = { largura: 256, altura: 128 };
    const panoramaId = await seedCaptura(tenants.a, 8, menor);

    await servico.execute(panoramaId);

    expect(await tamanhoDaTratada(panoramaId)).toEqual({
      width: menor.largura,
      height: menor.altura,
    });
  });

  it('o original nunca é sobrescrito', async () => {
    // Reverter uma montagem ruim tem que custar apagar uma coluna.
    const panoramaId = await seedCaptura(tenants.a, 8);
    const antes = await prisma.panorama.findUniqueOrThrow({
      where: { id: panoramaId },
      select: { imageData: true },
    });

    await servico.execute(panoramaId);

    const depois = await prisma.panorama.findUniqueOrThrow({
      where: { id: panoramaId },
      select: { imageData: true, treatedImageData: true },
    });
    expect(depois.imageData).toBe(antes.imageData);
    expect(depois.treatedImageData).not.toBeNull();
  });
});
