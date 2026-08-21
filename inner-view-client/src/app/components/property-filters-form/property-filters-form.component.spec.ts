import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { PropertyFiltersFormComponent } from './property-filters-form.component';
import { FILTROS_VAZIOS, PropertyFilters } from '../../home/property-filters';

describe('PropertyFiltersFormComponent', () => {
  let fixture: ComponentFixture<PropertyFiltersFormComponent>;
  let emitidos: PropertyFilters[];

  async function montar(filtros: PropertyFilters = FILTROS_VAZIOS) {
    await TestBed.configureTestingModule({
      imports: [PropertyFiltersFormComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(PropertyFiltersFormComponent);
    fixture.componentRef.setInput('filters', filtros);
    emitidos = [];
    fixture.componentInstance.filtersChange.subscribe((f) => emitidos.push(f));
    fixture.detectChanges();
  }

  function select(nome: 'type' | 'purpose'): HTMLSelectElement {
    const el = fixture.nativeElement as HTMLElement;
    return el.querySelector('select[data-filtro="' + nome + '"]') as HTMLSelectElement;
  }

  it('monta um select de tipo com todos os valores mais "todos"', async () => {
    await montar();
    // 6 tipos + a opcao vazia
    expect(select('type').options.length).toBe(7);
  });

  it('monta um select de finalidade com todos os valores mais "todas"', async () => {
    await montar();
    expect(select('purpose').options.length).toBe(4);
  });

  it('escolher um tipo emite so o tipo trocado', async () => {
    await montar({ ...FILTROS_VAZIOS, query: 'casa' });

    select('type').value = 'APARTMENT';
    select('type').dispatchEvent(new Event('change'));

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, type: 'APARTMENT', query: 'casa' }]);
  });

  it('voltar para "todos os tipos" emite tipo nulo', async () => {
    await montar({ ...FILTROS_VAZIOS, type: 'HOUSE' });

    select('type').value = '';
    select('type').dispatchEvent(new Event('change'));

    expect(emitidos).toEqual([FILTROS_VAZIOS]);
  });

  it('escolher uma finalidade emite so a finalidade trocada', async () => {
    await montar();

    select('purpose').value = 'RENT';
    select('purpose').dispatchEvent(new Event('change'));

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, purpose: 'RENT' }]);
  });

  it('o select reflete o filtro que chegou', async () => {
    await montar({ type: 'LAND', purpose: 'SALE', location: 'Centro', query: '' });

    expect(select('type').value).toBe('LAND');
    expect(select('purpose').value).toBe('SALE');
  });

  it('digitar localizacao emite o texto sem espaco em volta', async () => {
    await montar();

    fixture.componentInstance.onLocation(
      new CustomEvent('ionInput', { detail: { value: '  Centro  ' } }),
    );

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, location: 'Centro' }]);
  });

  // "Limpar filtros" limpa filtros. O texto tem caixa propria, visivel, com
  // botao de limpar do proprio searchbar.
  it('limpar zera os tres filtros e mantem o texto', async () => {
    await montar({ type: 'HOUSE', purpose: 'SALE', location: 'Centro', query: 'casa' });

    const botao = (fixture.nativeElement as HTMLElement)
      .querySelector('button[data-filtro="clear"]') as HTMLButtonElement;
    botao.click();

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, query: 'casa' }]);
  });

  it('sem filtro ativo nao ha botao de limpar', async () => {
    await montar({ ...FILTROS_VAZIOS, query: 'casa' });

    expect((fixture.nativeElement as HTMLElement)
      .querySelector('button[data-filtro="clear"]')).toBeNull();
  });
});
