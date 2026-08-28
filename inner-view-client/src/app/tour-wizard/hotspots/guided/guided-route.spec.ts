import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import {
  cicloFechado,
  corDoAmbiente,
  estadoDosDots,
  passagemDoPasso,
  passoDoRoteiro,
  primeiroPassoIncompleto,
} from './guided-route';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(id: string, hotspots: WizardHotspot[] = []): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
  };
}

/** Sala -> Cozinha -> Quarto -> (volta para Sala). Nenhuma passagem ainda. */
function tresVazias(): WizardScene[] {
  return [cena('sala'), cena('cozinha'), cena('quarto')];
}

describe('passagemDoPasso', () => {
  it('acha o ponto que leva ao ambiente alvo', () => {
    const sala = cena('sala', [ponto('h1', 'cozinha')]);
    expect(passagemDoPasso(sala, 'cozinha')?.id).toBe('h1');
  });

  // O ambiente pode ter outros pontos, do editor livre. Eles nao sao a
  // passagem deste passo e o assistente nao pode confundi-los com ela.
  it('ignora pontos que levam a outro lugar', () => {
    const sala = cena('sala', [ponto('h1', 'varanda'), ponto('h2', 'cozinha')]);
    expect(passagemDoPasso(sala, 'cozinha')?.id).toBe('h2');
  });

  it('ignora ponto sem destino', () => {
    const sala = cena('sala', [ponto('h1', null)]);
    expect(passagemDoPasso(sala, 'cozinha')).toBeNull();
  });

  it('sem passagem devolve null', () => {
    expect(passagemDoPasso(cena('sala'), 'cozinha')).toBeNull();
  });
});

describe('passoDoRoteiro', () => {
  it('o passo i aponta para o ambiente i+1', () => {
    const passo = passoDoRoteiro(tresVazias(), 0);
    expect(passo?.scene.id).toBe('sala');
    expect(passo?.target.id).toBe('cozinha');
    expect(passo?.index).toBe(0);
    expect(passo?.total).toBe(3);
    expect(passo?.isLast).toBeFalse();
  });

  // O ciclo e o que garante que ninguem fica preso: o ultimo fecha no primeiro.
  it('o ultimo passo aponta de volta para o primeiro', () => {
    const passo = passoDoRoteiro(tresVazias(), 2);
    expect(passo?.scene.id).toBe('quarto');
    expect(passo?.target.id).toBe('sala');
    expect(passo?.isLast).toBeTrue();
  });

  it('traz a passagem que ja existe', () => {
    const cenas = [cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')];
    expect(passoDoRoteiro(cenas, 0)?.hotspot?.id).toBe('h1');
  });

  // Com um ambiente so nao ha percurso a montar, e a etapa 2 ja e opcional ai.
  it('menos de dois ambientes nao tem roteiro', () => {
    expect(passoDoRoteiro([cena('sala')], 0)).toBeNull();
    expect(passoDoRoteiro([], 0)).toBeNull();
  });

  // O indice vem de `findIndex`, que devolve -1 quando a cena selecionada nao
  // esta entre as prontas - durante uma troca, por exemplo.
  it('indice fora da faixa devolve null', () => {
    expect(passoDoRoteiro(tresVazias(), -1)).toBeNull();
    expect(passoDoRoteiro(tresVazias(), 3)).toBeNull();
  });

  it('dois ambientes formam um ciclo de ida e volta', () => {
    const cenas = [cena('sala'), cena('cozinha')];
    expect(passoDoRoteiro(cenas, 0)?.target.id).toBe('cozinha');
    expect(passoDoRoteiro(cenas, 1)?.target.id).toBe('sala');
  });
});

describe('primeiroPassoIncompleto', () => {
  it('pula os passos que ja estao ligados', () => {
    const cenas = [
      cena('sala', [ponto('h1', 'cozinha')]),
      cena('cozinha'),
      cena('quarto'),
    ];
    expect(primeiroPassoIncompleto(cenas)).toBe(1);
  });

  it('tudo ligado devolve -1', () => {
    const cenas = [
      cena('sala', [ponto('h1', 'cozinha')]),
      cena('cozinha', [ponto('h2', 'quarto')]),
      cena('quarto', [ponto('h3', 'sala')]),
    ];
    expect(primeiroPassoIncompleto(cenas)).toBe(-1);
  });

  it('nada ligado comeca do zero', () => {
    expect(primeiroPassoIncompleto(tresVazias())).toBe(0);
  });

  it('menos de dois ambientes devolve -1', () => {
    expect(primeiroPassoIncompleto([cena('sala')])).toBe(-1);
  });
});

describe('cicloFechado', () => {
  it('so com todos ligados', () => {
    const cenas = [
      cena('sala', [ponto('h1', 'cozinha')]),
      cena('cozinha', [ponto('h2', 'sala')]),
    ];
    expect(cicloFechado(cenas)).toBeTrue();
  });

  it('faltando um, nao fechou', () => {
    const cenas = [cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')];
    expect(cicloFechado(cenas)).toBeFalse();
  });

  it('menos de dois ambientes nunca fecha', () => {
    expect(cicloFechado([cena('sala')])).toBeFalse();
  });
});

describe('estadoDosDots', () => {
  it('marca atual, concluido e pendente', () => {
    const cenas = [
      cena('sala', [ponto('h1', 'cozinha')]),
      cena('cozinha'),
      cena('quarto'),
    ];
    expect(estadoDosDots(cenas, 1)).toEqual(['concluido', 'atual', 'pendente']);
  });

  // O atual ganha do concluido: a pilula tem que dizer onde a pessoa esta,
  // mesmo que aquele passo ja esteja resolvido.
  it('o atual vence mesmo com passagem feita', () => {
    const cenas = [cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')];
    expect(estadoDosDots(cenas, 0)[0]).toBe('atual');
  });

  it('menos de dois ambientes nao tem dots', () => {
    expect(estadoDosDots([cena('sala')], 0)).toEqual([]);
  });
});

describe('corDoAmbiente', () => {
  it('devolve um token do tema, nunca hex', () => {
    expect(corDoAmbiente(0)).toBe('var(--app-room-1)');
    expect(corDoAmbiente(5)).toBe('var(--app-room-6)');
  });

  it('cicla depois do sexto', () => {
    expect(corDoAmbiente(6)).toBe(corDoAmbiente(0));
    expect(corDoAmbiente(13)).toBe(corDoAmbiente(1));
  });
});
