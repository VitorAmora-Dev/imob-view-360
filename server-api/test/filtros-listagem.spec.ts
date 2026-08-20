import { ListPropertiesService } from '../src/modules/properties/services/list-properties.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

// Mesmo arranjo de `tenant-properties.spec.ts`: o service só usa métodos de
// query, que o cliente de teste também tem, então passar o cliente direto evita
// subir o AppModule inteiro para exercitar uma consulta.
const asPrismaService = prisma as unknown as PrismaService;
const listar = new ListPropertiesService(asPrismaService);

const CONSULTA = { page: 1, limit: 20, status: 'AVAILABLE' as const };

type Finalidade = 'SALE' | 'RENT' | 'SALE_OR_RENT';

interface Endereco {
  street: string;
  district: string;
  city: string;
  state: string;
}

/**
 * As fixtures já criam um imóvel por agência — `COD-alfa`, HOUSE/SALE, em
 * Centro / Porto Alegre / RS. As asserções são por CÓDIGO, e não por
 * quantidade, justamente porque esse imóvel participa das consultas.
 */
async function criarImovel(
  tenant: TenantFixture,
  code: string,
  extras: {
    purpose?: Finalidade;
    type?: 'HOUSE' | 'APARTMENT';
    title?: string;
    address?: Endereco;
  } = {},
): Promise<void> {
  await prisma.property.create({
    data: {
      code,
      title: extras.title ?? `Imóvel ${code}`,
      type: extras.type ?? 'HOUSE',
      purpose: extras.purpose ?? 'SALE',
      agencyId: tenant.agencyId,
      ...(extras.address && { address: { create: extras.address } }),
    },
  });
}

/** Códigos do resultado, ordenados — a ordem da listagem não é o assunto aqui. */
function codigos(resultado: { data: { code: string }[] }): string[] {
  return resultado.data.map((imovel) => imovel.code).sort();
}

describe('filtros da listagem de imóveis', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  describe('finalidade', () => {
    beforeEach(async () => {
      await criarImovel(tenants.a, 'ALUGA', { purpose: 'RENT' });
      await criarImovel(tenants.a, 'AMBOS', { purpose: 'SALE_OR_RENT' });
    });

    // Um imóvel marcado "Venda ou Aluguel" TAMBÉM está para alugar. Igualdade
    // exata o esconderia de quem procura aluguel — resultado faltando, não
    // resultado a mais.
    it('aluguel traz também os de venda ou aluguel', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, purpose: 'RENT' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['ALUGA', 'AMBOS']);
    });

    it('venda traz também os de venda ou aluguel', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, purpose: 'SALE' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['AMBOS', 'COD-alfa']);
    });

    // O caminho oposto NÃO é simétrico: quem escolhe "Venda ou Aluguel" está
    // perguntando por essa marcação, não pelo conjunto inteiro.
    it('venda ou aluguel continua sendo igualdade exata', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, purpose: 'SALE_OR_RENT' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['AMBOS']);
    });

    it('o filtro não atravessa a fronteira da agência', async () => {
      await criarImovel(tenants.b, 'ALHEIO', { purpose: 'RENT' });

      const resultado = await listar.execute(
        { ...CONSULTA, purpose: 'RENT' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['ALUGA', 'AMBOS']);
    });
  });
});
