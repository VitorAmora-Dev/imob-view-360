import { ListPropertiesService } from '../src/modules/properties/services/list-properties.service';
import { ListUsersService } from '../src/modules/users/services/list-users.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;
const listarImoveis = new ListPropertiesService(asPrismaService);
const listarUsuarios = new ListUsersService(asPrismaService);

/**
 * Paginação por offset só é confiável se a ordenação for TOTAL.
 *
 * `createdAt` e `name` não são únicos. Quando duas linhas empatam, o Postgres
 * não promete devolvê-las na mesma ordem em duas consultas — a ordem entre
 * empatadas depende do plano escolhido e da posição física das tuplas, e as
 * duas coisas mudam sozinhas com o tempo (um UPDATE reescreve a tupla, o
 * planejador troca de estratégia quando a tabela cresce). Com `skip`/`take` por
 * cima disso, o efeito para quem usa é um item aparecendo em duas páginas
 * enquanto outro não aparece em nenhuma.
 *
 * Estes testes fixam o CONTRATO — "entre empatadas, a ordem é por id" — em vez
 * de tentar reproduzir o sintoma. Tentei primeiro pelo sintoma, atualizando uma
 * linha no meio da paginação para mexer na ordem física: com 7 linhas o
 * Postgres devolveu a mesma ordem de qualquer jeito e o teste passava mesmo com
 * o desempate removido. Um teste que não falha quando o código quebra não está
 * testando nada.
 */

const CONSULTA = { page: 1, limit: 2, status: 'AVAILABLE' as const };
const MESMO_INSTANTE = new Date('2026-01-01T12:00:00.000Z');

async function seedImoveisEmpatados(
  tenant: TenantFixture,
  quantos: number,
): Promise<void> {
  for (let i = 0; i < quantos; i++) {
    await prisma.property.create({
      data: {
        code: `EMPATE-${i}`,
        title: `Imóvel ${i}`,
        type: 'HOUSE',
        purpose: 'SALE',
        price: 100000 + i,
        agencyId: tenant.agencyId,
        // Todos no mesmo instante: é o empate que o desempate resolve.
        createdAt: MESMO_INSTANTE,
      },
    });
  }
}

/** Percorre todas as páginas e devolve os ids na ordem em que apareceram. */
async function paginarTudo<T extends { id: string }>(
  buscar: (pagina: number) => Promise<{ data: T[]; pages: number }>,
): Promise<string[]> {
  const primeira = await buscar(1);
  const ids = primeira.data.map((linha) => linha.id);

  for (let pagina = 2; pagina <= primeira.pages; pagina++) {
    const resultado = await buscar(pagina);
    ids.push(...resultado.data.map((linha) => linha.id));
  }

  return ids;
}

describe('paginação estável', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  it('ordena imóveis empatados em createdAt por id, de forma total', async () => {
    await seedImoveisEmpatados(tenants.a, 6);

    const ids = await paginarTudo((pagina) =>
      listarImoveis.execute({ ...CONSULTA, page: pagina }, tenants.a.admin),
    );

    // Os seis empatados mais o imóvel que a fixture cria (com createdAt de
    // agora, portanto o primeiro na ordem decrescente).
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);

    // Entre os empatados, a ordem tem de ser decrescente por id. Sem desempate
    // ela é arbitrária, e uuid aleatório praticamente nunca sai ordenado.
    const empatados = ids.slice(1);
    expect(empatados).toEqual([...empatados].sort().reverse());
  });

  it('ordena usuários homônimos por id, de forma total', async () => {
    // Dois "Ana Silva" na mesma agência não são exceção em imobiliária nenhuma.
    for (let i = 0; i < 4; i++) {
      await prisma.user.create({
        data: {
          name: 'Ana Silva',
          email: `ana${i}@alfa.test`,
          password: 'nao-e-um-hash',
          type: 'AGENT',
          agencyId: tenants.a.agencyId,
        },
      });
    }

    const ids = await paginarTudo((pagina) =>
      listarUsuarios.execute({ page: pagina, limit: 2 }, tenants.a.admin),
    );

    // As quatro Anas mais o "Admin alfa" da fixture, que vem ANTES delas por
    // nome ('Admin' < 'Ana': o 'd' precede o 'n').
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);

    const homonimas = ids.slice(1);
    expect(homonimas).toEqual([...homonimas].sort());
  });
});
