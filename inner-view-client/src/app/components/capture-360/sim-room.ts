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

/**
 * A wall, not a test chart.
 *
 * This used to be a fine grid drawn edge to edge, and that turned out to hide a
 * real property of rooms. With a few degrees of parallax a repeating grid
 * decorrelates EVERYWHERE, so there was nowhere quiet for a seam to be routed
 * through and any measurement of seam placement came out flat. Actual rooms are
 * the opposite: mostly plain wall, with the detail gathered into objects —
 * a picture, a door frame, a skirting board.
 *
 * So detail is now localised. Low-contrast grain still covers everything, which
 * is what the sharpness metric reads, but the strong edges sit in a few places,
 * the way they do in the photographs this is standing in for.
 */
function patternTexture(
  base: string,
  accent: string,
  features: number,
  label?: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  let seed = features * 7919 + 13;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  // Fine, low-contrast grain over the whole surface: enough texture for a
  // sharpness reading, not enough to make every spot equally costly to cut.
  ctx.fillStyle = accent;
  for (let i = 0; i < 2600; i++) {
    ctx.globalAlpha = 0.04 + rand() * 0.07;
    ctx.fillRect(rand() * 512, rand() * 512, 2 + rand() * 3, 2 + rand() * 3);
  }
  ctx.globalAlpha = 1;

  // Skirting board along the bottom — a strong horizontal a seam must cross.
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(0, 470, 512, 14);
  ctx.globalAlpha = 1;

  // A handful of framed features, standing in for pictures, doors and windows.
  for (let i = 0; i < features; i++) {
    const w = 60 + rand() * 130;
    const h = 60 + rand() * 150;
    const x = rand() * (512 - w);
    const y = 40 + rand() * (400 - h);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.55 + rand() * 0.3;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#2a2622';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
    // Some internal detail so a cut through one is visibly wrong.
    ctx.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(x, y + (h * k) / 4);
      ctx.lineTo(x + w, y + (h * k) / 4);
      ctx.stroke();
    }
  }

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
  // Repeated once per wall, not three times: a wall that tiles is a wall that
  // matches itself in the wrong place, which is a correlation trap and not
  // something a room does.
  scene.add(new THREE.Mesh(shell, [
    surface(patternTexture('#d9d2c7', '#8d8377', 3, 'L'), [1, 1]),
    surface(patternTexture('#cfd6dc', '#7f8a95', 4, 'R'), [1, 1]),
    surface(patternTexture('#e8e6e1', '#b3aea4', 1, 'TETO'), [1, 1]),
    surface(patternTexture('#9c8a72', '#5e5140', 2, 'CHAO'), [1, 1]),
    surface(patternTexture('#d5cbbd', '#8a7d6b', 3, 'F'), [1, 1]),
    surface(patternTexture('#cdd3c9', '#7d8a78', 4, 'B'), [1, 1]),
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
  prop(0.9, 0.5, 0.4, [0.15, -0.5, -0.5], patternTexture('#5b4636', '#c9b18b', 5, '0.5'));
  // 1.5 m — a wardrobe
  prop(1.0, 1.8, 0.5, [-1.3, -0.3, 1.4], patternTexture('#6b5a45', '#d8c5a4', 6, '1.5'));
  // 3 m — a shelf against the far wall
  prop(1.4, 0.9, 0.3, [0.8, 0.2, -2.2], patternTexture('#4f5a63', '#c3cdd6', 5, '3.0'));

  return {
    scene,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

export { ROOM_WIDTH, ROOM_DEPTH, ROOM_HEIGHT };
