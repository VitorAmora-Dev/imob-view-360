import { JwtPayload } from '../src/common/strategies/jwt-access.strategy';
import { prisma } from './setup/prisma';

/**
 * Duas agências completas e simétricas. A simetria é proposital: qualquer
 * asserção de isolamento vale nos dois sentidos, então um teste que passe só
 * porque a agência A é "maior" que a B fica evidente.
 */
export interface TenantFixture {
  agencyId: string;
  admin: JwtPayload;
  propertyId: string;
  propertyCode: string;
}

export interface TwoTenants {
  a: TenantFixture;
  b: TenantFixture;
}

export async function seedTwoTenants(): Promise<TwoTenants> {
  return {
    a: await seedTenant('alfa'),
    b: await seedTenant('beta'),
  };
}

async function seedTenant(slug: string): Promise<TenantFixture> {
  const agency = await prisma.agency.create({
    data: { name: `Imobiliária ${slug}`, taxId: `tax-${slug}` },
  });

  const admin = await prisma.user.create({
    data: {
      name: `Admin ${slug}`,
      email: `admin@${slug}.test`,
      // Hash falso: nenhum teste deste arquivo faz login, e gerar bcrypt de
      // verdade em cada fixture custaria ~100ms por usuário sem nada em troca.
      password: `nao-e-um-hash-${slug}`,
      type: 'ADMINISTRATOR',
      agencyId: agency.id,
    },
  });

  const property = await prisma.property.create({
    data: {
      code: `COD-${slug}`,
      title: `Imóvel da ${slug}`,
      type: 'HOUSE',
      purpose: 'SALE',
      price: 500000,
      agencyId: agency.id,
      agentId: admin.id,
      address: {
        create: {
          street: `Rua ${slug}`,
          district: 'Centro',
          city: 'Porto Alegre',
          state: 'RS',
          zipCode: '90000-000',
        },
      },
    },
  });

  return {
    agencyId: agency.id,
    admin: {
      sub: admin.id,
      email: admin.email,
      role: admin.type,
      agencyId: agency.id,
    },
    propertyId: property.id,
    propertyCode: property.code,
  };
}
