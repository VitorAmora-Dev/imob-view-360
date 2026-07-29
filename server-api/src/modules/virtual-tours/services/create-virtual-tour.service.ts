import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { CreateVirtualTourDto } from '../dto/create-virtual-tour.dto';

@Injectable()
export class CreateVirtualTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(dto: CreateVirtualTourDto, currentUser: JwtPayload) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, agencyId: currentUser.agencyId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const existing = await this.prisma.virtualTour.findUnique({
      where: { propertyId: dto.propertyId },
    });
    if (existing)
      throw new ConflictException(
        'Virtual tour already exists for this property',
      );

    return this.prisma.$transaction(async (tx) => {
      const tour = await tx.virtualTour.create({
        data: { propertyId: dto.propertyId, status: 'PUBLISHED' },
      });

      const tempIdMap = new Map<string, string>();

      for (const p of dto.panoramas) {
        const panorama = await tx.panorama.create({
          data: {
            roomName: p.roomName,
            imageData: p.imageData,
            order: p.order,
            initialPanorama: p.initialPanorama,
            virtualTourId: tour.id,
          },
        });
        tempIdMap.set(p.tempId, panorama.id);

        if (p.measurements.length) {
          await tx.measurement.createMany({
            data: p.measurements.map((m) => ({
              ...m,
              panoramaId: panorama.id,
            })),
          });
        }
      }

      for (const p of dto.panoramas) {
        if (!p.hotspots.length) continue;
        const originId = tempIdMap.get(p.tempId)!;
        for (const h of p.hotspots) {
          const targetId = tempIdMap.get(h.targetTempId);
          if (!targetId)
            throw new BadRequestException(
              `targetTempId "${h.targetTempId}" not found in panoramas list`,
            );
          await tx.hotspot.create({
            data: {
              label: h.label,
              positionX: h.positionX,
              positionY: h.positionY,
              originId,
              targetId,
            },
          });
        }
      }

      return tx.virtualTour.findUnique({
        where: { id: tour.id },
        select: {
          id: true,
          status: true,
          propertyId: true,
          createdAt: true,
          updatedAt: true,
          panoramas: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              roomName: true,
              order: true,
              initialPanorama: true,
              measurements: {
                select: {
                  id: true,
                  description: true,
                  value: true,
                  unit: true,
                },
              },
              originHotspots: {
                select: {
                  id: true,
                  label: true,
                  positionX: true,
                  positionY: true,
                  targetId: true,
                },
              },
            },
          },
        },
      });
    });
  }
}
