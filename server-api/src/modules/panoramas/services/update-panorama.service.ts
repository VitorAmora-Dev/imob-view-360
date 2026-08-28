import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { Prisma } from 'generated/prisma/client';
import { UpdatePanoramaDto } from '../dto/update-panorama.dto';

/**
 * O tratamento é derivado de `imageData`: quando a foto muda, o que a IA montou
 * a partir da anterior deixa de descrever este cômodo.
 *
 * Sem isso o bug era silencioso e permanente — o `PanoramaImageReader` prefere a
 * coluna tratada, então refotografar a sala continuaria mostrando o render do
 * cômodo antigo, para sempre, sem nada na interface denunciando. Voltar a
 * PENDING é o bastante: o novo panorama é servido na hora, e o `--pendentes` do
 * CLI o reencontra para montar de novo.
 *
 * O `treatmentStatus` daqui é também o discriminador que o leitor usa para
 * saber qual coluna pedir ao banco — mexer num sem o outro faz o tour servir a
 * imagem errada.
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
      select: { id: true, virtualTourId: true },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    return this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.panorama.update({
        where: { id },
        data: { ...dto, ...(dto.imageData ? SEM_TRATAMENTO : {}) },
        select: { id: true, roomName: true, order: true, initialPanorama: true, virtualTourId: true },
      });
      // O mesmo toque de `CreatePanoramaService`, e pela mesma razão: renomear
      // e reordenar cômodos é o que o salvamento de rascunho mais faz, e sem
      // isto meia hora de edição não moveria o relógio do tour um milissegundo
      // — a faixa da home mostraria a hora em que a captura COMEÇOU, e o
      // sweeper contaria a idade a partir dali.
      // Hora explícita: ver o mesmo toque em `CreatePanoramaService` — o
      // Prisma não preenche `@updatedAt` quando o `data` está vazio.
      await tx.virtualTour.update({
        where: { id: panorama.virtualTourId },
        data: { updatedAt: new Date() },
      });
      return atualizado;
    });
  }
}
