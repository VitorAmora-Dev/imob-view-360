import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { GuidedRouteStore } from './guided-route.store';

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

describe('GuidedRouteStore', () => {
  let draft: TourDraftStore;
  let guided: GuidedRouteStore;

  function montar(cenas: WizardScene[], selecionada = cenas[0]?.id ?? null) {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        HotspotEditorStore,
        GuidedRouteStore,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    draft.scenes.set(cenas);
    draft.selectedSceneId.set(selecionada);
    guided = TestBed.inject(GuidedRouteStore);
  }

  afterEach(() => TestBed.resetTestingModule());

  function pontosDe(id: string): WizardHotspot[] {
    return draft.scenes().find((s) => s.id === id)?.hotspots ?? [];
  }

  it('o passo vem da cena selecionada, e nao de um indice proprio', () => {
    montar([cena('sala'), cena('cozinha'), cena('quarto')], 'cozinha');
    expect(guided.indice()).toBe(1);
    expect(guided.passo()?.target.id).toBe('quarto');
  });

  it('marcar cria o ponto com o destino derivado da sequencia', () => {
    montar([cena('sala'), cena('cozinha')]);
    guided.marcar(0.3, 0.6);

    const pontos = pontosDe('sala');
    expect(pontos.length).toBe(1);
    expect(pontos[0].target).toBe('cozinha');
    expect(pontos[0].u).toBe(0.3);
    expect(pontos[0].v).toBe(0.6);
  });

  // O gesto e "corrigir onde eu marquei", nao "marcar de novo". Criar um
  // segundo ponto deixaria duas passagens para o mesmo lugar na mesma foto.
  it('marcar de novo MOVE a passagem, nao cria uma segunda', () => {
    montar([cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')]);
    guided.marcar(0.8, 0.4);

    const pontos = pontosDe('sala');
    expect(pontos.length).toBe(1);
    expect(pontos[0].id).toBe('h1');
    expect(pontos[0].u).toBe(0.8);
  });

  // A promessa central: o assistente nao destroi trabalho do editor livre.
  it('marcar nao encosta nos outros pontos do ambiente', () => {
    montar([
      cena('sala', [ponto('h1', 'varanda'), ponto('h2', null)]),
      cena('cozinha'),
    ]);
    guided.marcar(0.5, 0.5);

    const ids = pontosDe('sala').map((h) => h.id);
    expect(ids).toContain('h1');
    expect(ids).toContain('h2');
    expect(pontosDe('sala').length).toBe(3);
  });

  it('refazer apaga so a passagem deste passo', () => {
    montar([
      cena('sala', [ponto('h1', 'cozinha'), ponto('h2', 'varanda')]),
      cena('cozinha'),
    ]);
    guided.refazer();

    expect(pontosDe('sala').map((h) => h.id)).toEqual(['h2']);
  });

  it('confirmar troca a cena selecionada para o proximo', () => {
    montar([cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')]);
    guided.confirmar();

    expect(draft.selectedSceneId()).toBe('cozinha');
    expect(guided.indice()).toBe(1);
  });

  it('confirmar sem passagem nao faz nada', () => {
    montar([cena('sala'), cena('cozinha')]);
    guided.confirmar();

    expect(draft.selectedSceneId()).toBe('sala');
  });

  it('confirmar o ultimo passo com tudo ligado mostra o resumo', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'cozinha',
    );
    expect(guided.resumo()).toBeFalse();
    guided.confirmar();

    expect(guided.resumo()).toBeTrue();
    expect(guided.fechado()).toBeTrue();
  });

  // Sem isto, "Editar conexoes" voltaria ao passo 1 e o diagrama continuaria
  // na tela -- o ciclo segue fechado, e a gaveta nunca sairia do resumo.
  it('voltar ao inicio sai do resumo e vai para o passo 1', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'cozinha',
    );
    guided.confirmar();
    guided.voltarAoInicio();

    expect(guided.resumo()).toBeFalse();
    expect(draft.selectedSceneId()).toBe('sala');
  });

  // E confirmar de dentro dessa revisao nao pode devolver o resumo na hora:
  // quem clicou em "Editar conexoes" quer percorrer os passos.
  it('confirmar um passo do meio nao devolve o resumo', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'quarto')]),
        cena('quarto', [ponto('h3', 'sala')]),
      ],
      'sala',
    );
    guided.confirmar();

    expect(guided.resumo()).toBeFalse();
    expect(draft.selectedSceneId()).toBe('cozinha');
  });

  it('abrir vai para o primeiro passo incompleto', () => {
    montar(
      [cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha'), cena('quarto')],
      'quarto',
    );
    guided.abrir();

    expect(draft.selectedSceneId()).toBe('cozinha');
    expect(guided.resumo()).toBeFalse();
  });

  it('abrir com tudo ligado mostra o resumo direto', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'sala',
    );
    guided.abrir();

    expect(guided.resumo()).toBeTrue();
  });

  it('com um ambiente so o assistente nao esta disponivel', () => {
    montar([cena('sala')]);
    expect(guided.disponivel()).toBeFalse();
    expect(guided.passo()).toBeNull();
  });
});
