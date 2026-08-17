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

  it('mexer num hotspot não troca o array que vai para o viewer', () => {
    // O viewer recarrega a foto inteira quando a referência de `panoramas`
    // muda — ele não distingue "trocou a imagem" de "mexeu num ponto". Como
    // `patchScene` cria cena nova a cada mutação, sem o `equal` do computed
    // isto virava uma decodificação de equirretangular por tecla digitada e
    // por `pointermove` de arraste. Medido no navegador: 5 teclas = 5
    // recargas, um arraste = mais 18.
    //
    // O teste é de IDENTIDADE de propósito. Comparar valores é o que a suíte
    // já fazia, e foi exatamente por isso que ela não viu nada.
    draft.scenes.set([scene('a', [hotspot('h1', null)]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    const antes = fixture.componentInstance.viewerPanoramas();

    editor.update('h1', { label: 'Cozinha' });
    expect(fixture.componentInstance.viewerPanoramas()).toBe(antes);

    editor.startDrag('h1');
    editor.dragTo(0.2, 0.3);
    expect(fixture.componentInstance.viewerPanoramas()).toBe(antes);

    editor.add(0.6, 0.6);
    expect(fixture.componentInstance.viewerPanoramas()).toBe(antes);
  });

  it('trocar de ambiente troca o array, senão a foto não mudaria', () => {
    // O outro lado da moeda: o `equal` não pode segurar a mudança que importa.
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    const antes = fixture.componentInstance.viewerPanoramas();
    draft.selectScene('b');

    expect(fixture.componentInstance.viewerPanoramas()).not.toBe(antes);
    expect(fixture.componentInstance.viewerPanoramas()[0].id).toBe('b');
  });

  it('não manda ao viewer os hotspots da cena', () => {
    // Quem desenha os pins é o overlay HTML; deixar a lista cheia faria o
    // viewer desenhar os sprites dele também, e apareceriam dois por ponto.
    draft.scenes.set([scene('a', [hotspot('h1', 'b')]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    expect(fixture.componentInstance.viewerPanoramas()[0].originHotspots).toEqual([]);
  });

  it('liga o arraste à lixeira, sem que um saiba do outro', () => {
    // O overlay não sabe que existe lixeira; a lixeira não sabe que existe
    // arraste. Quem junta as duas pontas é a etapa, e é isso que se prova aqui.
    draft.scenes.set([scene('a', [hotspot('h1', null)]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    editor.startDrag('h1');
    fixture.detectChanges();

    const alvo: HTMLElement = fixture.nativeElement.querySelector('app-hotspot-trash');
    const r = alvo.getBoundingClientRect();

    fixture.componentInstance.onPinDragMoved({
      u: 0.4,
      v: 0.4,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    });
    expect(editor.pinDrag()?.overTrash).toBeTrue();

    fixture.componentInstance.onPinDragMoved({
      u: 0.4,
      v: 0.1,
      clientX: r.left + r.width / 2,
      clientY: r.top - 200,
    });
    expect(editor.pinDrag()?.overTrash).toBeFalse();
    // E o ponto seguiu o ponteiro nos dois casos.
    expect(editor.hotspots()[0].v).toBe(0.1);
  });

  it('criar um ponto já pergunta para onde ele leva', () => {
    // Antes eram dois cliques: um para criar, outro no pin para nomear. O
    // segundo não decidia nada e nada na tela contava que ele existia — dava
    // para criar cinco pontos e nunca descobrir como nomeá-los.
    //
    // E o que abre é o SELETOR, não o editor: no instante da criação a única
    // coisa obrigatória é o destino.
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });

    expect(editor.picker()).toBe(editor.hotspots()[0].id);
    // O sheet NÃO abre: ele cobre metade da tela, e com o toque na metade de
    // baixo da foto cobriria o próprio ponto recém-criado.
    expect(editor.sheet()).toBeNull();
  });

  it('escolher o destino grava e fecha o seletor', () => {
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });
    const criado = editor.hotspots()[0].id;

    editor.pickTarget(criado, 'b');

    expect(editor.hotspots()[0].target).toBe('b');
    expect(editor.picker()).toBeNull();
  });

  it('com o seletor aberto, tocar na foto fecha em vez de criar outro ponto', () => {
    // Sem isto não haveria como dispensá-lo tocando fora: o toque criaria um
    // segundo ponto e um segundo seletor, e quem quisesse sair ganharia um
    // ponto órfão a cada tentativa.
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });

    fixture.componentInstance.onPlaced({ positionX: 0.7, positionY: 0.6 });

    expect(editor.hotspots().length).toBe(1);
    expect(editor.picker()).toBeNull();
  });

  it('não pergunta nada quando não há segundo ambiente', () => {
    // O seletor só saberia aparecer vazio, e apareceria a cada clique na foto.
    draft.scenes.set([scene('a')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });

    expect(editor.hotspots().length).toBe(1);
    expect(editor.picker()).toBeNull();
    expect(editor.sheet()).toBeNull();
  });

  it('arrastar o ponto fecha o seletor — ele está grudado no pin', () => {
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });
    const criado = editor.hotspots()[0].id;

    editor.startDrag(criado);

    expect(editor.picker()).toBeNull();
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
