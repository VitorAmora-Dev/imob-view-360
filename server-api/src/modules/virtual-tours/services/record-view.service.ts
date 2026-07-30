import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { RecordViewDto } from '../dto/record-view.dto';

@Injectable()
export class RecordViewService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(virtualTourId: string, dto: RecordViewDto) {
    // Rota pública: mesmo critério de find e thumbnail. DRAFT e ARCHIVED caem
    // no mesmo 404 de tour inexistente, sem revelar que o id existe — e sem
    // deixar registrar view em tour não publicado.
    // findFirst (e não findUnique) porque o where combina id + status.
    const tour = await this.prisma.virtualTour.findFirst({
      where: { id: virtualTourId, status: 'PUBLISHED' },
    });
    if (!tour) throw new NotFoundException('Virtual tour not found');

    const visitor = await this.prisma.visitor.upsert({
      where: { sessionId: dto.sessionId },
      create: { sessionId: dto.sessionId },
      update: {},
    });

    return this.prisma.view.create({
      data: {
        virtualTourId,
        visitorId: visitor.id,
        durationSeconds: dto.durationSeconds,
        device: dto.device,
      },
      select: { id: true, viewedAt: true, durationSeconds: true, device: true },
    });
  }
}
