import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';

@Injectable()
export class GetThumbnailService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(virtualTourId: string): Promise<Buffer> {
    const panorama = await this.prisma.panorama.findFirst({
      where: { virtualTourId },
      orderBy: [{ initialPanorama: 'desc' }, { order: 'asc' }],
      select: { imageData: true },
    });
    if (!panorama) throw new NotFoundException('No thumbnail available');

    const base64 = panorama.imageData.includes(',')
      ? panorama.imageData.split(',')[1]
      : panorama.imageData;

    return Buffer.from(base64, 'base64');
  }
}
