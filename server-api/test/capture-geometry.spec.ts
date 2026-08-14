import { CreateVirtualTourService } from '../src/modules/virtual-tours/services/create-virtual-tour.service';
import { CreateVirtualTourSchema } from '../src/modules/virtual-tours/dto/create-virtual-tour.dto';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const createTour = new CreateVirtualTourService(prisma as unknown as PrismaService);

/**
 * O preenchimento dos polos é deliberadamente plausível: olhando só a imagem,
 * nada distingue pixel fotografado de pixel inventado. Estes três números são a
 * única coisa que faz essa distinção, e a etapa de IA depende deles.
 */
describe('geometria da captura no panorama', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  const panorama = (extra: Record<string, unknown> = {}) => ({
    tempId: 'p0',
    roomName: 'Cozinha',
    imageData: 'data:image/jpeg;base64,panorama',
    order: 0,
    initialPanorama: true,
    ...extra,
  });

  it('guarda a lente ajustada e a faixa que foi de fato fotografada', async () => {
    const dto = CreateVirtualTourSchema.parse({
      propertyId: tenants.a.propertyId,
      panoramas: [
        panorama({ fittedVfovDeg: 88.6, bandTopDeg: 42.9, bandBottomDeg: -43.2 }),
      ],
    });
    await createTour.execute(dto, tenants.a.admin);

    const saved = await prisma.panorama.findFirstOrThrow({ where: { roomName: 'Cozinha' } });
    expect(saved.fittedVfovDeg).toBeCloseTo(88.6, 6);
    expect(saved.bandTopDeg).toBeCloseTo(42.9, 6);
    expect(saved.bandBottomDeg).toBeCloseTo(-43.2, 6);
  });

  it('deixa vazio quando o panorama veio de um arquivo, não da câmera', async () => {
    // Um equirretangular enviado de fora já é a esfera inteira, ou não é, e não
    // há como esta API saber qual — nulo é a resposta honesta.
    const dto = CreateVirtualTourSchema.parse({
      propertyId: tenants.a.propertyId,
      panoramas: [panorama()],
    });
    await createTour.execute(dto, tenants.a.admin);

    const saved = await prisma.panorama.findFirstOrThrow({ where: { roomName: 'Cozinha' } });
    expect(saved.fittedVfovDeg).toBeNull();
    expect(saved.bandTopDeg).toBeNull();
    expect(saved.bandBottomDeg).toBeNull();
  });

  it('recusa latitudes que não existem na esfera', () => {
    const parsed = CreateVirtualTourSchema.safeParse({
      propertyId: tenants.a.propertyId,
      panoramas: [panorama({ bandTopDeg: 120 })],
    });
    expect(parsed.success).toBe(false);
  });

  it('recusa um campo de visão que nenhuma lente tem', () => {
    const parsed = CreateVirtualTourSchema.safeParse({
      propertyId: tenants.a.propertyId,
      panoramas: [panorama({ fittedVfovDeg: 400 })],
    });
    expect(parsed.success).toBe(false);
  });
});
