import { Injectable } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';

export interface RascunhoResumo {
  id: string;
  propertyId: string;
  updatedAt: Date;
  ambientes: number;
  /** Primeiro cômodo, para a miniatura. Nulo enquanto nenhum terminou. */
  capaPanoramaId: string | null;
}

/**
 * As capturas em andamento da imobiliária de quem pediu.
 *
 * Existe porque a listagem de imóveis esconde DRAFT de propósito — imóvel de
 * rascunho não tem título nem endereço e apareceria no lugar mais visível do
 * sistema como uma linha vazia. Esconder ali é certo; o que faltava era um
 * lugar onde o rascunho fosse o assunto, e não ruído.
 */
@Injectable()
export class ListDraftToursService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(currentUser: JwtPayload): Promise<RascunhoResumo[]> {
    const rascunhos = await this.prisma.virtualTour.findMany({
      where: {
        status: 'DRAFT',
        property: { agencyId: currentUser.agencyId },
      },
      // Mais recente primeiro: quem tem dois rascunhos quase sempre quer o
      // último. `updatedAt` e não `createdAt` porque uma captura retomada
      // ontem é mais relevante que uma começada hoje de manhã e abandonada.
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        propertyId: true,
        updatedAt: true,
        _count: { select: { panoramas: true } },
        // Nenhuma coluna de imagem: a miniatura vem por URL, do
        // `/panoramas/:id/preview?w=320`. Trazer base64 aqui carregaria
        // dezenas de MB para desenhar um card de 320px.
        panoramas: {
          orderBy: { order: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
    });

    return rascunhos.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      updatedAt: r.updatedAt,
      ambientes: r._count.panoramas,
      capaPanoramaId: r.panoramas[0]?.id ?? null,
    }));
  }
}
