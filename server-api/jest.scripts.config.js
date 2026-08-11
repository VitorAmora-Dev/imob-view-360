/**
 * Specs de geometria e tratamento de imagem — sem banco.
 *
 * Config separada porque o `globalSetup` da suíte da API sobe Postgres e roda
 * migrations. Fazer a matemática de cubemap depender de um container é o tipo
 * de atrito que faz o teste deixar de ser rodado.
 *
 *   yarn test:scripts
 */
module.exports = {
  rootDir: '.',
  testRegex: '(scripts|src/shared/imaging)/.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
