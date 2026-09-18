import { PrismaClient } from '../generated/prisma/client';
import { varrer } from '../scripts/varrer-orfaos';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asClient = prisma as unknown as PrismaClient;
const VIVA = 'panoramas/p/2/tratada.jpg';
const ORFA = 'panoramas/p/1/tratada.jpg';

describe('varrer-orfaos', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();

    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'PUBLISHED' },
    });
    await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: tour.id,
        imageKey: 'panoramas/p/0/original.jpg',
        treatedImageKey: VIVA,
        treatmentStatus: 'DONE',
      },
    });

    for (const chave of ['panoramas/p/0/original.jpg', VIVA, ORFA]) {
      await balde.gravar(chave, Buffer.from(chave));
      await balde.gravar(chaveDaCapa(chave), Buffer.from(`capa de ${chave}`));
    }
  });

  it('acha a versão anterior e não toca na viva', async () => {
    const r = await varrer(asClient, balde, { apagar: false, dias: 0 });

    expect(r.orfaos.sort()).toEqual([ORFA, chaveDaCapa(ORFA)].sort());
  });

  it('seco por padrão: não apaga nada', async () => {
    await varrer(asClient, balde, { apagar: false, dias: 0 });

    expect(balde.tem(ORFA)).toBe(true);
  });

  it('com --apagar, some com o órfão e preserva o vivo', async () => {
    const r = await varrer(asClient, balde, { apagar: true, dias: 0 });

    expect(r.apagados).toBe(2);
    expect(balde.tem(ORFA)).toBe(false);
    expect(balde.tem(VIVA)).toBe(true);
    expect(balde.tem(chaveDaCapa(VIVA))).toBe(true);
  });

  it('não apaga objeto recém-gravado', async () => {
    // A decisão 10 grava no balde ANTES do banco: existe uma janela, de
    // milissegundos a segundos, em que um objeto legítimo ainda não tem dono.
    // Varrer sem idade de corte apagaria uma captura em curso.
    const r = await varrer(asClient, balde, { apagar: true, dias: 7 });

    expect(r.orfaos).toEqual([]);
    expect(balde.tem(ORFA)).toBe(true);
  });

  it('a foto de referência de um panorama vivo não é órfã', async () => {
    // Decisão 4: elas NÃO são apagadas depois do tratamento. Apagar continua
    // disponível para sempre; recuperar nunca fica.
    const panorama = await prisma.panorama.findFirstOrThrow({
      select: { id: true },
    });
    await prisma.captureFrame.create({
      data: {
        panoramaId: panorama.id,
        index: 0,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        imageKey: `capturas/${panorama.id}/0.jpg`,
      },
    });
    await balde.gravar(`capturas/${panorama.id}/0.jpg`, Buffer.from('ref'));

    const r = await varrer(asClient, balde, { apagar: true, dias: 0 });

    expect(balde.tem(`capturas/${panorama.id}/0.jpg`)).toBe(true);
    expect(r.orfaos).not.toContain(`capturas/${panorama.id}/0.jpg`);
  });
});
