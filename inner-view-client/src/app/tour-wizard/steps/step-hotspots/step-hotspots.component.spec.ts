import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { StepHotspotsComponent } from './step-hotspots.component';

/**
 * O clique no pin (B4).
 *
 * "Clicar num pin com destino NAVEGA e nunca abre editor" é regra dura do DoD
 * da frente, e a razão é de produto: a etapa 2 é o único lugar onde o corretor
 * confere o que o visitante vai viver. Se clicar num ponto abrisse formulário,
 * ele nunca veria o tour funcionando enquanto o monta.
 */
describe('StepHotspotsComponent — clique no pin', () => {
  let draft: TourDraftStore;
  let fixture: ComponentFixture<StepHotspotsComponent>;
  let editor: HotspotEditorStore;

  function scene(id: string, hotspots: WizardHotspot[] = []): WizardScene {
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

  function hotspot(id: string, target: string | null): WizardHotspot {
    return { id, u: 0.5, v: 0.5, label: '', target };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        // A etapa monta o bottom sheet (B8), que é um `IonModal`.
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
  });

  function monta(): void {
    fixture = TestBed.createComponent(StepHotspotsComponent);
    fixture.detectChanges();
    // O store do editor é fornecido PELO componente, então só existe depois de
    // ele ser criado.
    editor = fixture.debugElement.injector.get(HotspotEditorStore);
  }

  it('navega para o ambiente de destino, sem abrir o editor', () => {
    draft.scenes.set([scene('a', [hotspot('h1', 'b')]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPinActivated('h1');

    expect(draft.selectedSceneId()).toBe('b');
    expect(editor.sheet()).toBeNull();
  });

  it('fecha o sheet ao navegar — ele mostraria a lista do ambiente anterior', () => {
    draft.scenes.set([scene('a', [hotspot('h1', 'b')]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    editor.openList();

    fixture.componentInstance.onPinActivated('h1');

    expect(editor.sheet()).toBeNull();
  });

  it('abre o editor quando o ponto não tem destino', () => {
    draft.scenes.set([scene('a', [hotspot('h1', null)]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPinActivated('h1');

    expect(editor.sheet()).toEqual({ mode: 'editor', hotspotId: 'h1' });
    // E não saiu do lugar: não há para onde ir.
    expect(draft.selectedSceneId()).toBe('a');
  });

  it('ignora um id que não existe mais', () => {
    // O ponto pode ter sido excluído entre o toque e o handler.
    draft.scenes.set([scene('a', [hotspot('h1', 'b')]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPinActivated('fantasma');

    expect(draft.selectedSceneId()).toBe('a');
    expect(editor.sheet()).toBeNull();
  });

  it('não manda ao viewer os hotspots da cena', () => {
    // Quem desenha os pins é o overlay HTML; deixar a lista cheia faria o
    // viewer desenhar os sprites dele também, e apareceriam dois por ponto.
    draft.scenes.set([scene('a', [hotspot('h1', 'b')]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    expect(fixture.componentInstance.viewerPanoramas()[0].originHotspots).toEqual([]);
  });

  it('não monta o viewer para cena recusada', () => {
    draft.scenes.set([
      { ...scene('a'), state: 'rejected', rejectedReason: 'type' },
    ]);
    draft.selectedSceneId.set('a');
    monta();

    expect(fixture.componentInstance.viewerPanoramas()).toEqual([]);
  });
});
