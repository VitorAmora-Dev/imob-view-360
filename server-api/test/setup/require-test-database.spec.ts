import { assertTestDatabase, TEST_DATABASE_NAME } from './require-test-database';

/**
 * A guarda é o que separa "roda os testes" de "apaga o banco de desenvolvimento".
 * Estes casos existem para que ninguém a afrouxe sem perceber.
 */
describe('guarda do banco de teste', () => {
  const SENHA = 'senha-de-mentira-para-o-teste';
  const url = (banco: string, host = 'localhost:5433') =>
    `postgresql://postgres:${SENHA}@${host}/${banco}`;

  it('aceita o banco de teste', () => {
    expect(() =>
      assertTestDatabase(url(`${TEST_DATABASE_NAME}?schema=public`)),
    ).not.toThrow();
  });

  it('aborta no banco de desenvolvimento', () => {
    expect(() => assertTestDatabase(url('property-360?schema=public'))).toThrow(
      /não aponta para o banco de teste/,
    );
  });

  it('aborta em banco de produção remoto', () => {
    expect(() =>
      assertTestDatabase(url('property-360-prod', 'db.producao.com:5432')),
    ).toThrow(/não aponta para o banco de teste/);
  });

  it('aborta em nome que apenas TERMINA com o nome do banco de teste', () => {
    // Um `endsWith` ingênuo na URL inteira deixaria este passar.
    expect(() =>
      assertTestDatabase(url(`producao-${TEST_DATABASE_NAME}`)),
    ).toThrow(/não aponta para o banco de teste/);
  });

  it('aborta quando não há nome de banco', () => {
    expect(() => assertTestDatabase(url(''))).toThrow(
      /não aponta para o banco de teste/,
    );
  });

  it('aborta em URL inválida', () => {
    expect(() => assertTestDatabase('não é uma url')).toThrow(/não é uma URL/);
  });

  it('nunca expõe a senha na mensagem de erro', () => {
    // A mensagem costuma ir parar em log de CI, que é retido e indexado.
    let mensagem = '';
    try {
      assertTestDatabase(url('property-360'));
    } catch (erro) {
      mensagem = (erro as Error).message;
    }

    expect(mensagem).not.toContain(SENHA);
    expect(mensagem).toContain(':***@');
  });
});
