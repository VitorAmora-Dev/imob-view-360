import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { StepInfoComponent } from './step-info.component';

/**
 * O que os <select> mostram tem que ser o que o rascunho guarda.
 *
 * O defeito que isto trava: a seleção vinha de um `[value]` no <select>, que é
 * atribuído antes de o `@for` criar as opções e por isso não grudava. Bastava
 * ir conferir a etapa 2 e voltar — o componente remonta — para os campos
 * voltarem a "Selecione…" com o store cheio. A tela dizia uma coisa e o
 * publicado fazia outra, que é pior que perder o dado.
 */
describe('StepInfoComponent — tipo e finalidade', () => {
  let store: TourDraftStore;

  function monta(): ComponentFixture<StepInfoComponent> {
    const fixture = TestBed.createComponent(StepInfoComponent);
    fixture.detectChanges();
    return fixture;
  }

  function selects(fixture: ComponentFixture<StepInfoComponent>): HTMLSelectElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('select'));
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

  it('nasce vazio quando o rascunho está vazio', () => {
    expect(selects(monta()).map((s) => s.value)).toEqual(['', '']);
  });

  it('reflete o que já estava no rascunho ao montar', () => {
    // É este o caso do remonte: o store vem preenchido de antes, e o componente
    // é construído do zero.
    store.patchProperty({ type: 'HOUSE', purpose: 'RENT' });

    expect(selects(monta()).map((s) => s.value)).toEqual(['HOUSE', 'RENT']);
  });

  it('grava no rascunho o que for escolhido', () => {
    const fixture = monta();
    const [tipo, finalidade] = selects(fixture);

    tipo.value = 'LAND';
    tipo.dispatchEvent(new Event('change'));
    finalidade.value = 'SALE_OR_RENT';
    finalidade.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(store.property().type).toBe('LAND');
    expect(store.property().purpose).toBe('SALE_OR_RENT');
  });

  it('acompanha uma mudança feita fora do <select>', () => {
    const fixture = monta();
    store.patchProperty({ type: 'OFFICE' });
    fixture.detectChanges();

    expect(selects(fixture)[0].value).toBe('OFFICE');
  });
});
