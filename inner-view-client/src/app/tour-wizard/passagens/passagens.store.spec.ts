import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HotspotEditorStore } from '../hotspot-editor.store';
import { TourDraftStore } from '../tour-draft.store';
import { WizardHotspot, WizardScene } from '../tour-wizard.model';
import { PassagensStore } from './passagens.store';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(
  id: string,
  connections: string[] = [],
  hotspots: WizardHotspot[] = [],
): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
    connections,
  };
}

describe('PassagensStore', () => {
  let draft: TourDraftStore;
  let passagens: PassagensStore;

  function montar(cenas: WizardScene[]) {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        HotspotEditorStore,
        PassagensStore,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    draft.scenes.set(cenas);
    passagens = TestBed.inject(PassagensStore);
    passagens.abrir();
  }

  afterEach(() => TestBed.resetTestingModule());

  const pontosDe = (id: string) =>
    draft.scenes().find((s) => s.id === id)?.hotspots ?? [];

  it('abre na primeira passagem pendente', () => {
    montar([
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala']),
    ]);

    expect(passagens.indice()).toBe(1);
    expect(passagens.atual()?.origem.id).toBe('cozinha');
  });

  /**
   * A ARMADILHA, e a razao de este teste existir.
   *
   * `HotspotEditorStore.add()` e `.update()` escrevem na cena de
   * `draft.selectedSceneId()`, e NAO numa cena passada por parametro. Se o
   * ponteiro andar sem sincronizar a selecao, o ponto vai para a FOTO ERRADA --
   * sem erro nenhum, sem nada na tela denunciando.
   */
  it('a cena selecionada acompanha o passo, SEMPRE', () => {
    montar([
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    expect(draft.selectedSceneId()).toBe('sala');

    passagens.marcar(0.3, 0.4);
    passagens.confirmar();
    // Ainda na Sala: o segundo destino dela e o proximo da fila.
    expect(draft.selectedSceneId()).toBe('sala');

    passagens.marcar(0.6, 0.4);
    passagens.confirmar();
    // Os destinos da Sala acabaram; agora e a foto da Cozinha.
    expect(draft.selectedSceneId()).toBe('cozinha');
  });

  it('marcar grava o ponto na cena de origem, com o destino da passagem', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    passagens.marcar(0.25, 0.75);

    const pontos = pontosDe('sala');
    expect(pontos.length).toBe(1);
    expect(pontos[0].target).toBe('cozinha');
    expect(pontos[0].u).toBe(0.25);
    expect(pontosDe('cozinha')).toEqual([]);
  });

  it('marcar de novo MOVE o ponto, nao cria um segundo', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    passagens.marcar(0.25, 0.75);
    passagens.marcar(0.8, 0.2);

    expect(pontosDe('sala').length).toBe(1);
    expect(pontosDe('sala')[0].u).toBe(0.8);
  });

  it('refazer apaga so a passagem atual', () => {
    montar([
      cena('sala', ['cozinha', 'quarto'], [ponto('h9', 'quarto')]),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);
    passagens.marcar(0.3, 0.4);
    passagens.refazer();

    expect(pontosDe('sala').map((h) => h.id)).toEqual(['h9']);
  });

  it('confirmar sem ponto nao anda', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    const antes = passagens.indice();
    passagens.confirmar();

    expect(passagens.indice()).toBe(antes);
  });

  // O pedido: permanece na MESMA foto ate acabarem os destinos daquele ambiente.
  it('fica na mesma foto enquanto houver destino no ambiente', () => {
    montar([
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    passagens.marcar(0.3, 0.4);
    passagens.confirmar();

    expect(passagens.atual()?.origem.id).toBe('sala');
    expect(passagens.atual()?.destino.id).toBe('quarto');
  });

  it('as pendentes do ambiente sao as outras da mesma foto', () => {
    montar([
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    expect(passagens.pendentes().map((p) => p.destino.id)).toEqual(['quarto']);
  });

  it('conta quantas ja foram feitas', () => {
    montar([
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala']),
    ]);

    expect(passagens.feitas()).toBe(1);
    expect(passagens.total()).toBe(2);
  });

  it('acabou quando nao ha mais pendente', () => {
    montar([
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ]);

    expect(passagens.acabou()).toBeTrue();
  });

  it('sem conexao nenhuma, nao ha fila', () => {
    montar([cena('sala'), cena('cozinha')]);

    expect(passagens.total()).toBe(0);
    expect(passagens.atual()).toBeNull();
    expect(passagens.acabou()).toBeTrue();
  });
});
