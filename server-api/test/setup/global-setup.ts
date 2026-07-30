import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';
import {
  TEST_DATABASE_NAME,
  requireTestDatabaseUrl,
} from './require-test-database';

const API_ROOT = resolve(__dirname, '../..');

/**
 * Roda uma vez por execução do Jest, antes de qualquer teste:
 *   1. valida que a DATABASE_URL aponta para o banco de teste (aborta se não)
 *   2. cria o banco se ele ainda não existir
 *   3. aplica as migrations
 *
 * É idempotente: rodar de novo com o banco já criado e migrado não faz nada.
 * O banco NÃO é destruído ao final — o truncate entre testes já garante o
 * estado, e recriar a cada execução custaria segundos sem benefício.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = requireTestDatabaseUrl();

  await createDatabaseIfMissing(databaseUrl);

  // O prisma.config.ts lê process.env['DATABASE_URL'] e o dotenv dele não
  // sobrescreve o que já existe, então injetar aqui é suficiente para o
  // migrate acertar o banco de teste em vez do de desenvolvimento.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

/**
 * `CREATE DATABASE` não aceita parâmetro vinculado nem roda dentro de
 * transação, então a conexão é feita ao banco de manutenção `postgres` e o
 * nome vai interpolado — seguro porque é uma constante nossa, não entrada
 * externa.
 */
async function createDatabaseIfMissing(databaseUrl: string): Promise<void> {
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = '/postgres';

  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DATABASE_NAME],
    );
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
      console.log(`\n[test] banco ${TEST_DATABASE_NAME} criado.`);
    }
  } finally {
    await client.end();
  }
}
