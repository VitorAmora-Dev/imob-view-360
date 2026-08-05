import * as THREE from 'three';

/**
 * A small room with real depth, built so the simulation can reproduce the two
 * things that ruined the real captures and that a textured sphere can never
 * show: parallax and auto-exposure swings.
 *
 * A sphere at infinity is invariant to camera translation, so the old sim
 * scored 0.97 correlation while the phone produced triple-exposed guitars.
 * Here the walls sit ~2 m away and props sit at 0.5, 1.5 and 3 m, so moving
 * the camera off the rotation axis genuinely misaligns near objects.
 *
 * Units are metres, matching the pivot radius used for hand-held capture.
 */
const ROOM_WIDTH = 4;
const ROOM_DEPTH = 5;
const ROOM_HEIGHT = 2.7;

export interface SimRoom {
  scene: THREE.Scene;
  dispose(): void;
}

/** Deterministic texture with fine detail — blur from ghosting has to show up. */
function patternTexture(
  base: string,
  accent: string,
  lines: number,
  label?: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  // Fine grid: high-frequency detail is what a ghosted stitch destroys, so the
  // sharpness metric needs plenty of it.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  for (let i = 0; i <= lines; i++) {
    const p = (i / lines) * 512;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }

  // Speckle adds detail at a different scale than the grid.
  let seed = 1;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  ctx.fillStyle = accent;
  for (let i = 0; i < 400; i++) {
    ctx.globalAlpha = 0.25 + rand() * 0.5;
    ctx.fillRect(rand() * 512, rand() * 512, 3 + rand() * 5, 3 + rand() * 5);
  }
  ctx.globalAlpha = 1;

  if (label) {
    ctx.fillStyle = '#111';
    ctx.font = 'bold 96px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 256, 256);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function buildSimRoom(): SimRoom {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];

  const surface = (
    texture: THREE.CanvasTexture,
    repeat: [number, number],
  ): THREE.MeshBasicMaterial => {
    texture.repeat.set(repeat[0], repeat[1]);
    disposables.push(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
    disposables.push(material);
    return material;
  };

  // The room shell, seen from inside.
  const shell = new THREE.BoxGeometry(ROOM_WIDTH, ROOM_HEIGHT, ROOM_DEPTH);
  disposables.push(shell);
  // BoxGeometry material order: +X, -X, +Y (teto), -Y (piso), +Z, -Z
  scene.add(new THREE.Mesh(shell, [
    surface(patternTexture('#d9d2c7', '#8d8377', 14, 'L'), [3, 2]),
    surface(patternTexture('#cfd6dc', '#7f8a95', 14, 'R'), [3, 2]),
    surface(patternTexture('#e8e6e1', '#b3aea4', 10, 'TETO'), [3, 3]),
    surface(patternTexture('#9c8a72', '#5e5140', 16, 'CHAO'), [3, 3]),
    surface(patternTexture('#d5cbbd', '#8a7d6b', 14, 'F'), [3, 2]),
    surface(patternTexture('#cdd3c9', '#7d8a78', 14, 'B'), [3, 2]),
  ]));

  // Props at three depths: near objects are where parallax is brutal.
  const prop = (
    w: number, h: number, d: number,
    pos: [number, number, number],
    texture: THREE.CanvasTexture,
  ) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    disposables.push(geometry, material, texture);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    scene.add(mesh);
  };

  // 0.5 m — a desk edge right in front of the user
  prop(0.9, 0.5, 0.4, [0.15, -0.5, -0.5], patternTexture('#5b4636', '#c9b18b', 8, '0.5'));
  // 1.5 m — a wardrobe
  prop(1.0, 1.8, 0.5, [-1.3, -0.3, 1.4], patternTexture('#6b5a45', '#d8c5a4', 10, '1.5'));
  // 3 m — a shelf against the far wall
  prop(1.4, 0.9, 0.3, [0.8, 0.2, -2.2], patternTexture('#4f5a63', '#c3cdd6', 10, '3.0'));

  return {
    scene,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

export { ROOM_WIDTH, ROOM_DEPTH, ROOM_HEIGHT };
