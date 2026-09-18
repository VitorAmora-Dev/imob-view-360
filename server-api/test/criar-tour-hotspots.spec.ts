import { FOTO_DE_TESTE } from './imagem-de-teste';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { BadRequestException } from '@nestjs/common';
import { CreateVirtualTourService } from '../src/modules/virtual-tours/services/create-virtual-tour.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

/**
 * As ligações entre cômodos são criadas junto com o tour, e o cliente não
 * conhece os ids do banco na hora de montar o corpo: ele manda `tempId` por
 * panorama e `targetTempId` por hotspot, e o servidor resolve.
 *
 * Essa resolução não tinha teste nenhum. Escrevi estes ao trocar o laço de
 * `create` por hotspot por um `createMany` — a suíte inteira passava verde com
 * o laço reescrito, o que significa que ela não dizia nada sobre ele.
 */

function panorama(tempId: string, order: number, hotspots: unknown[] = []) {
  return {
    tempId,
    roomName: `Cômodo ${tempId}`,
    imageData: FOTO_DE_TESTE,
    order,
    initialPanorama: order === 0,
    measurements: [],
    hotspots,
  };
}

function hotspot(targetTempId: string, label: string) {
  return { label, positionX: 0.25, positionY: 0.5, targetTempId };
}

describe('ligações entre cômodos na criação do tour', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let criarTour: CreateVirtualTourService;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    criarTour = new CreateVirtualTourService(
      asPrismaService,
      new GravadorDeImagens(balde),
    );
  });

  it('resolve tempId para o id real e liga origem e destino', async () => {
    await criarTour.execute(
      {
        propertyId: tenants.a.propertyId,
        panoramas: [
          panorama('sala', 0, [hotspot('quarto', 'Ir para o quarto')]),
          panorama('quarto', 1, [hotspot('sala', 'Voltar para a sala')]),
        ],
      } as never,
      tenants.a.admin,
    );

    const salvos = await prisma.hotspot.findMany({
      include: {
        origin: { select: { roomName: true } },
        target: { select: { roomName: true } },
      },
      orderBy: { label: 'asc' },
    });

    expect(salvos).toHaveLength(2);
    expect(salvos.map((h) => [h.origin.roomName, h.target.roomName])).toEqual([
      ['Cômodo sala', 'Cômodo quarto'],
      ['Cômodo quarto', 'Cômodo sala'],
    ]);
    const panoramas = await prisma.panorama.findMany({
      select: { imageKey: true, imageData: true },
    });
    expect(panoramas).toHaveLength(2);
    for (const p of panoramas) {
      expect(p.imageData).toBe(FOTO_DE_TESTE);
      expect(balde.tem(p.imageKey!)).toBe(true);
      expect(balde.tem(chaveDaCapa(p.imageKey!))).toBe(true);
    }
  });

  it('recusa destino que não está na lista, sem deixar tour pela metade', async () => {
    // O erro acontece depois de as panorâmicas já terem sido gravadas dentro da
    // transação. Se ela não desfizesse, o imóvel ficaria com um tour órfão que
    // o `POST` seguinte recusaria por conflito — e o corretor não teria como
    // sair disso pela interface.
    const chamada = criarTour.execute(
      {
        propertyId: tenants.a.propertyId,
        panoramas: [
          panorama('sala', 0, [hotspot('varanda-que-nao-existe', 'Ir')]),
        ],
      } as never,
      tenants.a.admin,
    );

    await expect(chamada).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.virtualTour.count()).toBe(0);
    expect(await prisma.panorama.count()).toBe(0);
    expect(await prisma.hotspot.count()).toBe(0);
  });

  it('cada panorama mantém seu id e sua imagem mesmo com tempId repetido', async () => {
    await criarTour.execute(
      {
        propertyId: tenants.a.propertyId,
        panoramas: [panorama('sala', 0), panorama('sala', 1)],
      } as never,
      tenants.a.admin,
    );

    const panoramas = await prisma.panorama.findMany({
      select: { id: true, imageKey: true },
    });
    expect(panoramas).toHaveLength(2);
    for (const p of panoramas) {
      expect(p.imageKey).toContain(`panoramas/${p.id}/`);
      expect(balde.tem(p.imageKey!)).toBe(true);
    }
  });
});
