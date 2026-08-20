import { Injectable } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { ListPropertiesDto } from '../dto/list-properties.dto';

const PROPERTY_SELECT = {
  id: true,
  code: true,
  title: true,
  description: true,
  type: true,
  purpose: true,
  price: true,
  totalArea: true,
  status: true,
  agencyId: true,
  agentId: true,
  createdAt: true,
  updatedAt: true,
  address: true,
  virtualTour: { select: { id: true, status: true } },
} as const;

/**
 * Monta o filtro da listagem.
 *
 * Fora do `execute()` porque tem ramos que interagem entre si, e essa
 * interação é invisível quando ela está embutida no meio da consulta.
 */
export function montarWhere(
  query: ListPropertiesDto,
  agencyId: string,
): Prisma.PropertyWhereInput {
  const {
    type,
    purpose,
    status,
    city,
    state,
    district,
    priceMin,
    priceMax,
    search,
  } = query;

  return {
    agencyId,
    status,
    ...(type && { type }),
    ...(purpose && { purpose }),
    ...((priceMin !== undefined || priceMax !== undefined) && {
      price: {
        ...(priceMin !== undefined && { gte: priceMin }),
        ...(priceMax !== undefined && { lte: priceMax }),
      },
    }),
    ...((city || state || district) && {
      address: {
        ...(city && { city: { contains: city, mode: 'insensitive' } }),
        ...(state && { state }),
        ...(district && {
          district: { contains: district, mode: 'insensitive' },
        }),
      },
    }),
    ...(search && {
      OR: [
        { code: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { address: { street: { contains: search, mode: 'insensitive' } } },
        { address: { district: { contains: search, mode: 'insensitive' } } },
        { address: { city: { contains: search, mode: 'insensitive' } } },
        { address: { state: { contains: search, mode: 'insensitive' } } },
        { address: { zipCode: { contains: search, mode: 'insensitive' } } },
      ],
    }),
  };
}

@Injectable()
export class ListPropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListPropertiesDto, currentUser: JwtPayload) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const where = montarWhere(query, currentUser.agencyId);

    // O desempate por `id` é o que torna a paginação confiável. `createdAt` não
    // é único — dois imóveis cadastrados no mesmo instante (importação em lote,
    // ou dois cliques rápidos) ficam com ordem indefinida entre si, e o
    // Postgres não promete devolvê-los na mesma ordem em duas consultas. Com
    // `skip`/`take` por cima disso, um imóvel aparece em duas páginas e outro
    // não aparece em nenhuma.
    const [data, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        select: PROPERTY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.property.count({ where }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
