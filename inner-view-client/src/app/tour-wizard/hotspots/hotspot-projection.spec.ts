import * as THREE from 'three';
import {
  hotspotToWorld,
  projectToScreen,
  isWithinCanvas,
  HOTSPOT_RADIUS,
} from './hotspot-projection';

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

/** A mesma esfera que o `initThreeJS` do viewer monta. */
function viewerSphere(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(500, 120, 80);
  geometry.scale(-1, 1, 1);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

/**
 * Reproduz exatamente o que `onCanvasClick` emite para um clique em (x, y) da
 * tela — inclusive o `1 - uv.y`.
 */
function cliqueEm(
  x: number,
  y: number,
  camera: THREE.PerspectiveCamera,
  sphere: THREE.Mesh,
  width: number,
  height: number,
): { positionX: number; positionY: number } {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1),
    camera,
  );
  const uv = raycaster.intersectObject(sphere)[0].uv!;
  return { positionX: uv.x, positionY: 1 - uv.y };
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

  it('v=0 é o polo de CIMA, v=1 o de baixo', () => {
    // Não é arbitrário nem invertível ao gosto: o SphereGeometry do three.js
    // grava `uv.y = 1 - v` com v=0 no topo, então o topo tem uv.y=1; e o
    // viewer emite `positionY = 1 - uv.y`, o que devolve 0 no topo.
    // Ver o teste de ida e volta abaixo, que é quem prova isso de fato.
    expect(hotspotToWorld(0.75, 0).y).toBeCloseTo(HOTSPOT_RADIUS, 4);
    expect(hotspotToWorld(0.75, 1).y).toBeCloseTo(-HOTSPOT_RADIUS, 4);
  });

  it('mapeia u direto na longitude', () => {
    // u=0 → phi=0 → +X ; u=0.5 → phi=PI → -X
    expect(hotspotToWorld(0, 0.5).x).toBeCloseTo(HOTSPOT_RADIUS, 4);
    expect(hotspotToWorld(0.5, 0.5).x).toBeCloseTo(-HOTSPOT_RADIUS, 4);
  });
});

describe('ida e volta com o clique do viewer', () => {
  // ESTE é o teste que importa. Um pin tem de nascer sob o dedo que o criou;
  // qualquer outra convenção é opinião. Foi a falta dele que deixou passar um
  // eixo vertical espelhado — a fórmula batia com a de `addHotspots`, que
  // já estava errada.
  const W = 1064;
  const H = 599;

  it('devolve o pin ao pixel exato do clique', () => {
    const camera = viewerCamera(W, H);
    const sphere = viewerSphere();

    for (const [x, y] of [
      [W * 0.3, H * 0.35],
      [W * 0.5, H * 0.5],
      [W * 0.7, H * 0.65],
      [W * 0.4, H * 0.8],
      [W * 0.62, H * 0.18],
    ]) {
      const { positionX, positionY } = cliqueEm(x, y, camera, sphere, W, H);
      const volta = projectToScreen(
        hotspotToWorld(positionX, positionY),
        camera,
        W,
        H,
      );

      expect(volta).not.toBeNull();
      expect(volta!.x).toBeCloseTo(x, 0);
      expect(volta!.y).toBeCloseTo(y, 0);
    }
  });

  it('mantém a ida e volta depois de girar a câmera', () => {
    const camera = viewerCamera(W, H);
    const sphere = viewerSphere();
    camera.lookAt(-320, 140, -390);
    camera.updateMatrixWorld(true);

    const { positionX, positionY } = cliqueEm(W * 0.35, H * 0.7, camera, sphere, W, H);
    const volta = projectToScreen(
      hotspotToWorld(positionX, positionY),
      camera,
      W,
      H,
    );

    expect(volta!.x).toBeCloseTo(W * 0.35, 0);
    expect(volta!.y).toBeCloseTo(H * 0.7, 0);
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

  it('projeta acima do centro o hotspot de v MENOR', () => {
    const camera = viewerCamera(1280, 720);

    const acima = projectToScreen(hotspotToWorld(0.75, 0.38), camera, 1280, 720);
    const abaixo = projectToScreen(hotspotToWorld(0.75, 0.62), camera, 1280, 720);

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

describe('isWithinCanvas', () => {
  it('aceita o ponto no meio do canvas', () => {
    expect(isWithinCanvas({ x: 640, y: 360 }, 1280, 720)).toBe(true);
  });

  it('recusa o ponto bem além da borda', () => {
    expect(isWithinCanvas({ x: 1920, y: 360 }, 1280, 720)).toBe(false);
    expect(isWithinCanvas({ x: -400, y: 360 }, 1280, 720)).toBe(false);
    expect(isWithinCanvas({ x: 640, y: 1400 }, 1280, 720)).toBe(false);
    expect(isWithinCanvas({ x: 640, y: -300 }, 1280, 720)).toBe(false);
  });

  it('aceita o ponto logo fora da borda, dentro da folga', () => {
    // A pílula tem largura: cortar no instante em que o centro cruza a borda
    // faria o pin sumir de uma vez no meio do giro, em vez de deslizar.
    expect(isWithinCanvas({ x: 1280 + 40, y: 360 }, 1280, 720)).toBe(true);
    expect(isWithinCanvas({ x: -40, y: 360 }, 1280, 720)).toBe(true);
  });

  it('respeita a folga passada', () => {
    expect(isWithinCanvas({ x: 1500, y: 360 }, 1280, 720, 8)).toBe(false);
    expect(isWithinCanvas({ x: 1500, y: 360 }, 1280, 720, 400)).toBe(true);
  });

  it('descarta o pin fora do enquadramento na câmera de verdade', () => {
    // ~70° de desvio do eixo: ainda à frente da câmera, mas fora do frustum
    // (meia-abertura horizontal ≈ 54° com fov 75 e aspect 16/9).
    const camera = viewerCamera(1280, 720);
    const ponto = projectToScreen(
      hotspotToWorld(200 / 360, 0.5),
      camera,
      1280,
      720,
    );

    expect(ponto).not.toBeNull();
    expect(isWithinCanvas(ponto!, 1280, 720)).toBe(false);
  });
});
