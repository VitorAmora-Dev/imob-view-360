import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { base64Puro, imagemServivel } from '../../panoramas/panorama-image';

@Injectable()
export class GetThumbnailService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(virtualTourId: string): Promise<Buffer> {
    const panorama = await this.prisma.panorama.findFirst({
      // Rota pública: mesmo critério do find — thumbnail só de tour publicado.
      where: { virtualTourId, virtualTour: { status: 'PUBLISHED' } },
      orderBy: [{ initialPanorama: 'desc' }, { order: 'asc' }],
      select: { imageData: true, treatedImageData: true },
    });
    if (!panorama) throw new NotFoundException('No thumbnail available');

    // A capa é a primeira coisa que o comprador vê; se há versão tratada, é ela
    // que vai.
    return Buffer.from(base64Puro(imagemServivel(panorama)), 'base64');
  }
}
