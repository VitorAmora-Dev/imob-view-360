import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { SELECAO_PARA_EDICAO, formatarParaEdicao } from './tour-para-edicao';

/**
 * O tour para quem vai EDITÁ-LO — publicado inclusive.
 *
 * DONO: Frente C (SPRINT-4-TOUR-VIEWER.md, TV-10).
 *
 * POR QUE NÃO BASTOU AFROUXAR O `/rascunho`
 *
 * O `FindDraftTourService` recusa tour publicado de propósito, e o comentário
 * dele explica: o wizard aberto por aquela rota oferece "Descartar captura",
 * que apaga o `Property` em cascata. Servir um tour no ar por ali punha esse
 * botão em cima de panoramas, hotspots, tratamento de IA já pago e o link
 * público que o corretor mandou para o cliente.
 *
 * Trocar `status: 'DRAFT'` por `status: { in: [...] }` naquele serviço custaria
 * uma linha e destruiria a única garantia que ele dá. A garantia não é sobre
 * ler: é sobre o que o cliente pode fazer com o que leu. Enquanto forem duas
 * rotas, "isto é descartável" continua sendo uma afirmação do SERVIDOR, e não
 * uma convenção que o wizard precisa lembrar de respeitar.
 *
 * O que muda no cliente: o wizard aberto por aqui entra em modo de edição, sem
 * descarte, e a ação final é "Salvar alterações" — nunca "Publicar", porque o
 * tour já está publicado (TV-11).
 *
 * `ARCHIVED` fica de fora das duas: tour arquivado volta ao ar pelo caminho de
 * arquivamento, não por uma edição que o republicaria sem querer.
 */
@Injectable()
export class FindEditableTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const tour = await this.prisma.virtualTour.findFirst({
      where: {
        id,
        status: { in: ['DRAFT', 'PUBLISHED'] },
        // A autorização é esta linha. Sem ela, um uuid vazado abriria o tour de
        // qualquer imobiliária para edição — que é bem pior que lê-lo.
        property: { agencyId: currentUser.agencyId },
      },
      select: SELECAO_PARA_EDICAO,
    });

    // 404 e não 403: 403 confirmaria que o id existe em outra imobiliária.
    if (!tour) throw new NotFoundException('Editable tour not found');

    return formatarParaEdicao(tour);
  }
}
