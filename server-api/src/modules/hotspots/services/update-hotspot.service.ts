import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { UpdateHotspotDto } from '../dto/update-hotspot.dto';

@Injectable()
export class UpdateHotspotService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, dto: UpdateHotspotDto, currentUser: JwtPayload) {
    const hotspot = await this.prisma.hotspot.findFirst({
      where: { id, origin: { virtualTour: { property: { agencyId: currentUser.agencyId } } } },
      select: { id: true, origin: { select: { virtualTourId: true } } },
    });
    if (!hotspot) throw new NotFoundException('Hotspot not found');

    // O where acima prova a posse do hotspot, não a do destino. Sem esta
    // checagem o targetId do dto entra direto no update, e um hotspot pode
    // passar a apontar para panorama de outra agência — mesma validação que o
    // create já faz, aqui só quando o dto traz targetId, porque o update é
    // parcial e um label sozinho não deve pagar uma consulta.
    if (dto.targetId) {
      const target = await this.prisma.panorama.findFirst({
        where: { id: dto.targetId, virtualTourId: hotspot.origin.virtualTourId },
        select: { id: true },
      });
      if (!target) throw new BadRequestException('Target panorama does not belong to the same tour');
    }

    return this.prisma.hotspot.update({
      where: { id },
      data: dto,
      select: { id: true, label: true, positionX: true, positionY: true, originId: true, targetId: true },
    });
  }
}
