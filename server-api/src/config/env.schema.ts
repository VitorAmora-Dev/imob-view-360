import { z } from 'zod';

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
     * Domínios extras liberados em connect-src e img-src da CSP, separados por
     * vírgula. Reservado para o bucket de imagens (Fase 2 da migração).
     */
    CSP_EXTRA_ORIGINS: z.string().default(''),
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
  });

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
