import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, posix, resolve, sep } from 'node:path';
import { ArmazenamentoDeImagens, ObjetoArmazenado } from './armazenamento.port';

/**
 * A porta, em arquivos.
 *
 * Existe para que desenvolvimento e teste de integração não precisem de conta
 * na Cloudflare. O comportamento observável é o mesmo da R2 em tudo que
 * importa, com uma diferença deliberada: não há endereço público nem link
 * assinado, então a API continua servindo os bytes — que é exatamente o
 * comportamento da entrega A em produção.
 */
export class ArmazenamentoLocal implements ArmazenamentoDeImagens {
  private readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = resolve(raiz);
  }

  async gravar(chave: string, bytes: Buffer): Promise<void> {
    const caminho = this.caminhoDe(chave);
    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, bytes, {
      flag: chave.startsWith('panoramas/') ? 'wx' : 'w',
    });
  }

  async ler(chave: string): Promise<Buffer | null> {
    try {
      return await readFile(this.caminhoDe(chave));
    } catch (erro) {
      if (semArquivo(erro)) return null;
      throw erro;
    }
  }

  /** Não há CDN em desenvolvimento: a API serve. */
  enderecoPublico(_chave: string): string | null {
    void _chave;
    return null;
  }

  /** Não há o que assinar num arquivo local: a API serve, autenticada. */
  async enderecoAssinado(
    _chave: string,
    _segundos: number,
  ): Promise<string | null> {
    void _chave;
    void _segundos;
    return null;
  }

  async apagar(chave: string): Promise<void> {
    await rm(this.caminhoDe(chave), { force: true });
  }

  async *listar(prefixo: string): AsyncIterable<ObjetoArmazenado> {
    yield* this.percorrer(prefixo.replace(/\/+$/, ''));
  }

  private async *percorrer(relativo: string): AsyncIterable<ObjetoArmazenado> {
    let entradas;
    try {
      entradas = await readdir(this.caminhoDe(relativo), {
        withFileTypes: true,
      });
    } catch (erro) {
      // Prefixo que ainda não existe é "nada gravado ali", não erro: o balde
      // de um ambiente novo não tem nenhuma das duas pastas.
      if (semArquivo(erro)) return;
      throw erro;
    }

    for (const entrada of entradas) {
      const filho = posix.join(relativo, entrada.name);
      if (entrada.isDirectory()) {
        yield* this.percorrer(filho);
      } else if (entrada.isFile()) {
        const info = await stat(this.caminhoDe(filho));
        yield { chave: filho, modificadoEm: new Date(info.mtime.getTime()) };
      }
    }
  }

  /**
   * A chave vem do banco em `migrar-imagens` e em `varrer-orfaos`, então ela
   * cruza a fronteira do processo. Uma com `..` escreveria fora da raiz — o
   * custo de conferir é uma comparação de string.
   */
  private caminhoDe(chave: string): string {
    if (
      isAbsolute(chave) ||
      chave.includes('\\') ||
      chave.split('/').includes('..')
    ) {
      throw new Error(
        `Chave aponta para fora da raiz do armazenamento: ${chave}`,
      );
    }
    const caminho = resolve(this.raiz, chave);
    if (caminho !== this.raiz && !caminho.startsWith(this.raiz + sep)) {
      throw new Error(
        `Chave aponta para fora da raiz do armazenamento: ${chave}`,
      );
    }
    return caminho;
  }
}

function semArquivo(erro: unknown): boolean {
  return (erro as NodeJS.ErrnoException)?.code === 'ENOENT';
}
