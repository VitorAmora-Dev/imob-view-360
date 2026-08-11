import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { TreatPanoramaService } from '../../panoramas/services/treat-panorama.service';

/**
 * Enfileira a montagem por IA de todos os panoramas de um tour, e informa o
 * andamento.
 *
 * Existe separado do gatilho automático porque o cliente precisa de duas coisas
 * que o `agendar` sozinho não dá: um momento definido para começar — depois de
 * as fotos originais terem subido, sem as quais o modelo não tem referência — e
 * um número para mostrar na tela de montagem enquanto o corretor espera.
 */

export interface AndamentoDaMontagem {
  total: number;
  prontos: number;
  falhas: number;
  dispensados: number;
  terminado: boolean;
}

@Injectable()
export class MontarTourService {
  private readonly logger = new Logger(MontarTourService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tratamento: TreatPanoramaService,
  ) {}

  /**
   * Dispara e volta na hora. O corretor acompanha por `andamento`; segurar a
   * resposta por vários minutos morreria em timeout de proxy antes de terminar.
   */
  async iniciar(tourId: string, user: JwtPayload): Promise<AndamentoDaMontagem> {
    const panoramas = await this.panoramasDoTour(tourId, user);

    if (!this.tratamento.habilitado()) return this.andamento(tourId, user);

    // Já montado ou já em curso não volta para a fila: um segundo clique não
    // pode custar outra rodada de API.
    const alvos = panoramas
      .filter((p) => p.treatmentStatus !== 'DONE' && p.treatmentStatus !== 'PROCESSING')
      .map((p) => p.id);

    // PROCESSING é gravado AQUI, e aguardado, antes de qualquer coisa entrar na
    // fila. Sem isso existe uma corrida real: `agendar` dispara `execute`, que
    // pode marcar SKIPPED antes de este método ler o andamento — e o cliente,
    // vendo todos os panoramas em estado terminal, navegava para o tour cinco
    // segundos depois de clicar, com a montagem ainda por começar. Era esse o
    // "não foi possível carregar o tour virtual".
    if (alvos.length > 0) {
      await this.prisma.panorama.updateMany({
        where: { id: { in: alvos } },
        data: { treatmentStatus: 'PROCESSING', treatmentError: null },
      });
      this.logger.log(`${tourId}: ${alvos.length} panorama(s) enfileirado(s) para montagem.`);
    }

    for (const id of alvos) this.tratamento.agendar(id);

    return this.andamento(tourId, user);
  }

  async andamento(tourId: string, user: JwtPayload): Promise<AndamentoDaMontagem> {
    const panoramas = await this.panoramasDoTour(tourId, user);

    const conta = (status: string) => panoramas.filter((p) => p.treatmentStatus === status).length;
    const prontos = conta('DONE');
    const falhas = conta('FAILED');
    const dispensados = conta('SKIPPED');

    return {
      total: panoramas.length,
      prontos,
      falhas,
      dispensados,
      // Falha e dispensa também encerram: o tour abre com o panorama original,
      // e prender o corretor numa tela de espera por algo que não vai mudar
      // seria pior que mostrar o resultado que existe.
      terminado: prontos + falhas + dispensados >= panoramas.length,
    };
  }

  /** Escopo por agência, como as demais rotas autenticadas do módulo. */
  private async panoramasDoTour(tourId: string, user: JwtPayload) {
    const tour = await this.prisma.virtualTour.findFirst({
      where: { id: tourId, property: { agencyId: user.agencyId } },
      select: {
        panoramas: {
          select: { id: true, treatmentStatus: true },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!tour) throw new NotFoundException('Virtual tour not found');
    return tour.panoramas;
  }
}
