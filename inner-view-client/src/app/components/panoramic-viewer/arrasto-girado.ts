import * as THREE from 'three';

/**
 * O arrasto quando o palco está girado por CSS.
 *
 * Função pura de propósito: é a única matemática do modo paisagem, e testá-la
 * não deve exigir WebGL nem montar componente. O componente só liga os eventos
 * de ponteiro nela.
 *
 * ## Por que isto existe, e não um ajuste no OrbitControls
 *
 * Com o palco girado e o aparelho deitado, o arrasto que a pessoa faz na
 * horizontal chega ao viewport como VERTICAL. O `OrbitControls` lê esse delta e
 * mexe no ângulo polar — e o polar é grampeado em `[0, π]` por construção.
 *
 * A armadilha é que isso PARECE certo: como a imagem também está girada, o
 * polar aparece como movimento horizontal e passa num teste rápido. Só que meio
 * giro depois o dedo bate numa parede, sem nada na tela explicando por quê.
 * Azimute é livre; polar não é.
 *
 * Trocar os eixos não é algo que o `OrbitControls` saiba fazer: `object.up`
 * gira o quadro inteiro, não troca qual delta alimenta qual ângulo. E
 * interceptar os eventos para reescrever as coordenadas exigiria fazê-lo no
 * `document` — depois do `pointerdown` ele move `pointermove` e `pointerup`
 * para `domElement.ownerDocument` —, e um `stopImmediatePropagation()` ali
 * quebraria em silêncio qualquer outro listener de ponteiro do aplicativo.
 *
 * Daí o desenho: no modo deitado o `OrbitControls` é desligado e quem move a
 * câmera é isto aqui, com a MESMA fórmula dele, para o tato ser o mesmo.
 */

/**
 * Folga contra os polos.
 *
 * Com `phi` exatamente em 0 ou π a câmera fica olhando para o próprio eixo
 * "cima" e perde a referência de rolagem — a imagem gira sozinha em torno do
 * centro. Mesmo `EPS` que o `OrbitControls` usa.
 */
export const FOLGA_DO_POLO = 0.000001;

/** Giro que o palco recebe por CSS, em graus. */
export type RotacaoDaTela = 0 | 90;

/**
 * Leva um deslocamento medido na VIEWPORT para o quadro do palco girado.
 *
 * O palco usa `transform: rotate(90deg)`, que é horário: o eixo X local dele
 * aponta para BAIXO na viewport, e o Y local aponta para a ESQUERDA. Invertendo
 * essa relação, um deslocamento `(dvx, dvy)` da viewport vale `(dvy, -dvx)` no
 * quadro do palco — que é o quadro que a pessoa enxerga depois de virar o
 * aparelho.
 *
 * Com `rotacao` em 0 devolve o que recebeu: é o caminho de embed, wizard,
 * captura e upload, que não giram nada.
 */
export function deltaNoQuadroDoPalco(
  dvx: number,
  dvy: number,
  rotacao: RotacaoDaTela,
): { dx: number; dy: number } {
  if (rotacao === 0) return { dx: dvx, dy: dvy };
  return { dx: dvy, dy: -dvx };
}

/**
 * Aplica um arrasto às coordenadas esféricas da câmera, no lugar.
 *
 * A fórmula é a do `OrbitControls` copiada de propósito, sinal por sinal —
 * inclusive dividir os DOIS eixos pela ALTURA, que parece engano e não é: é o
 * que mantém a velocidade do giro igual na horizontal e na vertical, em vez de
 * deixá-la variar com a proporção da tela.
 *
 * `velocidade` é o `rotateSpeed` do controle, que neste viewer é NEGATIVO
 * (-0.5): arrastar para a direita traz a cena para a direita, como quem empurra
 * a foto em vez de girar a cabeça. Passar o mesmo número é o que faz os dois
 * modos terem o mesmo tato.
 */
export function girarEsfera(
  esfera: THREE.Spherical,
  dx: number,
  dy: number,
  alturaDoElemento: number,
  velocidade: number,
): void {
  // Elemento sem altura acontece entre montar e o primeiro layout. Dividir por
  // zero mandaria `theta` para NaN, e a câmera não volta de lá.
  if (alturaDoElemento <= 0) return;

  const doisPi = 2 * Math.PI;

  esfera.theta -= (doisPi * (dx * velocidade)) / alturaDoElemento;
  esfera.phi -= (doisPi * (dy * velocidade)) / alturaDoElemento;

  esfera.phi = Math.max(FOLGA_DO_POLO, Math.min(Math.PI - FOLGA_DO_POLO, esfera.phi));
}
