import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { PropertyFiltersBarComponent } from './property-filters-bar.component';
import { FILTROS_VAZIOS, PropertyFilters } from '../../home/property-filters';
import { TW_MOBILE_QUERY } from '../../tour-wizard/hotspots/media';

describe('PropertyFiltersBarComponent', () => {
  let fixture: ComponentFixture<PropertyFiltersBarComponent>;

  /**
   * Dubla SO a consulta do projeto. O Ionic tambem pergunta por media queries
   * — plataforma, `prefers-reduced-motion` —, e devolver o mesmo dublê para
   * todo mundo o faria acreditar em coisas que nao foram ditas aqui. Mesmo
   * cuidado do hotspot-sheet.
   */
  function fingirLargura(mobile: boolean) {
    const real = window.matchMedia.bind(window);
    const lista = {
      matches: mobile,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;

    spyOn(window, 'matchMedia').and.callFake((consulta: string) =>
      consulta === TW_MOBILE_QUERY ? lista : real(consulta),
    );
  }

  // A apresentacao do Ionic e' assincrona e o modal sobrevive ao teardown com o
  // foco em cima, derrubando teste de outro arquivo conforme a ordem sorteada.
  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('ion-modal').forEach((modal) => modal.remove());
    (document.activeElement as HTMLElement | null)?.blur();
  });

  async function montar(mobile: boolean, filtros: PropertyFilters = FILTROS_VAZIOS) {
    fingirLargura(mobile);

    await TestBed.configureTestingModule({
      imports: [PropertyFiltersBarComponent],
      providers: [
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PropertyFiltersBarComponent);
    fixture.componentRef.setInput('filters', filtros);
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('no desktop o formulario fica embutido', async () => {
    await montar(false);
    expect(el().querySelector('app-property-filters-form')).not.toBeNull();
    expect(el().querySelector('button[data-filtros-toggle]')).toBeNull();
  });

  // Um IonModal escondido por CSS continua prendendo o foco, travando o scroll
  // e respondendo ao Esc. A diferenca entre "some da vista" e "nao esta la" e'
  // a diferenca entre uma barra de filtros e um teclado preso.
  it('no desktop o sheet nao existe no DOM', async () => {
    await montar(false);
    expect(el().querySelector('app-property-filters-sheet')).toBeNull();
  });

  it('no mobile o formulario embutido da lugar ao botao', async () => {
    await montar(true);
    expect(el().querySelector('button[data-filtros-toggle]')).not.toBeNull();
    expect(el().querySelector('app-property-filters-sheet')).not.toBeNull();
  });

  it('o botao mostra a contagem de filtros ativos', async () => {
    await montar(true, { type: 'HOUSE', purpose: 'RENT', location: '', query: '' });
    expect(fixture.componentInstance.quantidade()).toBe(2);
    expect(el().querySelector('button[data-filtros-toggle]')?.textContent)
      .toContain('HOME.FILTERS.TOGGLE_COUNT');
  });

  it('sem filtro o botao usa o rotulo sem numero', async () => {
    await montar(true);
    expect(el().querySelector('button[data-filtros-toggle]')?.textContent)
      .toContain('HOME.FILTERS.TOGGLE');
  });

  it('o botao abre o sheet', async () => {
    await montar(true);
    expect(fixture.componentInstance.sheetAberto()).toBeFalse();

    (el().querySelector('button[data-filtros-toggle]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.sheetAberto()).toBeTrue();
  });

  it('repassa a mudanca de filtro para cima', async () => {
    await montar(false);
    const emitidos: PropertyFilters[] = [];
    fixture.componentInstance.filtersChange.subscribe((f) => emitidos.push(f));

    fixture.componentInstance.aoMudar({ ...FILTROS_VAZIOS, type: 'LAND' });

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, type: 'LAND' }]);
  });
});
