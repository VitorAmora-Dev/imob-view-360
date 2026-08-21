import { NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { CreateVirtualTourService } from '../src/modules/virtual-tours/services/create-virtual-tour.service';
import { MontarTourService } from '../src/modules/virtual-tours/services/montar-tour.service';
import { UpdateVirtualTourService } from '../src/modules/virtual-tours/services/update-virtual-tour.service';
import { TreatPanoramaService } from '../src/modules/panoramas/services/treat-panorama.service';
import { GetPanoramaPreviewService } from '../src/modules/panoramas/services/get-panorama-preview.service';
import { GetPanoramaImageService } from '../src/modules/panoramas/services/get-panorama-image.service';
import { ListPropertiesService } from '../src/modules/properties/services/list-properties.service';
import { UpdatePropertyService } from '../src/modules/properties/services/update-property.service';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { limparCacheDeMiniatura } from '../src/modules/panoramas/panorama-miniatura';
import { ListPropertiesDto } from '../src/modules/properties/dto/list-properties.dto';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

/**
 * O tour de captura passa a existir no servidor ANTES de estar pronto, para que
 * a montagem por IA rode enquanto o corretor fotografa os outros cômodos.
 *
 * Isso inverte uma premissa que valia no resto do sistema: até aqui, tour no
 * banco era tour publicado. Estes casos cobrem as consequências disso — o
 * rascunho não pode aparecer para o público nem na listagem, e quem está
 * editando precisa continuar enxergando a foto.
 */

const asPrismaService = prisma as unknown as PrismaService;
const leitor = new PanoramaImageReader(asPrismaService);

const criarTour = new CreateVirtualTourService(asPrismaService);
const publicarTour = new UpdateVirtualTourService(asPrismaService);
const atualizarImovel = new UpdatePropertyService(asPrismaService);
const listarImoveis = new ListPropertiesService(asPrismaService);
const preview = new GetPanoramaPreviewService(asPrismaService, leitor);
const imagemPublica = new GetPanoramaImageService(asPrismaService, leitor);
const montar = new MontarTourService(
  asPrismaService,
  new TreatPanoramaService(asPrismaService),
);

/** O que a rota de listagem entrega ao serviço quando ninguém filtra nada. */
const LISTA_SEM_FILTRO: ListPropertiesDto = {
  page: 1,
  limit: 20,
  status: 'AVAILABLE',
};

async function jpegDe(tom: number): Promise<string> {
  const bytes = await sharp({
    create: {
      width: 1600,
      height: 800,
      channels: 3,
      background: { r: tom, g: tom, b: tom },
    },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

/** Um rascunho com um cômodo, no estado em que o wizard o deixa. */
async function seedRascunho(
  tenant: TenantFixture,
): Promise<{ tourId: string; panoramaId: string }> {
  const tour = await criarTour.execute(
    { propertyId: tenant.propertyId, status: 'DRAFT', panoramas: [] },
    tenant.admin,
  );
  const panorama = await prisma.panorama.create({
    data: {
      roomName: 'Sala',
      imageData: await jpegDe(60),
      virtualTourId: tour.id,
      initialPanorama: true,
    },
    select: { id: true },
  });
  return { tourId: tour.id, panoramaId: panorama.id };
}

describe('rascunho de captura', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    limparCacheDeMiniatura();
  });

  it('nasce em DRAFT quando o status não é informado', async () => {
    // O default vem do schema, e o serviço gravava PUBLISHED fixo por cima
    // dele. Sem este caso, voltar a fixar o valor não quebraria nada visível:
    // o wizard seguiria funcionando, só que publicando cada captura no instante
    // da primeira foto.
    const tour = await criarTour.execute(
      { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
      tenants.a.admin,
    );
    expect(tour.status).toBe('DRAFT');
  });

  it('nasce publicado quando quem cria pede, como a tela legada faz', async () => {
    const tour = await criarTour.execute(
      { propertyId: tenants.a.propertyId, status: 'PUBLISHED', panoramas: [] },
      tenants.a.admin,
    );
    expect(tour.status).toBe('PUBLISHED');
  });

  it('esconde o imóvel do rascunho da listagem, e o devolve ao publicar', async () => {
    // O imóvel do wizard nasce como marcador, sem título nem endereço. Ele
    // apareceria no lugar mais visível do sistema como uma linha vazia que
    // nenhuma tela sabe apagar.
    const { tourId } = await seedRascunho(tenants.a);

    const durante = await listarImoveis.execute(
      LISTA_SEM_FILTRO,
      tenants.a.admin,
    );
    expect(durante.data).toHaveLength(0);
    expect(durante.total).toBe(0);

    await publicarTour.execute(
      tourId,
      { status: 'PUBLISHED' },
      tenants.a.admin,
    );

    const depois = await listarImoveis.execute(
      LISTA_SEM_FILTRO,
      tenants.a.admin,
    );
    expect(depois.data.map((p) => p.id)).toEqual([tenants.a.propertyId]);
  });

  it('mantém na listagem o imóvel que não tem tour nenhum', async () => {
    // A regra é "esconde rascunho", não "só mostra quem tem tour". Imóvel sem
    // tour é a maior parte do cadastro, e um filtro escrito com `isNot` sobre a
    // relação opcional teria derrubado todos eles de uma vez.
    const lista = await listarImoveis.execute(
      LISTA_SEM_FILTRO,
      tenants.a.admin,
    );
    expect(lista.data.map((p) => p.id)).toContain(tenants.a.propertyId);
  });

  it('nega ao público a imagem do rascunho, e a entrega a quem edita', async () => {
    const { panoramaId } = await seedRascunho(tenants.a);

    await expect(imagemPublica.execute(panoramaId)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const { corpo } = await preview.execute(panoramaId, tenants.a.admin, {
      variante: 'treated',
    });
    expect(corpo).toBeDefined();
  });

  it('nega o preview de outra imobiliária', async () => {
    const { panoramaId } = await seedRascunho(tenants.a);
    await expect(
      preview.execute(panoramaId, tenants.b.admin, { variante: 'treated' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('preview: original e tratada', () => {
  let tenants: TwoTenants;
  let panoramaId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    limparCacheDeMiniatura();
    ({ panoramaId } = await seedRascunho(tenants.a));
    // Tratada bem mais clara que a original (60), para separar as duas pelo tom
    // médio dos pixels em vez de pelo tamanho do buffer.
    await prisma.panorama.update({
      where: { id: panoramaId },
      data: {
        treatedImageData: await jpegDe(230),
        treatmentStatus: 'DONE',
        treatedAt: new Date(),
      },
    });
  });

  it('serve a tratada em variant=treated e a original em variant=original', async () => {
    const tratada = await preview.execute(panoramaId, tenants.a.admin, {
      variante: 'treated',
    });
    const original = await preview.execute(panoramaId, tenants.a.admin, {
      variante: 'original',
    });

    const mediaTratada = (await sharp(tratada.corpo!).stats()).channels[0].mean;
    const mediaOriginal = (await sharp(original.corpo!).stats()).channels[0]
      .mean;

    expect(mediaTratada).toBeGreaterThan(200);
    expect(mediaOriginal).toBeLessThan(100);
  });

  it('dá ETags diferentes para as duas variantes', async () => {
    // Sem isto o antes e o depois viram a mesma foto e nada denuncia: o
    // navegador vê o ETag que já tem da tratada, responde do próprio cache, e
    // nenhuma requisição chega ao servidor para aparecer no log.
    const tratada = await preview.execute(panoramaId, tenants.a.admin, {
      variante: 'treated',
    });
    const original = await preview.execute(panoramaId, tenants.a.admin, {
      variante: 'original',
    });
    expect(tratada.etag).not.toBe(original.etag);
  });

  it('não devolve corpo quando o cliente já tem aquela variante', async () => {
    const { etag } = await preview.execute(panoramaId, tenants.a.admin, {
      variante: 'treated',
    });
    const revalidado = await preview.execute(panoramaId, tenants.a.admin, {
      variante: 'treated',
      etagDoCliente: etag,
    });
    expect(revalidado.corpo).toBeUndefined();
    expect(revalidado.etag).toBe(etag);
  });

  it('não confunde as duas variantes no cache de redução', async () => {
    // Mesmo panorama, mesma largura, mesmo `updatedAt`: sem a variante na
    // chave, a segunda chamada recebe os bytes guardados pela primeira.
    const tratada = await preview.execute(panoramaId, tenants.a.admin, {
      variante: 'treated',
      largura: 320,
    });
    const original = await preview.execute(panoramaId, tenants.a.admin, {
      variante: 'original',
      largura: 320,
    });

    expect(
      (await sharp(tratada.corpo!).stats()).channels[0].mean,
    ).toBeGreaterThan(200);
    expect(
      (await sharp(original.corpo!).stats()).channels[0].mean,
    ).toBeLessThan(100);
  });

  it('cai na original quando pedem a tratada e ela ainda não existe', async () => {
    // É o estado normal durante a captura: a etapa 2 pede sempre a tratada e
    // recebe o que houver, trocando sozinha quando a montagem termina.
    const { panoramaId: cru } = await seedRascunho(tenants.b);
    const { corpo } = await preview.execute(cru, tenants.b.admin, {
      variante: 'treated',
    });
    expect((await sharp(corpo!).stats()).channels[0].mean).toBeLessThan(100);
  });
});

describe('andamento da montagem, cômodo a cômodo', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  it('diz qual panorama está em qual estado, na ordem do tour', async () => {
    // O agregado responde "quanto falta". O wizard precisa de "qual acabou",
    // para trocar aquela imagem na tela sem rebaixar o tour inteiro a cada
    // volta do polling.
    const tour = await criarTour.execute(
      { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
      tenants.a.admin,
    );

    const sala = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        imageData: await jpegDe(60),
        virtualTourId: tour.id,
        order: 0,
        treatmentStatus: 'DONE',
      },
      select: { id: true },
    });
    const quarto = await prisma.panorama.create({
      data: {
        roomName: 'Quarto',
        imageData: await jpegDe(60),
        virtualTourId: tour.id,
        order: 1,
        treatmentStatus: 'PENDING',
      },
      select: { id: true },
    });

    const andamento = await montar.andamento(tour.id, tenants.a.admin);

    expect(andamento.panoramas).toEqual([
      { id: sala.id, status: 'DONE' },
      { id: quarto.id, status: 'PENDING' },
    ]);
    expect(andamento.prontos).toBe(1);
    expect(andamento.terminado).toBe(false);
  });
});

describe('atualização do imóvel', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  it('grava os dados que só existem na última etapa do wizard', async () => {
    const atualizado = await atualizarImovel.execute(
      tenants.a.propertyId,
      { title: 'Apartamento no Bela Vista', price: 750000 },
      tenants.a.admin,
    );
    expect(atualizado.title).toBe('Apartamento no Bela Vista');
    expect(atualizado.price).toBe(750000);
    // O que não veio no PATCH continua como estava.
    expect(atualizado.type).toBe('HOUSE');
  });

  it('cria o endereço quando o imóvel ainda não tem, em vez de falhar', async () => {
    // O imóvel do wizard nasce sem endereço. Com `update` puro no lugar do
    // `upsert`, o Prisma erra com registro inexistente no caminho mais comum
    // desta rota.
    const semEndereco = await prisma.property.create({
      data: {
        code: 'COD-rascunho',
        title: 'Captura em andamento',
        type: 'HOUSE',
        purpose: 'SALE',
        agencyId: tenants.a.agencyId,
      },
      select: { id: true },
    });

    const atualizado = await atualizarImovel.execute(
      semEndereco.id,
      { address: { street: 'Rua Nova', city: 'Porto Alegre', state: 'RS' } },
      tenants.a.admin,
    );
    expect(atualizado.address?.street).toBe('Rua Nova');
  });

  it('nega o imóvel de outra imobiliária', async () => {
    await expect(
      atualizarImovel.execute(
        tenants.a.propertyId,
        { title: 'x' },
        tenants.b.admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
