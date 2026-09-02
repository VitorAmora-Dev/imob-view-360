import { Panorama, VirtualTour } from '../models/virtual-tour.model';
import {
  LARGURA_DA_MINIATURA,
  cenasDoTour,
  comLargura,
  marcarPrincipal,
} from './tour-viewer.model';

/**
 * A tradução de tour para cenas (TV-0).
 *
 * Função pura, testada sem montar componente: é o contrato que as três frentes
 * consomem, e um erro aqui aparece como "a miniatura errada tem borda accent"
 * três telas adiante.
 */

function panorama(parcial: Partial<Panorama> & { id: string }): Panorama {
  return {
    roomName: 'Sala',
    imageUrl: `/panoramas/${parcial.id}/image?v=1`,
    order: 0,
    initialPanorama: false,
    originHotspots: [],
    measurements: [],
    ...parcial,
  };
}

function tourCom(panoramas: Panorama[]): VirtualTour {
  return {
    id: 't1',
    status: 'PUBLISHED',
    propertyId: 'p1',
    createdAt: '',
    updatedAt: '',
    panoramas,
  };
}

describe('comLargura', () => {
  it('usa & quando o endereço já tem query string', () => {
    expect(comLargura('/panoramas/a/image?v=9', 292)).toBe('/panoramas/a/image?v=9&w=292');
  });

  it('usa ? quando não tem', () => {
    expect(comLargura('/panoramas/a/image', 292)).toBe('/panoramas/a/image?w=292');
  });
});

describe('cenasDoTour', () => {
  it('pede a miniatura pequena, nunca a esfera inteira', () => {
    const cenas = cenasDoTour(tourCom([panorama({ id: 'a' })]));

    expect(cenas[0].thumbUrl).toContain(`w=${LARGURA_DA_MINIATURA}`);
    // A esfera continua sem `w`: quem a desenha é o viewer, e ali a resolução
    // cheia é o produto.
    expect(cenas[0].imageUrl).not.toContain('w=');
  });

  it('usa o nome da cena destino quando o hotspot não tem label', () => {
    const cenas = cenasDoTour(
      tourCom([
        panorama({
          id: 'a',
          originHotspots: [
            { id: 'h1', positionX: 0.5, positionY: 0.5, targetId: 'b' },
            { id: 'h2', label: '  ', positionX: 0.1, positionY: 0.5, targetId: 'b' },
          ],
        }),
        panorama({ id: 'b', roomName: 'Cozinha' }),
      ]),
    );

    expect(cenas[0].hotspots[0].label).toBe('Cozinha');
    // Label só de espaços é ausência de label, não um rótulo em branco.
    expect(cenas[0].hotspots[1].label).toBe('Cozinha');
  });

  it('preserva as coordenadas UV sem converter nada', () => {
    const cenas = cenasDoTour(
      tourCom([
        panorama({
          id: 'a',
          originHotspots: [{ id: 'h1', positionX: 0.25, positionY: 0.75, targetId: 'b' }],
        }),
        panorama({ id: 'b' }),
      ]),
    );

    expect(cenas[0].hotspots[0].u).toBe(0.25);
    expect(cenas[0].hotspots[0].v).toBe(0.75);
  });
});

describe('marcarPrincipal', () => {
  const ponto = (id: string, alvo: string) => ({
    id,
    targetSceneId: alvo,
    label: '',
    u: 0.5,
    v: 0.5,
    kind: 'secondary' as const,
  });

  it('elege quem leva para a próxima cena da ordem', () => {
    const pontos = marcarPrincipal([ponto('h1', 'c'), ponto('h2', 'b')], 'b');

    expect(pontos.find((p) => p.id === 'h2')!.kind).toBe('primary');
    expect(pontos.find((p) => p.id === 'h1')!.kind).toBe('secondary');
  });

  it('deixa todos secundários quando ninguém leva para a próxima', () => {
    const pontos = marcarPrincipal([ponto('h1', 'z')], 'b');

    expect(pontos.every((p) => p.kind === 'secondary')).toBeTrue();
  });

  it('nunca marca mais de um por cena', () => {
    const pontos = marcarPrincipal([ponto('h1', 'b'), ponto('h2', 'b')], 'b');

    expect(pontos.filter((p) => p.kind === 'primary').length).toBe(1);
  });

  it('na última cena não há próxima, e ninguém é principal', () => {
    const pontos = marcarPrincipal([ponto('h1', 'a')], null);

    expect(pontos.every((p) => p.kind === 'secondary')).toBeTrue();
  });
});
