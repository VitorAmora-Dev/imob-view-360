import 'dotenv/config';
import compression from 'compression';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import {
  bodyLimitMiddleware,
  urlencodedMiddleware,
} from './config/body-limit.config';
import { Env } from './config/env.schema';
import {
  corsOptions,
  helmetMiddleware,
  parseOriginList,
  swaggerCspMiddleware,
} from './config/security.config';
import { alocadorSemAjuste } from './shared/memoria';

/**
 * O sharp guarda 50 MB de operações em cache por padrão, e essa memória é
 * residente. Numa instância de 512 MB é um décimo da caixa gasto para acelerar
 * repetições que a rota de imagem já resolve com o cache de miniatura dela.
 *
 * Fica aqui, e não junto do código de imagem, porque o alvo é o PROCESSO da
 * API: o CLI `yarn tratar-panorama` roda numa máquina com memória de sobra e
 * não tem por que abrir mão do cache.
 */
sharp.cache(false);

/**
 * O aviso do alocador sai antes de tudo: se ele estiver faltando, a instância
 * vai morrer no meio de uma captura e a linha precisa estar no topo do log
 * daquele processo, não perdida no meio das rotas mapeadas.
 */
const semAjuste = alocadorSemAjuste();
if (semAjuste) new Logger('Memoria').warn(semAjuste);

async function bootstrap() {
  // bodyParser: false para que os parsers abaixo rodem antes do roteador do Nest
  // e o limite alto valha só nas rotas de imagem — ver body-limit.config.ts
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const env: ConfigService<Env, true> = app.get(ConfigService);

  // Compressão antes dos parsers de corpo porque ela age na SAÍDA: registrar
  // depois funcionaria igual, mas fica mais fácil de ler junto do resto do
  // pipeline de resposta.
  //
  // O `compression` decide por `Content-Type`, e `image/jpeg` não está na lista
  // de compressíveis — então a rota de imagem não paga CPU para reembalar bytes
  // que já saem comprimidos. Quem ganha é o JSON.
  app.use(compression());

  app.use(bodyLimitMiddleware());
  app.use(urlencodedMiddleware());
  app.use(
    helmetMiddleware(
      parseOriginList(env.get('CSP_EXTRA_ORIGINS', { infer: true })),
    ),
  );

  // Allowlist vazia = nenhuma origem cross-origin, que é o comportamento de dev.
  const allowedOrigins = parseOriginList(
    env.get('CORS_ORIGINS', { infer: true }),
  );
  if (allowedOrigins.length > 0) {
    app.enableCors(corsOptions(allowedOrigins));
  }

  // /docs expõe toda a superfície da API; fica fora de produção.
  if (env.get('NODE_ENV', { infer: true }) !== 'production') {
    app.use('/docs', swaggerCspMiddleware());

    const config = new DocumentBuilder()
      .setTitle('Inner View API')
      .setDescription('API do sistema de tours virtuais imobiliários')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'refresh-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
