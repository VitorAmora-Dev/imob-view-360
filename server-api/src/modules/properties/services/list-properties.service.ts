import { Injectable } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { ListPropertiesDto } from '../dto/list-properties.dto';

const PROPERTY_SELECT = {
  id: true, code: true, title: true, description: true,
  type: true, purpose: true, price: true, totalArea: true,
  status: true, agencyId: true, agentId: true,
  createdAt: true, updatedAt: true, address: true,
  virtualTour: { select: { id: true, status: true } },
} as const;

@Injectable()
export class ListPropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListPropertiesDto, currentUser: JwtPayload) {
    const { page, limit, type, purpose, status, city, state, district, priceMin, priceMax, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PropertyWhereInput = {
      agencyId: currentUser.agencyId,
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
          ...(district && { district: { contains: district, mode: 'insensitive' } }),
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

    const [data, total] = await Promise.all([
      this.prisma.property.findMany({ where, skip, take: limit, select: PROPERTY_SELECT, orderBy: { createdAt: 'desc' } }),
      this.prisma.property.count({ where }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
