import { Raster } from './cubemap';
import { casarCorNaBorda, distanciaAoBuraco, recomporComPena } from './juncao';
import { descontinuidadeNaBorda } from './providers';

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

/** Metade de cima fotografada (255), metade de baixo é o buraco (0). */
const cobertura = (lado = 16) => raster(lado, lado, (_x, y) => (y < lado / 2 ? 255 : 0));

describe('juncao', () => {
  describe('distanciaAoBuraco', () => {
    it('dá zero no buraco e cresce entrando na fotografia', () => {
      const dist = distanciaAoBuraco(cobertura(16), 8);
      const em = (x: number, y: number) => dist[y * 16 + x];

      expect(em(4, 8)).toBe(0); // primeira linha do buraco
      expect(em(4, 7)).toBe(1); // colada na fronteira
      expect(em(4, 6)).toBe(2);
      expect(em(4, 5)).toBe(3);
    });

    it('satura no máximo pedido, para não varrer a imagem inteira', () => {
      const dist = distanciaAoBuraco(cobertura(16), 3);
      expect(Math.max(...Array.from(dist))).toBe(3);
      expect(dist[0 * 16 + 4]).toBe(3);
    });

    it('é zero em toda parte quando não há fotografia', () => {
      const dist = distanciaAoBuraco(raster(8, 8, () => 0), 5);
      expect(Array.from(dist).every((d) => d === 0)).toBe(true);
    });
  });

  describe('casarCorNaBorda', () => {
    it('corrige o degrau de cor do gerado usando a borda como referência', () => {
      // O caso real do bake-off: teto fotografado branco (200), teto gerado bege
      // (120). Sem correção o anel é de 80 níveis.
      const cob = cobertura(16);
      const original = raster(16, 16, () => 200);
      const gerado = raster(16, 16, () => 120);

      const corrigido = casarCorNaBorda(gerado, original, cob, 6);

      // A média do gerado tem de subir para perto da fotografia.
      const centroBuraco = (14 * 16 + 8) * 4;
      expect(corrigido.data[centroBuraco]).toBeGreaterThan(180);
      expect(corrigido.data[centroBuraco]).toBeLessThanOrEqual(255);
    });

    /**
     * O que os outros casos não pegavam por usarem cor chapada: a estatística
     * tem de vir da FAIXA colada na fronteira, não da região fotografada
     * inteira. Aqui o interior é escuro (60) e só as linhas junto ao buraco são
     * claras (200) — se o filtro de faixa não morder, a média de referência
     * despenca e a correção vai para o lugar errado.
     */
    it('mede só a faixa junto à fronteira, não a fotografia inteira', () => {
      const cob = cobertura(16);
      const original = raster(16, 16, (_x, y) => (y >= 6 && y < 8 ? 200 : 60));
      const gerado = raster(16, 16, () => 100);

      const corrigido = casarCorNaBorda(gerado, original, cob, 2);

      // Referência é a faixa de 200, então o gerado sobe na direção dela.
      const centroBuraco = (12 * 16 + 8) * 4;
      expect(corrigido.data[centroBuraco]).toBeGreaterThan(150);
    });

    it('derruba o `borda` medido depois da recomposição', () => {
      const cob = cobertura(16);
      const original = raster(16, 16, () => 200);
      const gerado = raster(16, 16, () => 120);

      const antes = descontinuidadeNaBorda(recomporComPena(original, gerado, cob, 0), cob);
      const depois = descontinuidadeNaBorda(
        recomporComPena(original, casarCorNaBorda(gerado, original, cob, 6), cob, 0),
        cob,
      );

      expect(antes).toBeCloseTo(80, 0);
      expect(depois).toBeLessThan(antes / 4);
    });

    it('não inventa correção quando falta borda dos dois lados', () => {
      const tudoFoto = raster(8, 8, () => 255);
      const gerado = raster(8, 8, () => 10);

      const saida = casarCorNaBorda(gerado, raster(8, 8, () => 200), tudoFoto, 4);

      expect(Array.from(saida.data)).toEqual(Array.from(gerado.data));
      expect(saida.data).not.toBe(gerado.data);
    });

    it('trava o ganho para uma borda lisa não explodir o contraste', () => {
      // Fotografia de desvio zero (parede chapada) contra gerado com variação:
      // sem trava a razão de desvios seria enorme.
      const cob = cobertura(16);
      const original = raster(16, 16, () => 200);
      const gerado = raster(16, 16, (x, y) => 100 + ((x * 7 + y * 13) % 40));

      const corrigido = casarCorNaBorda(gerado, original, cob, 6, 1.6);

      for (let i = 0; i < corrigido.data.length; i += 4) {
        expect(corrigido.data[i]).toBeGreaterThanOrEqual(0);
        expect(corrigido.data[i]).toBeLessThanOrEqual(255);
      }
    });
  });

  describe('recomporComPena', () => {
    it('com pena zero é o corte seco da primeira rodada', () => {
      const cob = cobertura(8);
      const original = raster(8, 8, () => 200);
      const gerado = raster(8, 8, () => 100);

      const saida = recomporComPena(original, gerado, cob, 0);

      expect(saida.data[(1 * 8 + 4) * 4]).toBe(200); // fotografia intacta
      expect(saida.data[(6 * 8 + 4) * 4]).toBe(100); // buraco, todo gerado
    });

    it('faz a transição ao longo da pena em vez de saltar', () => {
      const cob = cobertura(16);
      const original = raster(16, 16, () => 200);
      const gerado = raster(16, 16, () => 100);

      const saida = recomporComPena(original, gerado, cob, 4);
      const em = (y: number) => saida.data[(y * 16 + 8) * 4];

      // Descendo em direção ao buraco, o gerado pesa cada vez mais.
      expect(em(4)).toBe(200); // além da pena: fotografia pura
      expect(em(7)).toBeLessThan(em(6));
      expect(em(6)).toBeLessThan(em(5));
      expect(em(8)).toBe(100); // dentro do buraco: gerado puro
    });

    it('preserva a fotografia além da faixa da pena', () => {
      const cob = cobertura(16);
      const original = raster(16, 16, () => 200);
      const saida = recomporComPena(original, raster(16, 16, () => 0), cob, 3);

      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 16; x++) {
          expect(saida.data[(y * 16 + x) * 4]).toBe(200);
        }
      }
    });

    it('mantém o original onde o modelo devolveu transparente', () => {
      const cob = cobertura(8);
      const original = raster(8, 8, () => 200);
      const gerado = raster(8, 8, () => 0);
      for (let i = 3; i < gerado.data.length; i += 4) gerado.data[i] = 0;

      const saida = recomporComPena(original, gerado, cob, 3);

      for (let i = 0; i < saida.data.length; i += 4) expect(saida.data[i]).toBe(200);
    });
  });
});
