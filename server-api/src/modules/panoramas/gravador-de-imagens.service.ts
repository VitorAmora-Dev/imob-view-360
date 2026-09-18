import { Inject, Injectable } from '@nestjs/common';
import {
  ARMAZENAMENTO,
  ArmazenamentoDeImagens,
  VarianteDeImagem,
  chaveDaCapa,
  chaveDaCaptura,
  chaveDoPanorama,
  versaoAgora,
} from '../../shared/armazenamento/armazenamento.port';
import { reduzirParaCapa } from './capa-do-panorama';

/**
 * Põe uma imagem no balde e devolve a chave. Um lugar só, para as três rotas
 * que gravam foto: a captura de um cômodo, a refotografia e o tratamento por
 * IA.
 *
 * Existe por DRY com consequência: a capa é gerada aqui, e duas cópias dessa
 * regra divergiriam na qualidade sem ninguém perceber — foi o argumento que
 * criou `panorama-miniatura.ts` e continua valendo.
 *
 * **Quem chama grava o banco DEPOIS.** Este serviço não toca o Prisma de
 * propósito: é o `await` dele que precisa ter terminado antes de a linha
 * apontar para a chave. Se o balde aceitar e o banco falhar, sobra um arquivo
 * sem dono, que custa centavos e `varrer-orfaos` recolhe; se o banco gravasse
 * primeiro, uma falha deixaria uma linha apontando para o nada — e isso é tela
 * sem imagem.
 */
@Injectable()
export class GravadorDeImagens {
  constructor(
    @Inject(ARMAZENAMENTO)
    private readonly armazenamento: ArmazenamentoDeImagens,
  ) {}

  /**
   * Devolve a chave da imagem. A da capa se deduz com `chaveDaCapa` — não há
   * terceira coluna no banco guardando um endereço que já é calculável.
   */
  async gravarPanorama(
    panoramaId: string,
    bytes: Buffer,
    variante: VarianteDeImagem,
  ): Promise<string> {
    const chave = chaveDoPanorama(panoramaId, versaoAgora(), variante);

    // Imagem antes da capa: se a capa falhar, o `throw` sobe e quem chamou não
    // grava o banco. O que fica no balde é órfão, que é o lado barato do erro.
    await this.armazenamento.gravar(chave, bytes);
    await this.armazenamento.gravar(
      chaveDaCapa(chave),
      await reduzirParaCapa(bytes),
    );

    return chave;
  }

  /**
   * Foto de referência da captura. Sem capa: ela nunca é mostrada em tela, só
   * lida pelo tratamento. Sem versão: o envio acontece foto a foto em segundo
   * plano e um reenvio depois de falha de rede precisa REPOR a mesma foto.
   */
  async gravarCaptura(
    panoramaId: string,
    indice: number,
    bytes: Buffer,
  ): Promise<string> {
    const chave = chaveDaCaptura(panoramaId, indice);
    await this.armazenamento.gravar(chave, bytes);
    return chave;
  }
}
