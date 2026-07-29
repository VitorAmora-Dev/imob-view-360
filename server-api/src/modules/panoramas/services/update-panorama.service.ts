import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { UpdatePanoramaDto } from '../dto/update-panorama.dto';

@Injectable()
export class UpdatePanoramaService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, dto: UpdatePanoramaDto, currentUser: JwtPayload) {
    const panorama = await this.prisma.panorama.findFirst({
      where: { id, virtualTour: { property: { agencyId: currentUser.agencyId } } },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    return this.prisma.panorama.update({
      where: { id },
      data: dto,
      select: { id: true, roomName: true, order: true, initialPanorama: true, virtualTourId: true },
    });
  }
}
