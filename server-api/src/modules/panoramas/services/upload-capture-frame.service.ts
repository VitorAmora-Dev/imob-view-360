import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { UploadCaptureFrameDto } from '../dto/upload-capture-frame.dto';

@Injectable()
export class UploadCaptureFrameService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    panoramaId: string,
    dto: UploadCaptureFrameDto,
    currentUser: JwtPayload,
  ) {
    const panorama = await this.prisma.panorama.findFirst({
      where: {
        id: panoramaId,
        virtualTour: { property: { agencyId: currentUser.agencyId } },
      },
      select: { id: true },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    const { quaternion, ...frame } = dto;
    const data = {
      ...frame,
      qx: quaternion.x,
      qy: quaternion.y,
      qz: quaternion.z,
      qw: quaternion.w,
    };

    // O envio acontece em segundo plano, foto a foto, então uma falha de rede
    // é reenviada. Gravar por (panorama, índice) faz o reenvio repor a mesma
    // foto em vez de acumular cópias.
    const saved = await this.prisma.captureFrame.upsert({
      where: { panoramaId_index: { panoramaId, index: dto.index } },
      create: { ...data, panoramaId },
      update: data,
      select: { id: true, index: true },
    });
    return saved;
  }
}
