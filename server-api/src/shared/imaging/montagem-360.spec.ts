import { MAXIMO_DE_FOTOS, amostrarAnel, promptDeMontagem } from './montagem-360';

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

      expect(p).toContain('Images 2-13');
      expect(p).toContain('the 12 source photographs');
      expect(p).toContain('advances 30°');
      expect(p).toContain('(k = 1..11)');
    });

    it('mantém as duas instruções que sustentam o resultado', () => {
      const p = promptDeMontagem(8);

      // Sem esta, o modelo "endireita" a curvatura e destrói o panorama.
      expect(p).toContain('Real-world straight lines appear CURVED');
      // Sem esta, ele mistura duas vistas — que é o que produz fantasma.
      expect(p).toContain('Fix by CHOOSING, not by blending');
    });
  });
});
