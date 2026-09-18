import { z } from 'zod';
import {
  origemDoGatewayValida,
  SEGREDO_DO_GATEWAY,
} from '../shared/armazenamento/configuracao-do-gateway';

// Um segredo de 256 bits tem 44 caracteres em base64 e 64 em hex.
// O piso de 32 rejeita tanto placeholders quanto os fallbacks que existiam no código.
const SECRET_MIN_LENGTH = 32;

export const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URL: z.string().min(1, 'é obrigatória'),
    /**
     * Origens liberadas no CORS, separadas por vírgula. Vazio = nenhuma origem
     * cross-origin, que é o comportamento de dev (o proxy do Angular torna
     * tudo same-origin).
     */
    CORS_ORIGINS: z.string().default(''),
    /**
     * Domínios extras liberados em connect-src e img-src da CSP, separados por
     * vírgula. Inclua o gateway público e a origem S3 dos previews assinados.
     */
    CSP_EXTRA_ORIGINS: z.string().default(''),
    STORAGE_ENDPOINT: z.union([z.literal(''), z.url()]).default(''),
    STORAGE_BUCKET: z.string().default(''),
    STORAGE_ACCESS_KEY_ID: z.string().default(''),
    STORAGE_SECRET_ACCESS_KEY: z.string().default(''),
    /** Liga a entrega direta; a origem deve proteger rascunhos e capturas. */
    STORAGE_PUBLIC_URL: z.union([z.literal(''), z.url()]).default(''),
    /** Segredo exclusivo entre API e gateway; nunca é enviado ao frontend. */
    PUBLIC_IMAGE_GATEWAY_SECRET: z
      .union([z.literal(''), z.string().regex(SEGREDO_DO_GATEWAY)])
      .default(''),
    STORAGE_LOCAL_DIR: z
      .string()
      .default('.armazenamento')
      .transform((v) => v || '.armazenamento'),
    JWT_ACCESS_SECRET: z
      .string()
      .min(
        SECRET_MIN_LENGTH,
        `deve ter no mínimo ${SECRET_MIN_LENGTH} caracteres`,
      ),
    JWT_REFRESH_SECRET: z
      .string()
      .min(
        SECRET_MIN_LENGTH,
        `deve ter no mínimo ${SECRET_MIN_LENGTH} caracteres`,
      ),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'deve ser diferente de JWT_ACCESS_SECRET',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine(
    (env) => {
      const valores = [
        env.STORAGE_ENDPOINT,
        env.STORAGE_BUCKET,
        env.STORAGE_ACCESS_KEY_ID,
        env.STORAGE_SECRET_ACCESS_KEY,
      ];
      return valores.every((v) => !v) || valores.every(Boolean);
    },
    {
      message:
        'STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID e STORAGE_SECRET_ACCESS_KEY devem ser definidas juntas',
      path: ['STORAGE_BUCKET'],
    },
  )
  .refine((env) => !env.STORAGE_PUBLIC_URL || Boolean(env.STORAGE_ENDPOINT), {
    message: 'STORAGE_PUBLIC_URL requer STORAGE_ENDPOINT',
    path: ['STORAGE_PUBLIC_URL'],
  })
  .refine(
    (env) =>
      !env.STORAGE_PUBLIC_URL || Boolean(env.PUBLIC_IMAGE_GATEWAY_SECRET),
    {
      message:
        'STORAGE_PUBLIC_URL requer PUBLIC_IMAGE_GATEWAY_SECRET e o gateway privado',
      path: ['PUBLIC_IMAGE_GATEWAY_SECRET'],
    },
  )
  .refine(
    (env) => {
      return (
        !env.STORAGE_PUBLIC_URL || origemDoGatewayValida(env.STORAGE_PUBLIC_URL)
      );
    },
    {
      message:
        'STORAGE_PUBLIC_URL deve ser a origem HTTPS do Worker, nunca uma URL pública do R2',
      path: ['STORAGE_PUBLIC_URL'],
    },
  )
  .refine(
    (env) =>
      !env.PUBLIC_IMAGE_GATEWAY_SECRET ||
      (env.PUBLIC_IMAGE_GATEWAY_SECRET !== env.JWT_ACCESS_SECRET &&
        env.PUBLIC_IMAGE_GATEWAY_SECRET !== env.JWT_REFRESH_SECRET),
    {
      message:
        'PUBLIC_IMAGE_GATEWAY_SECRET deve ser diferente dos segredos JWT',
      path: ['PUBLIC_IMAGE_GATEWAY_SECRET'],
    },
  );

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validação executada na inicialização do Nest. Lançar aqui derruba o processo
 * antes de a aplicação subir — configuração ausente vira falha visível, não
 * um fallback silencioso.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (result.success) return result.data;

  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Variáveis de ambiente inválidas:\n${details}\n\nConsulte .env.example para a lista completa.`,
  );
}
