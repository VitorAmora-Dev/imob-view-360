import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { SceneRailComponent } from './scene-rail.component';

/** Rail de ambientes da etapa 2 (B5). */
describe('SceneRailComponent', () => {
  let draft: TourDraftStore;
  let editor: HotspotEditorStore;

  function scene(id: string, over: Partial<WizardScene> = {}): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready',
      ...over,
    };
  }

  function monta(): ComponentFixture<SceneRailComponent> {
    const fixture = TestBed.createComponent(SceneRailComponent);
    fixture.detectChanges();
    return fixture;
  }

  function itens(fixture: ComponentFixture<SceneRailComponent>): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.tw-rail__item'));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        HotspotEditorStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    editor = TestBed.inject(HotspotEditorStore);
  });

  it('lista só os ambientes válidos', () => {
    // Cena recusada não tem imagem para o viewer abrir: oferecê-la seria
    // oferecer um beco sem saída.
    draft.scenes.set([
      scene('a'),
      scene('ruim', { state: 'rejected', rejectedReason: 'type' }),
      scene('c'),
    ]);

    expect(itens(monta()).length).toBe(2);
  });

  it('marca o ambiente aberto, para leitor de tela também', () => {
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('b');

    const [primeiro, segundo] = itens(monta());

    expect(primeiro.classList).not.toContain('is-selected');
    expect(segundo.classList).toContain('is-selected');
    expect(segundo.getAttribute('aria-current')).toBe('true');
  });

  it('troca de ambiente no clique', () => {
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    const fixture = monta();

    itens(fixture)[1].click();

    expect(draft.selectedSceneId()).toBe('b');
  });

  it('fecha o sheet ao trocar de ambiente', () => {
    // O sheet mostra os pontos do ambiente que estava aberto; mantê-lo de pé
    // sobre outra foto mostraria uma lista que não corresponde à tela.
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    editor.openList();
    const fixture = monta();

    itens(fixture)[1].click();

    expect(editor.sheet()).toBeNull();
  });

  it('não mexe em nada ao clicar no ambiente que já está aberto', () => {
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    editor.openList();
    const fixture = monta();

    itens(fixture)[0].click();

    // Fechar o sheet aqui seria um efeito colateral sem causa: nada mudou.
    expect(editor.sheet()).toEqual({ mode: 'list' });
    expect(draft.selectedSceneId()).toBe('a');
  });

  it('conta os pontos de cada ambiente', () => {
    const ponto = (id: string): WizardHotspot => ({
      id,
      u: 0.5,
      v: 0.5,
      label: '',
      target: null,
    });
    draft.scenes.set([
      scene('a', { hotspots: [ponto('h1'), ponto('h2')] }),
      scene('b'),
    ]);
    const fixture = monta();

    const contagens = Array.from(
      fixture.nativeElement.querySelectorAll('.tw-rail__count'),
    ).map((el) => (el as HTMLElement).textContent!.trim());

    // Sem loader de i18n no TestBed a chave sai crua; o que importa aqui é o
    // ramo escolhido, não o texto — a tradução é conferida na paridade pt/en.
    expect(contagens[0]).toContain('2');
    expect(contagens[1]).toBe('TOUR_WIZARD.STEP2.RAIL_NONE');
  });
});
