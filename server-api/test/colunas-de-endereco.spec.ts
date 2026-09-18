import { prisma } from './setup/prisma';
import { seedTwoTenants, TwoTenants } from './fixtures';

/**
 * O passo 1 da migração: as colunas de endereço nascem vazias e as de bytes
 * passam a aceitar nulo. Nada muda de comportamento — o que muda é o que o
 * banco permite guardar.
 */
describe('colunas de endereço', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  it('aceita panorama com endereço e SEM bytes', async () => {
    // O estado final da migração: a coluna some e sobra a chave.
    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'PUBLISHED' },
    });

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: tour.id,
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageKey: 'panoramas/x/2/tratada.jpg',
      },
    });

    expect(panorama.imageData).toBeNull();
    expect(panorama.imageKey).toBe('panoramas/x/1/original.jpg');
    expect(panorama.treatedImageKey).toBe('panoramas/x/2/tratada.jpg');
  });

  it('aceita panorama com bytes e SEM endereço', async () => {
    // O estado de hoje, que tem de continuar válido durante a migração inteira.
    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'PUBLISHED' },
    });

    const panorama = await prisma.panorama.create({
      data: { roomName: 'Sala', virtualTourId: tour.id, imageData: 'AAAA' },
    });

    expect(panorama.imageKey).toBeNull();
    expect(panorama.imageData).toBe('AAAA');
  });

  it('aceita foto de captura com endereço e sem bytes', async () => {
    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'DRAFT' },
    });
    const panorama = await prisma.panorama.create({
      data: { roomName: 'Sala', virtualTourId: tour.id, imageData: 'AAAA' },
    });

    const frame = await prisma.captureFrame.create({
      data: {
        panoramaId: panorama.id,
        index: 0,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        imageKey: 'capturas/x/0.jpg',
      },
    });

    expect(frame.imageData).toBeNull();
    expect(frame.imageKey).toBe('capturas/x/0.jpg');
  });
});
