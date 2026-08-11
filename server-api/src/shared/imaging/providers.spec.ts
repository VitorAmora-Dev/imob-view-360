import { Raster } from './cubemap';
import {
  alinharAoLimite,
  derivaForaDaMascara,
  descontinuidadeNaBorda,
  diferencaMedia,
  recomporPelaCobertura,
} from './providers';

function raster(width: number, height: number, valor: (x: number, y: number) => number): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = valor(x, y);
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Metade de cima fotografada, metade de baixo é o buraco a preencher. */
const cobertura = raster(8, 8, (_x, y) => (y < 4 ? 255 : 0));

describe('providers', () => {
  describe('recomporPelaCobertura', () => {
    it('mantém a fotografia mesmo quando o modelo repinta a face inteira', () => {
      const original = raster(8, 8, () => 100);
      const modeloDesobediente = raster(8, 8, () => 7);

      const final = recomporPelaCobertura(original, modeloDesobediente, cobertura);

      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const i = (y * 8 + x) * 4;
          // Em cima só pode haver original; embaixo só pode haver gerado.
          expect(final.data[i]).toBe(y < 4 ? 100 : 7);
        }
      }
    });

    it('não devolve o buffer de entrada', () => {
      const original = raster(4, 4, () => 10);
      const final = recomporPelaCobertura(original, raster(4, 4, () => 20), raster(4, 4, () => 255));
      expect(final.data).not.toBe(original.data);
      expect(final.data[0]).toBe(10);
    });

    it('mantém o original onde o modelo devolveu transparente', () => {
      // É assim que o gpt-image-2 diz "não mexi aqui". Copiar esse pixel daria
      // preto — foi o que produziu as lascas pretas na borda do buraco.
      const original = raster(8, 8, () => 100);
      const gerado = raster(8, 8, () => 0);
      for (let i = 3; i < gerado.data.length; i += 4) gerado.data[i] = 0;

      const final = recomporPelaCobertura(original, gerado, cobertura);

      for (let i = 0; i < final.data.length; i += 4) expect(final.data[i]).toBe(100);
    });

    it('opaca o que gerou, para o buraco nunca sair transparente', () => {
      const original = raster(4, 4, () => 10);
      const gerado = raster(4, 4, () => 20);
      for (let i = 3; i < gerado.data.length; i += 4) gerado.data[i] = 0;

      const final = recomporPelaCobertura(original, gerado, raster(4, 4, () => 0));

      for (let i = 3; i < final.data.length; i += 4) expect(final.data[i]).toBe(255);
    });
  });

  describe('derivaForaDaMascara', () => {
    it('dá zero quando o modelo devolve intacto o que era fotografia', () => {
      const original = raster(8, 8, (x) => x * 10);
      const gerado = raster(8, 8, (x, y) => (y < 4 ? x * 10 : 0));

      expect(derivaForaDaMascara(original, gerado, cobertura)).toBe(0);
    });

    it('mede só a região fotografada, ignorando o buraco', () => {
      const original = raster(8, 8, () => 100);
      // Erra 30 em cima (fotografia) e 200 embaixo (buraco, que não conta).
      const gerado = raster(8, 8, (_x, y) => (y < 4 ? 130 : 255));

      expect(derivaForaDaMascara(original, gerado, cobertura)).toBeCloseTo(30, 6);
    });

    it('é zero quando não sobra nada fotografado para comparar', () => {
      const tudoBuraco = raster(4, 4, () => 0);
      expect(derivaForaDaMascara(raster(4, 4, () => 1), raster(4, 4, () => 250), tudoBuraco)).toBe(0);
    });

    it('não acusa deriva quando o modelo devolveu transparente', () => {
      // O caso do gpt-image-2: região preservada volta transparente. Ler isso
      // como preto marcaria 100 de deriva num modelo que obedeceu.
      const original = raster(8, 8, () => 100);
      const gerado = raster(8, 8, () => 0);
      for (let i = 3; i < gerado.data.length; i += 4) gerado.data[i] = 0;

      expect(derivaForaDaMascara(original, gerado, cobertura)).toBe(0);
    });
  });

  describe('diferencaMedia', () => {
    it('mede a imagem inteira, que é o que interessa numa edição global', () => {
      expect(diferencaMedia(raster(4, 4, () => 100), raster(4, 4, () => 130))).toBeCloseTo(30, 6);
      expect(diferencaMedia(raster(4, 4, () => 100), raster(4, 4, () => 100))).toBe(0);
    });
  });

  describe('descontinuidadeNaBorda', () => {
    it('é zero quando o gerado continua o tom da fotografia', () => {
      const face = raster(8, 8, () => 100);
      expect(descontinuidadeNaBorda(face, cobertura)).toBe(0);
    });

    it('acusa o degrau quando o gerado tem outro tom', () => {
      // Fotografia em 100, preenchimento em 160: o anel de 60 níveis na junção
      // é exatamente o que se vê como emenda no tour.
      const face = raster(8, 8, (_x, y) => (y < 4 ? 100 : 160));
      expect(descontinuidadeNaBorda(face, cobertura)).toBeCloseTo(60, 6);
    });

    it('ignora variação longe da fronteira', () => {
      // Degrau grande, mas inteiro dentro da região gerada.
      const face = raster(8, 8, (_x, y) => (y < 6 ? 100 : 250));
      expect(descontinuidadeNaBorda(face, cobertura)).toBe(0);
    });

    it('é zero quando não existe fronteira', () => {
      const tudoFoto = raster(8, 8, () => 255);
      expect(descontinuidadeNaBorda(raster(8, 8, (x) => x * 30), tudoFoto)).toBe(0);
    });
  });

  describe('alinharAoLimite', () => {
    it('arredonda para múltiplo de 16, que é o que o gpt-image-2 aceita', () => {
      expect(alinharAoLimite(1280) % 16).toBe(0);
      expect(alinharAoLimite(1280)).toBe(1280);
      expect(alinharAoLimite(1290) % 16).toBe(0);
      expect(alinharAoLimite(2048)).toBe(2048);
    });

    it('respeita o piso e o teto de pixels totais', () => {
      // 655.360 px totais ⇒ lado mínimo ~810, subido ao múltiplo de 16.
      expect(alinharAoLimite(64)).toBeGreaterThanOrEqual(816);
      expect(alinharAoLimite(64) ** 2).toBeGreaterThanOrEqual(655360);

      // Numa face quadrada o teto que morde é o total (8.294.400), não o lado
      // máximo de 3840 — 3840² estouraria em 78%.
      expect(alinharAoLimite(9999)).toBe(2880);
      expect(alinharAoLimite(9999) ** 2).toBeLessThanOrEqual(8294400);
    });
  });
});
