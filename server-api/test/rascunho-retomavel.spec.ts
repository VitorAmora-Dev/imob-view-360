import { NotFoundException } from '@nestjs/common';
import { CreatePanoramaService } from '../src/modules/panoramas/services/create-panorama.service';
import { UpdatePanoramaService } from '../src/modules/panoramas/services/update-panorama.service';
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
const criarPanorama = new CreatePanoramaService(asPrismaService);
const atualizarPanorama = new UpdatePanoramaService(asPrismaService);

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

    /**
     * A conexão ESCOLHIDA e ainda não posicionada é a única parte do wizard que
     * não se deduz do resto: nome e ordem são colunas, a passagem posicionada
     * é um `Hotspot`. Sem esta coluna, o corretor que fizesse a etapa de
     * ordenação e fechasse o app retomava com a fila de passagens vazia.
     */
    it('devolve as conexões escolhidas de cada cômodo', async () => {
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
      const cozinha = await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Cozinha',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 1,
          initialPanorama: false,
        },
        select: { id: true },
      });
      await atualizarPanorama.execute(
        sala.id,
        { draftConnections: [cozinha.id] },
        tenants.a.admin,
      );

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);

      expect(rascunho.panoramas[0].draftConnections).toEqual([cozinha.id]);
      // Nenhum hotspot foi posicionado: é exatamente o estado que se perdia.
      expect(rascunho.panoramas[0].hotspots).toHaveLength(0);
    });

    /**
     * Lista inteira e sempre, inclusive vazia — desligar o último ambiente
     * precisa chegar ao banco. Um PATCH que tratasse vazio como "não mexer"
     * manteria a conexão que o corretor acabou de desfazer.
     */
    it('aceita lista vazia para desligar tudo', async () => {
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
          draftConnections: [tour!.id],
        },
        select: { id: true },
      });

      await atualizarPanorama.execute(
        sala.id,
        { draftConnections: [] },
        tenants.a.admin,
      );

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);
      expect(rascunho.panoramas[0].draftConnections).toEqual([]);
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
  /**
   * `VirtualTour.updatedAt` é o relógio de "quando esta captura parou de
   * andar", e três coisas dependem dele: a ordem da faixa da home
   * (`orderBy: updatedAt desc`), a hora que o cartão mostra, e a idade de
   * corte de `limpar-rascunhos`.
   *
   * Só que nada escrevia na LINHA do tour durante a captura: o panorama
   * nasce com `virtualTourId` escalar, e o único `virtualTour.update` do
   * servidor era o do publicar. O relógio ficava parado em `createdAt` — e o
   * sweeper apagava por idade de criação uma captura editada até ontem.
   */
  describe('o relógio do tour durante a captura', () => {
    /**
     * Empurra o tour para o passado por SQL cru, e não por `prisma.update`:
     * `updatedAt` é `@updatedAt`, então o cliente reescreveria o valor com o
     * agora e o teste passaria sem nada ter tocado no tour.
     */
    async function envelhecer(tourId: string): Promise<Date> {
      const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.$executeRaw`UPDATE "VirtualTour" SET "updatedAt" = ${ontem} WHERE id = ${tourId}`;
      return ontem;
    }

    async function updatedAtDe(tourId: string): Promise<Date> {
      const tour = await prisma.virtualTour.findUniqueOrThrow({
        where: { id: tourId },
        select: { updatedAt: true },
      });
      return tour.updatedAt;
    }

    it('move o updatedAt do tour quando um cômodo novo entra', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );
      const ontem = await envelhecer(tour!.id);

      await criarPanorama.execute(
        {
          tourId: tour!.id,
          roomName: 'Sala',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 0,
          initialPanorama: true,
          measurements: [],
        },
        tenants.a.admin,
      );

      expect((await updatedAtDe(tour!.id)).getTime()).toBeGreaterThan(
        ontem.getTime(),
      );
    });

    it('move o updatedAt do tour quando um cômodo é renomeado ou reordenado', async () => {
      // É o que o salvamento de rascunho faz a cada troca de etapa: nenhum
      // cômodo novo, só nome, ordem e capa. Sem isto, uma captura de seis
      // cômodos editada por meia hora não moveria o relógio um milissegundo.
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );
      const panorama = await criarPanorama.execute(
        {
          tourId: tour!.id,
          roomName: 'Ambiente 1',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 0,
          initialPanorama: true,
          measurements: [],
        },
        tenants.a.admin,
      );
      const ontem = await envelhecer(tour!.id);

      await atualizarPanorama.execute(
        panorama!.id,
        { roomName: 'Cozinha' },
        tenants.a.admin,
      );

      expect((await updatedAtDe(tour!.id)).getTime()).toBeGreaterThan(
        ontem.getTime(),
      );
    });

    it('não toca no tour de outra imobiliária', async () => {
      // O escopo por agência já barra a chamada; este caso é o que impede o
      // toque no tour de virar uma escrita fora do inquilino do chamador.
      const tourB = await criarTour.execute(
        { propertyId: tenants.b.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.b.admin,
      );
      const ontem = await envelhecer(tourB!.id);

      await expect(
        criarPanorama.execute(
          {
            tourId: tourB!.id,
            roomName: 'Sala',
            imageData: 'data:image/jpeg;base64,SGk=',
            order: 0,
            initialPanorama: true,
            measurements: [],
          },
          tenants.a.admin,
        ),
      ).rejects.toThrow(NotFoundException);

      expect((await updatedAtDe(tourB!.id)).getTime()).toBe(ontem.getTime());
    });
  });
});
