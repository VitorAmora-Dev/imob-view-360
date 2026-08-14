import {
  ALTURA_MODELO,
  CUSTO_POR_PANORAMA,
  LARGURA_MODELO,
  MAXIMO_DE_FOTOS,
  amostrarAnel,
  custoDaFalha,
  promptDeMontagem,
} from './montagem-360';

describe('montagem-360', () => {
  describe('amostrarAnel', () => {
    it('devolve tudo quando cabe', () => {
      const fotos = [0, 1, 2, 3, 4, 5, 6, 7];
      expect(amostrarAnel(fotos)).toEqual(fotos);
    });

    it('nunca passa do teto da API', () => {
      const fotos = Array.from({ length: 24 }, (_, i) => i);
      expect(amostrarAnel(fotos)).toHaveLength(MAXIMO_DE_FOTOS);
    });

    it('só devolve índices válidos e em ordem angular', () => {
      const fotos = Array.from({ length: 24 }, (_, i) => i);
      const escolhidas = amostrarAnel(fotos);

      for (const f of escolhidas) expect(fotos).toContain(f);
      for (let k = 1; k < escolhidas.length; k++) {
        expect(escolhidas[k]).toBeGreaterThan(escolhidas[k - 1]);
      }
    });

    /**
     * O que o corte antigo quebrava. O prompt afirma que a referência k cobre a
     * k-ésima faixa da largura; com `slice(0, 15)` de 24 fotos, a última
     * escolhida ficava em 225° e o modelo era informado de que tinha referência
     * para uma volta inteira que não recebeu.
     */
    it('mantém a volta coberta até o fim', () => {
      const fotos = Array.from({ length: 24 }, (_, i) => i);
      const escolhidas = amostrarAnel(fotos);

      // A última escolhida precisa estar perto do fim do anel, não a três
      // quartos dele.
      expect(escolhidas[escolhidas.length - 1]).toBeGreaterThanOrEqual(fotos.length - 2);

      // E nenhum vão pode passar de duas fotos originais, senão a faixa
      // anunciada e a fotografada se descolam.
      for (let k = 1; k < escolhidas.length; k++) {
        expect(escolhidas[k] - escolhidas[k - 1]).toBeLessThanOrEqual(2);
      }
    });

    it('com teto zero não escolhe nada', () => {
      expect(amostrarAnel([1, 2, 3], 0)).toEqual([]);
    });
  });

  describe('promptDeMontagem', () => {
    it('descreve o anel realmente enviado, não um de 8', () => {
      const p = promptDeMontagem(12);

      expect(p).toContain('Images 2–13');
      expect(p).toContain('The 12 original source photographs');
      expect(p).toContain('advances approximately 30°');
      expect(p).toContain('k = 1 ... 11');
    });

    it('mantém as duas instruções que sustentam o resultado', () => {
      const p = promptDeMontagem(8);

      // Sem esta, o modelo "endireita" a curvatura e destrói o panorama.
      expect(p).toContain('This curvature is correct and must be preserved');
      // Sem esta, ele mistura duas vistas — que é o que produz fantasma.
      expect(p).toContain('selecting the most reliable source');
    });

    /**
     * O prompt afirma as dimensões em três lugares e a requisição manda `size`
     * separado. Se os dois se descolarem, o modelo recebe uma ordem que a API
     * não deixa cumprir — e 8192×4096, que chegou a ser pedido, está quatro
     * vezes acima do teto de pixels do gpt-image-2.
     */
    it('afirma exatamente o tamanho que a requisição pede', () => {
      const p = promptDeMontagem(8);
      const esperado = `${LARGURA_MODELO} × ${ALTURA_MODELO} pixels`;

      expect(p.split(esperado).length - 1).toBe(3);
      expect(p).toContain(`${LARGURA_MODELO} = 2 × ${ALTURA_MODELO}`);
      expect(LARGURA_MODELO * ALTURA_MODELO).toBeLessThanOrEqual(8_294_400);
      expect(LARGURA_MODELO % 16).toBe(0);
      expect(ALTURA_MODELO % 16).toBe(0);
    });
  });

  /**
   * O total impresso no fim de um lote precisa bater com a fatura. Tratar toda
   * falha como grátis fazia ele mentir para baixo — 3 falhas depois da geração
   * em 20 panoramas anunciavam US$ 3,23 contra US$ 3,80 cobrados.
   */
  describe('custoDaFalha', () => {
    const comCusto = (erro: unknown) => {
      (erro as { custoUSD?: number }).custoUSD = CUSTO_POR_PANORAMA;
      return erro;
    };

    it('é zero quando a chamada nem chegou a sair', () => {
      // Falha de `sharp` antes da API: nunca recebe anotação.
      expect(custoDaFalha(new Error('Panorama sem dimensões legíveis.'))).toBe(0);
    });

    it('é zero para erro anotado como recusa antes da geração', () => {
      const erro = new Error('400 parâmetro inválido');
      (erro as { custoUSD?: number }).custoUSD = 0;
      expect(custoDaFalha(erro)).toBe(0);
    });

    it('cobra quando a falha veio depois de a imagem ter sido gerada', () => {
      expect(custoDaFalha(comCusto(new Error('500 internal error')))).toBe(CUSTO_POR_PANORAMA);
    });

    it('não quebra com erro que não é objeto', () => {
      expect(custoDaFalha('caiu a rede')).toBe(0);
      expect(custoDaFalha(undefined)).toBe(0);
      expect(custoDaFalha(null)).toBe(0);
    });
  });
});
