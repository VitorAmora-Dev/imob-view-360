import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { ArmazenamentoLocal } from './armazenamento-local';

describe('ArmazenamentoLocal', () => {
  let raiz: string;
  let disco: ArmazenamentoLocal;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'armazenamento-'));
    disco = new ArmazenamentoLocal(raiz);
  });

  afterEach(async () => {
    if (
      dirname(resolve(raiz)) !== resolve(tmpdir()) ||
      !basename(raiz).startsWith('armazenamento-')
    ) {
      throw new Error('Raiz temporária inesperada; limpeza recusada');
    }
    await rm(raiz, { recursive: true, force: true });
  });

  it('grava criando os diretórios do caminho', async () => {
    // A chave tem três níveis e nenhum deles existe antes da primeira foto.
    await disco.gravar('panoramas/p1/1/original.jpg', Buffer.from('oi'));

    const lido = await readFile(join(raiz, 'panoramas/p1/1/original.jpg'));
    expect(lido.toString()).toBe('oi');
  });

  it('devolve o que gravou', async () => {
    await disco.gravar('panoramas/p1/1/original.jpg', Buffer.from('oi'));

    expect((await disco.ler('panoramas/p1/1/original.jpg'))?.toString()).toBe(
      'oi',
    );
  });

  it('devolve null para arquivo que não existe, em vez de lançar', async () => {
    // É esse null que autoriza a queda para a coluna antiga do banco.
    expect(await disco.ler('panoramas/nao/existe.jpg')).toBeNull();
  });

  it('recusa chave que sobe de diretório', async () => {
    // A chave é montada a partir de ids, mas ela cruza a fronteira do processo
    // em `migrar-imagens` e em `varrer-orfaos`, que leem chave do banco. Uma
    // chave com `..` escreveria fora da raiz.
    await expect(disco.gravar('../fora.jpg', Buffer.from('x'))).rejects.toThrow(
      /fora da raiz/,
    );
  });

  it('não emite endereço público nem assinado', async () => {
    // Em desenvolvimento não existe CDN nem link assinado: a API continua
    // servindo os bytes, e é esse null que diz isso a quem pergunta.
    expect(disco.enderecoPublico('panoramas/p1/1/original.jpg')).toBeNull();
    expect(
      await disco.enderecoAssinado('panoramas/p1/1/original.jpg', 300),
    ).toBeNull();
  });

  it('lista recursivamente o que está sob o prefixo, com a data', async () => {
    await disco.gravar('panoramas/p1/1/original.jpg', Buffer.from('a'));
    await disco.gravar('panoramas/p2/1/original.jpg', Buffer.from('b'));
    await disco.gravar('capturas/p1/0.jpg', Buffer.from('c'));

    const achados = [];
    for await (const objeto of disco.listar('panoramas/')) achados.push(objeto);

    expect(achados.map((o) => o.chave).sort()).toEqual([
      'panoramas/p1/1/original.jpg',
      'panoramas/p2/1/original.jpg',
    ]);
    expect(achados[0].modificadoEm).toBeInstanceOf(Date);
  });

  it('listar num prefixo inexistente devolve vazio, sem lançar', async () => {
    const achados = [];
    for await (const objeto of disco.listar('panoramas/')) achados.push(objeto);

    expect(achados).toEqual([]);
  });

  it('apagar some com o arquivo e não reclama se já não havia', async () => {
    await disco.gravar('panoramas/p1/1/original.jpg', Buffer.from('oi'));

    await disco.apagar('panoramas/p1/1/original.jpg');
    await disco.apagar('panoramas/p1/1/original.jpg');

    expect(await disco.ler('panoramas/p1/1/original.jpg')).toBeNull();
  });
});
