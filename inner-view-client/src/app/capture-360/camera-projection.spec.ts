import {
  CameraModel,
  DEG,
  focalPx,
  goreOutline,
  maskFitsFrame,
  pitchForBand,
  projectLonLat,
  sampleParallel,
} from './camera-projection';
import { BAND_PITCH_DEG, LAT_SPAN_DEG } from './capture-360.types';

/**
 * Inversa da projeção, implementada AQUI (não no código de produção) para o
 * teste de roundtrip: pixel → raio na base da câmera → (lon, lat).
 * d = xn·r + yn·u + f = (xn, yn·cosφ + sinφ, −yn·sinφ + cosφ)
 */
function unproject(cam: CameraModel, px: number, py: number): { lon: number; lat: number } {
  const f = focalPx(cam);
  const xn = (px - cam.width / 2) / f;
  const yn = (cam.height / 2 - py) / f;
  const phi = cam.pitchDeg * DEG;
  const dx = xn;
  const dy = yn * Math.cos(phi) + Math.sin(phi);
  const dz = -yn * Math.sin(phi) + Math.cos(phi);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return {
    lon: Math.atan2(dx, dz) / DEG,
    lat: Math.asin(dy / len) / DEG,
  };
}

describe('camera-projection', () => {
  // Retrato 1080×1920 com a vFOV default de ultrawide.
  const cam: CameraModel = { pitchDeg: BAND_PITCH_DEG, vFovDeg: 100, width: 1080, height: 1920 };

  it('projeta o equador como reta horizontal (grande círculo pelo centro)', () => {
    const expectedY = cam.height / 2 + focalPx(cam) * Math.tan(BAND_PITCH_DEG * DEG);
    for (let lon = -22.5; lon <= 22.5; lon += 2.5) {
      const p = projectLonLat(cam, lon, 0);
      expect(p).not.toBeNull();
      expect(p!.y).toBeCloseTo(expectedY, 6);
    }
  });

  it('projeta o centro do paralelo 40° em y = centro − focal·tan(20°)', () => {
    // 40° de latitude com pitch 20° → 20° acima do eixo óptico.
    const p = projectLonLat(cam, 0, LAT_SPAN_DEG)!;
    expect(p.x).toBeCloseTo(cam.width / 2, 9);
    expect(p.y).toBeCloseTo(cam.height / 2 - focalPx(cam) * Math.tan(BAND_PITCH_DEG * DEG), 6);
  });

  it('é simétrico em longitude: x(−lon) = width − x(lon)', () => {
    for (const lat of [0, 20, 40]) {
      for (const lon of [5, 12.5, 22.5]) {
        const a = projectLonLat(cam, lon, lat)!;
        const b = projectLonLat(cam, -lon, lat)!;
        expect(b.x).toBeCloseTo(cam.width - a.x, 6);
        expect(b.y).toBeCloseTo(a.y, 6);
      }
    }
  });

  it('projeta os meridianos ±22.5° como retas (colinearidade)', () => {
    for (const lon of [-22.5, 22.5]) {
      const pts = [0, 10, 20, 30, 40].map((lat) => projectLonLat(cam, lon, lat)!);
      const [a, b] = [pts[0], pts[pts.length - 1]];
      for (const p of pts) {
        // distância de p à reta a—b, normalizada pelo comprimento
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        expect(Math.abs(cross) / len).toBeLessThan(1e-6);
      }
    }
  });

  it('curva o paralelo 40°: bordas mais altas na tela que o centro', () => {
    const center = projectLonLat(cam, 0, 40)!;
    const edge = projectLonLat(cam, 22.5, 40)!;
    expect(edge.y).toBeLessThan(center.y); // y de tela cresce para baixo
  });

  it('tem razão topo/base projetada ≈ 0.7515 (não os 76.6% esféricos)', () => {
    const topL = projectLonLat(cam, -22.5, 40)!;
    const topR = projectLonLat(cam, 22.5, 40)!;
    const botL = projectLonLat(cam, -22.5, 0)!;
    const botR = projectLonLat(cam, 22.5, 0)!;
    const ratio = (topR.x - topL.x) / (botR.x - botL.x);
    // Valor fechado: cos40·cos22.5·cos20 / (sin40·sin20 + cos40·cos22.5·cos20)
    expect(ratio).toBeCloseTo(0.7515, 3);
    // A spec de projeto partiu de cos40° = 0.766 (razão esférica); a projetada
    // fica dentro de ±2% dela — mesma geometria, vista em perspectiva.
    expect(Math.abs(ratio - Math.cos(40 * DEG))).toBeLessThan(0.02);
  });

  it('faz roundtrip lonLat → pixel → lonLat com erro < 1e-6°', () => {
    for (let lon = -22.5; lon <= 22.5; lon += 45 / 8) {
      for (let lat = 0; lat <= 40; lat += 5) {
        const p = projectLonLat(cam, lon, lat)!;
        const back = unproject(cam, p.x, p.y);
        expect(back.lon).toBeCloseTo(lon, 6);
        expect(back.lat).toBeCloseTo(lat, 6);
      }
    }
  });

  it('espelha a faixa inferior: mesma geometria com y refletido', () => {
    const lower: CameraModel = { ...cam, pitchDeg: pitchForBand('lower') };
    const up = projectLonLat(cam, 10, 25)!;
    const down = projectLonLat(lower, 10, -25)!;
    expect(down.x).toBeCloseTo(up.x, 6);
    expect(down.y).toBeCloseTo(cam.height - up.y, 6);
  });

  it('sampleParallel devolve segments+1 pontos ordenados', () => {
    const pts = sampleParallel(cam, 40, -22.5, 22.5, 16);
    expect(pts.length).toBe(17);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
    }
  });

  describe('maskFitsFrame', () => {
    it('reprova a lente principal (vFOV 60° em retrato não comporta 45° de longitude)', () => {
      const narrow: CameraModel = { ...cam, vFovDeg: 60 };
      expect(maskFitsFrame(narrow, 'upper')).toBeFalse();
    });

    it('aprova a ultrawide (vFOV 100° em retrato)', () => {
      expect(maskFitsFrame(cam, 'upper')).toBeTrue();
      expect(maskFitsFrame({ ...cam, pitchDeg: -BAND_PITCH_DEG }, 'lower')).toBeTrue();
    });

    it('reprova quando o retângulo visível (crop do cover) esconde parte do gomo', () => {
      const { equatorLeft, equatorRight } = goreOutline(cam, 'upper');
      const width = equatorRight.x - equatorLeft.x;
      // janela visível mais estreita que a base do gomo
      expect(
        maskFitsFrame(cam, 'upper', {
          x: equatorLeft.x + width * 0.1,
          y: 0,
          width: width * 0.8,
          height: cam.height,
        }),
      ).toBeFalse();
    });
  });
});
