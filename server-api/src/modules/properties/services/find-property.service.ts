import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';

const PROPERTY_DETAIL_SELECT = {
  id: true, code: true, title: true, description: true,
  type: true, purpose: true, price: true, totalArea: true,
  status: true, agencyId: true, agentId: true,
  createdAt: true, updatedAt: true, address: true,
  virtualTour: { select: { id: true, status: true } },
} as const;

@Injectable()
export class FindPropertyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const property = await this.prisma.property.findFirst({
      where: { id, agencyId: currentUser.agencyId },
      select: PROPERTY_DETAIL_SELECT,
    });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }
}
