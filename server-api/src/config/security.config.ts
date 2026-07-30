import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import helmet from 'helmet';

/** Lista separada por vírgula → array, ignorando espaços e entradas vazias. */
export function parseOriginList(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function corsOptions(origins: string[]): CorsOptions {
  return {
    // Origem fora da lista simplesmente não recebe Access-Control-Allow-Origin,
    // e o browser bloqueia. Não lançamos erro: isso quebraria clientes que não
    // são browser (curl, integrações servidor-a-servidor) sem ganho de segurança.
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

/**
 * CSP desta API, que serve JSON e imagem — não HTML de aplicação.
 *
 * `frameAncestors: 'none'` vale para as respostas da API. A exceção do
 * `/embed` NÃO mora aqui: essa rota é do app Angular, servido por outro host.
 *
 * `extraOrigins` alimenta connect-src e img-src e existe para receber o domínio
 * do bucket na Fase 2 da migração de storage.
 */
export function helmetMiddleware(extraOrigins: string[]) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        connectSrc: ["'self'", ...extraOrigins],
        imgSrc: ["'self'", 'data:', ...extraOrigins],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    // O thumbnail é consumido por <img> a partir do app, em outro domínio; o
    // padrão same-origin do helmet bloquearia essa carga.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    // O padrão do helmet é SAMEORIGIN, que contradiz o frame-ancestors 'none'
    // acima. Alinhado em deny para os dois cabeçalhos dizerem a mesma coisa.
    xFrameOptions: { action: 'deny' },
  });
}

/**
 * O Swagger UI injeta script e style inline, que a CSP estrita acima bloqueia.
 * Aplicado só na rota /docs, que por sua vez só existe fora de produção.
 */
export function swaggerCspMiddleware() {
  return helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  });
}
