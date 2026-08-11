import {
  FACE_NAMES,
  LATERAL_FACES,
  POLE_FACES,
  Raster,
  composeEquirect,
  directionForEquirectPixel,
  directionForFacePixel,
  equirectToCubemap,
  faceForDirection,
  faceSizeFor,
} from './cubemap';

/**
 * Padrão suave em função de (φ, θ), contínuo na volta do panorama. Suave porque
 * o teste mede a perda da reamostragem, não a capacidade do bilinear de
 * reconstruir alta frequência; contínuo porque uma descontinuidade em φ=0
 * mascararia exatamente o defeito de wrap que se quer detectar.
 */
function padraoSuave(width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const phi = ((x + 0.5) / width) * 2 * Math.PI;
      const theta = ((y + 0.5) / height) * Math.PI;
      const i = (y * width + x) * 4;
      data[i] = 128 + 100 * Math.cos(phi);
      data[i + 1] = 128 + 100 * Math.sin(phi);
      data[i + 2] = 128 + 100 * Math.cos(theta);
      data[i + 3] = 255;
    }
  }

  return { data, width, height };
}

/** Erro médio por canal RGB entre dois rasters do mesmo tamanho. */
function erroMedio(a: Raster, b: Raster): number {
  let soma = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    soma += Math.abs(a.data[i] - b.data[i]);
    soma += Math.abs(a.data[i + 1] - b.data[i + 1]);
    soma += Math.abs(a.data[i + 2] - b.data[i + 2]);
    n += 3;
  }
  return soma / n;
}

describe('cubemap', () => {
  describe('faceForDirection', () => {
    it('é o inverso de directionForFacePixel', () => {
      const size = 32;

      for (const face of FACE_NAMES) {
        for (const [x, y] of [
          [0, 0],
          [size - 1, 0],
          [size >> 1, size >> 1],
          [size - 1, size - 1],
        ]) {
          const dir = directionForFacePixel(face, x, y, size);
          const achado = faceForDirection(dir);

          expect(achado.face).toBe(face);

          // (s, t) precisa voltar ao centro do mesmo pixel.
          expect(((achado.s + 1) / 2) * size - 0.5).toBeCloseTo(x, 4);
          expect(((achado.t + 1) / 2) * size - 0.5).toBeCloseTo(y, 4);
        }
      }
    });

    it('classifica os polos em py/ny e o equador nas laterais', () => {
      expect(faceForDirection({ x: 0, y: 1, z: 0 }).face).toBe('py');
      expect(faceForDirection({ x: 0, y: -1, z: 0 }).face).toBe('ny');

      for (const x of [0, 90, 180, 270]) {
        const dir = directionForEquirectPixel((x / 360) * 400, 200, 400, 400);
        expect(LATERAL_FACES).toContain(faceForDirection(dir).face);
      }
    });
  });

  describe('directionForEquirectPixel', () => {
    it('segue a convenção do stitcher: +Y no topo, φ=0 em +X', () => {
      const topo = directionForEquirectPixel(0, 0, 256, 128);
      expect(topo.y).toBeGreaterThan(0.98);

      // Com altura par o equador cai entre as linhas 63 e 64, então o centro da
      // linha 64 fica meio pixel abaixo dele — daí a tolerância de uma linha em
      // vez de zero.
      const umaLinha = Math.PI / 128;
      const equadorEsquerda = directionForEquirectPixel(0, 64, 256, 128);
      expect(equadorEsquerda.x).toBeCloseTo(1, 2);
      expect(Math.abs(equadorEsquerda.y)).toBeLessThan(umaLinha);

      const fundo = directionForEquirectPixel(0, 127, 256, 128);
      expect(fundo.y).toBeLessThan(-0.98);
    });
  });

  describe('faceSizeFor', () => {
    it('acompanha a resolução do equirect mas respeita o teto dos modelos', () => {
      expect(faceSizeFor(8192)).toBe(2048);
      expect(faceSizeFor(5120)).toBe(1280);
      expect(faceSizeFor(20000)).toBe(2048);
    });
  });

  describe('ida e volta', () => {
    it('preserva a imagem ao reprojetar as seis faces', () => {
      const original = padraoSuave(512, 256);
      const faces = equirectToCubemap(original, faceSizeFor(512));
      const volta = composeEquirect(original, faces, FACE_NAMES);

      // Duas reamostragens bilineares sobre um padrão suave: o resíduo fica
      // muito abaixo de um nível visível.
      expect(erroMedio(original, volta)).toBeLessThan(2);
    });

    it('não cria emenda na borda φ=0', () => {
      const original = padraoSuave(512, 256);
      const faces = equirectToCubemap(original, faceSizeFor(512));
      const volta = composeEquirect(original, faces, FACE_NAMES);

      // A coluna 0 e a última encostam na esfera; se o wrap tivesse falhado,
      // uma delas teria sido reconstruída por clamp e o salto apareceria aqui.
      for (let y = 0; y < volta.height; y++) {
        const primeira = (y * volta.width) * 4;
        const ultima = (y * volta.width + volta.width - 1) * 4;
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(volta.data[primeira + c] - volta.data[ultima + c])).toBeLessThan(8);
        }
      }
    });
  });

  describe('composeEquirect', () => {
    it('devolve as laterais bit a bit quando só os polos são substituídos', () => {
      const original = padraoSuave(256, 128);
      const faces = equirectToCubemap(original, faceSizeFor(256));

      // Faces de polo destruídas de propósito: o que sobreviver intacto no
      // resultado só pode ter vindo do `base`.
      for (const face of POLE_FACES) {
        faces[face].data.fill(0);
      }

      const volta = composeEquirect(original, faces, POLE_FACES);
      expect(volta.width).toBe(original.width);

      let lateraisConferidas = 0;
      let poloAlterado = 0;

      for (let y = 0; y < original.height; y++) {
        for (let x = 0; x < original.width; x++) {
          const i = (y * original.width + x) * 4;
          const dir = directionForEquirectPixel(x, y, original.width, original.height);
          const { face } = faceForDirection(dir);

          if (LATERAL_FACES.includes(face)) {
            expect(volta.data[i]).toBe(original.data[i]);
            expect(volta.data[i + 1]).toBe(original.data[i + 1]);
            expect(volta.data[i + 2]).toBe(original.data[i + 2]);
            lateraisConferidas++;
          } else if (volta.data[i] !== original.data[i]) {
            poloAlterado++;
          }
        }
      }

      expect(lateraisConferidas).toBeGreaterThan(0);
      expect(poloAlterado).toBeGreaterThan(0);
    });

    it('ignora face ausente em vez de furar o panorama', () => {
      const original = padraoSuave(256, 128);
      const volta = composeEquirect(original, { py: undefined }, POLE_FACES);
      expect(erroMedio(original, volta)).toBe(0);
    });
  });

  describe('equirectToCubemap', () => {
    it('em modo nearest devolve só valores que existiam na origem', () => {
      const width = 256;
      const height = 128;
      const data = new Uint8ClampedArray(width * height * 4);
      // Máscara binária: metade de cima 255, metade de baixo 0.
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const v = y < height / 2 ? 255 : 0;
          const i = (y * width + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = v;
          data[i + 3] = 255;
        }
      }

      const faces = equirectToCubemap({ data, width, height }, 64, true);

      for (const face of FACE_NAMES) {
        for (let i = 0; i < faces[face].data.length; i += 4) {
          expect([0, 255]).toContain(faces[face].data[i]);
        }
      }
    });
  });
});
