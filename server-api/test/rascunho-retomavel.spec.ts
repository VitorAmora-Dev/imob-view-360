import { NotFoundException } from '@nestjs/common';
import { CreateVirtualTourService } from '../src/modules/virtual-tours/services/create-virtual-tour.service';
import { FindDraftTourService } from '../src/modules/virtual-tours/services/find-draft-tour.service';
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
const lerRascunho = new FindDraftTourService(asPrismaService);

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

  describe('leitura para reidratar', () => {
    it('serve o rascunho da própria agência, com cômodos e hotspots', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );
      const sala = await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Sala',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 0,
          initialPanorama: true,
        },
        select: { id: true },
      });
      const quarto = await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Quarto',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 1,
          initialPanorama: false,
        },
        select: { id: true },
      });
      await prisma.hotspot.create({
        data: {
          originId: sala.id,
          targetId: quarto.id,
          label: 'Ir ao quarto',
          positionX: 0.25,
          positionY: 0.5,
        },
      });

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);

      expect(rascunho.panoramas.map((p) => p.roomName)).toEqual(['Sala', 'Quarto']);
      expect(rascunho.panoramas[0].hotspots).toHaveLength(1);
      expect(rascunho.panoramas[0].hotspots[0].targetId).toBe(quarto.id);
      expect(rascunho.panoramas[0].hotspots[0].positionX).toBe(0.25);
    });

    it('devolve os dados do imóvel para a etapa 3', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);

      expect(rascunho.propertyId).toBe(tenants.a.propertyId);
      expect(typeof rascunho.property.title).toBe('string');
    });

    it('não traz coluna de imagem nenhuma', async () => {
      // A equirect é TOAST de dezenas de MB. Foi ela que fez o tour mais
      // pesado sair com 58,4 MB de JSON, e reidratar não precisa dela: a
      // imagem vem por URL, sob demanda, e só a do cômodo que está à vista.
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );
      await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Sala',
          imageData: 'data:image/jpeg;base64,SGk=',
          treatedImageData: 'data:image/jpeg;base64,VHJhdGFkYQ==',
          order: 0,
          initialPanorama: true,
        },
      });

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);

      const json = JSON.stringify(rascunho);
      expect(json).not.toContain('SGk=');
      expect(json).not.toContain('VHJhdGFkYQ==');
    });

    it('nega o rascunho de outra imobiliária com 404, sem confirmar o id', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.b.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.b.admin,
      );

      await expect(
        lerRascunho.execute(tour!.id, tenants.a.admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('serve também o tour já publicado, para o caso de retomar depois de publicar', async () => {
      // Sem filtro de status de propósito: a autorização aqui vem do token e
      // do escopo por agência, como no `/preview`. Filtrar status seria
      // repetir a defesa da rota pública numa rota que não é pública.
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'PUBLISHED', panoramas: [] },
        tenants.a.admin,
      );

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);

      expect(rascunho.status).toBe('PUBLISHED');
    });
  });
});
