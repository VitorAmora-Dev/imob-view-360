import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { UpdateHotspotDto } from '../dto/update-hotspot.dto';

@Injectable()
export class UpdateHotspotService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, dto: UpdateHotspotDto, currentUser: JwtPayload) {
    const hotspot = await this.prisma.hotspot.findFirst({
      where: { id, origin: { virtualTour: { property: { agencyId: currentUser.agencyId } } } },
    });
    if (!hotspot) throw new NotFoundException('Hotspot not found');

    return this.prisma.hotspot.update({
      where: { id },
      data: dto,
      select: { id: true, label: true, positionX: true, positionY: true, originId: true, targetId: true },
    });
  }
}
