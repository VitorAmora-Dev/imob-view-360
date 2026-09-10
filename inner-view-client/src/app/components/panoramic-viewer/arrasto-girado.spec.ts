import * as THREE from 'three';

import {
  FOLGA_DO_POLO,
  deltaNoQuadroDoPalco,
  girarEsfera,
} from './arrasto-girado';

/** O `rotateSpeed` do viewer. Negativo de proposito — ver `girarEsfera`. */
const VELOCIDADE = -0.5;
const ALTURA = 400;

describe('deltaNoQuadroDoPalco', () => {
  it('sem giro, devolve o que recebeu', () => {
    expect(deltaNoQuadroDoPalco(30, -12, 0)).toEqual({ dx: 30, dy: -12 });
  });

  /**
   * O caso que guarda o recurso inteiro.
   *
   * Com o aparelho deitado, o arrasto que a pessoa faz na HORIZONTAL chega ao
   * viewport como vertical. Se ele continuasse chegando como vertical ate a
   * camera, viraria angulo polar — que e grampeado — e o dedo bateria numa
   * parede meio giro depois.
   */
  it('arrasto vertical na viewport vira horizontal no palco deitado', () => {
    expect(deltaNoQuadroDoPalco(0, 100, 90)).toEqual({ dx: 100, dy: -0 });
  });

  it('arrasto horizontal na viewport vira vertical no palco deitado', () => {
    expect(deltaNoQuadroDoPalco(100, 0, 90)).toEqual({ dx: 0, dy: -100 });
  });

  /** O giro do CSS e horario, entao o quadro do palco gira junto com ele. */
  it('preserva o comprimento do deslocamento', () => {
    const { dx, dy } = deltaNoQuadroDoPalco(30, 40, 90);
    expect(Math.hypot(dx, dy)).toBeCloseTo(50, 10);
  });
});

describe('girarEsfera', () => {
  function esfera(theta = 0, phi = Math.PI / 2): THREE.Spherical {
    return new THREE.Spherical(0.1, phi, theta);
  }

  /**
   * A formula e a do OrbitControls, copiada sinal por sinal. Este caso fixa o
   * numero para que uma troca de sinal la em cima nao passe despercebida: o
   * tato dos dois modos tem de ser o mesmo.
   */
  it('usa a mesma conta do OrbitControls, inclusive o sinal', () => {
    const s = esfera();

    girarEsfera(s, 100, 0, ALTURA, VELOCIDADE);

    expect(s.theta).toBeCloseTo((2 * Math.PI * 50) / ALTURA, 10);
  });

  /** Os DOIS eixos dividem pela ALTURA — nao e engano, ver o comentario da funcao. */
  it('divide os dois eixos pela altura, para a velocidade nao variar com a proporcao', () => {
    const horizontal = esfera();
    const vertical = esfera();

    girarEsfera(horizontal, 100, 0, ALTURA, VELOCIDADE);
    girarEsfera(vertical, 0, 100, ALTURA, VELOCIDADE);

    expect(Math.abs(horizontal.theta)).toBeCloseTo(Math.abs(vertical.phi - Math.PI / 2), 10);
  });

  /** Azimute e livre: e o que permite dar voltas inteiras no comodo. */
  it('nao grampeia o azimute', () => {
    const s = esfera();

    for (let i = 0; i < 40; i++) girarEsfera(s, 100, 0, ALTURA, VELOCIDADE);

    expect(Math.abs(s.theta)).toBeGreaterThan(2 * Math.PI);
  });

  /**
   * Polar e grampeado. Com `phi` em 0 ou π a camera olha para o proprio eixo
   * "cima" e perde a referencia de rolagem — a imagem passa a girar sozinha em
   * torno do centro.
   */
  it('grampeia o polar longe dos polos', () => {
    const paraCima = esfera();
    const paraBaixo = esfera();

    for (let i = 0; i < 40; i++) girarEsfera(paraCima, 0, 100, ALTURA, VELOCIDADE);
    for (let i = 0; i < 40; i++) girarEsfera(paraBaixo, 0, -100, ALTURA, VELOCIDADE);

    expect(paraCima.phi).toBeLessThanOrEqual(Math.PI - FOLGA_DO_POLO);
    expect(paraCima.phi).toBeGreaterThanOrEqual(FOLGA_DO_POLO);
    expect(paraBaixo.phi).toBeLessThanOrEqual(Math.PI - FOLGA_DO_POLO);
    expect(paraBaixo.phi).toBeGreaterThanOrEqual(FOLGA_DO_POLO);
  });

  /**
   * Entre montar e o primeiro layout o elemento tem altura zero. Dividir por
   * zero mandaria `theta` para NaN, e a camera nao volta de la.
   */
  it('elemento sem altura nao manda a camera para NaN', () => {
    const s = esfera(0.7, 1.2);

    girarEsfera(s, 100, 100, 0, VELOCIDADE);

    expect(s.theta).toBe(0.7);
    expect(s.phi).toBe(1.2);
  });
});
