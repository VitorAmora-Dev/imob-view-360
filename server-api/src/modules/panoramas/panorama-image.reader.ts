import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  ARMAZENAMENTO,
  ArmazenamentoDeImagens,
  chaveDaCapa,
} from '../../shared/armazenamento/armazenamento.port';
import { base64Puro, chaveServida } from './panorama-image';

type Enderecos = {
  imageKey: string | null;
  treatedImageKey: string | null;
};

/**
 * Lê a imagem de um panorama, do balde ou da coluna antiga.
 *
 * A precedência é o coração da migração: o endereço primeiro, a coluna como
 * queda. É essa queda que mantém tour publicado vivo enquanto o preenchimento
 * roda — sem ela, o deploy que introduz o balde seria um apagão.
 *
 * A queda é POR VARIANTE, e não "qualquer chave que exista". Ver `chaveServida`
 * em `panorama-image.ts` para o caso que isso evita.
 *
 * `treatmentStatus` continua sendo o discriminador de `preferirTratada` nos
 * três chamadores, porque anda junto de `treatedImageData`/`treatedImageKey`
 * nos dois lugares que os escrevem: `treat-panorama.service.ts` ao concluir e o
 * `SEM_TRATAMENTO` de `update-panorama.service.ts` ao refotografar.
 */
@Injectable()
export class PanoramaImageReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARMAZENAMENTO)
    private readonly armazenamento: ArmazenamentoDeImagens,
  ) {}

  async carregar(
    panoramaId: string,
    preferirTratada: boolean,
  ): Promise<Buffer | null> {
    const enderecos = await this.enderecos(panoramaId);
    if (!enderecos) return null;

    // Com o palpite certo e a linha já migrada, isto é UMA consulta estreita
    // mais uma leitura do balde: nenhuma coluna TOAST sai do banco.
    const tratada = preferirTratada
      ? ((await this.doBalde(enderecos.treatedImageKey)) ??
        (await this.daColuna(panoramaId, 'tratada')))
      : null;

    return (
      tratada ??
      (await this.doBalde(enderecos.imageKey)) ??
      (await this.daColuna(panoramaId, 'original'))
    );
  }

  /**
   * A capa gravada ao lado da imagem que seria servida.
   *
   * `null` quando a variante servida ainda não tem chave: é instrução para
   * quem chama reduzir sob demanda, e some quando a migração terminar.
   */
  async carregarCapa(
    panoramaId: string,
    preferirTratada: boolean,
  ): Promise<Buffer | null> {
    const enderecos = await this.enderecos(panoramaId);
    if (!enderecos) return null;

    const chave = chaveServida(enderecos, preferirTratada);
    return chave ? this.armazenamento.ler(chaveDaCapa(chave)) : null;
  }

  private async enderecos(id: string): Promise<Enderecos | null> {
    return this.prisma.panorama.findUnique({
      where: { id },
      select: { imageKey: true, treatedImageKey: true },
    });
  }

  /**
   * `null` tanto para "não há chave" quanto para "o objeto não está lá". O
   * segundo é defeito, e a queda para a coluna é rede de segurança: servir a
   * coluna é melhor que servir tela vazia.
   */
  private async doBalde(chave: string | null): Promise<Buffer | null> {
    return chave ? this.armazenamento.ler(chave) : null;
  }

  /**
   * Consulta separada por variante, e não uma trazendo as duas: são colunas
   * TOAST de dezenas de MB, e pedir as duas para descartar uma em JS é o que
   * fazia a consulta mais pesada do sistema custar o dobro do que precisava.
   */
  private async daColuna(
    id: string,
    qual: 'original' | 'tratada',
  ): Promise<Buffer | null> {
    const linha =
      qual === 'tratada'
        ? await this.prisma.panorama.findUnique({
            where: { id },
            select: { treatedImageData: true },
          })
        : await this.prisma.panorama.findUnique({
            where: { id },
            select: { imageData: true },
          });

    const base64 =
      linha && 'treatedImageData' in linha
        ? linha.treatedImageData
        : linha && 'imageData' in linha
          ? linha.imageData
          : null;

    return base64 ? Buffer.from(base64Puro(base64), 'base64') : null;
  }
}
