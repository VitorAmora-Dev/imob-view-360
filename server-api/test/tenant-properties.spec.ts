import { NotFoundException } from '@nestjs/common';
import { DeletePropertyService } from '../src/modules/properties/services/delete-property.service';
import { FindPropertyService } from '../src/modules/properties/services/find-property.service';
import { ListPropertiesService } from '../src/modules/properties/services/list-properties.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

// Os services recebem PrismaService por injeção, mas só usam os métodos de
// query — que o cliente de teste também tem. Passar o cliente de teste direto
// evita subir o AppModule inteiro (e o ConfigModule, e as estratégias JWT) para
// exercitar três consultas.
const asPrismaService = prisma as unknown as PrismaService;

const find = new FindPropertyService(asPrismaService);
const list = new ListPropertiesService(asPrismaService);
const remove = new DeletePropertyService(asPrismaService);

const LIST_QUERY = { page: 1, limit: 20, status: 'AVAILABLE' as const };

/**
 * Devolve a exceção de uma promise que deve rejeitar. Falha explicitamente se
 * ela resolver — sem isso, um serviço que parasse de lançar passaria batido.
 */
async function capturarErro(
  promise: Promise<unknown>,
): Promise<NotFoundException> {
  try {
    await promise;
  } catch (erro) {
    return erro as NotFoundException;
  }
  throw new Error('esperava que a promise rejeitasse, mas ela resolveu');
}

describe('isolamento de tenant — properties', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  describe('find', () => {
    it('encontra o imóvel da própria agência', async () => {
      const property = await find.execute(
        tenants.a.propertyId,
        tenants.a.admin,
      );

      expect(property.id).toBe(tenants.a.propertyId);
      expect(property.agencyId).toBe(tenants.a.agencyId);
    });

    it('não encontra o imóvel de outra agência', async () => {
      // O id existe e é válido; o que muda é só a agência de quem pergunta.
      await expect(
        find.execute(tenants.b.propertyId, tenants.a.admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('trata imóvel de outra agência igual a imóvel inexistente', async () => {
      // 404 e não 403: um 403 confirmaria que o id existe.
      const alheio = await capturarErro(
        find.execute(tenants.b.propertyId, tenants.a.admin),
      );
      const inexistente = await capturarErro(
        find.execute('11111111-1111-4111-8111-111111111111', tenants.a.admin),
      );

      expect(alheio.getStatus()).toBe(inexistente.getStatus());
      expect(alheio.message).toBe(inexistente.message);
    });
  });

  describe('list', () => {
    it('lista apenas os imóveis da própria agência', async () => {
      const result = await list.execute(LIST_QUERY, tenants.a.admin);

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(tenants.a.propertyId);
    });

    it('não vaza imóvel de outra agência nem com filtro que casaria', async () => {
      // Cidade e estado são iguais nas duas fixtures de propósito: sem o escopo
      // por agência, este filtro devolveria os dois imóveis.
      const result = await list.execute(
        { ...LIST_QUERY, city: 'Porto Alegre', state: 'RS' },
        tenants.a.admin,
      );

      expect(result.total).toBe(1);
      expect(result.data.map((p) => p.agencyId)).toEqual([tenants.a.agencyId]);
    });

    it('não vaza imóvel de outra agência via busca textual', async () => {
      const result = await list.execute(
        { ...LIST_QUERY, search: 'Imóvel' },
        tenants.a.admin,
      );

      expect(result.data.map((p) => p.code)).toEqual([tenants.a.propertyCode]);
    });
  });

  describe('delete', () => {
    it('apaga o imóvel da própria agência', async () => {
      await remove.execute(tenants.a.propertyId, tenants.a.admin);

      const restante = await prisma.property.findUnique({
        where: { id: tenants.a.propertyId },
      });
      expect(restante).toBeNull();
    });

    it('não apaga o imóvel de outra agência', async () => {
      await expect(
        remove.execute(tenants.b.propertyId, tenants.a.admin),
      ).rejects.toBeInstanceOf(NotFoundException);

      // A asserção que importa: o registro continua lá. Só verificar que houve
      // exceção não provaria que nada foi apagado antes dela.
      const intacto = await prisma.property.findUnique({
        where: { id: tenants.b.propertyId },
      });
      expect(intacto).not.toBeNull();
      expect(intacto?.agencyId).toBe(tenants.b.agencyId);
    });
  });

  describe('guarda do harness', () => {
    it('o truncate roda entre os testes', async () => {
      // Se o beforeEach global falhasse, as fixtures de todos os testes
      // anteriores estariam acumuladas aqui.
      const agencias = await prisma.agency.count();
      expect(agencias).toBe(2);
    });
  });
});
