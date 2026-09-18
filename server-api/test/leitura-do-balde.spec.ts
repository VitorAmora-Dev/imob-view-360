import sharp from 'sharp';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function jpeg(tom: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 800,
      height: 400,
      channels: 3,
      background: { r: tom, g: tom, b: tom },
    },
  })
    .jpeg()
    .toBuffer();
}

/** O tom médio distingue uma imagem da outra sem comparar bytes. */
async function tomDe(bytes: Buffer): Promise<number> {
  const { channels } = await sharp(bytes).stats();
  return Math.round(channels[0].mean);
}

async function seedTour(tenant: TenantFixture): Promise<string> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId: tenant.propertyId, status: 'PUBLISHED' },
  });
  return tour.id;
}

describe('leitura de imagem: balde antes da coluna', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let leitor: PanoramaImageReader;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    leitor = new PanoramaImageReader(asPrismaService, balde);
  });

  it('cai para a coluna quando a linha não tem endereço', async () => {
    // Teste 1 da spec. É esta queda que mantém tour publicado vivo enquanto o
    // preenchimento roda — sem ela, a migração seria um apagão.
    const bytes = await jpeg(60);
    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageData: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      },
    });

    const lido = await leitor.carregar(panorama.id, false);

    expect(await tomDe(lido!)).toBe(60);
  });

  it('prefere o endereço e não toca na coluna', async () => {
    // Teste 2 da spec. As duas fontes carregam imagens DIFERENTES de propósito:
    // é o tom que prova qual delas saiu.
    const doBalde = await jpeg(200);
    const daColuna = await jpeg(60);
    await balde.gravar('panoramas/x/1/original.jpg', doBalde);

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageData: `data:image/jpeg;base64,${daColuna.toString('base64')}`,
        imageKey: 'panoramas/x/1/original.jpg',
      },
    });

    const consultas = jest.spyOn(prisma.panorama, 'findUnique');
    const lido = await leitor.carregar(panorama.id, false);

    expect(await tomDe(lido!)).toBe(200);
    expect(consultas).toHaveBeenCalledTimes(1);
    expect(consultas).toHaveBeenCalledWith({
      where: { id: panorama.id },
      select: { imageKey: true, treatedImageKey: true },
    });
  });

  it('cai para a coluna quando a chave existe mas o objeto sumiu', async () => {
    // Rede de segurança, não caminho normal: uma chave gravada cujo objeto não
    // está lá é defeito. Servir a coluna é melhor que servir tela vazia.
    const daColuna = await jpeg(60);
    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageData: `data:image/jpeg;base64,${daColuna.toString('base64')}`,
        imageKey: 'panoramas/x/1/original.jpg',
      },
    });

    const lido = await leitor.carregar(panorama.id, false);

    expect(await tomDe(lido!)).toBe(60);
  });

  it('com tratamento pronto no balde, serve a tratada', async () => {
    await balde.gravar('panoramas/x/1/original.jpg', await jpeg(60));
    await balde.gravar('panoramas/x/2/tratada.jpg', await jpeg(200));

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageKey: 'panoramas/x/2/tratada.jpg',
        treatmentStatus: 'DONE',
      },
    });

    expect(await tomDe((await leitor.carregar(panorama.id, true))!)).toBe(200);
  });

  it('com a tratada só na coluna, NÃO serve o original do balde', async () => {
    // O caso que a migração cria e que mostraria a foto errada: o original já
    // migrou, a tratada ainda não. Cair para `imageKey` aqui entregaria o
    // cômodo SEM tratamento a quem pediu o tratado, e nada denunciaria.
    await balde.gravar('panoramas/x/1/original.jpg', await jpeg(60));
    const tratada = await jpeg(200);

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageData: `data:image/jpeg;base64,${tratada.toString('base64')}`,
        treatmentStatus: 'DONE',
      },
    });

    expect(await tomDe((await leitor.carregar(panorama.id, true))!)).toBe(200);
  });

  it('devolve a capa gravada ao lado da imagem servida', async () => {
    const chave = 'panoramas/x/2/tratada.jpg';
    await balde.gravar(chave, await jpeg(200));
    await balde.gravar(chaveDaCapa(chave), await jpeg(210));

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageKey: chave,
        treatmentStatus: 'DONE',
      },
    });

    expect(await tomDe((await leitor.carregarCapa(panorama.id, true))!)).toBe(
      210,
    );
  });

  it('sem capa para a variante servida, devolve null em vez de a errada', async () => {
    // O null é instrução: quem chama reduz sob demanda. Devolver a capa do
    // original aqui mostraria o cômodo sem tratamento no card.
    await balde.gravar('panoramas/x/1/original.jpg', await jpeg(60));
    await balde.gravar(
      chaveDaCapa('panoramas/x/1/original.jpg'),
      await jpeg(65),
    );

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageData: 'ainda-na-coluna',
        treatmentStatus: 'DONE',
      },
    });

    expect(await leitor.carregarCapa(panorama.id, true)).toBeNull();
  });

  it('devolve null para panorama que não existe', async () => {
    expect(
      await leitor.carregar('00000000-0000-0000-0000-000000000000', false),
    ).toBeNull();
  });
});
