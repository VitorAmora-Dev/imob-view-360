import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';

@Injectable()
export class DeletePanoramaService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    // `select` do id: é uma checagem de dono, e sem ele o Prisma traz a linha
    // inteira — as duas colunas base64, dezenas de MB, para avaliar um `if`.
    const panorama = await this.prisma.panorama.findFirst({
      where: { id, virtualTour: { property: { agencyId: currentUser.agencyId } } },
      select: { id: true },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    await this.prisma.panorama.delete({ where: { id } });
  }
}
