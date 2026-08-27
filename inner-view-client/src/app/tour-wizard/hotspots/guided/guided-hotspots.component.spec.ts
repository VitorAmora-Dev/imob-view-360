import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { GuidedHotspotsComponent } from './guided-hotspots.component';
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

describe('GuidedHotspotsComponent', () => {
  let fixture: ComponentFixture<GuidedHotspotsComponent>;
  let draft: TourDraftStore;
  let guided: GuidedRouteStore;

  function montar(cenas: WizardScene[], selecionada = cenas[0]?.id ?? null) {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        // Na aplicação quem fornece o editor é a ETAPA, para os dois modos
        // compartilharem a instância. Aqui a etapa não está montada.
        HotspotEditorStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    draft.scenes.set(cenas);
    draft.selectedSceneId.set(selecionada);

    fixture = TestBed.createComponent(GuidedHotspotsComponent);
    fixture.detectChanges();
    guided = fixture.debugElement.injector.get(GuidedRouteStore);
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function botaoPrimario(): HTMLButtonElement | null {
    return el().querySelector('.gs__acao');
  }

  function pontosDe(id: string): WizardHotspot[] {
    return draft.scenes().find((s) => s.id === id)?.hotspots ?? [];
  }

  it('mostra a gaveta com o proximo ambiente', () => {
    montar([cena('sala'), cena('cozinha')]);

    expect(el().querySelector('app-guided-sheet')).not.toBeNull();
    expect(el().textContent).toContain('cozinha');
  });

  // A trava e o que impede confirmar um passo sem passagem e avancar deixando
  // um ambiente sem saida -- o defeito que o assistente existe para evitar.
  it('sem passagem, o botao primario fica desabilitado', () => {
    montar([cena('sala'), cena('cozinha')]);

    expect(botaoPrimario()?.disabled).toBeTrue();
  });

  it('marcar a passagem libera o botao primario', () => {
    montar([cena('sala'), cena('cozinha')]);
    expect(botaoPrimario()?.disabled).toBeTrue();

    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.5 });
    fixture.detectChanges();

    expect(botaoPrimario()?.disabled).toBeFalse();
  });

  // Quem ja ligou metade no editor livre nao deve confirmar de novo o que ja
  // esta feito. Montar o assistente pula para onde falta trabalho.
  it('abre no primeiro passo incompleto, e nao no passo 1', () => {
    montar(
      [cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha'), cena('quarto')],
      'sala',
    );

    expect(guided.indice()).toBe(1);
    expect(botaoPrimario()?.disabled).toBeTrue();
  });

  it('o toque na foto marca a passagem com o destino derivado', () => {
    montar([cena('sala'), cena('cozinha')]);

    fixture.componentInstance.onPlaced({ positionX: 0.25, positionY: 0.75 });
    fixture.detectChanges();

    const pontos = pontosDe('sala');
    expect(pontos.length).toBe(1);
    expect(pontos[0].target).toBe('cozinha');
    expect(pontos[0].u).toBe(0.25);
  });

  it('ao fechar o ciclo a gaveta troca para o diagrama', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'cozinha',
    );

    guided.confirmar();
    fixture.detectChanges();

    expect(el().querySelector('app-guided-cycle')).not.toBeNull();
    expect(el().querySelector('app-guided-sheet')).toBeNull();
  });

  // Com o diagrama na tela nao ha passo em andamento; um toque ali moveria a
  // passagem do passo 1 sem que nada na tela dissesse isso.
  it('com o diagrama aberto, o toque na foto nao marca nada', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'cozinha',
    );

    guided.confirmar();
    fixture.detectChanges();
    fixture.componentInstance.onPlaced({ positionX: 0.9, positionY: 0.1 });

    expect(pontosDe('sala')[0].u).toBe(0.5);
  });

  it('com um ambiente so, o assistente nao monta', () => {
    montar([cena('sala')]);

    expect(el().querySelector('app-guided-sheet')).toBeNull();
    expect(el().querySelector('app-guided-cycle')).toBeNull();
  });
});
