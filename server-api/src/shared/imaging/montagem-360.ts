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
 * Teto real para uma imagem 2:1 no gpt-image-2. O limite que morde não é o lado
 * máximo de 3840 e sim o total de 8.294.400 px: 3840×1920 dá 7.372.800, e o
 * próximo passo par (4096×2048) estouraria.
 */
export const LARGURA_MODELO = 3840;
export const ALTURA_MODELO = 1920;

/** Estimativa pública por imagem; conferir contra a fatura antes de projetar custo. */
export const CUSTO_POR_PANORAMA = 0.19;

export interface PedidoMontagem {
  /** Equirect 2:1 já reduzido a `LARGURA_MODELO × ALTURA_MODELO`, em PNG. */
  panorama: Buffer;
  /** Fotos da captura em ordem angular, PNG. A ordem é afirmada no prompt. */
  fotos: Buffer[];
}

export interface ResultadoMontagem {
  imagem: Buffer;
  ms: number;
  custoUSD: number;
}

/**
 * O prompt é parametrizado pela contagem de fotos porque metade das capturas tem
 * 12 ou 15, não 8. Chumbar "8" e "45°" faria o modelo procurar emenda onde não
 * há — a instrução deixaria de ajudar e passaria a apontar para o lugar errado.
 */
export function promptDeMontagem(quantidadeDeFotos: number): string {
  const n = quantidadeDeFotos;
  const passo = Math.round(360 / n);
  const ultima = n + 1;
  const fracao = n === 8 ? 'eighth' : `1/${n}`;

  return `ROLE
You are a high-end panorama retoucher working on a real-estate 360° virtual tour.
Accuracy is legally required: a buyer will compare this image against the real room.

INPUTS
- Image 1: an equirectangular 360° panorama, 2:1, auto-stitched by an algorithm. This is the image you must repair.
- Images 2-${ultima}: the ${n} source photographs it was built from, in angular order. They are ground truth — use them to decide what is really there.
  Reference 1 covers the leftmost ${fracao} of the panorama; each following reference advances ${passo}° to the right, i.e. reference k covers roughly the band from (k-1)/${n} to k/${n} of the image width.

THE PROJECTION — READ THIS BEFORE EDITING
- Equirectangular. Real-world straight lines appear CURVED, and that is CORRECT. Do not straighten walls, door frames, skirting boards, ceiling lines or furniture edges. "Fixing" that curvature destroys the panorama.
- The image wraps: the left edge is continuous with the right edge. They must meet with no step in geometry, texture, brightness or colour.
- Only the middle horizontal band (roughly ±45° from the horizon) was actually photographed. The top and bottom bands were filled by software and have no reference. Do not invent lamps, vents, skylights, tripods or drains there. Leave them as they are unless a seam defect runs into them, and then continue only what is already visible.

DEFECTS TO REMOVE (priority order)
1. PARALLAX. The camera did not rotate around its optical centre, so objects near the camera appear twice, doubled, or with an edge broken and offset across a seam. This is the top priority and is non-negotiable, including on small objects: chair and table legs, door and window frames, power outlets, light switches, handles, picture frames, plants, cables, skirting boards.
2. SEAM STEPS. Geometry that jumps sideways or vertically where two photographs meet. Seams fall near x = k/${n} of the width (k = 1..${n - 1}), plus the wrap seam at the left/right edge.
3. TEXTURE AND TONE BREAKS. Flooring, wall paint, ceiling, rugs, fabric weave and embroidery, and picture frames changing material, pattern scale, grain direction, brightness, contrast or white balance from one side of a seam to the other.

METHOD
- Fix by CHOOSING, not by blending. Where a region is doubled, pick the single source view that shows it most faithfully — normally the reference where it sits closest to the frame centre — and reconstruct the region from that one view. Do not average two views: averaging is exactly what produces ghosting.
- Carry continuous features through the seam: grout lines, floorboards, tile joints, mouldings, and the wall/floor and wall/ceiling meeting lines must run through unbroken, keeping their smooth equirectangular curvature.
- Repair locally. Every pixel that is already correct must come out unchanged. This is a targeted repair, not a re-render and not a restyle.
- Keep it photographic. Match the existing grain, sharpness and noise. No blur, no smear, no painterly or 3D-rendered look, no cloned patch that reads as a repeated pattern.

HARD CONSTRAINTS — NEVER
- Never invent, add, remove, move or restyle any object, furniture, appliance, finish, corner, wall edge, window, door or picture frame. If it is not in the references, it does not exist.
- Never crop, rotate, re-centre, zoom, re-level the horizon, or change the framing.
- Never change the aspect ratio or resolution: the output must be exactly 2:1 and the same pixel dimensions as image 1.
- Never straighten the equirectangular curvature.
- Never add text, logos, watermarks or borders.

SELF-CHECK BEFORE RETURNING
Verify against the references: (a) no object appears twice; (b) every seam, including the left/right wrap, is invisible in geometry, texture and tone; (c) small objects are intact and single; (d) nothing exists that is not in the references; (e) dimensions and framing are unchanged.

OUTPUT
Return only the corrected panorama, same pixel dimensions, 2:1. No commentary, no before/after.`;
}

/**
 * Uma chamada por panorama. A API aceita 16 imagens por requisição, o que cobre
 * o equirect mais até 15 fotos — o teto das capturas atuais.
 */
export async function montarPanorama(pedido: PedidoMontagem): Promise<ResultadoMontagem> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada.');

  const cliente = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const imagens = [
    await toFile(pedido.panorama, 'panorama.png', { type: 'image/png' }),
    ...(await Promise.all(
      pedido.fotos.map((f, i) => toFile(f, `foto-${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' })),
    )),
  ];

  const inicio = Date.now();
  // Sem `input_fidelity`: o gpt-image-2 removeu o parâmetro e a requisição falha
  // se ele for enviado — a entrada já é processada em alta fidelidade.
  const resposta = await cliente.images.edit({
    model: 'gpt-image-2',
    image: imagens,
    prompt: promptDeMontagem(pedido.fotos.length),
    size: `${LARGURA_MODELO}x${ALTURA_MODELO}`,
  } as never);
  const ms = Date.now() - inicio;

  const b64 = (resposta as { data?: Array<{ b64_json?: string }> })?.data?.[0]?.b64_json;
  if (!b64) throw new Error('A OpenAI não devolveu imagem.');

  return { imagem: Buffer.from(b64, 'base64'), ms, custoUSD: CUSTO_POR_PANORAMA };
}
