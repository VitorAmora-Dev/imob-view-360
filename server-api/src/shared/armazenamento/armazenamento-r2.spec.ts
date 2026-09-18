import { ArmazenamentoR2 } from './armazenamento-r2';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

/**
 * Nenhum destes testes toca a rede. Assinar uma URL é criptografia sobre o
 * pedido e a credencial — não há I/O — e é justamente isso que dá para provar
 * sem bucket.
 */
const CONFIG = {
  endpoint: 'https://conta.r2.cloudflarestorage.com',
  bucket: 'imob360',
  chaveId: 'chave-de-teste',
  chaveSecreta: 'segredo-de-teste',
  urlPublica: null,
};

describe('ArmazenamentoR2', () => {
  afterEach(() => jest.restoreAllMocks());

  it('só objeto ausente vira null; falhas de permissão e bucket sobem', async () => {
    const enviar = jest.spyOn(S3Client.prototype, 'send');
    enviar.mockImplementationOnce(async () => {
      throw Object.assign(new Error('ausente'), { name: 'NoSuchKey' });
    });
    await expect(new ArmazenamentoR2(CONFIG).ler('a.jpg')).resolves.toBeNull();
    enviar.mockImplementationOnce(async () => {
      throw Object.assign(new Error('negado'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
    });
    await expect(new ArmazenamentoR2(CONFIG).ler('a.jpg')).rejects.toThrow(
      'negado',
    );
    enviar.mockImplementationOnce(async () => {
      throw Object.assign(new Error('bucket ausente'), {
        name: 'NoSuchBucket',
        $metadata: { httpStatusCode: 404 },
      });
    });
    await expect(new ArmazenamentoR2(CONFIG).ler('a.jpg')).rejects.toThrow(
      'bucket ausente',
    );
  });

  it('panoramas são condicionais e capturas mutáveis não têm cache imutável', async () => {
    const comandos: PutObjectCommand[] = [];
    jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(async (comando: PutObjectCommand) => {
        comandos.push(comando);
        return {};
      });
    const r2 = new ArmazenamentoR2(CONFIG);
    await r2.gravar('panoramas/p/1/original.jpg', Buffer.from('imagem'));
    await r2.gravar('capturas/p/1.jpg', Buffer.from('referencia'));
    expect(comandos[0].input.IfNoneMatch).toBe('*');
    expect(comandos[1].input.IfNoneMatch).toBeUndefined();
    expect(comandos[1].input.CacheControl).toBe('private, no-store');
  });

  it('lista todas as páginas usando o token de continuação', async () => {
    const enviar = jest.spyOn(S3Client.prototype, 'send');
    enviar.mockImplementationOnce(async () => ({
      Contents: [
        { Key: 'panoramas/p/1/original.jpg', LastModified: new Date(1) },
      ],
      IsTruncated: true,
      NextContinuationToken: 'pagina2',
    }));
    enviar.mockImplementationOnce(async () => ({
      Contents: [
        { Key: 'panoramas/p/2/tratada.jpg', LastModified: new Date(2) },
      ],
    }));
    const objetos = [];
    for await (const objeto of new ArmazenamentoR2(CONFIG).listar('panoramas/'))
      objetos.push(objeto);
    expect(objetos.map((o) => o.chave)).toHaveLength(2);
    expect(
      (enviar.mock.calls[1][0] as ListObjectsV2Command).input.ContinuationToken,
    ).toBe('pagina2');
  });

  it('sem URL pública configurada, não emite endereço público', () => {
    // É o estado da entrega A: as chaves já estão preenchidas, o domínio ainda
    // não existe, e a API continua servindo. Emitir aqui derrubaria a tela.
    const r2 = new ArmazenamentoR2(CONFIG);

    expect(r2.enderecoPublico('panoramas/p1/1/tratada.jpg')).toBeNull();
  });

  it('com URL pública configurada, emite o absoluto da CDN', () => {
    const r2 = new ArmazenamentoR2({
      ...CONFIG,
      urlPublica: 'https://fotos.arpvision.com.br',
    });

    expect(r2.enderecoPublico('panoramas/p1/1/tratada.jpg')).toBe(
      'https://fotos.arpvision.com.br/panoramas/p1/1/tratada.jpg',
    );
  });

  it('a barra final da URL pública não vira barra dupla', () => {
    const r2 = new ArmazenamentoR2({
      ...CONFIG,
      urlPublica: 'https://fotos.arpvision.com.br/',
    });

    expect(r2.enderecoPublico('panoramas/p1/1/tratada.jpg')).toBe(
      'https://fotos.arpvision.com.br/panoramas/p1/1/tratada.jpg',
    );
  });

  it('o link assinado expira no prazo pedido', async () => {
    // O teste 9 da spec. `X-Amz-Expires` é o prazo em segundos, gravado DENTRO
    // da assinatura: mexer nele invalida o link em vez de estendê-lo.
    const r2 = new ArmazenamentoR2(CONFIG);

    const assinado = await r2.enderecoAssinado(
      'panoramas/p1/1/tratada.jpg',
      300,
    );

    const url = new URL(assinado!);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.host).toBe('conta.r2.cloudflarestorage.com');
    expect(url.pathname).toContain('panoramas/p1/1/tratada.jpg');
  });

  it('o link assinado carrega a credencial, e não o segredo', async () => {
    const r2 = new ArmazenamentoR2(CONFIG);

    const assinado = await r2.enderecoAssinado(
      'panoramas/p1/1/tratada.jpg',
      300,
    );

    expect(assinado).toContain('chave-de-teste');
    expect(assinado).not.toContain('segredo-de-teste');
  });
});
