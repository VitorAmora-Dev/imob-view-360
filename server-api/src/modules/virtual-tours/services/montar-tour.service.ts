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

    // Sem chave nada vai ser montado, e isso precisa aparecer como estado
    // terminal AGORA. Só devolver o andamento deixava tudo em PENDING, e
    // `terminado` nunca ficava true: o corretor via a tela de montagem com um
    // "não feche o app" por dez minutos inteiros, em toda captura, para uma
    // etapa que jamais começaria.
    if (!this.tratamento.habilitado()) {
      await this.dispensar(
        panoramas.filter((p) => p.treatmentStatus !== 'DONE').map((p) => p.id),
        'montagem por IA desabilitada no servidor',
      );
      return this.andamento(tourId, user);
    }

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

  /**
   * Encerra em SKIPPED o que não vai ser montado. É o que faz `terminado` virar
   * true e liberar a tela de espera — o tour abre com os panoramas originais,
   * que é exatamente o que ele teria sem esta etapa.
   */
  private async dispensar(ids: string[], motivo: string): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.panorama.updateMany({
      where: { id: { in: ids } },
      data: { treatmentStatus: 'SKIPPED', treatmentError: motivo, treatedAt: new Date() },
    });
    this.logger.warn(`${ids.length} panorama(s) dispensado(s): ${motivo}.`);
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
