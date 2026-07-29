import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';

@Injectable()
export class DeleteVirtualTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const tour = await this.prisma.virtualTour.findFirst({
      where: { id, property: { agencyId: currentUser.agencyId } },
    });
    if (!tour) throw new NotFoundException('Virtual tour not found');

    await this.prisma.virtualTour.delete({ where: { id } });
  }
}
