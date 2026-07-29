import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';

@Injectable()
export class FindVirtualTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string) {
    const tour = await this.prisma.virtualTour.findUnique({
      where: { id },
      select: {
        id: true, status: true, propertyId: true, createdAt: true, updatedAt: true,
        panoramas: {
          select: {
            id: true, roomName: true, imageData: true, order: true, initialPanorama: true,
            originHotspots: {
              select: { id: true, label: true, positionX: true, positionY: true, targetId: true },
            },
            measurements: {
              select: { id: true, description: true, value: true, unit: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!tour) throw new NotFoundException('Virtual tour not found');
    return tour;
  }
}
