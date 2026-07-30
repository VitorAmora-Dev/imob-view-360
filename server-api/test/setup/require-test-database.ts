import { config } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Nome obrigatório do banco de teste. O harness roda TRUNCATE ... CASCADE em
 * todas as tabelas entre os testes; apontar isso para o banco de desenvolvimento
 * — ou pior, para um banco remoto — apaga tudo sem recuperação.
 */
export const TEST_DATABASE_NAME = 'property-360-test';

let cached: string | undefined;

/**
 * Carrega o .env.test e devolve a DATABASE_URL, abortando se ela não apontar
 * para o banco de teste.
 *
 * Esta função é chamada tanto pelo globalSetup (antes do migrate) quanto pelo
 * cliente Prisma dos testes (antes do truncate) de propósito: o globalSetup roda
 * no processo principal do Jest, mas os testes rodam em workers separados, com
 * o próprio process.env. Uma guarda só no globalSetup não protegeria o truncate.
 */
export function requireTestDatabaseUrl(): string {
  if (cached) return cached;

  // Não sobrescreve variável já definida: o ambiente (CI, ou um override
  // pontual na linha de comando) sempre vence o arquivo versionado.
  config({ path: resolve(__dirname, '../../.env.test') });

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'DATABASE_URL não definida. Esperava encontrá-la em server-api/.env.test ' +
        'ou no ambiente.',
    );
  }

  cached = assertTestDatabase(raw);
  return cached;
}

/**
 * Compara o nome do banco extraído da URL, e não um `endsWith` na string
 * inteira: a URL termina em `?schema=public`, e um sufixo como
 * `.../producao-property-360-test` passaria num endsWith ingênuo.
 */
export function assertTestDatabase(rawUrl: string): string {
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(
      new URL(rawUrl).pathname.replace(/^\//, ''),
    );
  } catch {
    throw new Error(`DATABASE_URL não é uma URL válida: ${redact(rawUrl)}`);
  }

  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(
      [
        '',
        '  ABORTADO: a DATABASE_URL dos testes não aponta para o banco de teste.',
        '',
        `    banco encontrado : ${databaseName || '(nenhum)'}`,
        `    banco exigido    : ${TEST_DATABASE_NAME}`,
        `    url              : ${redact(rawUrl)}`,
        '',
        '  O harness executa TRUNCATE ... CASCADE em todas as tabelas entre os',
        '  testes. Rodar isso contra o banco errado apaga os dados sem volta.',
        '',
        '  Corrija a DATABASE_URL em server-api/.env.test ou no ambiente.',
        '',
      ].join('\n'),
    );
  }

  return rawUrl;
}

/** Nunca imprimir a senha numa mensagem de erro, que costuma ir para log de CI. */
function redact(rawUrl: string): string {
  return rawUrl.replace(/:\/\/([^:]+):([^@]*)@/, '://$1:***@');
}
