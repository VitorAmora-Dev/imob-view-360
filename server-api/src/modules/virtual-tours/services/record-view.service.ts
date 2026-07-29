import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { RecordViewDto } from '../dto/record-view.dto';

@Injectable()
export class RecordViewService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(virtualTourId: string, dto: RecordViewDto) {
    const tour = await this.prisma.virtualTour.findUnique({ where: { id: virtualTourId } });
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
