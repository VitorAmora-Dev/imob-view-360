import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';

@Injectable()
export class DeletePropertyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const property = await this.prisma.property.findFirst({
      where: { id, agencyId: currentUser.agencyId },
    });
    if (!property) throw new NotFoundException('Property not found');

    await this.prisma.property.delete({ where: { id } });
  }
}
