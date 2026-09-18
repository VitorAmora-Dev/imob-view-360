import sharp from 'sharp';
import {
  LARGURA_DA_CAPA,
  reduzirParaCapa,
} from '../src/modules/panoramas/capa-do-panorama';

async function panoramica(largura: number, altura: number): Promise<Buffer> {
  return sharp({
    create: {
      width: largura,
      height: altura,
      channels: 3,
      background: { r: 120, g: 120, b: 120 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('capa do panorama', () => {
  it('sai com 640 de largura', async () => {
    // O teste 5 da spec. Um tamanho só: 640 cobre o card de imóvel (320 CSS px
    // em tela 2x) e a faixa de cenas (292), e a diferença de banda entre os
    // dois não paga a complexidade de manter duas capas.
    const capa = await reduzirParaCapa(await panoramica(4096, 2048));

    expect((await sharp(capa).metadata()).width).toBe(LARGURA_DA_CAPA);
  });

  it('mantém a proporção 2:1 da equirretangular', async () => {
    const capa = await reduzirParaCapa(await panoramica(4096, 2048));

    const meta = await sharp(capa).metadata();
    expect(meta.height).toBe(LARGURA_DA_CAPA / 2);
  });

  it('não amplia uma panorâmica menor que a capa', async () => {
    // Esticar uma foto pequena só gastaria bytes: não há detalhe para inventar.
    const capa = await reduzirParaCapa(await panoramica(400, 200));

    expect((await sharp(capa).metadata()).width).toBe(400);
  });

  it('a capa é muito menor que a panorâmica de origem', async () => {
    const original = await panoramica(4096, 2048);

    const capa = await reduzirParaCapa(original);

    expect(capa.length).toBeLessThan(original.length / 4);
  });
});
