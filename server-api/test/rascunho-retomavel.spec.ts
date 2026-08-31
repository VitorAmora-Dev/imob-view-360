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

    /**
     * Teto de 20. A faixa da home dispara UM download de miniatura por cartão,
     * em paralelo, no `ngOnInit` — sem limite, quem acumulou rascunhos paga a
     * rajada inteira em toda visita à tela inicial. E ninguém rola um carrossel
     * horizontal até o vigésimo item para retomar o que parou ontem.
     */
    it('não devolve mais de 20, e corta pelos mais antigos', async () => {
      // 21 rascunhos: `VirtualTour.propertyId` é único, então é um imóvel cada.
      const criados: string[] = [];
      for (let i = 0; i < 21; i++) {
        const imovel = await prisma.property.create({
          data: {
            code: `LOTE-${i}`,
            title: `Captura ${i}`,
            type: 'HOUSE',
            purpose: 'SALE',
            agencyId: tenants.a.agencyId,
          },
          select: { id: true },
        });
        const tour = await prisma.virtualTour.create({
          data: { propertyId: imovel.id, status: 'DRAFT' },
          select: { id: true },
        });
        // `updatedAt` explícito e crescente, num UPDATE: é o critério de
        // ordenação, e deixar o relógio decidir tornaria o corte imprevisível
        // se dois inserts caíssem no mesmo milissegundo. Mesmo caminho que
        // `UpdatePanoramaService` usa para tocar o tour.
        await prisma.virtualTour.update({
          where: { id: tour.id },
          data: { updatedAt: new Date(2026, 0, i + 1) },
        });
        criados.push(tour.id);
      }

      const lista = await listarRascunhos.execute(tenants.a.admin);

      expect(lista).toHaveLength(20);
      // O mais recente é o primeiro, e o mais ANTIGO é o que ficou de fora.
      expect(lista[0].id).toBe(criados[20]);
      expect(lista.map((r) => r.id)).not.toContain(criados[0]);
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

    /**
     * REVERTE uma decisão anterior deste mesmo arquivo. O teste que morava
     * aqui afirmava o oposto — "serve também o tour já publicado, para o caso
     * de retomar depois de publicar" —, e o argumento dele era sobre
     * AUTORIZAÇÃO: filtrar status seria repetir numa rota autenticada a defesa
     * que a rota pública faz.
     *
     * O argumento continua correto e ainda assim leva ao lugar errado, porque
     * o risco aqui não é quem lê: é o que o wizard FAZ com o que recebe. Ele
     * trata tudo como rascunho, e a tela de sair oferece "Descartar captura",
     * que apaga o `Property` em cascata — tour, panoramas, hotspots, frames e
     * o tratamento de IA já pago. Um cartão velho na faixa da home (o
     * `ion-router-outlet` mantém a página em cache) bastava para pôr esse
     * botão em cima de um tour no ar, com o link já mandado ao cliente.
     *
     * E o caso de uso que o nome invocava não existe: nada no aplicativo
     * retoma depois de publicar. A faixa lista só `DRAFT`, e `?rascunho=` é o
     * único caminho até aqui. Quando editar tour publicado for uma
     * funcionalidade de verdade, ela pede a sua própria rota — uma que não
     * entregue o botão de descartar junto.
     */
    it('recusa tour publicado — rascunho publicado deixou de ser rascunho', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'PUBLISHED', panoramas: [] },
        tenants.a.admin,
      );

      await expect(
        lerRascunho.execute(tour!.id, tenants.a.admin),
      ).rejects.toBeInstanceOf(NotFoundException);
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
