import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'generated/prisma/client';
import { requireTestDatabaseUrl } from './require-test-database';

// A guarda roda na importação do módulo: nenhum teste consegue obter um cliente
// apontado para banco que não seja o de teste. Cada worker do Jest tem o próprio
// process.env, por isso a checagem se repete aqui e não fica só no globalSetup.
const connectionString = requireTestDatabaseUrl();

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

let cachedTables: string[] | undefined;

/**
 * Lista as tabelas do schema public direto do catálogo, em vez de manter uma
 * lista fixa no código: model novo no schema.prisma entra no truncate sozinho.
 * `_prisma_migrations` fica de fora — apagá-la faria o migrate deploy reaplicar
 * tudo na próxima execução.
 */
async function tableNames(): Promise<string[]> {
  if (cachedTables) return cachedTables;

  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  cachedTables = rows.map((row) => `"public"."${row.tablename}"`);
  return cachedTables;
}

/**
 * Zera o banco entre os testes.
 *
 * Um único TRUNCATE com todas as tabelas de uma vez (e não um por tabela):
 * o Postgres resolve as dependências de chave estrangeira no mesmo comando,
 * então a ordem não importa e não há janela em que o banco esteja meio vazio.
 *
 * CASCADE é necessário por causa das FKs entre Property, VirtualTour, Panorama
 * e Hotspot. RESTART IDENTITY não faz diferença aqui — todos os ids são uuid —
 * mas fica para o caso de entrar alguma coluna serial.
 */
export async function truncateAll(): Promise<void> {
  const tables = await tableNames();
  if (tables.length === 0) return;

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
  );
}
