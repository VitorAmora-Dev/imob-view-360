import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { CreatePanoramaDto } from '../dto/create-panorama.dto';
import { TreatPanoramaService } from './treat-panorama.service';

@Injectable()
export class CreatePanoramaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tratamento: TreatPanoramaService,
  ) {}

  async execute(dto: CreatePanoramaDto, currentUser: JwtPayload) {
    const { tourId, measurements, ...panoramaData } = dto;

    const tour = await this.prisma.virtualTour.findFirst({
      where: { id: tourId, property: { agencyId: currentUser.agencyId } },
    });
    if (!tour) throw new NotFoundException('Virtual tour not found');

    const criado = await this.prisma.$transaction(async (tx) => {
      const panorama = await tx.panorama.create({
        data: { ...panoramaData, virtualTourId: tourId },
      });
      if (measurements.length) {
        await tx.measurement.createMany({
          data: measurements.map((m) => ({ ...m, panoramaId: panorama.id })),
        });
      }
      return tx.panorama.findUnique({
        where: { id: panorama.id },
        select: {
          id: true, roomName: true, order: true, initialPanorama: true, virtualTourId: true,
          measurements: { select: { id: true, description: true, value: true, unit: true } },
        },
      });
    });

    // Fora da transação: o tratamento lê o panorama por outra conexão.
    this.tratamento.agendar(criado!.id);
    return criado;
  }
}
