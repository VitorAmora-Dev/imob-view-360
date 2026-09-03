import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JwtAccessStrategy,
  JwtPayload,
} from '../src/common/strategies/jwt-access.strategy';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { CreateVirtualTourService } from '../src/modules/virtual-tours/services/create-virtual-tour.service';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

/**
 * A claim de agência, e por que ela não pode faltar.
 *
 * Meia dúzia de consultas do produto escopam por `agencyId` vindo do token. O
 * Prisma APAGA silenciosamente uma condição cujo valor é `undefined`, então um
 * payload sem a claim não dá erro: ele transforma a consulta que via uma
 * imobiliária na consulta que vê todas.
 *
 * O primeiro caso aqui não testa código NOSSO — testa o ORM. É de propósito:
 * ele é a razão de a trava existir, e sem ele a trava parece paranóia. No dia
 * em que o Prisma passar a recusar `undefined` num `where`, este caso cai e
 * alguém descobre que a linha da estratégia virou redundante — o que é
 * exatamente a notícia que se quer receber.
 */

const asPrismaService = prisma as unknown as PrismaService;
const criarTour = new CreateVirtualTourService(asPrismaService);

// A estratégia só lê o segredo no construtor; nada aqui verifica assinatura.
const config = { get: () => 'segredo-de-teste' } as unknown as ConfigService<
  Record<string, unknown>,
  true
>;

describe('claim de agência no token de acesso', () => {
  let tenants: TwoTenants;
  let strategy: JwtAccessStrategy;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    strategy = new JwtAccessStrategy(asPrismaService, config);
  });

  it('O MOTIVO: com `agencyId` undefined o Prisma apaga o filtro e serve a outra imobiliária', async () => {
    const tourDeB = await criarTour.execute(
      { propertyId: tenants.b.propertyId, status: 'PUBLISHED', panoramas: [] },
      tenants.b.admin,
    );

    const semAClaim = undefined as unknown as string;
    const vazou = await prisma.virtualTour.findFirst({
      where: { id: tourDeB!.id, property: { agencyId: semAClaim } },
      select: { id: true },
    });

    // Nenhum erro, nenhum log: a condição simplesmente deixou de existir.
    expect(vazou?.id).toBe(tourDeB!.id);
  });

  it('e por isso a estratégia recusa o token antes de ele chegar lá', async () => {
    const payload = {
      sub: tenants.a.admin.sub,
      email: tenants.a.admin.email,
      role: tenants.a.admin.role,
    } as JwtPayload;

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('string vazia PASSA — é o usuário sem imobiliária, e ela filtra certo', async () => {
    // `User.agencyId` é nulável, e as emissões de token trocam null por `''`.
    // Diferente de `undefined`, `''` é valor de verdade: não casa com nenhuma
    // agência e rende 404 em tudo. Recusar aqui trocaria esse 404 por um 401
    // súbito para quem hoje só não enxerga nada.
    const payload: JwtPayload = { ...tenants.a.admin, agencyId: '' };

    await expect(strategy.validate(payload)).resolves.toEqual(payload);

    const nada = await prisma.virtualTour.findFirst({
      where: { property: { agencyId: '' } },
      select: { id: true },
    });
    expect(nada).toBeNull();
  });

  it('o token completo passa', async () => {
    await expect(strategy.validate(tenants.a.admin)).resolves.toEqual(
      tenants.a.admin,
    );
  });
});
