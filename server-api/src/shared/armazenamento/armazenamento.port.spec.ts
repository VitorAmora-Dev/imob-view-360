import { ArmazenamentoEmMemoria } from './armazenamento-em-memoria';
import {
  chaveDaCapa,
  chaveDaCaptura,
  chaveDoPanorama,
  versaoAgora,
} from './armazenamento.port';

describe('chaves do armazenamento', () => {
  it('duas versões geradas no mesmo milissegundo são diferentes', () => {
    const relogio = jest.spyOn(Date, 'now').mockReturnValue(1757950000000);
    try {
      expect(versaoAgora()).not.toBe(versaoAgora());
    } finally {
      relogio.mockRestore();
    }
  });

  it('monta a chave do panorama com a versão no caminho', () => {
    expect(chaveDoPanorama('p1', '1757950000000', 'original')).toBe(
      'panoramas/p1/1757950000000/original.jpg',
    );
    expect(chaveDoPanorama('p1', '1757950000000', 'tratada')).toBe(
      'panoramas/p1/1757950000000/tratada.jpg',
    );
  });

  it('a capa mora ao lado da imagem, na MESMA versão', () => {
    // É o que permite achar a capa sem uma terceira coluna no banco: quem tem
    // a chave da imagem tem a da capa por aritmética de string.
    expect(chaveDaCapa('panoramas/p1/1757950000000/tratada.jpg')).toBe(
      'panoramas/p1/1757950000000/capa.jpg',
    );
  });

  it('recusa chave sem diretório em vez de inventar uma', () => {
    expect(() => chaveDaCapa('tratada.jpg')).toThrow(/sem diretório/);
  });

  it('a foto da captura não carrega versão', () => {
    // Reenvio depois de falha de rede repõe a MESMA foto, como o upsert por
    // (panorama, índice) já faz no banco. Versionar aqui acumularia cópias.
    expect(chaveDaCaptura('p1', 7)).toBe('capturas/p1/7.jpg');
  });

  it('a versão é o instante da gravação, em milissegundos', () => {
    expect(versaoAgora(new Date(1757950000000))).toBe('1757950000000');
  });

  it('duas gravações do mesmo panorama nunca dividem a mesma chave', () => {
    // A imutabilidade do arquivo é o que faz invalidação de CDN sumir como
    // classe de problema. Se duas versões colidissem, ela voltaria.
    const primeira = chaveDoPanorama('p1', versaoAgora(new Date(1)), 'tratada');
    const segunda = chaveDoPanorama('p1', versaoAgora(new Date(2)), 'tratada');
    expect(primeira).not.toBe(segunda);
  });
});

describe('ArmazenamentoEmMemoria', () => {
  it('devolve o que gravou', async () => {
    const memoria = new ArmazenamentoEmMemoria();
    await memoria.gravar('a/b.jpg', Buffer.from('oi'));

    expect((await memoria.ler('a/b.jpg'))?.toString()).toBe('oi');
  });

  it('devolve null para chave que não existe, em vez de lançar', async () => {
    // Quem lê precisa distinguir "não está no balde" de "o balde falhou": é
    // esse null que autoriza a queda para a coluna antiga.
    expect(await new ArmazenamentoEmMemoria().ler('nao/existe.jpg')).toBeNull();
  });

  it('sem endereço público configurado, não inventa um', async () => {
    const memoria = new ArmazenamentoEmMemoria();

    expect(memoria.enderecoPublico('a/b.jpg')).toBeNull();
    expect(await memoria.enderecoAssinado('a/b.jpg', 300)).toBeNull();
  });

  it('com endereço público configurado, emite o absoluto', () => {
    const memoria = new ArmazenamentoEmMemoria('https://cdn.teste');

    expect(memoria.enderecoPublico('a/b.jpg')).toBe(
      'https://cdn.teste/a/b.jpg',
    );
  });

  it('lista só o que está sob o prefixo', async () => {
    const memoria = new ArmazenamentoEmMemoria();
    await memoria.gravar('panoramas/p1/1/original.jpg', Buffer.from('a'));
    await memoria.gravar('capturas/p1/0.jpg', Buffer.from('b'));

    const achados: string[] = [];
    for await (const objeto of memoria.listar('panoramas/')) {
      achados.push(objeto.chave);
    }

    expect(achados).toEqual(['panoramas/p1/1/original.jpg']);
  });

  it('apagar some com o objeto', async () => {
    const memoria = new ArmazenamentoEmMemoria();
    await memoria.gravar('a/b.jpg', Buffer.from('oi'));

    await memoria.apagar('a/b.jpg');

    expect(await memoria.ler('a/b.jpg')).toBeNull();
  });
});
