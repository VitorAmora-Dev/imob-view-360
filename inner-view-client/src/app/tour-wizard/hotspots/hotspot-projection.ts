import * as THREE from 'three';

/**
 * Projeção de um hotspot do wizard para coordenadas de tela.
 *
 * DONO: Frente B (§7). É o miolo da tarefa B2 — o overlay HTML dos pins
 * precisa saber, a cada frame, onde cada ponto da esfera caiu no canvas.
 *
 * Função pura de propósito: a matemática aqui é o único trecho do sprint sem
 * plano B barato, e testá-la não deve exigir WebGL nem montar componente.
 */

/**
 * Mesmo raio que `PanoramicViewerComponent.addHotspots` usa para os sprites —
 * 10 unidades dentro da esfera de 500, para não haver z-fighting com a textura.
 */
export const HOTSPOT_RADIUS = 490;

/**
 * Folga, em px, para além da borda do canvas antes de descartar um pin.
 *
 * Não é zero porque o pin tem largura: cortá-lo no instante em que o centro
 * cruza a borda faria a pílula sumir de uma vez no meio do giro, em vez de
 * deslizar para fora.
 */
export const DEFAULT_PIN_MARGIN = 96;

/** Posição em pixels dentro do canvas, com origem no canto superior esquerdo. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Converte o par `(u, v)` de um `WizardHotspot` na posição 3D dentro da esfera.
 *
 * ATENÇÃO ao nome dos campos: apesar de `u`/`v`, `v` **não** é o V da UV do
 * three.js — é o `positionY` do backend, que o viewer já emite invertido
 * (`positionY = 1 - uv.y`, panoramic-viewer:261). Por isso `theta` leva o
 * `(1 - v)`, exatamente como `addHotspots` faz na volta. Trocar por `v * PI`
 * espelha todos os pins no equador.
 */
export function hotspotToWorld(u: number, v: number): THREE.Vector3 {
  const phi = u * 2 * Math.PI;
  const theta = (1 - v) * Math.PI;

  return new THREE.Vector3(
    HOTSPOT_RADIUS * Math.cos(phi) * Math.sin(theta),
    HOTSPOT_RADIUS * Math.cos(theta),
    HOTSPOT_RADIUS * Math.sin(phi) * Math.sin(theta),
  );
}

/**
 * Projeta um ponto do mundo no canvas. Devolve `null` quando o ponto está
 * atrás da câmera.
 *
 * O `null` não é detalhe: `Vector3.project()` divide por `w`, e com `w`
 * negativo o ponto de trás reaparece espelhado na frente, num pixel plausível.
 * Sem o corte, girar 180° enche a tela de pins fantasmas. Por isso a conta é
 * feita em dois passos — espaço de câmera primeiro, para poder olhar o sinal
 * de `z` antes da divisão.
 */
export function projectToScreen(
  world: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): ScreenPoint | null {
  const local = world.clone().applyMatrix4(camera.matrixWorldInverse);

  // A câmera olha para -Z no próprio espaço: z >= 0 está atrás dela.
  if (local.z >= 0) return null;

  const ndc = local.applyMatrix4(camera.projectionMatrix);

  return {
    x: (ndc.x * 0.5 + 0.5) * width,
    y: (-ndc.y * 0.5 + 0.5) * height,
  };
}

/**
 * Se o ponto vale a pena desenhar, dada a folga de `margin`.
 *
 * O overlay esconde em vez de remover do DOM: o nó do pin é criado pelo `@for`
 * e vive enquanto o hotspot existir, porque recriá-lo a cada giro custaria mais
 * do que deixá-lo invisível — e derrubaria o foco do teclado no meio da edição.
 */
export function isWithinCanvas(
  point: ScreenPoint,
  width: number,
  height: number,
  margin = DEFAULT_PIN_MARGIN,
): boolean {
  return (
    point.x >= -margin &&
    point.x <= width + margin &&
    point.y >= -margin &&
    point.y <= height + margin
  );
}
