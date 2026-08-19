import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { CreateHotspotDto } from '../dto/create-hotspot.dto';

@Injectable()
export class CreateHotspotService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(dto: CreateHotspotDto, currentUser: JwtPayload) {
    const { panoramaId, ...hotspotData } = dto;

    const panorama = await this.prisma.panorama.findFirst({
      where: { id: panoramaId, virtualTour: { property: { agencyId: currentUser.agencyId } } },
      select: { id: true, virtualTourId: true },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    const target = await this.prisma.panorama.findFirst({
      where: { id: hotspotData.targetId, virtualTourId: panorama.virtualTourId },
      // Só a existência importa aqui — o `select` da consulta de cima já estava
      // certo, e esta ficou para trás puxando as duas colunas base64.
      select: { id: true },
    });
    if (!target) throw new BadRequestException('Target panorama does not belong to the same tour');

    return this.prisma.hotspot.create({
      data: { ...hotspotData, originId: panoramaId },
      select: { id: true, label: true, positionX: true, positionY: true, originId: true, targetId: true },
    });
  }
}
