import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ArmazenamentoDeImagens, ObjetoArmazenado } from './armazenamento.port';

export interface ConfigDaR2 {
  endpoint: string;
  bucket: string;
  chaveId: string;
  chaveSecreta: string;
  /** `null` até a entrega B: sem domínio, a API continua servindo. */
  urlPublica: string | null;
}

/**
 * A porta, na Cloudflare R2.
 *
 * A R2 fala o protocolo da S3, então a biblioteca é a da AWS e trocar de
 * fornecedor depois é mudar `endpoint`. `region: 'auto'` é o que a R2 exige: ela
 * não tem regiões, mas o assinador da AWS não assina sem uma.
 */
export class ArmazenamentoR2 implements ArmazenamentoDeImagens {
  private readonly cliente: S3Client;
  private readonly urlPublica: string | null;

  constructor(private readonly config: ConfigDaR2) {
    this.cliente = new S3Client({
      region: 'auto',
      forcePathStyle: true,
      endpoint: config.endpoint,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: config.chaveId,
        secretAccessKey: config.chaveSecreta,
      },
    });
    // Sem a barra final, para a concatenação de `enderecoPublico` não produzir
    // `//` — que a CDN trata como caminho diferente e cacheia duas vezes.
    this.urlPublica = config.urlPublica?.replace(/\/+$/, '') ?? null;
  }

  async gravar(chave: string, bytes: Buffer): Promise<void> {
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: chave,
        Body: bytes,
        ...(chave.startsWith('panoramas/') ? { IfNoneMatch: '*' } : {}),
        ContentType: 'image/jpeg',
        // O bucket também contém rascunhos e referências. Uma futura camada
        // pública pode aplicar cache longo somente após autorizar PUBLISHED.
        // Capturas são mutáveis; os bytes privados não podem ter cache público.
        CacheControl: chave.startsWith('panoramas/')
          ? 'private, max-age=300'
          : 'private, no-store',
      }),
    );
  }

  async ler(chave: string): Promise<Buffer | null> {
    try {
      const resposta = await this.cliente.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: chave }),
      );
      const bytes = await resposta.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (erro) {
      // Objeto ausente é resposta, não falha: é ele que autoriza a queda para a
      // coluna antiga do banco durante a migração. Qualquer outro erro sobe —
      // engolir um 403 aqui faria toda foto do balde parecer "não migrada".
      if (naoExiste(erro)) return null;
      throw erro;
    }
  }

  enderecoPublico(chave: string): string | null {
    return this.urlPublica ? `${this.urlPublica}/${chave}` : null;
  }

  async enderecoAssinado(
    chave: string,
    segundos: number,
  ): Promise<string | null> {
    return getSignedUrl(
      this.cliente,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: chave }),
      { expiresIn: segundos },
    );
  }

  async apagar(chave: string): Promise<void> {
    await this.cliente.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: chave }),
    );
  }

  async *listar(prefixo: string): AsyncIterable<ObjetoArmazenado> {
    let continuacao: string | undefined;
    do {
      const pagina = await this.cliente.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefixo,
          ContinuationToken: continuacao,
        }),
      );
      for (const objeto of pagina.Contents ?? []) {
        if (objeto.Key) {
          // Sem idade conhecida, proteja o objeto da varredura destrutiva.
          yield {
            chave: objeto.Key,
            modificadoEm: objeto.LastModified ?? new Date(),
          };
        }
      }
      // Sem esta paginação a varredura enxergaria só as primeiras mil chaves e
      // deixaria os órfãos das páginas seguintes acumulados no bucket.
      continuacao = pagina.IsTruncated
        ? pagina.NextContinuationToken
        : undefined;
    } while (continuacao);
  }
}

function naoExiste(erro: unknown): boolean {
  const nome = (erro as { name?: string })?.name;
  const status = (erro as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return (
    nome === 'NoSuchKey' ||
    nome === 'NotFound' ||
    (status === 404 && nome !== 'NoSuchBucket')
  );
}
