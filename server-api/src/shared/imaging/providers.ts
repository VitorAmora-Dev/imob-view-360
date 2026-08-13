import { GoogleGenAI } from '@google/genai';
import OpenAI, { toFile } from 'openai';
import { Raster } from './cubemap';
import { casarCorNaBorda, recomporComPena } from './juncao';
import {
  furarPelaCobertura,
  mascaraParaAlfaEditavel,
  pngParaRaster,
  rasterParaPng,
  redimensionar,
} from './raster';

/**
 * Os dois candidatos do bake-off atrás da mesma interface.
 *
 * A propriedade que sustenta o pipeline inteiro NÃO está no provider: está em
 * `recomporPelaCobertura`, aplicado depois de toda geração. Seja qual for a
 * imagem que o modelo devolva, só os pixels dentro do buraco de cobertura são
 * aproveitados; o resto volta do original, byte a byte. Isso rebaixa "o modelo
 * respeita a máscara?" de risco a métrica — `derivaForaDaMascara` mede quanto
 * ele reescreveu do que não devia, e essa medida é uma das saídas do relatório.
 */

export interface PedidoEdicao {
  /** Face do cubemap a completar. */
  face: Raster;
  /**
   * O que o modelo é mandado preencher: branco = fotografado, preto = a gerar.
   * Normalmente é a cobertura EROD1DA, propositalmente maior que o buraco real,
   * para o modelo repintar alguns pixels de fotografia e ter sobre o que casar.
   */
  cobertura: Raster;
  /**
   * A cobertura verdadeira, usada na recomposição. Só o que estiver fora dela é
   * substituído sem ressalva; a faixa entre as duas é misturada. Omitida, vale a
   * `cobertura` e o corte é seco.
   */
  coberturaFiel?: Raster;
  /** Largura da mistura, em pixels. Zero reproduz o corte seco da rodada 1. */
  pena?: number;
  /** Faces laterais, para o modelo casar material, cor e luz. */
  referencias?: Raster[];
  prompt: string;
  seed?: number;
}

export interface ResultadoEdicao {
  /** Face final: gerado dentro do buraco, original fora. É o que vai para o cubemap. */
  face: Raster;
  /** O que o modelo devolveu, sem recomposição — guardado para auditoria. */
  cru: Raster;
  /** Diferença média por canal fora do buraco: quanto o modelo mexeu no que era fotografia. */
  derivaForaDaMascara: number;
  modelo: string;
  ms: number;
  custoUSD: number;
}

export interface ImageEditProvider {
  readonly nome: string;
  readonly modelo: string;
  /**
   * O que uma chamada custa, para quem precisa estimar ANTES de gastar.
   *
   * Está na interface, e não numa constante à parte no script, porque a
   * estimativa do bake-off trazia um 0,17 chumbado que não batia com nenhum dos
   * dois providers — anunciava menos que o Gemini e mais que o GPT, e o único
   * número que importa ali é o que aparece antes de a rodada começar.
   */
  readonly custoPorImagemUSD: number;
  disponivel(): boolean;
  editar(pedido: PedidoEdicao): Promise<ResultadoEdicao>;
}

/* -------------------------------------------------------------------------- */
/* Gemini 3 Pro Image (Nano Banana Pro)                                        */
/* -------------------------------------------------------------------------- */

/**
 * 1120 tokens de saída em 2K a US$ 120,00 por milhão. O custo de entrada (560
 * tokens por imagem de referência) fica fora da conta por ser duas ordens de
 * grandeza menor.
 */
const CUSTO_GEMINI_2K = 0.1344;

export class GeminiImageProvider implements ImageEditProvider {
  readonly nome = 'gemini';
  readonly modelo = 'gemini-3-pro-image-preview';
  readonly custoPorImagemUSD = CUSTO_GEMINI_2K;

  private cliente: GoogleGenAI | null = null;

  disponivel(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async editar(pedido: PedidoEdicao): Promise<ResultadoEdicao> {
    this.cliente ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // O Gemini não recebe máscara como parâmetro: o buraco precisa estar visível
    // na própria imagem, e é por isso que a face vai com alfa perfurado.
    const alvo = await rasterParaPng(furarPelaCobertura(pedido.face, pedido.cobertura));
    const referencias = await Promise.all((pedido.referencias ?? []).map(rasterParaPng));

    const partes: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: pedido.prompt },
      { inlineData: { mimeType: 'image/png', data: alvo.toString('base64') } },
      ...referencias.map((r) => ({
        inlineData: { mimeType: 'image/png', data: r.toString('base64') },
      })),
    ];

    const inicio = Date.now();
    const resposta = await this.cliente.models.generateContent({
      model: this.modelo,
      contents: [{ role: 'user', parts: partes }],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: '2K' },
        ...(pedido.seed === undefined ? {} : { seed: pedido.seed }),
      },
    });
    const ms = Date.now() - inicio;

    const imagem = extrairImagemGemini(resposta);
    return montarResultado(pedido, await pngParaRaster(imagem), this.modelo, ms, CUSTO_GEMINI_2K);
  }
}

function extrairImagemGemini(resposta: unknown): Buffer {
  const partes =
    (resposta as { candidates?: Array<{ content?: { parts?: Array<Record<string, any>> } }> })
      ?.candidates?.[0]?.content?.parts ?? [];

  for (const parte of partes) {
    const dados = parte?.inlineData?.data;
    if (typeof dados === 'string') return Buffer.from(dados, 'base64');
  }

  // Vale mostrar o texto: quando o modelo recusa, a razão vem por aqui e sem
  // isso o erro seria só "sem imagem".
  const texto = partes.map((p) => p?.text).filter(Boolean).join(' ');
  throw new Error(`Gemini não devolveu imagem${texto ? `: ${texto}` : '.'}`);
}

/* -------------------------------------------------------------------------- */
/* GPT Image 2                                                                 */
/* -------------------------------------------------------------------------- */

/** Estimativa pública por imagem; conferir contra a fatura antes de projetar custo. */
const CUSTO_GPT_IMAGE_2 = 0.19;

export class OpenAIImageProvider implements ImageEditProvider {
  readonly nome = 'gpt-image-2';
  readonly modelo = 'gpt-image-2';
  readonly custoPorImagemUSD = CUSTO_GPT_IMAGE_2;

  private cliente: OpenAI | null = null;

  disponivel(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async editar(pedido: PedidoEdicao): Promise<ResultadoEdicao> {
    this.cliente ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const face = await rasterParaPng(pedido.face);
    const mascara = await rasterParaPng(mascaraParaAlfaEditavel(pedido.cobertura));
    const referencias = await Promise.all((pedido.referencias ?? []).map(rasterParaPng));

    const lado = alinharAoLimite(pedido.face.width);

    const inicio = Date.now();
    // Nada de `input_fidelity`: o gpt-image-2 removeu o parâmetro e a requisição
    // falha se ele for enviado — o modelo já processa a entrada em alta fidelidade.
    const resposta = await this.cliente.images.edit({
      model: this.modelo,
      image: [
        await paraArquivo(face, 'face.png'),
        ...(await Promise.all(referencias.map((r, i) => paraArquivo(r, `ref-${i}.png`)))),
      ],
      mask: await paraArquivo(mascara, 'mascara.png'),
      prompt: pedido.prompt,
      size: `${lado}x${lado}`,
    } as never);
    const ms = Date.now() - inicio;

    const b64 = resposta?.data?.[0]?.b64_json;
    if (!b64) throw new Error('GPT Image 2 não devolveu imagem.');

    return montarResultado(
      pedido,
      await pngParaRaster(Buffer.from(b64, 'base64')),
      this.modelo,
      ms,
      CUSTO_GPT_IMAGE_2,
    );
  }
}

function paraArquivo(buffer: Buffer, nome: string) {
  return toFile(buffer, nome, { type: 'image/png' });
}

/**
 * O gpt-image-2 exige lados múltiplos de 16, com o maior lado até 3840 e o total
 * entre 655.360 e 8.294.400 pixels. Para uma face quadrada quem manda é o total,
 * não o lado: 3840² seriam 14,7 MP e a requisição falharia. O teto real aqui é
 * √8.294.400 = 2880, que já é múltiplo de 16.
 */
export function alinharAoLimite(lado: number): number {
  const minimo = Math.ceil(Math.sqrt(655360) / 16) * 16;
  const maximo = Math.floor(Math.sqrt(8294400) / 16) * 16;
  return Math.max(minimo, Math.min(maximo, Math.round(lado / 16) * 16));
}

/* -------------------------------------------------------------------------- */
/* Recomposição e métrica                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Dentro do buraco vale o que o modelo gerou; fora, o pixel original. É esta
 * função — e não a boa vontade do provedor — que garante que nenhum móvel,
 * acabamento ou textura fotografada seja reescrito.
 *
 * O alfa do gerado é a terceira condição, e não é detalhe: o gpt-image-2 devolve
 * a região preservada TRANSPARENTE em vez de repetir a original. Sem esta
 * checagem, "transparente" entraria como preto e a face voltaria com lascas
 * pretas na borda do buraco — foi exatamente o que apareceu na primeira rodada.
 */
export function recomporPelaCobertura(original: Raster, gerado: Raster, cobertura: Raster): Raster {
  const data = new Uint8ClampedArray(original.data);

  for (let i = 0; i < data.length; i += 4) {
    if (cobertura.data[i] > 127) continue;
    if (gerado.data[i + 3] < 128) continue;

    data[i] = gerado.data[i];
    data[i + 1] = gerado.data[i + 1];
    data[i + 2] = gerado.data[i + 2];
    data[i + 3] = 255;
  }

  return { data, width: original.width, height: original.height };
}

/** Diferença média por canal sobre a imagem inteira — a medida do experimento C. */
export function diferencaMedia(a: Raster, b: Raster): number {
  let soma = 0;
  let n = 0;

  for (let i = 0; i < a.data.length; i += 4) {
    if (b.data[i + 3] < 128) continue;
    soma += Math.abs(a.data[i] - b.data[i]);
    soma += Math.abs(a.data[i + 1] - b.data[i + 1]);
    soma += Math.abs(a.data[i + 2] - b.data[i + 2]);
    n += 3;
  }

  return n === 0 ? 0 : soma / n;
}

/**
 * Diferença média por canal, restrita ao que era fotografia. Zero significa que
 * o modelo devolveu intacto o que não devia tocar; valores altos significam que
 * ele repintou a face inteira e só a recomposição salvou o resultado.
 *
 * Pixel transparente na saída não conta. Devolver a região preservada como
 * transparente é como o gpt-image-2 diz "não mexi aqui" — tratar isso como preto
 * marcaria 186 de 255 de deriva num modelo que na verdade obedeceu, que foi a
 * leitura errada da primeira rodada.
 */
export function derivaForaDaMascara(original: Raster, gerado: Raster, cobertura: Raster): number {
  let soma = 0;
  let n = 0;

  for (let i = 0; i < original.data.length; i += 4) {
    if (cobertura.data[i] <= 127) continue;
    if (gerado.data[i + 3] < 128) continue;

    soma += Math.abs(original.data[i] - gerado.data[i]);
    soma += Math.abs(original.data[i + 1] - gerado.data[i + 1]);
    soma += Math.abs(original.data[i + 2] - gerado.data[i + 2]);
    n += 3;
  }

  return n === 0 ? 0 : soma / n;
}

/**
 * Salto médio de cor exatamente na fronteira entre o que é fotografia e o que
 * foi gerado.
 *
 * Uma face pode ser bonita sozinha e ainda assim reprovar: se o piso gerado tem
 * outro tom, a junção vira um anel visível no tour. Este número é o que separa
 * "preencheu" de "casou" — e não tem como ser julgado pelo contact sheet, onde a
 * costura fica pequena demais para o olho.
 */
export function descontinuidadeNaBorda(face: Raster, cobertura: Raster): number {
  const { width, height } = face;
  let soma = 0;
  let n = 0;

  const amostrar = (x: number, y: number) => (y * width + x) * 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dentro = cobertura.data[amostrar(x, y)] > 127;

      // Só interessa o pixel fotografado que faz divisa com o gerado.
      if (!dentro) continue;

      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const vx = x + dx;
        const vy = y + dy;
        if (vx >= width || vy >= height) continue;
        if (cobertura.data[amostrar(vx, vy)] > 127) continue;

        const i = amostrar(x, y);
        const j = amostrar(vx, vy);
        soma += Math.abs(face.data[i] - face.data[j]);
        soma += Math.abs(face.data[i + 1] - face.data[j + 1]);
        soma += Math.abs(face.data[i + 2] - face.data[j + 2]);
        n += 3;
      }
    }
  }

  return n === 0 ? 0 : soma / n;
}

async function montarResultado(
  pedido: PedidoEdicao,
  cruBruto: Raster,
  modelo: string,
  ms: number,
  custoUSD: number,
): Promise<ResultadoEdicao> {
  // Os modelos não garantem devolver exatamente o lado pedido; sem reamostrar
  // de volta, a recomposição compararia pixels de grades diferentes.
  const cru =
    cruBruto.width === pedido.face.width && cruBruto.height === pedido.face.height
      ? cruBruto
      : await redimensionar(cruBruto, pedido.face.width, pedido.face.height);

  const fiel = pedido.coberturaFiel ?? pedido.cobertura;
  const pena = pedido.pena ?? 0;

  // A cor é casada ANTES de recompor: misturar primeiro e corrigir depois
  // arrastaria a fotografia junto na faixa da pena.
  const casado = pena > 0 ? casarCorNaBorda(cru, pedido.face, fiel) : cru;

  return {
    face:
      pena > 0
        ? recomporComPena(pedido.face, casado, fiel, pena)
        : recomporPelaCobertura(pedido.face, casado, fiel),
    cru,
    derivaForaDaMascara: derivaForaDaMascara(pedido.face, cru, pedido.cobertura),
    modelo,
    ms,
    custoUSD,
  };
}
