import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { UpdateVirtualTourDto } from '../dto/update-virtual-tour.dto';

@Injectable()
export class UpdateVirtualTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, dto: UpdateVirtualTourDto, currentUser: JwtPayload) {
    const tour = await this.prisma.virtualTour.findFirst({
      where: { id, property: { agencyId: currentUser.agencyId } },
    });
    if (!tour) throw new NotFoundException('Virtual tour not found');

    return this.prisma.virtualTour.update({
      where: { id },
      data: { status: dto.status },
      select: { id: true, status: true, propertyId: true, updatedAt: true },
    });
  }
}
