import * as THREE from 'three';
import { hotspotToWorld, projectToScreen, HOTSPOT_RADIUS } from './hotspot-projection';

/**
 * Câmera montada igual à do `PanoramicViewerComponent.initThreeJS` — mesma fov,
 * mesmos planos, mesma posição. Se aquele setup mudar, estes testes têm de
 * mudar junto: é a projeção dele que estamos travando.
 */
function viewerCamera(width = 1280, height = 720): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(75, width / height, 1, 1100);
  camera.position.set(0, 0, 0.1);
  camera.lookAt(0, 0, 0); // OrbitControls mira em (0,0,0) → olha para -Z
  camera.updateMatrixWorld(true);
  return camera;
}

describe('hotspotToWorld', () => {
  it('põe o ponto que a câmera encara por padrão em -Z', () => {
    const p = hotspotToWorld(0.75, 0.5);

    expect(p.x).toBeCloseTo(0, 4);
    expect(p.y).toBeCloseTo(0, 4);
    expect(p.z).toBeCloseTo(-HOTSPOT_RADIUS, 4);
  });

  it('põe o ponto oposto ao da câmera em +Z', () => {
    const p = hotspotToWorld(0.25, 0.5);

    expect(p.z).toBeCloseTo(HOTSPOT_RADIUS, 4);
  });

  it('v maior sobe — v=1 é o polo de cima, v=0 o de baixo', () => {
    // Trava a inversão do eixo vertical, que é o erro mais fácil de cometer
    // aqui. O viewer emite `positionY = 1 - uv.y` (panoramic-viewer:261) e
    // `addHotspots` lê de volta com `theta = (1 - positionY) * PI`. Quem
    // escrever `theta = v * PI` — o que o nome do campo `v` sugere — espelha
    // todos os pins no equador e o bug passa despercebido em foto simétrica.
    expect(hotspotToWorld(0.75, 1).y).toBeCloseTo(HOTSPOT_RADIUS, 4);
    expect(hotspotToWorld(0.75, 0).y).toBeCloseTo(-HOTSPOT_RADIUS, 4);
  });

  it('acompanha a fórmula de addHotspots em u arbitrário', () => {
    // u=0 → phi=0 → +X ; u=0.5 → phi=PI → -X
    expect(hotspotToWorld(0, 0.5).x).toBeCloseTo(HOTSPOT_RADIUS, 4);
    expect(hotspotToWorld(0.5, 0.5).x).toBeCloseTo(-HOTSPOT_RADIUS, 4);
  });
});

describe('projectToScreen', () => {
  it('projeta o ponto encarado no centro da viewport', () => {
    const camera = viewerCamera(1280, 720);

    const point = projectToScreen(hotspotToWorld(0.75, 0.5), camera, 1280, 720);

    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(640, 2);
    expect(point!.y).toBeCloseTo(360, 2);
  });

  it('devolve null para o ponto atrás da câmera', () => {
    // O pin fantasma: `Vector3.project()` divide por w, e com w negativo o
    // ponto de trás reaparece espelhado na frente, num pixel perfeitamente
    // plausível. Sem este corte, girar 180° enche a tela de pins do lado errado.
    const camera = viewerCamera(1280, 720);

    const point = projectToScreen(hotspotToWorld(0.25, 0.5), camera, 1280, 720);

    expect(point).toBeNull();
  });

  it('projeta acima do centro o hotspot de v maior', () => {
    const camera = viewerCamera(1280, 720);

    const acima = projectToScreen(hotspotToWorld(0.75, 0.62), camera, 1280, 720);
    const abaixo = projectToScreen(hotspotToWorld(0.75, 0.38), camera, 1280, 720);

    expect(acima).not.toBeNull();
    expect(abaixo).not.toBeNull();
    // Y de tela cresce para baixo: o de cima tem Y menor.
    expect(acima!.y).toBeLessThan(360);
    expect(abaixo!.y).toBeGreaterThan(360);
  });

  it('segue a câmera quando ela gira', () => {
    const camera = viewerCamera(1280, 720);
    const world = hotspotToWorld(0.75, 0.5);

    const parado = projectToScreen(world, camera, 1280, 720);
    camera.lookAt(-100, 0, -490); // gira um pouco para a esquerda
    camera.updateMatrixWorld(true);
    const girado = projectToScreen(world, camera, 1280, 720);

    expect(parado!.x).toBeCloseTo(640, 2);
    expect(girado).not.toBeNull();
    // Olhando mais para a esquerda, o ponto fixo desliza para a direita da tela.
    expect(girado!.x).toBeGreaterThan(parado!.x);
  });
});
