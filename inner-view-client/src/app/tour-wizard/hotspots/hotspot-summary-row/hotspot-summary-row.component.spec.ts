import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { HotspotSummaryRowComponent } from './hotspot-summary-row.component';

/** Linha-resumo do mobile (B7). */
describe('HotspotSummaryRowComponent', () => {
  let draft: TourDraftStore;
  let editor: HotspotEditorStore;

  function cena(hotspots: WizardHotspot[]): WizardScene {
    return {
      id: 'a',
      room: 'Sala',
      fileName: 'a.jpg',
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots,
      state: 'ready',
    };
  }

  function ponto(id: string, label = ''): WizardHotspot {
    return { id, u: 0.5, v: 0.5, label, target: null };
  }

  function monta(): ComponentFixture<HotspotSummaryRowComponent> {
    const fixture = TestBed.createComponent(HotspotSummaryRowComponent);
    fixture.detectChanges();
    return fixture;
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

  it('não ocupa espaço quando não há ponto nenhum', () => {
    draft.scenes.set([cena([])]);
    draft.selectedSceneId.set('a');

    expect(monta().nativeElement.querySelector('.tw-sum-row')).toBeNull();
  });

  it('junta os nomes por " · "', () => {
    draft.scenes.set([cena([ponto('h1', 'Cozinha'), ponto('h2', 'Suíte')])]);
    draft.selectedSceneId.set('a');

    expect(monta().componentInstance.names()).toBe('Cozinha · Suíte');
  });

  it('usa o número do ponto que ainda não tem nome', () => {
    // Omiti-lo faria o contador dizer 3 e a linha listar 2, sem explicação.
    draft.scenes.set([cena([ponto('h1', 'Cozinha'), ponto('h2'), ponto('h3')])]);
    draft.selectedSceneId.set('a');
    const fixture = monta();

    expect(fixture.componentInstance.count()).toBe(3);
    expect(fixture.componentInstance.names()).toBe('Cozinha · 2 · 3');
  });

  it('"Ver todos" pede a lista completa', () => {
    draft.scenes.set([cena([ponto('h1')])]);
    draft.selectedSceneId.set('a');
    const fixture = monta();

    fixture.nativeElement.querySelector('.tw-sum-row__all').click();

    expect(editor.sheet()).toEqual({ mode: 'list' });
  });
});
