import { UploadCaptureFrameService } from '../src/modules/panoramas/services/upload-capture-frame.service';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

const FOTO = `data:image/jpeg;base64,${Buffer.from('foto-de-referencia').toString('base64')}`;

function dto(index: number) {
  return {
    index,
    imageData: FOTO,
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  } as never;
}

describe('fotos da captura no balde', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let upload: UploadCaptureFrameService;
  let panoramaId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    upload = new UploadCaptureFrameService(
      asPrismaService,
      new GravadorDeImagens(balde),
    );

    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'DRAFT' },
    });
    const panorama = await prisma.panorama.create({
      data: { roomName: 'Sala', virtualTourId: tour.id, imageData: 'AAAA' },
    });
    panoramaId = panorama.id;
  });

  it('grava a foto no balde e guarda a chave', async () => {
    await upload.execute(panoramaId, dto(3), tenants.a.admin);

    const linha = await prisma.captureFrame.findFirstOrThrow({
      where: { panoramaId, index: 3 },
      select: { imageKey: true },
    });
    expect(linha.imageKey).toBe(`capturas/${panoramaId}/3.jpg`);
    expect(balde.tem(linha.imageKey!)).toBe(true);
  });

  it('não gera capa para foto de referência', async () => {
    // Ela nunca é mostrada em tela: capa seria trabalho e bytes para nada.
    await upload.execute(panoramaId, dto(3), tenants.a.admin);

    expect(balde.chaves()).toEqual([`capturas/${panoramaId}/3.jpg`]);
  });

  it('o reenvio repõe a foto em vez de acumular cópias', async () => {
    // O envio acontece foto a foto em segundo plano, então uma falha de rede é
    // reenviada. A chave sem versão é o que faz o reenvio REPOR.
    await upload.execute(panoramaId, dto(3), tenants.a.admin);
    await upload.execute(panoramaId, dto(3), tenants.a.admin);

    expect(balde.chaves()).toEqual([`capturas/${panoramaId}/3.jpg`]);
    expect(await prisma.captureFrame.count({ where: { panoramaId } })).toBe(1);
  });

  it('recusa panorama de outra agência sem tocar no balde', async () => {
    await expect(
      upload.execute(panoramaId, dto(3), tenants.b.admin),
    ).rejects.toThrow('Panorama not found');

    expect(balde.gravacoes).toBe(0);
  });
});
