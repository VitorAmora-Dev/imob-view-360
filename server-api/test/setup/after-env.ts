import { prisma, truncateAll } from './prisma';

// Estado limpo antes de cada teste, e não depois: se um teste quebrar no meio,
// os dados dele ficam no banco para inspeção, e o próximo teste ainda começa
// zerado. Limpar no afterEach apagaria justamente a evidência da falha.
beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});
