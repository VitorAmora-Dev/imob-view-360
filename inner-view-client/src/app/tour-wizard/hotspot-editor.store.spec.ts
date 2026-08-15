import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HotspotEditorStore, V_MAX, V_MIN } from './hotspot-editor.store';
import { TourDraftStore } from './tour-draft.store';
import { WizardHotspot, WizardScene } from './tour-wizard.model';

/**
 * O arraste do lado do store (B9).
 *
 * O gesto em si é do overlay; aqui mora a única REGRA do arraste: até onde um
 * ponto pode ir. Ela tem um limite consciente e uma ausência consciente, e as
 * duas precisam de teste — sobretudo a ausência, que some sem barulho no dia em
 * que alguém "completar" o clamp.
 */
describe('HotspotEditorStore — arraste', () => {
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

  function ponto(): WizardHotspot {
    return { id: 'h1', u: 0.5, v: 0.5, label: '', target: null };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        HotspotEditorStore,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    editor = TestBed.inject(HotspotEditorStore);

    draft.scenes.set([cena([ponto()])]);
    draft.selectedSceneId.set('a');
  });

  it('leva o ponto para onde o dedo foi', () => {
    editor.startDrag('h1');

    editor.dragTo(0.3, 0.4);

    expect(editor.hotspots()[0]).toEqual(
      jasmine.objectContaining({ u: 0.3, v: 0.4 }),
    );
  });

  it('não deixa o ponto chegar aos polos', () => {
    // Nos polos o equirretangular está infinitamente esticado e todos os `u`
    // colapsam no mesmo pixel: um ponto de navegação ali não aponta para nada.
    editor.startDrag('h1');

    editor.dragTo(0.5, 0);
    expect(editor.hotspots()[0].v).toBe(V_MIN);

    editor.dragTo(0.5, 1);
    expect(editor.hotspots()[0].v).toBe(V_MAX);
  });

  it('deixa o ponto ir até a costura da foto', () => {
    // Divergência consciente do plano, que pede clamp de 2–98% em X também.
    // `u` dá a volta: 0 e 1 são o mesmo meridiano. Limitá-lo criaria uma faixa
    // morta ali — e uma incoerência, porque o clique que CRIA um ponto não tem
    // limite nenhum, então daria para criar em 0,99 e nunca arrastar de volta.
    editor.startDrag('h1');

    editor.dragTo(0.995, 0.5);

    expect(editor.hotspots()[0].u).toBe(0.995);
  });

  it('ignora movimento sem arraste em curso', () => {
    // `pointermove` chega antes de o long-press completar, e depois do
    // `pointerup`. Nenhum dos dois pode mover ponto nenhum.
    editor.dragTo(0.1, 0.1);

    expect(editor.hotspots()[0]).toEqual(
      jasmine.objectContaining({ u: 0.5, v: 0.5 }),
    );
  });

  it('excluir outro ponto não descarta a edição em andamento', () => {
    // Largar o ponto B na lixeira enquanto se edita o A fechava o editor do A
    // com o texto pela metade. A guarda não comparava id nenhum.
    draft.scenes.set([
      cena([ponto(), { id: 'h2', u: 0.2, v: 0.2, label: '', target: null }]),
    ]);
    draft.selectedSceneId.set('a');
    editor.openEditor('h1');

    editor.remove('h2');

    expect(editor.sheet()).toEqual({ mode: 'editor', hotspotId: 'h1' });
  });

  it('excluir o ponto aberto fecha o editor', () => {
    // O outro lado: sem isso, o sheet ficaria aberto sobre um ponto que não
    // existe mais.
    editor.openEditor('h1');

    editor.remove('h1');

    expect(editor.sheet()).toBeNull();
  });

  it('soltar encerra o arraste', () => {
    editor.startDrag('h1');
    expect(editor.pinDrag()).toEqual({ hotspotId: 'h1', overTrash: false });

    editor.endDrag();

    expect(editor.pinDrag()).toBeNull();
    // E o que vier depois não move mais nada.
    editor.dragTo(0.1, 0.1);
    expect(editor.hotspots()[0].u).toBe(0.5);
  });
});
