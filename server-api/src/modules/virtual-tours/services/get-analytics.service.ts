import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';

@Injectable()
export class GetAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const tour = await this.prisma.virtualTour.findFirst({
      where: { id, property: { agencyId: currentUser.agencyId } },
    });
    if (!tour) throw new NotFoundException('Virtual tour not found');

    const [totalViews, totalShares, avgDuration] = await Promise.all([
      this.prisma.view.count({ where: { virtualTourId: id } }),
      this.prisma.share.count({ where: { virtualTourId: id } }),
      this.prisma.view.aggregate({
        where: { virtualTourId: id, durationSeconds: { not: null } },
        _avg: { durationSeconds: true },
      }),
    ]);

    return {
      totalViews,
      totalShares,
      avgDurationSeconds: avgDuration._avg.durationSeconds ?? 0,
    };
  }
}
