import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { Env } from '../../config/env.schema';
import { ArmazenamentoLocal } from './armazenamento-local';
import { ArmazenamentoR2 } from './armazenamento-r2';
import { ARMAZENAMENTO, ArmazenamentoDeImagens } from './armazenamento.port';

/**
 * Escolhe onde as fotos moram, uma vez, no boot.
 *
 * `@Global` pelo mesmo motivo do `PrismaModule`: a porta é lida em três
 * módulos (panoramas, virtual-tours e os scripts), e importá-la em cada um
 * seria repetir a fiação sem ganhar nada.
 *
 * A escolha é por `STORAGE_ENDPOINT` e não por `NODE_ENV`: é o que permite
 * apontar um ambiente de desenvolvimento para um balde de verdade sem mentir
 * sobre o ambiente, e é o que mantém a suíte no disco sem precisar saber que é
 * uma suíte.
 */
@Global()
@Module({
  providers: [
    {
      provide: ARMAZENAMENTO,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<Env, true>,
      ): ArmazenamentoDeImagens => {
        const endpoint = config.get('STORAGE_ENDPOINT', { infer: true });
        const logger = new Logger('Armazenamento');

        if (!endpoint) {
          const raiz = resolve(
            config.get('STORAGE_LOCAL_DIR', { infer: true }),
          );
          logger.log(`Fotos em disco, em ${raiz}. Sem STORAGE_ENDPOINT.`);
          return new ArmazenamentoLocal(raiz);
        }

        const urlPublica = config.get('STORAGE_PUBLIC_URL', { infer: true });
        logger.log(
          urlPublica
            ? `Fotos na R2, servidas por ${urlPublica}.`
            : 'Fotos na R2, servidas pela API (STORAGE_PUBLIC_URL vazia).',
        );

        return new ArmazenamentoR2({
          endpoint,
          bucket: config.get('STORAGE_BUCKET', { infer: true }),
          chaveId: config.get('STORAGE_ACCESS_KEY_ID', { infer: true }),
          chaveSecreta: config.get('STORAGE_SECRET_ACCESS_KEY', {
            infer: true,
          }),
          urlPublica: urlPublica || null,
        });
      },
    },
  ],
  exports: [ARMAZENAMENTO],
})
export class ArmazenamentoModule {}
