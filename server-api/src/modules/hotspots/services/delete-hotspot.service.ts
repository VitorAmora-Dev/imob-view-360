import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';

@Injectable()
export class DeleteHotspotService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const hotspot = await this.prisma.hotspot.findFirst({
      where: { id, origin: { virtualTour: { property: { agencyId: currentUser.agencyId } } } },
    });
    if (!hotspot) throw new NotFoundException('Hotspot not found');

    await this.prisma.hotspot.delete({ where: { id } });
  }
}
