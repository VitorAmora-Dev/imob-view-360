import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { RecordShareDto } from '../dto/record-share.dto';

@Injectable()
export class RecordShareService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(virtualTourId: string, dto: RecordShareDto) {
    const tour = await this.prisma.virtualTour.findUnique({ where: { id: virtualTourId } });
    if (!tour) throw new NotFoundException('Virtual tour not found');

    const visitor = await this.prisma.visitor.upsert({
      where: { sessionId: dto.sessionId },
      create: { sessionId: dto.sessionId },
      update: {},
    });

    return this.prisma.share.create({
      data: { virtualTourId, visitorId: visitor.id, channel: dto.channel },
      select: { id: true, sharedAt: true, channel: true },
    });
  }
}
