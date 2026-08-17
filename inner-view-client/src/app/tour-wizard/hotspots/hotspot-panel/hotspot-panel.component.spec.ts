import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { HotspotPanelComponent } from './hotspot-panel.component';

/**
 * O painel é onde o ponto ganha nome e destino (B6).
 *
 * Os casos abaixo são os que o corretor encontra e que dariam beco sem saída:
 * tour de um ambiente só (não há para onde apontar), ponto recém-criado (sem
 * destino, e isso não é erro) e o remonte da etapa, que já mordeu a etapa 3.
 */
describe('HotspotPanelComponent', () => {
  let draft: TourDraftStore;
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

  function hotspot(id: string, over: Partial<WizardHotspot> = {}): WizardHotspot {
    return { id, u: 0.5, v: 0.5, label: '', target: null, ...over };
  }

  function monta(): ComponentFixture<HotspotPanelComponent> {
    const fixture = TestBed.createComponent(HotspotPanelComponent);
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

  it('mostra estado vazio quando o ambiente não tem pontos', () => {
    draft.scenes.set([scene('a')]);
    draft.selectedSceneId.set('a');

    const fixture = monta();

    expect(fixture.nativeElement.querySelector('.tw-hp__empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.tw-hp__card').length).toBe(0);
  });

  it('não oferece o ambiente aberto como destino de si mesmo', () => {
    draft.scenes.set([scene('a', [hotspot('h1')]), scene('b'), scene('c')]);
    draft.selectedSceneId.set('a');

    const valores = [
      ...monta().nativeElement.querySelectorAll('select option'),
    ].map((o: HTMLOptionElement) => o.value);

    expect(valores).toEqual(['', 'b', 'c']);
  });

  it('troca o select por uma explicação quando só há um ambiente', () => {
    // Um select vazio faria o corretor procurar o próprio erro; o que falta é
    // uma foto na etapa 1.
    draft.scenes.set([scene('a', [hotspot('h1')])]);
    draft.selectedSceneId.set('a');

    const el = monta().nativeElement;

    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('.tw-hp__warn')).not.toBeNull();
  });

  it('avisa que ponto sem destino não é salvo, sem tratar como erro', () => {
    draft.scenes.set([scene('a', [hotspot('h1')]), scene('b')]);
    draft.selectedSceneId.set('a');

    const el = monta().nativeElement;

    expect(el.querySelector('.tw-hp__warn')).not.toBeNull();
    // Nada de campo em vermelho: o ponto é descartado no publicar, com aviso,
    // e isso não impede publicar.
    expect(el.querySelector('.has-error')).toBeNull();
  });

  it('grava nome e destino no rascunho', () => {
    draft.scenes.set([scene('a', [hotspot('h1')]), scene('b')]);
    draft.selectedSceneId.set('a');
    const fixture = monta();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('.tw-hp__name');
    input.value = 'Porta da cozinha';
    input.dispatchEvent(new Event('input'));

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    select.value = 'b';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(editor.hotspots()[0].label).toBe('Porta da cozinha');
    expect(editor.hotspots()[0].target).toBe('b');
  });

  it('reflete o destino já gravado ao montar', () => {
    // O caso do remonte: sair para a etapa 3 e voltar reconstrói o painel. Um
    // `[value]` no <select> não sobreviveria — a seleção sai do `[selected]`
    // de cada <option>.
    draft.scenes.set([
      scene('a', [hotspot('h1', { target: 'b' })]),
      scene('b'),
      scene('c'),
    ]);
    draft.selectedSceneId.set('a');

    const select: HTMLSelectElement = monta().nativeElement.querySelector('select');

    expect(select.value).toBe('b');
  });

  it('voltar para "sem destino" grava null, não string vazia', () => {
    // `toCreateTourPayload` filtra por `target !== null`; uma string vazia
    // passaria pelo filtro e subiria um destino inválido.
    draft.scenes.set([scene('a', [hotspot('h1', { target: 'b' })]), scene('b')]);
    draft.selectedSceneId.set('a');
    const fixture = monta();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    select.value = '';
    select.dispatchEvent(new Event('change'));

    expect(editor.hotspots()[0].target).toBeNull();
  });

  it('leva o foco ao card de um ponto que ACABOU de nascer', async () => {
    // O caso que quebrou no navegador. Enquanto o editor só era aberto a partir
    // de um pin já existente, o card sempre estava no DOM quando o efeito
    // corria. Criar o ponto e abrir a edição no mesmo tick inverteu isso: o
    // `querySelector` rodava antes de o `@for` criar o card, achava `null`, e no
    // desktop o clique na foto não tinha resposta nenhuma — o sheet lá não abre.
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    const fixture = monta();

    const id = editor.add(0.3, 0.4);
    editor.openEditor(id);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector(`#hs-label-${id}`),
    );
  });

  it('remove o ponto pelo botão', () => {
    draft.scenes.set([scene('a', [hotspot('h1'), hotspot('h2')]), scene('b')]);
    draft.selectedSceneId.set('a');
    const fixture = monta();

    fixture.nativeElement.querySelector('.tw-hp__remove').click();
    fixture.detectChanges();

    expect(editor.hotspots().map((h) => h.id)).toEqual(['h2']);
  });
});
