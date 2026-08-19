import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'generated/prisma/client';

/**
 * Acima disto, a consulta vira uma linha de log. O número é alto de propósito:
 * este backend grava panorâmicas de dezenas de MB, e um limiar de 100ms
 * encheria o log com escritas que são lentas por natureza. O que se quer
 * enxergar é a consulta que ficou lenta sem ninguém perceber.
 */
const LIMIAR_DE_QUERY_LENTA_MS = 500;

/** Log é para diagnóstico, não para reconstruir a query. */
const MAX_CARACTERES_DE_SQL = 300;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL ?? '',
      // `pg` espera indefinidamente por uma conexão livre quando o pool acaba.
      // Com a transação de criar tour segurando a dela por até 60s, um punhado
      // de uploads simultâneos fazia as requisições seguintes pendurarem sem
      // resposta e sem erro. Dez segundos e falha: pendurado é pior que
      // recusado, porque ninguém sabe se ainda vai voltar.
      connectionTimeoutMillis: 10_000,
      // Explícito porque era invisível: este é o padrão do `pg`, e com o driver
      // adapter os parâmetros `connection_limit` da URL do Prisma não valem.
      // Quem for aumentar precisa olhar o `max_connections` do Postgres antes.
      max: 10,
    });

    super({
      adapter,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });

    this.registrarQueryLenta();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Sem isto não havia como ver query lenta nenhuma: o cliente subia sem
   * nenhuma configuração de `log`, então nenhum trabalho de otimização era
   * verificável depois de escrito.
   *
   * O evento traz `params` além do SQL, e ele NÃO é logado. Os parâmetros deste
   * sistema incluem a base64 das panorâmicas — uma única linha de log teria
   * dezenas de MB, e a foto de um imóvel acabaria em texto no arquivo de log.
   */
  private registrarQueryLenta(): void {
    this.$on('query', (evento) => {
      if (evento.duration < LIMIAR_DE_QUERY_LENTA_MS) return;

      const sql = evento.query
        .replace(/\s+/g, ' ')
        .slice(0, MAX_CARACTERES_DE_SQL);
      this.logger.warn(`${evento.duration}ms  ${sql}`);
    });
  }
}
