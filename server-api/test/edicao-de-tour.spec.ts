import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { CreateVirtualTourService } from '../src/modules/virtual-tours/services/create-virtual-tour.service';
import { FindDraftTourService } from '../src/modules/virtual-tours/services/find-draft-tour.service';
import { FindEditableTourService } from '../src/modules/virtual-tours/services/find-editable-tour.service';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

/**
 * Reabrir para EDITAR um tour que já está no ar (TV-10).
 *
 * O par de rotas é o assunto destes casos, e é por isso que as duas aparecem no
 * mesmo arquivo: a garantia que interessa não é o que cada uma serve, é a
 * DIFERENÇA entre elas. `/rascunho` diz "isto é descartável" — o wizard aberto
 * por ali oferece apagar a captura inteira. `/edicao` diz "isto é editável", e
 * pode estar publicado.
 *
 * Quem um dia trocar o `status: 'DRAFT'` do primeiro serviço por um `in` para
 * "simplificar" faz cair o teste de recusa aqui embaixo, com as duas rotas
 * lado a lado para ver o que se perde.
 */

const asPrismaService = prisma as unknown as PrismaService;
const criarTour = new CreateVirtualTourService(asPrismaService);
const lerParaEdicao = new FindEditableTourService(asPrismaService);
const lerRascunho = new FindDraftTourService(asPrismaService);

describe('leitura de tour para edição', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  async function tourCom(status: 'DRAFT' | 'PUBLISHED') {
    const tour = await criarTour.execute(
      { propertyId: tenants.a.propertyId, status, panoramas: [] },
      tenants.a.admin,
    );
    return tour!;
  }

  it('serve o tour PUBLICADO, que é o que a rota de rascunho recusa', async () => {
    const tour = await tourCom('PUBLISHED');

    const paraEdicao = await lerParaEdicao.execute(tour.id, tenants.a.admin);

    expect(paraEdicao.id).toBe(tour.id);
    expect(paraEdicao.status).toBe('PUBLISHED');
    // A recusa da outra rota não é regressão: é a razão de esta existir.
    await expect(
      lerRascunho.execute(tour.id, tenants.a.admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serve também o rascunho — o wizard não precisa saber qual rota pedir', async () => {
    const tour = await tourCom('DRAFT');

    const paraEdicao = await lerParaEdicao.execute(tour.id, tenants.a.admin);

    expect(paraEdicao.id).toBe(tour.id);
    expect(paraEdicao.status).toBe('DRAFT');
  });

  it('devolve cômodos e pontos no mesmo formato da retomada', async () => {
    // Mesmo shape, e não "parecido": é o wizard inteiro que lê os dois, e um
    // campo a menos aqui abriria a tela pela metade só por este caminho.
    const tour = await tourCom('PUBLISHED');
    const sala = await prisma.panorama.create({
      data: {
        virtualTourId: tour.id,
        roomName: 'Sala',
        imageData: 'data:image/jpeg;base64,SGk=',
        order: 0,
        initialPanorama: true,
      },
      select: { id: true },
    });
    const quarto = await prisma.panorama.create({
      data: {
        virtualTourId: tour.id,
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

    const paraEdicao = await lerParaEdicao.execute(tour.id, tenants.a.admin);

    expect(paraEdicao.panoramas.map((p) => p.roomName)).toEqual([
      'Sala',
      'Quarto',
    ]);
    expect(paraEdicao.panoramas[0].hotspots).toHaveLength(1);
    expect(paraEdicao.panoramas[0].hotspots[0].targetId).toBe(quarto.id);
    expect(paraEdicao.panoramas[0].hotspots[0].positionX).toBe(0.25);
    expect(paraEdicao.property.title).toBe(`Imóvel da alfa`);
  });

  it('não traz coluna de imagem nenhuma', async () => {
    // Mesma razão da rota de rascunho: a equirect é TOAST de dezenas de MB, e
    // quem edita busca a foto de um cômodo por vez, pelo preview.
    const tour = await tourCom('PUBLISHED');
    await prisma.panorama.create({
      data: {
        virtualTourId: tour.id,
        roomName: 'Sala',
        imageData: 'data:image/jpeg;base64,SGk=',
        treatedImageData: 'data:image/jpeg;base64,VHJhdGFkYQ==',
        order: 0,
        initialPanorama: true,
      },
    });

    const json = JSON.stringify(
      await lerParaEdicao.execute(tour.id, tenants.a.admin),
    );

    expect(json).not.toContain('SGk=');
    expect(json).not.toContain('VHJhdGFkYQ==');
  });

  it('nega o tour de outra imobiliária com 404, sem confirmar o id', async () => {
    // A rota mais perigosa das duas: quem a abre não vai só LER o tour, vai
    // reescrevê-lo.
    const tour = await criarTour.execute(
      { propertyId: tenants.b.propertyId, status: 'PUBLISHED', panoramas: [] },
      tenants.b.admin,
    );

    await expect(
      lerParaEdicao.execute(tour!.id, tenants.a.admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa tour arquivado — quem volta ao ar é o desarquivamento', async () => {
    const tour = await tourCom('PUBLISHED');
    await prisma.virtualTour.update({
      where: { id: tour.id },
      data: { status: 'ARCHIVED' },
    });

    await expect(
      lerParaEdicao.execute(tour.id, tenants.a.admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 em id que não existe', async () => {
    await expect(
      lerParaEdicao.execute(
        '00000000-0000-4000-8000-000000000000',
        tenants.a.admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
