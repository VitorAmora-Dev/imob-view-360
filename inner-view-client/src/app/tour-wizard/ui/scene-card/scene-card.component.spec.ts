import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { SceneCardComponent } from './scene-card.component';

/**
 * O rótulo do card sai de `readyScenes()`, não da posição na lista.
 *
 * Esta distinção só aparece quando existe uma cena recusada ANTES de uma
 * válida — que é o caso que o card errava: mostrava "Capa" no arquivo que nem
 * ia subir, enquanto o resumo e o payload apontavam para outro. Era divergência
 * entre o que a tela dizia e o que o tour publicado fazia, e nenhum teste pegava
 * porque a verificação era a olho, sempre com fotos boas.
 */
describe('SceneCardComponent — capa e numeração', () => {
  let store: TourDraftStore;

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

  function monta(alvo: WizardScene, lista: WizardScene[]): ComponentFixture<SceneCardComponent> {
    store.scenes.set(lista.map((s, i) => ({ ...s, order: i })));
    const fixture = TestBed.createComponent(SceneCardComponent);
    fixture.componentRef.setInput('scene', alvo);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    store = TestBed.inject(TourDraftStore);
  });

  it('dá a capa à primeira cena válida, não à primeira da lista', () => {
    const recusada = scene('ruim', { state: 'rejected', rejectedReason: 'type' });
    const boa = scene('boa');
    const lista = [recusada, boa];

    expect(monta(recusada, lista).componentInstance.isCover()).toBe(false);
    expect(monta(boa, lista).componentInstance.isCover()).toBe(true);
    // O card e o resumo têm que contar a mesma história.
    expect(store.coverScene()?.id).toBe('boa');
  });

  it('numera só os ambientes válidos', () => {
    const lista = [
      scene('a'),
      scene('ruim', { state: 'rejected', rejectedReason: 'size' }),
      scene('c'),
    ];

    // 'c' é o SEGUNDO ambiente do tour, ainda que seja o terceiro card.
    expect(monta(lista[2], lista).componentInstance.roomNumber()).toBe(2);
  });

  it('não dá número a cena recusada — o card mostra o motivo no lugar', () => {
    const recusada = scene('ruim', { state: 'rejected', rejectedReason: 'size' });
    const fixture = monta(recusada, [scene('a'), recusada]);

    expect(fixture.componentInstance.roomNumber()).toBe(0);
    expect(fixture.nativeElement.querySelector('.tw-badge')).toBeNull();
  });

  it('mostra o tamanho em unidade legível', () => {
    const fixture = monta(
      scene('a', { fileSize: 9_400_000 }),
      [scene('a', { fileSize: 9_400_000 })],
    );

    expect(fixture.componentInstance.sizeLabel()).toBe('9.4 MB');
  });
});
