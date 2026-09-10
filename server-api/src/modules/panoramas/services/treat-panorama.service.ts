import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import {
  ALTURA_MODELO,
  LARGURA_MODELO,
  MODELO,
  ResultadoMontagem,
  amostrarAnel,
  custoDaFalha,
  montarPanorama,
} from '../../../shared/imaging/montagem-360';
import { costurarVolta, saltoNaVolta } from '../../../shared/imaging/volta';
import { pngParaRaster, rasterParaJpeg } from '../../../shared/imaging/raster';
import { base64Puro } from '../panorama-image';

/**
 * Montagem final do 360° por IA, a partir do panorama costurado e das fotos que
 * o originaram.
 *
 * O alvo são os dois defeitos que o corretor enxerga no tour: paralaxe (objeto
 * duplicado ou com a borda quebrada na emenda) e degrau na junção das fotos. O
 * modelo recebe o equirect mais cada foto original como verdade de campo e
 * devolve o mesmo panorama reparado.
 *
 * Uma rota anterior recortava o equirect em cubemap e só deixava a IA pintar
 * onde não havia pixel fotografado. Era segura por construção, mediu bem e foi
 * reprovada no olho: o chão e o teto recriados ficaram ruins. Esta é mais
 * arriscada — a imagem inteira passa pelo modelo — e o que a torna viável são as
 * fotos de referência. Na primeira sonda a mudança na faixa fotografada ficou em
 * 21 níveis de 255, contra 55–95 do mesmo modelo sem referências.
 *
 * O original nunca é sobrescrito. Quem aprova é o olho de quem conhece o imóvel,
 * e reverter tem que custar apagar uma coluna.
 */

/**
 * Largura da faixa, em pixels do modelo, em que a emenda da volta é reconciliada
 * depois da IA. O prompt proíbe quebrar a continuidade entre a borda esquerda e
 * a direita, e mesmo assim a sonda mediu o salto subindo de 5,5 para 9,9 — pedir
 * não garante, e aqui garantir custa aritmética.
 */
const FAIXA_DA_VOLTA = 48;

/**
 * Sem as fotos originais não há verdade de campo, e o modelo repintaria o cômodo
 * a partir da própria imagem — que é exatamente o caso reprovado no bake-off.
 * Captura antiga, sem `captureFrames`, é dispensada em vez de tratada às cegas.
 */
const MINIMO_DE_FOTOS = 4;

/**
 * Largura das fotos de referência mandadas ao modelo.
 *
 * Elas são referência de CONTEÚDO, não de resolução: mandá-las em 1536×2048
 * encheria o corpo da requisição sem o modelo aproveitar nada.
 */
const LARGURA_DA_REFERENCIA = 768;

/**
 * Quantos panoramas de um mesmo tour são montados ao mesmo tempo.
 *
 * Era 3, e três montagens simultâneas multiplicam por três o pico de memória
 * desta rota. Em 10/09/2026 a instância de produção estourou o limite e foi
 * reiniciada com UMA montagem em curso — a margem para três não existe. Um
 * tour de seis cômodos passa a levar ~6 min em vez de ~2, e é a única coisa
 * que se perde: o resultado de cada panorama é idêntico.
 */
const CONCORRENCIA = 1;

export interface ResultadoTratamento {
  status: 'DONE' | 'SKIPPED' | 'FAILED';
  fotos: number;
  saltoAntes: number;
  saltoDepois: number;
  custoUSD: number;
  ms: number;
}

@Injectable()
export class TreatPanoramaService implements OnModuleInit {
  private readonly logger = new Logger(TreatPanoramaService.name);
  private emAndamento = 0;
  private fila: Array<() => void> = [];
  /** Panoramas já na fila ou em execução — a guarda de idempotência de `agendar`. */
  private readonly conhecidos = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A fila vive na memória do processo; `PROCESSING` vive no banco. Um restart
   * no meio de uma montagem apagava a primeira e deixava a segunda gravada para
   * sempre: o panorama ficava preso num estado que nada mais visitava —
   * `iniciar` pula PROCESSING de propósito e o `--pendentes` do CLI só olhava
   * PENDING. Na volta, o que estava em curso volta a ser pendente.
   *
   * Isso assume uma instância só da API, que é como ela roda hoje. Com várias,
   * este reset atropelaria a montagem em curso de outra e o estado teria que
   * sair da memória para uma fila de verdade.
   */
  async onModuleInit(): Promise<void> {
    try {
      const { count } = await this.prisma.panorama.updateMany({
        where: { treatmentStatus: 'PROCESSING' },
        data: { treatmentStatus: 'PENDING' },
      });
      if (count > 0) {
        this.logger.warn(`${count} panorama(s) em PROCESSING de uma execução anterior devolvido(s) a PENDING.`);
      }
    } catch (erro) {
      // Não derruba o boot: a API serve os panoramas originais sem esta etapa.
      this.logger.warn(
        `Não foi possível reconciliar panoramas em PROCESSING: ${erro instanceof Error ? erro.message : erro}`,
      );
    }
  }

  /** Sem chave o serviço fica inerte em vez de quebrar o boot. */
  habilitado(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  /**
   * Enfileira sem prender quem chamou. Só pode ser usado DEPOIS do commit e
   * DEPOIS das fotos originais subirem: o serviço lê as duas coisas por outra
   * conexão, e sem as fotos o panorama seria dispensado.
   *
   * A concorrência é limitada porque cada montagem carrega o equirect e as fotos
   * em memória e ocupa uma chamada de ~60 s na API. Três de cada vez deixa um
   * tour de seis cômodos pronto em ~2 min sem o servidor oscilar.
   */
  agendar(panoramaId: string): void {
    if (!this.habilitado()) return;

    // Idempotente por id. Um segundo clique, um retry de rede ou uma requisição
    // repetida por um interceptor não podem custar outra chamada de API sobre o
    // mesmo panorama — e foi isso que apareceu no log como o mesmo panorama
    // dispensado duas vezes no mesmo segundo.
    if (this.conhecidos.has(panoramaId)) return;
    this.conhecidos.add(panoramaId);

    const executar = () => {
      this.emAndamento++;
      void this.execute(panoramaId)
        .catch((erro) => {
          this.logger.warn(
            `Montagem de ${panoramaId} não pôde ser agendada: ${erro instanceof Error ? erro.message : erro}`,
          );
        })
        .finally(() => {
          this.emAndamento--;
          this.conhecidos.delete(panoramaId);
          this.fila.shift()?.();
        });
    };

    if (this.emAndamento < CONCORRENCIA) executar();
    else this.fila.push(executar);
  }

  async execute(panoramaId: string): Promise<ResultadoTratamento> {
    const inicio = Date.now();

    // Nenhuma coluna de imagem aqui. A consulta antiga trazia o `imageData` de
    // TODAS as fotos da captura, e `amostrarAnel` descartava a maioria logo em
    // seguida: numa captura de 24, nove imagens iam ao heap para nada. O heap é
    // o recurso que acabou primeiro em produção.
    const existe = await this.prisma.panorama.count({
      where: { id: panoramaId },
    });
    if (existe === 0) throw new NotFoundException('Panorama não encontrado.');

    const daCaptura = await this.prisma.captureFrame.findMany({
      where: { panoramaId },
      select: { id: true },
      // Ordem angular: o prompt afirma que a referência k cobre a k-ésima
      // fatia da largura, e `index` é a ordem do disparo no anel.
      orderBy: { index: 'asc' },
    });

    if (daCaptura.length < MINIMO_DE_FOTOS) {
      return this.dispensar(panoramaId, 'sem fotos originais suficientes', inicio);
    }

    // A escolha acontece ANTES de qualquer imagem sair do banco. `amostrarAnel`
    // cobre a volta inteira quando a captura passa do teto da API — o prompt
    // afirma qual faixa cada referência cobre, e cortar as últimas deixaria
    // essa afirmação falsa.
    const escolhidas = amostrarAnel(daCaptura).map((f) => f.id);

    await this.prisma.panorama.update({
      where: { id: panoramaId },
      data: { treatmentStatus: 'PROCESSING', treatmentError: null },
    });

    try {
      return await this.montar(panoramaId, escolhidas, inicio);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);

      // Falhar não significa não ter pago: um 5xx pode chegar depois de a imagem
      // já ter sido gerada. `custoDaFalha` separa esse caso do 4xx recusado na
      // porta, para o total impresso no fim de um lote não ficar abaixo da
      // fatura.
      const custoUSD = custoDaFalha(erro);
      const nota = custoUSD > 0 ? ` (cobrada mesmo assim: US$ ${custoUSD.toFixed(2)})` : '';
      this.logger.error(`Montagem de ${panoramaId} falhou${nota}: ${mensagem}`);

      // O panorama original continua servível: falhar aqui degrada a qualidade
      // do tour, nunca o derruba.
      await this.prisma.panorama.update({
        where: { id: panoramaId },
        data: {
          treatmentStatus: 'FAILED',
          treatmentError: mensagem.slice(0, 500),
          treatmentMeta: { rota: 'montagem-360', modelo: MODELO, custoUSD },
        },
      });

      return {
        status: 'FAILED',
        fotos: escolhidas.length,
        saltoAntes: 0,
        saltoDepois: 0,
        custoUSD,
        ms: Date.now() - inicio,
      };
    }
  }

  private async montar(
    panoramaId: string,
    escolhidas: string[],
    inicio: number,
  ): Promise<ResultadoTratamento> {
    // O pedido ao modelo vive num escopo próprio de propósito. Quando ele
    // volta, o equirect original, o PNG reduzido e as referências já não são
    // alcançáveis, e o coletor pode devolvê-los ANTES da parte mais pesada do
    // que vem depois — os dois rasters e o redimensionamento final.
    const { r, largura, altura, quantasFotos } = await this.pedirMontagem(
      panoramaId,
      escolhidas,
    );

    const cru = await pngParaRaster(r.imagem);
    const saltoAntes = saltoNaVolta(cru);
    const costurado = costurarVolta(cru, FAIXA_DA_VOLTA);
    const saltoDepois = saltoNaVolta(costurado);

    // De volta ao tamanho que o visualizador já espera.
    const finalJpeg = await sharp(await rasterParaJpeg(costurado, 96))
      .resize(largura, altura, { fit: 'fill', kernel: 'lanczos3' })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      .toBuffer();

    await this.prisma.panorama.update({
      where: { id: panoramaId },
      data: {
        treatedImageData: `data:image/jpeg;base64,${finalJpeg.toString('base64')}`,
        treatmentStatus: 'DONE',
        treatmentError: null,
        treatedAt: new Date(),
        treatmentMeta: {
          rota: 'montagem-360',
          modelo: MODELO,
          fotos: quantasFotos,
          tamanhoPedido: `${LARGURA_MODELO}x${ALTURA_MODELO}`,
          // O que o modelo DEVOLVEU. Diferente do pedido, o resize final abaixo
          // esconde a diferença: o tour abre normalmente, com aparência boa ou
          // borrada conforme o caso, e nada no banco denunciaria. Esta linha é o
          // único lugar onde um fallback silencioso de tamanho apareceria.
          tamanhoDevolvido: `${cru.width}x${cru.height}`,
          tamanhoFinal: `${largura}x${altura}`,
          saltoNaVolta: { antes: saltoAntes, depois: saltoDepois },
          custoUSD: r.custoUSD,
          tentativas: r.tentativas,
          // O que a API contou. Ressalva: na primeira medição os números não
          // fecharam — ver `UsoDeTokens`. Para custo real, a fatura.
          ...(r.uso ? { uso: r.uso } : {}),
        },
      },
    });

    this.logger.log(
      `${panoramaId}: montado com ${quantasFotos} fotos · volta ${saltoAntes.toFixed(1)}→${saltoDepois.toFixed(1)} · ${(r.ms / 1000).toFixed(0)}s`,
    );

    return {
      status: 'DONE',
      fotos: quantasFotos,
      saltoAntes,
      saltoDepois,
      custoUSD: r.custoUSD,
      ms: Date.now() - inicio,
    };
  }

  /**
   * Prepara as imagens e chama o modelo.
   *
   * Separado de `montar` pelo ESCOPO, não pela leitura: é o `return` daqui que
   * torna inalcançável tudo o que foi mandado na requisição.
   */
  private async pedirMontagem(
    panoramaId: string,
    escolhidas: string[],
  ): Promise<{
    r: ResultadoMontagem;
    largura: number;
    altura: number;
    quantasFotos: number;
  }> {
    const { reduzido, largura, altura } =
      await this.equirectParaOModelo(panoramaId);
    const fotos = await this.referencias(escolhidas);

    return {
      r: await montarPanorama({ panorama: reduzido, fotos }),
      largura,
      altura,
      quantasFotos: fotos.length,
    };
  }

  /**
   * O equirect no tamanho que o modelo aceita, mais as dimensões do original.
   *
   * O buffer do original e a string base64 que o carregou morrem neste
   * `return`. Antes eles seguiam vivos durante a chamada de ~60 s à API, sem
   * ninguém para lê-los: só as duas dimensões são usadas depois.
   */
  private async equirectParaOModelo(
    panoramaId: string,
  ): Promise<{ reduzido: Buffer; largura: number; altura: number }> {
    const original = await this.prisma.panorama.findUnique({
      where: { id: panoramaId },
      select: { imageData: true },
    });
    if (!original) throw new NotFoundException('Panorama não encontrado.');

    const originalBuf = Buffer.from(base64Puro(original.imageData), 'base64');
    const meta = await sharp(originalBuf).metadata();
    if (!meta.width || !meta.height)
      throw new Error('Panorama sem dimensões legíveis.');

    return {
      reduzido: await sharp(originalBuf)
        .resize(LARGURA_MODELO, ALTURA_MODELO, {
          fit: 'fill',
          kernel: 'lanczos3',
        })
        .png()
        .toBuffer(),
      largura: meta.width,
      altura: meta.height,
    };
  }

  /**
   * As fotos de referência, convertidas UMA POR VEZ.
   *
   * Eram convertidas com `Promise.all`, e quinze `sharp` simultâneos decodificam
   * quinze JPEG de 1536×2048 ao mesmo tempo. Medido em 09/2026: pico de 84 MB
   * em paralelo contra 33 MB em série, para um resultado idêntico byte a byte.
   * Numa caixa de 512 MB essa diferença é o processo.
   *
   * O `shift` no laço não é enfeite: ele solta o base64 de cada foto assim que
   * ela vira PNG, em vez de manter as quinze strings vivas até o fim.
   */
  private async referencias(escolhidas: string[]): Promise<Buffer[]> {
    const linhas = await this.prisma.captureFrame.findMany({
      where: { id: { in: escolhidas } },
      select: { imageData: true },
      orderBy: { index: 'asc' },
    });

    const fotos: Buffer[] = [];
    for (let linha = linhas.shift(); linha; linha = linhas.shift()) {
      fotos.push(
        await sharp(Buffer.from(base64Puro(linha.imageData), 'base64'))
          .resize({ width: LARGURA_DA_REFERENCIA })
          .png()
          .toBuffer(),
      );
    }

    return fotos;
  }

  private async dispensar(
    panoramaId: string,
    motivo: string,
    inicio: number,
  ): Promise<ResultadoTratamento> {
    this.logger.log(`${panoramaId}: dispensado (${motivo}).`);
    await this.prisma.panorama.update({
      where: { id: panoramaId },
      data: { treatmentStatus: 'SKIPPED', treatmentError: motivo, treatedAt: new Date() },
    });
    return { status: 'SKIPPED', fotos: 0, saltoAntes: 0, saltoDepois: 0, custoUSD: 0, ms: Date.now() - inicio };
  }
}
