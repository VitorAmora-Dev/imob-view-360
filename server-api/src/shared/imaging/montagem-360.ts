import OpenAI, { toFile } from 'openai';

/**
 * Correção do panorama 360° inteiro pela OpenAI, usando as fotos originais da
 * captura como verdade de campo.
 *
 * O alvo é paralaxe e emenda — os dois defeitos que o corretor enxerga no tour.
 * O modelo recebe o equirect montado pelo stitcher mais cada foto que o
 * originou, e devolve o mesmo panorama corrigido.
 *
 * Isso é deliberadamente o oposto da rota anterior, que recortava o equirect em
 * cubemap e só deixava a IA pintar onde não havia pixel fotografado. Aquela era
 * segura por construção e foi reprovada no olho; esta é mais arriscada e ataca o
 * defeito certo. O que a torna testável em vez de ingênua são as fotos de
 * referência: sem elas, o mesmo modelo já devolveu outro imóvel no experimento C
 * do bake-off.
 *
 * Por isso o original nunca é sobrescrito: quem decide se o resultado presta é o
 * olho de quem conhece o imóvel, e reverter tem que custar apagar uma coluna.
 */

/**
 * Teto real para uma imagem 2:1 no gpt-image-2.
 *
 * A documentação do SDK diz: lados divisíveis por 16, proporção entre 1:3 e 3:1,
 * e resolução máxima de 3840×2160. Para 2:1 o que morde antes é o total de
 * pixels: 3840×1920 dá 7.372.800, e o próximo passo par (4096×2048) estouraria.
 *
 * Consequência que vale ter em mente: o stitcher entrega 5120×2560, maior do que
 * o modelo sabe devolver. A imagem é reduzida para vir aqui e reamostrada de
 * volta depois, então a passagem pela IA custa resolução. Não há como pedir mais
 * — nem no prompt, nem no `size`.
 */
export const LARGURA_MODELO = 3840;
export const ALTURA_MODELO = 1920;

/** Estimativa pública por imagem; conferir contra a fatura antes de projetar custo. */
export const CUSTO_POR_PANORAMA = 0.19;

export const MODELO = 'gpt-image-2';

/**
 * Fotos de referência por requisição. A API aceita 16 imagens e uma delas é o
 * próprio equirect.
 */
export const MAXIMO_DE_FOTOS = 15;

/**
 * Escolhe até `maximo` fotos distribuídas por toda a volta.
 *
 * O corte antigo era `slice(0, 15)`, e ele quebrava calado a única afirmação do
 * prompt que orienta o modelo espacialmente: a de que a referência k cobre a
 * k-ésima faixa da largura. Numa captura de 20 fotos, as 15 primeiras cobrem
 * 270° — o modelo era informado de que tinha referência para o panorama inteiro
 * enquanto um quarto dele nunca chegou, e as 15 faixas anunciadas ficavam todas
 * deslocadas. Pegando de forma espaçada, cada escolhida cai perto da faixa que o
 * prompt promete e a volta continua coberta.
 */
export function amostrarAnel<T>(fotos: T[], maximo = MAXIMO_DE_FOTOS): T[] {
  if (maximo <= 0) return [];
  if (fotos.length <= maximo) return fotos;

  const escolhidas: T[] = [];
  for (let k = 0; k < maximo; k++) {
    const i = Math.min(fotos.length - 1, Math.round((k * fotos.length) / maximo));
    escolhidas.push(fotos[i]);
  }
  return escolhidas;
}

export interface PedidoMontagem {
  /** Equirect 2:1 já reduzido a `LARGURA_MODELO × ALTURA_MODELO`, em PNG. */
  panorama: Buffer;
  /** Fotos da captura em ordem angular, PNG. A ordem é afirmada no prompt. */
  fotos: Buffer[];
}

/**
 * O que a API cobrou de fato, quando ela conta.
 *
 * Existe porque a estimativa de US$ 0,19 é pública e velha, e o prompt cresceu
 * bastante desde que ela foi anotada. Em vez de discutir de quanto foi o
 * aumento, a resposta fica gravada no `treatmentMeta`.
 *
 * Ressalva medida em 13/08/2026: os números que a API devolveu na primeira
 * montagem não fecham (8 tokens de entrada para um prompt de ~2.000 mais nove
 * imagens). O campo fica gravado como registro do que a API respondeu, mas para
 * custo real o que vale é a fatura.
 *
 * Só as chaves que vieram entram no mapa — `entrada`, `saida`, `entradaTexto` e
 * `entradaImagem` quando a API as informa. Um `undefined` aqui não seria JSON
 * válido para o Prisma, e "não sei" tem que ser ausência, não um campo vazio.
 */
export type UsoDeTokens = Record<string, number>;

export interface ResultadoMontagem {
  imagem: Buffer;
  ms: number;
  custoUSD: number;
  /** Chamadas geradoras cobradas. Só passa de 1 se houve retry pago. */
  tentativas: number;
  uso?: UsoDeTokens;
}

/**
 * Tentativas extras permitidas, e só para 429.
 *
 * O SDK da OpenAI reenvia sozinho até duas vezes por padrão. Numa rota em que
 * cada chamada custa US$ 0,19 isso significa gastar até três vezes o previsto
 * sem nada no log dizendo, enquanto `custoUSD` continuava registrando uma —
 * exatamente o contrário da regra que vale no resto deste código, de o número
 * aparecer antes de gastar. Por isso o cliente vai com `maxRetries: 0` e o
 * retry é explícito aqui.
 *
 * 429 é o único caso seguro de repetir: a requisição foi recusada na porta, sem
 * geração e sem cobrança. Um 5xx pode ter gerado a imagem antes de falhar, e
 * repeti-lo cobraria duas. Esses viram FAILED, o panorama original continua
 * servindo o tour, e retratar é uma decisão de quem vê o custo impresso.
 */
const TENTATIVAS_EXTRAS = 2;
const ESPERA_APOS_429_MS = 4000;

/**
 * O prompt é parametrizado pela contagem de fotos porque metade das capturas tem
 * 12 ou 15, não 8. Chumbar "8" e "45°" faria o modelo procurar emenda onde não
 * há — a instrução deixaria de ajudar e passaria a apontar para o lugar errado.
 *
 * As dimensões também são interpoladas, e não escritas à mão, porque o prompt as
 * afirma em três lugares e elas precisam bater com o `size` que a requisição
 * manda. Pedir no texto um tamanho que a API não gera é instrução impossível, e
 * instrução impossível costuma contaminar o resto da resposta.
 */
export function promptDeMontagem(quantidadeDeFotos: number): string {
  const n = quantidadeDeFotos;
  const passo = Math.round(360 / n);
  const ultima = n + 1;
  const fracao = n === 8 ? 'eighth' : `1/${n}`;
  const largura = LARGURA_MODELO;
  const altura = ALTURA_MODELO;

  return `You are a high-end 360° real-estate panorama restoration specialist.

This is a reality-preserving photographic correction task, not a creative image-generation task. Accuracy is a legal requirement because a prospective buyer may compare the final panorama with the physical property.

When any area is ambiguous, preserve the original panorama rather than guessing, completing, beautifying, or inventing content.

## INPUTS

* **Image 1:** The automatically stitched 360° equirectangular panorama that must be corrected and enhanced.
* **Images 2–${ultima}:** The ${n} original source photographs used to create the panorama, provided in angular order. These images are the ground truth and must be used to determine what physically exists in the room.

Reference 1 corresponds primarily to the leftmost ${fracao} of the panorama. Each following reference advances approximately ${passo}° to the right. Reference k therefore corresponds approximately to the horizontal interval from \`(k-1)/${n}\` to \`k/${n}\` of the panorama width.

## OUTPUT GEOMETRY AND RESOLUTION

Produce a final equirectangular panorama with:

* Exact output dimensions of **${largura} × ${altura} pixels**.
* An exact **2:1 aspect ratio**, meaning \`${largura} = 2 × ${altura}\`.
* The exact same field of view, camera position, panorama orientation, horizon position, and composition as Image 1.
* No cropping, rotation, zooming, reframing, recentering, perspective correction, or horizon re-leveling.

If Image 1 is smaller than the target resolution, upscale it using conservative, non-generative photographic super-resolution. Improve the representation of real edges and textures, but do not create details that cannot be verified in Image 1 or the source photographs.

## EQUIRECTANGULAR PROJECTION

The panorama uses an equirectangular projection.

Straight architectural lines in the physical room may appear curved in the flat panorama. This curvature is correct and must be preserved. Do not straighten walls, door frames, window frames, baseboards, ceiling lines, floor lines, furniture edges, or other architectural elements.

The panorama is horizontally continuous: the right edge connects directly to the left edge. The wraparound seam must remain perfectly continuous, without any jump in geometry, texture, exposure, color, sharpness, or noise.

## ZENITH AND NADIR PROTECTION

Only the central horizontal band—approximately ±45° from the horizon—contains reliable photographic information.

The upper and lower caps, including the blurred center of the ceiling at the **zenith** and the blurred center of the floor at the **nadir**, were filled or blurred by the original panorama software.

Preserve these blurred areas as they are:

* Do not deblur, sharpen, reconstruct, extend, or reveal them.
* Do not invent ceiling or floor details.
* Do not add lamps, skylights, vents, beams, tiles, floorboards, drains, rugs, cables, tripod parts, shadows, reflections, or any other structure.
* Do not use content-aware filling or generative inpainting in these areas.
* Only non-structural exposure, color, noise-reduction, and resolution-scaling adjustments may be applied, while preserving the original blur and silhouettes.
* If a stitching defect reaches one of these areas, continue only a structure that is already clearly visible. Otherwise, leave the area unchanged.

## PHOTOGRAPHIC QUALITY ENHANCEMENT

Improve the panorama conservatively while preserving its documentary accuracy:

1. Increase brightness and recover underexposed shadow information without producing washed-out blacks, artificial HDR, or clipped highlights.
2. Correct white balance and remove unwanted color casts while preserving the real colors of walls, furniture, fabrics, flooring, and lighting.
3. Improve global and local contrast without creating halos, crushed shadows, or exaggerated clarity.
4. Reduce luminance noise, chroma noise, JPEG blocking, mosquito noise, banding, and compression artifacts.
5. Apply restrained edge-aware sharpening after upscaling, avoiding halos, ringing, oversharpening, or artificial micro-detail.
6. Preserve natural material texture, including wood grain, fabric weave, wall texture, tile surfaces, and subtle photographic grain.
7. Avoid waxy surfaces, plastic-looking textures, painterly details, repeated patterns, or a 3D-rendered appearance.

Quality enhancement must not change the geometry, identity, quantity, location, shape, material, or style of any physical element.

## STITCHING DEFECTS — PRIORITY ORDER

### 1. Parallax and duplicated objects

The camera may not have rotated around its optical center. Nearby objects may therefore appear twice, ghosted, split, displaced, or broken across a seam.

Correct every such defect, including small elements such as:

* Chair and table legs
* Door and window frames
* Baseboards
* Electrical outlets and switches
* Handles and hinges
* Picture frames
* Plants and leaves
* Cables
* Decorative objects
* Furniture edges

Each physical object must appear exactly once.

### 2. Geometric seam discontinuities

Correct horizontal or vertical jumps where adjacent source photographs meet.

Internal stitching seams are expected near:

\`x = k/${n}\` of the panorama width, for \`k = 1 ... ${n - 1}\`.

Also inspect and correct the wraparound seam between the right and left edges.

### 3. Texture, lighting, and color discontinuities

Correct seam-related changes in:

* Floor and wall texture
* Ceiling texture
* Rugs and fabrics
* Tile and grout patterns
* Wood grain
* Picture frames
* Exposure and shadow density
* Contrast
* White balance
* Sharpness
* Noise and compression level

## CORRECTION METHOD

Correct by **selecting the most reliable source**, not by averaging conflicting images.

When an object or region is duplicated:

1. Identify the source photograph in which the area appears most clearly and closest to the center of the source frame.
2. Use that single source as the geometric and visual truth for the affected region.
3. Reconstruct only the defective area from that source.
4. Do not average or transparently blend two conflicting object positions, because this creates ghosting.

Make continuous elements cross seams without interruption. Grout lines, floorboards, tile joints, frames, baseboards, and wall-to-floor or wall-to-ceiling boundaries must continue smoothly while retaining their natural equirectangular curvature.

Use localized corrections. Outside the defective areas, preserve the original geometry and scene content. Global photographic adjustments and non-generative upscaling are allowed, but they must not alter the physical scene.

## HARD RESTRICTIONS

Never:

* Invent, add, remove, relocate, duplicate, redesign, beautify, or restyle any object or architectural feature.
* Replace furniture, appliances, decorations, surfaces, finishes, doors, windows, corners, walls, picture frames, or fixtures.
* Create details that are not visible in Image 1 or confirmed by the source photographs.
* Convert uncertain or blurred content into sharp invented content.
* Generate new floor or ceiling content.
* Remove intentional blur from the zenith or nadir.
* Straighten equirectangular curvature.
* crop, rotate, zoom, reframe, recenter, or re-level the panorama.
* Change the camera position, viewing direction, or field of view.
* Apply stylization, virtual staging, object cleanup, or architectural redesign.
* Add text, logos, watermarks, borders, people, reflections, or shadows not present in the references.
* Produce repeated cloned textures, painterly patches, or synthetic 3D-rendered surfaces.

## FINAL VERIFICATION

Before delivering the image, verify that:

1. Every physical object appears exactly once.
2. No object is ghosted, duplicated, split, stretched, or displaced.
3. Every internal seam is invisible in geometry, texture, sharpness, exposure, noise, and color.
4. The right and left edges connect seamlessly.
5. Small objects and thin structural elements remain intact.
6. No element has been introduced unless it is confirmed by the source photographs.
7. The zenith and nadir remain blurred and contain no invented floor or ceiling detail.
8. Dark areas are clearer but still natural.
9. JPEG artifacts and noise are reduced without destroying real texture.
10. White balance, contrast, and sharpness are consistent throughout the panorama.
11. The panorama retains the exact original composition and equirectangular projection.
12. The final dimensions are exactly **${largura} × ${altura} pixels**, with an exact **2:1 aspect ratio**.

## OUTPUT

Return only the corrected and enhanced panorama at **${largura} × ${altura} pixels** in exact 2:1 equirectangular format.

Do not include comments, captions, explanations, labels, comparison images, before-and-after layouts, borders, or watermarks.`;
}

/**
 * Uma chamada por panorama. A API aceita 16 imagens por requisição, o que cobre
 * o equirect mais até 15 fotos — o teto das capturas atuais.
 */
export async function montarPanorama(pedido: PedidoMontagem): Promise<ResultadoMontagem> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada.');

  // `maxRetries: 0` é deliberado — ver TENTATIVAS_EXTRAS.
  const cliente = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });

  const imagens = [
    await toFile(pedido.panorama, 'panorama.png', { type: 'image/png' }),
    ...(await Promise.all(
      pedido.fotos.map((f, i) => toFile(f, `foto-${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' })),
    )),
  ];

  const inicio = Date.now();
  let tentativas = 0;

  for (let extra = 0; ; extra++) {
    try {
      tentativas++;
      const resposta = await cliente.images.edit({
        model: MODELO,
        image: imagens,
        prompt: promptDeMontagem(pedido.fotos.length),
        size: `${LARGURA_MODELO}x${ALTURA_MODELO}`,
        // SEM `input_fidelity`. O tipo do SDK diz que o parâmetro vale para
        // "gpt-image-1, gpt-image-1.5 and later models", e o gpt-image-2 é
        // posterior — mas a API ao vivo responde:
        //
        //   400 The model 'gpt-image-2' does not support the
        //   'input_fidelity' parameter.
        //
        // Medido em 13/08/2026. A documentação do .d.ts está adiantada em
        // relação ao que o modelo aceita; quem manda é a resposta da API.
        // Recusa é 400 na validação, antes de gerar, então testar não custou.
      } as never);

      const b64 = (resposta as { data?: Array<{ b64_json?: string }> })?.data?.[0]?.b64_json;
      if (!b64) throw new Error('A OpenAI não devolveu imagem.');

      return {
        imagem: Buffer.from(b64, 'base64'),
        ms: Date.now() - inicio,
        // Um 429 é recusado antes de gerar, então não entra na conta.
        custoUSD: CUSTO_POR_PANORAMA,
        tentativas,
        uso: extrairUso(resposta),
      };
    } catch (erro) {
      if (extra >= TENTATIVAS_EXTRAS || !ehLimiteDeTaxa(erro)) throw anotarCusto(erro);
      tentativas--; // não gerou, não custou
      await new Promise((r) => setTimeout(r, ESPERA_APOS_429_MS * (extra + 1)));
    }
  }
}

/** 429: recusado na porta, sem geração e sem cobrança — o único retry seguro. */
function ehLimiteDeTaxa(erro: unknown): boolean {
  return (erro as { status?: number })?.status === 429;
}

/**
 * Quanto uma falha PODE ter custado, anotado no próprio erro.
 *
 * Nem toda falha sai de graça, e tratar todas como grátis fazia o total impresso
 * mentir para baixo: num lote de 20 com 3 falhas depois da geração, o script
 * anunciava US$ 3,23 e a fatura vinha US$ 3,80. Isso contradiz a regra que vale
 * no resto deste código, de o número que aparece ser o número que se paga.
 *
 * A divisão:
 *   - 4xx  → recusado na porta (parâmetro inválido, chave errada, cota
 *            estourada). Nada foi gerado, nada foi cobrado.
 *   - 5xx, queda de rede, ou 200 sem imagem → a geração pode ter acontecido
 *            antes de a resposta se perder, e no caso do 200 sem imagem ela
 *            aconteceu. Conta como cobrada.
 *
 * A anotação é feita AQUI, e não no serviço, porque só aqui se sabe que a
 * chamada chegou a ser tentada: uma falha de `sharp` antes disso não recebe
 * marca nenhuma e continua valendo zero.
 */
function anotarCusto(erro: unknown): unknown {
  const status = (erro as { status?: number })?.status;
  const semGeracao = typeof status === 'number' && status >= 400 && status < 500;

  if (erro instanceof Error || (typeof erro === 'object' && erro !== null)) {
    (erro as { custoUSD?: number }).custoUSD = semGeracao ? 0 : CUSTO_POR_PANORAMA;
  }
  return erro;
}

/** O que ficou anotado por `anotarCusto`; zero se a chamada nem chegou a sair. */
export function custoDaFalha(erro: unknown): number {
  const c = (erro as { custoUSD?: number })?.custoUSD;
  return typeof c === 'number' ? c : 0;
}

/**
 * Lê o `usage` da resposta, se vier. Defensivo de propósito: o campo é
 * documentado para os modelos GPT image mas não é garantido, e ficar sem a
 * contagem não pode derrubar uma montagem que já foi paga.
 */
function extrairUso(resposta: unknown): UsoDeTokens | undefined {
  const u = (
    resposta as {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { text_tokens?: number; image_tokens?: number };
      };
    }
  )?.usage;
  if (!u) return undefined;

  const uso: UsoDeTokens = {};
  const anotar = (chave: string, valor: number | undefined) => {
    if (typeof valor === 'number') uso[chave] = valor;
  };

  anotar('entrada', u.input_tokens);
  anotar('saida', u.output_tokens);
  anotar('entradaTexto', u.input_tokens_details?.text_tokens);
  anotar('entradaImagem', u.input_tokens_details?.image_tokens);

  return Object.keys(uso).length > 0 ? uso : undefined;
}
