import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTranslateService } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { HotspotTrashComponent } from './hotspot-trash.component';

/**
 * O alvo da lixeira (B10).
 *
 * Fica dentro de um pai posicionado e com tamanho, como no viewer de verdade:
 * o hit test lê o retângulo do próprio host, então testá-lo fora de um layout
 * mediria zeros e passaria dizendo nada.
 */
@Component({
  standalone: true,
  imports: [HotspotTrashComponent],
  template: `
    <div style="position: relative; width: 600px; height: 400px">
      <app-hotspot-trash />
    </div>
  `,
})
class PalcoComponent {}

describe('HotspotTrashComponent', () => {
  let fixture: ComponentFixture<PalcoComponent>;
  let editor: HotspotEditorStore;
  let draft: TourDraftStore;
  let lixeira: HotspotTrashComponent;

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

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PalcoComponent],
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

    draft.scenes.set([
      cena([
        { id: 'h1', u: 0.5, v: 0.5, label: '', target: null },
        { id: 'h2', u: 0.2, v: 0.2, label: '', target: null },
      ]),
    ]);
    draft.selectedSceneId.set('a');

    fixture = TestBed.createComponent(PalcoComponent);
    fixture.detectChanges();
    lixeira = fixture.debugElement.query(
      By.directive(HotspotTrashComponent),
    ).componentInstance;
  });

  /** Centro da área de acerto, em coordenadas de cliente. */
  function centroDoAlvo(): { x: number; y: number } {
    const r = fixture.debugElement
      .query(By.directive(HotspotTrashComponent))
      .nativeElement.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  it('não existe enquanto ninguém arrasta', () => {
    // Um botão permanente sobre a foto oferecendo excluir algo que não está
    // selecionado é ruído — e um ruído perigoso.
    expect(fixture.nativeElement.querySelector('.tw-trash')).toBeNull();
  });

  it('aparece quando o arraste começa', () => {
    editor.startDrag('h1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.tw-trash')).not.toBeNull();
  });

  it('não acusa acerto fora de um arraste', () => {
    // Sem esta guarda o alvo responderia "sim" a um ponteiro que só passou por
    // ali, e a etapa marcaria `overTrash` num arraste que não existe.
    editor.startDrag('h1');
    fixture.detectChanges();
    const centro = centroDoAlvo();
    editor.endDrag();
    fixture.detectChanges();

    expect(lixeira.contains(centro.x, centro.y)).toBeFalse();
  });

  it('acusa o ponteiro sobre o alvo, e só ele', () => {
    editor.startDrag('h1');
    fixture.detectChanges();
    const centro = centroDoAlvo();

    expect(lixeira.contains(centro.x, centro.y)).toBeTrue();
    // 120px ao lado: fora da faixa de ±92px do eixo.
    expect(lixeira.contains(centro.x + 120, centro.y)).toBeFalse();
    // 120px acima: fora dos 96px de altura.
    expect(lixeira.contains(centro.x, centro.y - 120)).toBeFalse();
  });

  it('a pílula nunca passa da área que responde', () => {
    // O que se vê promete onde soltar. Uma borda desenhada além da borda que
    // responde faria o ponto voltar para a foto sem explicação — e esta era a
    // situação real: com a frase longa, a pílula media 258px numa área de 184.
    //
    // O texto aqui é a chave crua do i18n, sem loader no TestBed, e isso é uma
    // sorte: é mais longo que qualquer tradução e prova a trava no pior caso.
    editor.startDrag('h1');
    fixture.detectChanges();

    const alvo = fixture.debugElement
      .query(By.directive(HotspotTrashComponent))
      .nativeElement.getBoundingClientRect();
    const pilula = fixture.nativeElement
      .querySelector('.tw-trash')
      .getBoundingClientRect();

    expect(alvo.width).toBe(184);
    expect(alvo.height).toBe(96);
    expect(pilula.width).toBeLessThanOrEqual(alvo.width);
    expect(pilula.height).toBeLessThan(alvo.height);
  });

  it('troca de estado quando o ponto entra', () => {
    editor.startDrag('h1');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tw-trash.is-active')).toBeNull();

    editor.setOverTrash(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.tw-trash.is-active')).not.toBeNull();
  });

  it('soltar sobre o alvo exclui o ponto', () => {
    editor.startDrag('h1');
    editor.setOverTrash(true);

    editor.endDrag();

    expect(editor.hotspots().map((h) => h.id)).toEqual(['h2']);
  });

  it('soltar fora do alvo só larga o ponto', () => {
    editor.startDrag('h1');
    editor.setOverTrash(true);
    editor.setOverTrash(false);

    editor.endDrag();

    expect(editor.hotspots().map((h) => h.id)).toEqual(['h1', 'h2']);
  });
});
