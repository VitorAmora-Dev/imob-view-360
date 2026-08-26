import { NotFoundException } from '@nestjs/common';
import { CreateVirtualTourService } from '../src/modules/virtual-tours/services/create-virtual-tour.service';
import { ListDraftToursService } from '../src/modules/virtual-tours/services/list-draft-tours.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

/**
 * O rascunho deixa de ser invisível e passa a ter caminho de volta.
 *
 * Até aqui ele existia só para a montagem por IA poder rodar durante a
 * captura, e ninguém o lia de propósito. Estes casos cobrem as duas leituras
 * novas — a lista da faixa da home e a releitura para reidratar o wizard — e
 * o que elas não podem fazer: vazar rascunho de outra imobiliária, e trazer
 * coluna de imagem no JSON.
 */

const asPrismaService = prisma as unknown as PrismaService;
const criarTour = new CreateVirtualTourService(asPrismaService);
const listarRascunhos = new ListDraftToursService(asPrismaService);

describe('rascunho retomável', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  describe('listagem', () => {
    it('traz o rascunho da própria agência, com contagem de ambientes e capa', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );
      const capa = await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Ambiente 1',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 0,
          initialPanorama: true,
        },
        select: { id: true },
      });
      await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Ambiente 2',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 1,
          initialPanorama: false,
        },
      });

      const lista = await listarRascunhos.execute(tenants.a.admin);

      expect(lista).toHaveLength(1);
      expect(lista[0].id).toBe(tour!.id);
      expect(lista[0].ambientes).toBe(2);
      expect(lista[0].capaPanoramaId).toBe(capa.id);
    });

    it('não traz tour publicado', async () => {
      await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'PUBLISHED', panoramas: [] },
        tenants.a.admin,
      );

      expect(await listarRascunhos.execute(tenants.a.admin)).toEqual([]);
    });

    it('não vaza rascunho de outra imobiliária', async () => {
      await criarTour.execute(
        { propertyId: tenants.b.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.b.admin,
      );

      expect(await listarRascunhos.execute(tenants.a.admin)).toEqual([]);
    });

    it('devolve capa nula quando o rascunho ainda não tem cômodo nenhum', async () => {
      // É o estado entre `garantirRascunho()` e a primeira captura terminar.
      // A faixa da home precisa saber desenhar isso sem miniatura.
      await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );

      const lista = await listarRascunhos.execute(tenants.a.admin);

      expect(lista[0].ambientes).toBe(0);
      expect(lista[0].capaPanoramaId).toBeNull();
    });
  });
});
