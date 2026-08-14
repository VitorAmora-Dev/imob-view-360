import { Raster } from './cubemap';
import { Orientacao } from './coverage';
import { desvioWB, emStops, luminancia, medirFotometria } from './fotometria';

/** Anel plano de `n` fotos, mesmo formato do `orientacoes.json` real. */
function anel(n: number): Orientacao[] {
  return Array.from({ length: n }, (_, i) => {
    const meioAngulo = (-(i / n) * 2 * Math.PI) / 2;
    return {
      arquivo: `${String(i).padStart(2, '0')}.jpg`,
      quaternion: { x: 0, y: Math.sin(meioAngulo), z: 0, w: Math.cos(meioAngulo) },
    };
  });
}

/**
 * Frame de cor chapada. A cena é uniforme de propósito: assim qualquer
 * diferença medida entre dois frames só pode ter vindo do ganho aplicado, que é
 * exatamente o que a fotometria deveria isolar.
 */
function frameUniforme(rgb: [number, number, number], lado = 32): Raster {
  const data = new Uint8ClampedArray(lado * lado * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { data, width: lado, height: lado };
}

const OPTS = { vfovDeg: 95, frameAspect: 0.75 };

describe('fotometria', () => {
  describe('emStops', () => {
    it('conta dobro e metade como uma parada', () => {
      expect(emStops(2)).toBeCloseTo(1, 6);
      expect(emStops(0.5)).toBeCloseTo(1, 6);
      expect(emStops(1)).toBe(0);
      expect(emStops(4)).toBeCloseTo(2, 6);
    });
  });

  describe('desvioWB', () => {
    it('é zero quando os três canais andam juntos', () => {
      expect(desvioWB([2, 2, 2])).toBeCloseTo(0, 6);
      expect(desvioWB([1, 1, 1])).toBe(0);
    });

    it('acusa dominante de cor mesmo com a exposição igual', () => {
      // Vermelho 20% acima e azul 20% abaixo do verde: exposição média quase
      // intacta, balanço de branco claramente torto.
      expect(desvioWB([1.2, 1, 0.8])).toBeCloseTo(0.2, 6);
    });
  });

  describe('luminancia', () => {
    it('pesa o verde acima dos outros, como o olho', () => {
      expect(luminancia([1, 1, 1])).toBeCloseTo(1, 6);
      expect(luminancia([0, 1, 0])).toBeCloseTo(0.7152, 6);
    });
  });

  describe('medirFotometria', () => {
    it('recupera o ganho que foi aplicado entre frames vizinhos', () => {
      const orientacoes = anel(8);
      const ganhos = [1, 1.5, 1.5, 1, 1, 1, 1, 1];
      const frames = ganhos.map((g) => frameUniforme([100 * g, 100 * g, 100 * g]));

      const relatorio = medirFotometria(frames, orientacoes, OPTS);

      expect(relatorio.pares.length).toBeGreaterThan(0);

      const par01 = relatorio.pares.find((p) => p.a === 0 && p.b === 1);
      expect(par01).toBeDefined();
      expect(luminancia(par01!.ganho)).toBeCloseTo(1.5, 2);

      // Entre 1 e 2 o ganho não muda.
      const par12 = relatorio.pares.find((p) => p.a === 1 && p.b === 2);
      expect(luminancia(par12!.ganho)).toBeCloseTo(1, 2);
    });

    it('não acusa salto nenhum quando o anel está fotometricamente coerente', () => {
      const orientacoes = anel(8);
      const frames = orientacoes.map(() => frameUniforme([120, 120, 120]));

      const relatorio = medirFotometria(frames, orientacoes, OPTS);

      expect(relatorio.maiorSaltoStops).toBeCloseTo(0, 3);
      expect(relatorio.amplitudeAnelStops).toBeCloseTo(0, 3);
      expect(relatorio.maiorDesvioWB).toBeCloseTo(0, 3);
    });

    it('joga a rampa acumulada no par que fecha a volta', () => {
      // Rampa suave: cada passo entre vizinhos é pequeno, mas a volta inteira
      // acumula — e o último par, que reencontra o primeiro frame, precisa
      // desfazer tudo de uma vez. É esse o erro de fechamento que aparece como
      // "um lado do panorama escuro e o outro claro".
      const orientacoes = anel(8);
      const frames = orientacoes.map((_, i) => {
        const v = 60 * Math.pow(1.1, i);
        return frameUniforme([v, v, v]);
      });

      const relatorio = medirFotometria(frames, orientacoes, OPTS);

      const fechamento = relatorio.pares.find((p) => p.b === 0);
      const internos = relatorio.pares.filter((p) => p.b !== 0);

      expect(internos.length).toBeGreaterThan(0);
      for (const par of internos) {
        expect(emStops(luminancia(par.ganho))).toBeLessThan(0.2);
      }

      // 1,1⁷ ≈ 1,95, quase uma parada inteira concentrada num par só.
      expect(emStops(luminancia(fechamento!.ganho))).toBeGreaterThan(0.9);
      expect(relatorio.amplitudeAnelStops).toBeGreaterThan(0.7);
    });

    it('separa dominante de cor de diferença de exposição', () => {
      const orientacoes = anel(8);
      const frames = orientacoes.map((_, i) =>
        i === 3 ? frameUniforme([144, 120, 96]) : frameUniforme([120, 120, 120]),
      );

      const relatorio = medirFotometria(frames, orientacoes, OPTS);

      expect(relatorio.maiorDesvioWB).toBeGreaterThan(0.15);
    });

    it('descarta pares sem sobreposição útil', () => {
      // Duas fotos opostas no anel não se enxergam; nenhum par pode ser
      // fabricado a partir delas.
      const orientacoes = [anel(2)[0], anel(2)[1]];
      const frames = orientacoes.map(() => frameUniforme([120, 120, 120]));

      const relatorio = medirFotometria(frames, orientacoes, OPTS, 2000);

      expect(relatorio.pares).toHaveLength(0);
      expect(relatorio.amplitudeAnelStops).toBe(0);
    });
  });
});
