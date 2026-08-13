import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { Prisma } from 'generated/prisma/client';
import { UpdatePanoramaDto } from '../dto/update-panorama.dto';

/**
 * O tratamento é derivado de `imageData`: quando a foto muda, o que a IA montou
 * a partir da anterior deixa de descrever este cômodo.
 *
 * Sem isso o bug era silencioso e permanente — `imagemServivel` prefere a coluna
 * tratada, então refotografar a sala continuaria mostrando o render do cômodo
 * antigo, para sempre, sem nada na interface denunciando. Voltar a PENDING é o
 * bastante: o novo panorama é servido na hora, e o `--pendentes` do CLI o
 * reencontra para montar de novo.
 */
const SEM_TRATAMENTO = {
  treatedImageData: null,
  treatmentStatus: 'PENDING',
  treatmentError: null,
  // `DbNull`, não `null` nem `undefined`: em coluna Json o Prisma trata
  // `undefined` como "não mexer", o que deixaria a meta da montagem antiga
  // descrevendo uma foto que não existe mais.
  treatmentMeta: Prisma.DbNull,
  treatedAt: null,
} as const;

@Injectable()
export class UpdatePanoramaService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, dto: UpdatePanoramaDto, currentUser: JwtPayload) {
    const panorama = await this.prisma.panorama.findFirst({
      where: { id, virtualTour: { property: { agencyId: currentUser.agencyId } } },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    return this.prisma.panorama.update({
      where: { id },
      data: { ...dto, ...(dto.imageData ? SEM_TRATAMENTO : {}) },
      select: { id: true, roomName: true, order: true, initialPanorama: true, virtualTourId: true },
    });
  }
}
