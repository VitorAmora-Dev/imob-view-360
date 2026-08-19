import { BadRequestException } from '@nestjs/common';
import { CreateVirtualTourService } from '../src/modules/virtual-tours/services/create-virtual-tour.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;
const criarTour = new CreateVirtualTourService(asPrismaService);

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
    imageData: `data:image/jpeg;base64,foto-${tempId}`,
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

  beforeEach(async () => {
    tenants = await seedTwoTenants();
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
});
