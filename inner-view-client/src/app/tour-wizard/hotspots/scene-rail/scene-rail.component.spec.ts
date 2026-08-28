import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { PanoramaImageCache } from '../../../services/panorama-image-cache.service';
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

  /**
   * As miniaturas de uma captura retomada.
   *
   * O rascunho é lido sem coluna de imagem (Tarefa 9), e quem baixa a foto
   * grande é o viewer — só a do cômodo SELECIONADO. O rail lia
   * `scene.imageData` direto, sem guarda: numa captura retomada ele abria com
   * `url()` vazio em toda linha, que é o ícone de imagem quebrada. As Tarefas
   * 9 e 10 blindaram o card da etapa 1 e a faixa da home contra exatamente
   * isto, e passaram por cima daqui.
   */
  describe('miniatura de uma cena retomada', () => {
    function retomada(id: string): WizardScene {
      return scene(id, { imageData: '', serverPanoramaId: `p-${id}` });
    }

    it('não desenha fundo nenhum enquanto não há imagem', () => {
      draft.scenes.set([retomada('a')]);
      spyOn(draft, 'garantirMiniatura').and.resolveTo('');

      const thumb: HTMLElement = monta().nativeElement.querySelector('.tw-rail__thumb');

      expect(thumb.style.backgroundImage).toBe('');
    });

    it('pede a miniatura de TODOS os cômodos do rail, e não só do selecionado', async () => {
      // O viewer pede a foto do cômodo aberto. Ninguém pedia pelos outros, e
      // eram justamente os outros que o rail existe para mostrar.
      draft.scenes.set([retomada('a'), retomada('b'), retomada('c')]);
      draft.selectedSceneId.set('a');
      const pedir = spyOn(draft, 'garantirMiniatura').and.resolveTo('');

      const fixture = monta();
      await fixture.whenStable();

      expect(pedir.calls.allArgs().map((args) => args[0]).sort()).toEqual([
        'a',
        'b',
        'c',
      ]);
    });

    it('pede a versão REDUZIDA, e não a equirretangular inteira', async () => {
      // Seis cômodos de equirect são dezenas de MB para desenhar seis selos.
      draft.scenes.set([retomada('a')]);
      const cache = spyOn(TestBed.inject(PanoramaImageCache), 'obter').and.resolveTo(
        'blob:mini',
      );

      const fixture = monta();
      await fixture.whenStable();

      expect(cache).toHaveBeenCalledWith('p-a', 'treated', 320);
    });

    it('desenha a miniatura assim que ela chega', async () => {
      draft.scenes.set([retomada('a')]);
      spyOn(draft, 'garantirMiniatura').and.callFake(async (id: string) => {
        draft.miniaturas.update((m) => ({ ...m, [id]: 'blob:mini' }));
        return 'blob:mini';
      });

      const fixture = monta();
      await fixture.whenStable();
      fixture.detectChanges();

      const thumb: HTMLElement = fixture.nativeElement.querySelector('.tw-rail__thumb');
      expect(thumb.style.backgroundImage).toContain('blob:mini');
    });

    it('não pede nada para a cena que já tem foto em memória', async () => {
      draft.scenes.set([scene('a')]);
      const pedir = spyOn(draft, 'garantirMiniatura');

      const fixture = monta();
      await fixture.whenStable();

      expect(pedir).not.toHaveBeenCalled();
    });
  });
});
