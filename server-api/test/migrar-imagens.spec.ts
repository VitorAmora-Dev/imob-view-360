import sharp from 'sharp';
import { PrismaClient } from '../generated/prisma/client';
import { conferir, migrar } from '../scripts/migrar-imagens';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asClient = prisma as unknown as PrismaClient;

async function dataUri(tom: number): Promise<string> {
  const bytes = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 3,
      background: { r: tom, g: tom, b: tom },
    },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

async function seedPanoramas(
  propertyId: string,
  quantos: number,
): Promise<string[]> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId, status: 'PUBLISHED' },
  });
  const ids: string[] = [];
  for (let i = 0; i < quantos; i++) {
    const criado = await prisma.panorama.create({
      data: {
        roomName: `Cômodo ${i}`,
        order: i,
        virtualTourId: tour.id,
        imageData: await dataUri(60 + i),
      },
    });
    ids.push(criado.id);
  }
  return ids;
}

describe('migrar-imagens', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
  });

  it('seco por padrão: conta sem gravar nada', async () => {
    // Um script que reescreve o banco não pode ter o caminho que escreve como o
    // mais fácil de digitar por engano.
    await seedPanoramas(tenants.a.propertyId, 3);

    const resumo = await migrar(asClient, balde, {
      limite: 100,
      aplicar: false,
    });

    expect(resumo.originais).toBe(3);
    expect(balde.gravacoes).toBe(0);
    expect(
      await prisma.panorama.count({ where: { imageKey: { not: null } } }),
    ).toBe(0);
  });

  it('com --aplicar, sobe a imagem e a capa e grava a chave', async () => {
    const [id] = await seedPanoramas(tenants.a.propertyId, 1);

    await migrar(asClient, balde, { limite: 100, aplicar: true });

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id },
      select: { imageKey: true, imageData: true },
    });
    expect(linha.imageKey).toMatch(/^panoramas\/.+\/original\.jpg$/);
    expect(balde.tem(linha.imageKey!)).toBe(true);
    expect(balde.tem(chaveDaCapa(linha.imageKey!))).toBe(true);
    // A coluna NÃO é apagada aqui: ela é a rede de segurança até a etapa 5.
    expect(linha.imageData).toBeTruthy();
  });

  it('é idempotente: a segunda execução não sobe nada', async () => {
    // Teste 7 da spec. Sem isto, rodar o script duas vezes dobraria o balde e
    // trocaria todas as chaves — invalidando o cache de todo visitante.
    await seedPanoramas(tenants.a.propertyId, 3);
    await migrar(asClient, balde, { limite: 100, aplicar: true });
    const depoisDaPrimeira = balde.gravacoes;

    const resumo = await migrar(asClient, balde, {
      limite: 100,
      aplicar: true,
    });

    expect(resumo.originais).toBe(0);
    expect(balde.gravacoes).toBe(depoisDaPrimeira);
  });

  it('é retomável: interrompido na metade, continua de onde parou', async () => {
    // Teste 8 da spec. O banco de produção tem 573 MB de foto e a instância
    // tem 512 MB de RAM: rodar tudo de uma vez não é opção.
    await seedPanoramas(tenants.a.propertyId, 5);

    const primeira = await migrar(asClient, balde, {
      limite: 2,
      aplicar: true,
    });
    expect(primeira.originais).toBe(2);
    expect(primeira.restam).toBe(3);

    const segunda = await migrar(asClient, balde, {
      limite: 100,
      aplicar: true,
    });

    expect(segunda.originais).toBe(3);
    expect(await prisma.panorama.count({ where: { imageKey: null } })).toBe(0);
  });

  it('migra a tratada e as fotos da captura também', async () => {
    const [id] = await seedPanoramas(tenants.a.propertyId, 1);
    await prisma.panorama.update({
      where: { id },
      data: { treatedImageData: await dataUri(200), treatmentStatus: 'DONE' },
    });
    await prisma.captureFrame.create({
      data: {
        panoramaId: id,
        index: 0,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        imageData: await dataUri(140),
      },
    });

    const resumo = await migrar(asClient, balde, {
      limite: 100,
      aplicar: true,
    });

    expect(resumo.tratadas).toBe(1);
    expect(resumo.capturas).toBe(1);
    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id },
      select: { treatedImageKey: true },
    });
    expect(linha.treatedImageKey).toMatch(/tratada\.jpg$/);
    expect(balde.tem(`capturas/${id}/0.jpg`)).toBe(true);
  });

  it('a conferência acusa o que falta e zera quando termina', async () => {
    // O passo 4 da migração: é ele que autoriza seguir para o 5.
    await seedPanoramas(tenants.a.propertyId, 2);

    expect((await conferir(asClient)).panoramas).toBe(2);

    await migrar(asClient, balde, { limite: 100, aplicar: true });

    expect(await conferir(asClient)).toEqual({
      panoramas: 0,
      tratadas: 0,
      capturas: 0,
    });
  });

  it('se o balde falhar numa linha, nenhuma chave é gravada para ela', async () => {
    const [id] = await seedPanoramas(tenants.a.propertyId, 1);
    jest
      .spyOn(balde, 'gravar')
      .mockRejectedValueOnce(new Error('balde fora do ar'));

    await expect(
      migrar(asClient, balde, { limite: 100, aplicar: true }),
    ).rejects.toThrow('balde fora do ar');

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id },
      select: { imageKey: true },
    });
    expect(linha.imageKey).toBeNull();
  });

  it('não substitui a chave de uma refotografia feita durante o upload', async () => {
    const [id] = await seedPanoramas(tenants.a.propertyId, 1);
    const gravar = balde.gravar.bind(balde);
    const novaChave = `panoramas/${id}/9999999999999/original.jpg`;
    const novaFoto = await dataUri(220);
    jest.spyOn(balde, 'gravar').mockImplementationOnce(async (chave, bytes) => {
      await gravar(chave, bytes);
      await prisma.panorama.update({
        where: { id },
        data: { imageKey: novaChave, imageData: novaFoto },
      });
    });

    const resumo = await migrar(asClient, balde, { limite: 1, aplicar: true });

    expect(resumo.originais).toBe(0);
    expect(
      await prisma.panorama.findUniqueOrThrow({
        where: { id },
        select: { imageKey: true, imageData: true },
      }),
    ).toEqual({ imageKey: novaChave, imageData: novaFoto });
  });

  it.each([0, -1, 1.5, Infinity, NaN])(
    'recusa limite inválido: %s',
    async (limite) => {
      await expect(
        migrar(asClient, balde, { limite, aplicar: true }),
      ).rejects.toThrow('inteiro positivo');
      expect(balde.gravacoes).toBe(0);
    },
  );
});
