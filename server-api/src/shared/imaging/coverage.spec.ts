import { equirectToCubemap } from './cubemap';
import {
  Orientacao,
  erodirCobertura,
  faixaCoberta,
  fracaoCoberta,
  hfovFromVfov,
  mascaraDeCobertura,
  mascaraDeCoberturaFace,
  mascaraPorFaixa,
} from './coverage';

/**
 * Anel de `n` fotos só em yaw, no mesmo frame do stitcher: yaw 0 olha para -Z e
 * cresce girando para +X, montado com Euler YXZ. Reproduz o formato do
 * `orientacoes.json` real, em que o anel é plano e o pitch fica perto de zero.
 */
function anel(n: number): Orientacao[] {
  return Array.from({ length: n }, (_, i) => {
    const yaw = (-(i / n) * 2 * Math.PI) / 2; // metade do ângulo, para o quaternion
    return {
      arquivo: `${String(i).padStart(2, '0')}.jpg`,
      quaternion: { x: 0, y: Math.sin(yaw), z: 0, w: Math.cos(yaw) },
    };
  });
}

describe('coverage', () => {
  describe('hfovFromVfov', () => {
    it('bate com a fórmula do stitcher', () => {
      // 4:3 em pé (frameAspect 0.75) com 95° verticais.
      expect(hfovFromVfov(95, 0.75)).toBeCloseTo(
        (2 * Math.atan(Math.tan((95 * Math.PI) / 360) * 0.75) * 180) / Math.PI,
        6,
      );
      // Aspecto 1 é a identidade.
      expect(hfovFromVfov(90, 1)).toBeCloseTo(90, 6);
    });
  });

  describe('mascaraDeCobertura', () => {
    it('reproduz a faixa vertical que a captura real registra', () => {
      // Um anel plano com 95° de campo vertical cobre ±47,5°. É esse número que
      // o INDICE.md mostra arredondado para dentro (−46,4…45,7) nas capturas de
      // 07/08, porque lá o anel tem pitch e roll residuais.
      const mask = mascaraDeCobertura(256, 128, anel(12), { vfovDeg: 95, frameAspect: 0.75 });
      const faixa = faixaCoberta(mask);

      expect(faixa.pitchMaxDeg).toBeGreaterThan(46);
      expect(faixa.pitchMaxDeg).toBeLessThanOrEqual(47.5);
      expect(faixa.pitchMinDeg).toBeLessThan(-46);
      expect(faixa.pitchMinDeg).toBeGreaterThanOrEqual(-47.5);
    });

    it('deixa nadir e zênite descobertos, que é o buraco a preencher', () => {
      const mask = mascaraDeCobertura(256, 128, anel(12), { vfovDeg: 95, frameAspect: 0.75 });

      const topo = mask.data[0];
      const fundo = mask.data[((mask.height - 1) * mask.width) * 4];
      expect(topo).toBe(0);
      expect(fundo).toBe(0);

      // Cerca de 29% da esfera fora da faixa — o defeito nº1 dos panoramas.
      const coberta = fracaoCoberta(mask);
      expect(coberta).toBeGreaterThan(0.68);
      expect(coberta).toBeLessThan(0.76);
    });

    it('cobre a esfera inteira quando o anel enxerga tudo', () => {
      const mask = mascaraDeCobertura(128, 64, anel(8), { vfovDeg: 179, frameAspect: 1 });
      expect(fracaoCoberta(mask)).toBeGreaterThan(0.99);
    });

    it('fecha em yaw sem deixar coluna vazia na borda φ=0', () => {
      const mask = mascaraDeCobertura(256, 128, anel(12), { vfovDeg: 95, frameAspect: 0.75 });

      // Na linha do equador, um anel de 12 com ~78° horizontais se sobrepõe de
      // sobra; qualquer buraco aqui seria erro de wrap, não de cobertura.
      const linha = Math.floor(mask.height / 2);
      for (let x = 0; x < mask.width; x++) {
        expect(mask.data[(linha * mask.width + x) * 4]).toBe(255);
      }
    });
  });

  describe('mascaraDeCoberturaFace', () => {
    const opts = { vfovDeg: 95, frameAspect: 0.75 };

    it('concorda com a máscara equirretangular recortada nas mesmas faces', () => {
      const equirect = mascaraDeCobertura(512, 256, anel(12), opts);
      const recortadas = equirectToCubemap(equirect, 64, true);

      for (const face of ['ny', 'py', 'px'] as const) {
        const direta = mascaraDeCoberturaFace(face, 64, anel(12), opts);

        let divergentes = 0;
        for (let i = 0; i < direta.data.length; i += 4) {
          if (direta.data[i] !== recortadas[face].data[i]) divergentes++;
        }

        // Só a borda pode divergir: o recorte herda a discretização do equirect.
        expect(divergentes / (64 * 64)).toBeLessThan(0.03);
      }
    });

    it('deixa o centro do nadir descoberto e as laterais cobertas', () => {
      const nadir = mascaraDeCoberturaFace('ny', 32, anel(12), opts);
      const lateral = mascaraDeCoberturaFace('px', 32, anel(12), opts);

      const centro = ((16 * 32) + 16) * 4;
      expect(nadir.data[centro]).toBe(0);
      expect(lateral.data[centro]).toBe(255);

      // O nadir não é todo buraco: os cantos da face chegam a pitch menor que
      // 45° e por isso caem dentro da faixa fotografada. É por isso que a
      // máscara importa mesmo dentro da face de polo.
      expect(fracaoCoberta(nadir)).toBeGreaterThan(0);
    });
  });

  describe('mascaraPorFaixa', () => {
    it('concorda com a máscara geométrica na faixa que ela produz', () => {
      const geometrica = mascaraDeCobertura(128, 64, anel(12), { vfovDeg: 95, frameAspect: 0.75 });
      const faixa = faixaCoberta(geometrica);
      const porFaixa = mascaraPorFaixa(128, 64, faixa.pitchMinDeg, faixa.pitchMaxDeg);

      expect(fracaoCoberta(porFaixa)).toBeCloseTo(fracaoCoberta(geometrica), 2);
    });
  });

  describe('erodirCobertura', () => {
    it('encolhe o coberto e nunca o aumenta', () => {
      const mask = mascaraDeCobertura(128, 64, anel(12), { vfovDeg: 95, frameAspect: 0.75 });
      const erodida = erodirCobertura(mask, 2);

      expect(fracaoCoberta(erodida)).toBeLessThan(fracaoCoberta(mask));

      for (let i = 0; i < mask.data.length; i += 4) {
        if (erodida.data[i] > 127) expect(mask.data[i]).toBeGreaterThan(127);
      }
    });

    /**
     * A única chamada é sobre faces de cubemap, cujas colunas 0 e w-1 são
     * vizinhas de 90° sem relação nenhuma. A versão anterior dava wrap em x, e
     * um buraco encostado na aresta esquerda comia fotografia boa na direita.
     */
    it('não casa as bordas laterais: em face de cubemap elas não são vizinhas', () => {
      const lado = 16;
      // Buraco só na coluna 0; o resto é fotografia.
      const mask = mascaraPorFaixa(lado, lado, -90, 90);
      for (let y = 0; y < lado; y++) {
        const i = (y * lado + 0) * 4;
        mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = 0;
      }

      const erodida = erodirCobertura(mask, 3);
      const em = (x: number, y: number) => erodida.data[(y * lado + x) * 4];

      expect(em(3, 8)).toBe(0); // a 3 do buraco, comido — correto
      expect(em(4, 8)).toBeGreaterThan(127); // além do raio, preservado
      expect(em(lado - 1, 8)).toBeGreaterThan(127); // a outra ponta, intocada
    });

    it('com raio zero devolve uma cópia, não o mesmo buffer', () => {
      const mask = mascaraPorFaixa(64, 32, -45, 45);
      const copia = erodirCobertura(mask, 0);

      expect(copia.data).not.toBe(mask.data);
      expect(Array.from(copia.data)).toEqual(Array.from(mask.data));
    });
  });
});
