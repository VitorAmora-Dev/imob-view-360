import { Raster } from './cubemap';
import { costurarVolta, saltoNaVolta } from './volta';

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

describe('volta', () => {
  describe('saltoNaVolta', () => {
    it('é zero quando as duas bordas já casam', () => {
      expect(saltoNaVolta(raster(64, 8, () => 120))).toBe(0);
    });

    it('mede o degrau entre a primeira e a última coluna', () => {
      // Rampa de 100 a 140: a volta tem 40 de degrau.
      const r = raster(41, 4, (x) => 100 + x);
      expect(saltoNaVolta(r)).toBeCloseTo(40, 6);
    });
  });

  describe('costurarVolta', () => {
    it('derruba o salto que a IA introduziu', () => {
      const r = raster(64, 8, (x) => (x < 32 ? 100 : 140));
      const antes = saltoNaVolta(r);
      const depois = saltoNaVolta(costurarVolta(r, 8));

      expect(antes).toBeCloseTo(40, 6);
      expect(depois).toBeLessThan(antes / 8);
    });

    it('divide o degrau entre os dois lados, sem puxar um até o outro', () => {
      const r = raster(64, 4, (x) => (x === 63 ? 140 : 100));
      const c = costurarVolta(r, 8);

      // A borda esquerda sobe e a direita desce; nenhuma das duas fica onde estava.
      expect(c.data[0]).toBeGreaterThan(100);
      expect(c.data[(63) * 4]).toBeLessThan(140);
    });

    it('não mexe no miolo da imagem', () => {
      const r = raster(64, 4, (x) => (x < 32 ? 100 : 140));
      const c = costurarVolta(r, 6);

      for (let y = 0; y < 4; y++) {
        for (let x = 6; x < 58; x++) {
          const i = (y * 64 + x) * 4;
          expect(c.data[i]).toBe(r.data[i]);
        }
      }
    });

    it('não faz nada quando já está contínuo', () => {
      const r = raster(64, 4, () => 120);
      const c = costurarVolta(r, 8);
      expect(Array.from(c.data)).toEqual(Array.from(r.data));
    });

    it('limita a faixa a um quarto da largura', () => {
      // Pedido absurdo não pode invadir a imagem inteira.
      const r = raster(64, 4, (x) => (x < 32 ? 100 : 140));
      const c = costurarVolta(r, 10_000);
      const meio = (2 * 64 + 32) * 4;
      expect(c.data[meio]).toBe(r.data[meio]);
    });

    it('preserva o alfa', () => {
      const r = raster(32, 4, (x) => x * 4);
      const c = costurarVolta(r, 4);
      for (let i = 3; i < c.data.length; i += 4) expect(c.data[i]).toBe(255);
    });
  });
});
