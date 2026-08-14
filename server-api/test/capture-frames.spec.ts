import { NotFoundException } from '@nestjs/common';
import { UploadCaptureFrameService } from '../src/modules/panoramas/services/upload-capture-frame.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;
const upload = new UploadCaptureFrameService(asPrismaService);

async function seedPanorama(tenant: TenantFixture): Promise<string> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId: tenant.propertyId },
  });
  const panorama = await prisma.panorama.create({
    data: {
      roomName: 'Sala',
      imageData: 'data:image/jpeg;base64,panorama',
      virtualTourId: tour.id,
      initialPanorama: true,
    },
  });
  return panorama.id;
}

function frame(index: number, imageData = `data:image/jpeg;base64,foto-${index}`) {
  return {
    index,
    imageData,
    quaternion: { x: 0, y: Math.sin(index), z: 0, w: Math.cos(index) },
  };
}

describe('fotos originais da captura 360°', () => {
  let tenants: TwoTenants;
  let panoramaId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    panoramaId = await seedPanorama(tenants.a);
  });

  it('guarda a foto com a orientação em que ela foi tirada', async () => {
    // A orientação é o que torna a foto reaproveitável: sem ela sobra uma
    // imagem solta, e a costura teria de ser redescoberta do zero.
    await upload.execute(panoramaId, frame(3), tenants.a.admin);

    const saved = await prisma.captureFrame.findFirstOrThrow({
      where: { panoramaId, index: 3 },
    });
    expect(saved.imageData).toBe('data:image/jpeg;base64,foto-3');
    expect(saved.qy).toBeCloseTo(Math.sin(3), 10);
    expect(saved.qw).toBeCloseTo(Math.cos(3), 10);
  });

  it('não guarda nada num panorama de outra agência', async () => {
    // O id existe e é válido; o que muda é só a agência de quem envia.
    await expect(
      upload.execute(panoramaId, frame(0), tenants.b.admin),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await prisma.captureFrame.count({ where: { panoramaId } })).toBe(0);
  });

  it('reenviar a mesma foto repõe, em vez de acumular cópias', async () => {
    // O envio roda em segundo plano e é retomável, então o mesmo índice chega
    // duas vezes sempre que a rede cair no meio.
    await upload.execute(panoramaId, frame(0, 'primeira-tentativa'), tenants.a.admin);
    await upload.execute(panoramaId, frame(0, 'segunda-tentativa'), tenants.a.admin);

    const saved = await prisma.captureFrame.findMany({ where: { panoramaId } });
    expect(saved.length).toBe(1);
    expect(saved[0].imageData).toBe('segunda-tentativa');
  });

  it('guarda a captura inteira, uma foto por índice', async () => {
    for (let i = 0; i < 12; i++) {
      await upload.execute(panoramaId, frame(i), tenants.a.admin);
    }

    const saved = await prisma.captureFrame.findMany({
      where: { panoramaId },
      orderBy: { index: 'asc' },
    });
    expect(saved.map((f) => f.index)).toEqual([...Array(12).keys()]);
  });

  it('apagar o panorama leva as fotos originais junto', async () => {
    await upload.execute(panoramaId, frame(0), tenants.a.admin);
    await prisma.panorama.delete({ where: { id: panoramaId } });

    expect(await prisma.captureFrame.count({ where: { panoramaId } })).toBe(0);
  });
});
