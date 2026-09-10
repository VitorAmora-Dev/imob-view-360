/**
 * Specs de `src/shared` e `scripts` — o que não precisa de banco.
 *
 * Config separada porque o `globalSetup` da suíte da API sobe Postgres e roda
 * migrations. Fazer a matemática de cubemap depender de um container é o tipo
 * de atrito que faz o teste deixar de ser rodado — e o mesmo vale para o
 * resto de `src/shared`, que é código puro por definição.
 *
 *   yarn test:scripts
 */
module.exports = {
  rootDir: '.',
  testRegex: '(scripts|src/shared)/.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
