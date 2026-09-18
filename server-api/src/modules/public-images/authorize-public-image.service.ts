import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { chaveServida } from '../panoramas/panorama-image';
import { chaveDaCapa } from '../../shared/armazenamento/armazenamento.port';
import { panoramaDaChavePublica } from '../../shared/armazenamento/chave-publica';

/** Autoriza metadados em tempo real. Não lê bytes nem guarda decisões em cache. */
@Injectable()
export class AuthorizePublicImageService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(chave: string): Promise<void> {
    const id = panoramaDaChavePublica(chave);
    if (!id) throw new NotFoundException();
    const panorama = await this.prisma.panorama.findFirst({
      where: { id, virtualTour: { status: 'PUBLISHED' } },
      select: { imageKey: true, treatedImageKey: true, treatmentStatus: true },
    });
    const servida =
      panorama && chaveServida(panorama, panorama.treatmentStatus === 'DONE');
    if (!servida || (chave !== servida && chave !== chaveDaCapa(servida))) {
      throw new NotFoundException();
    }
  }
}
