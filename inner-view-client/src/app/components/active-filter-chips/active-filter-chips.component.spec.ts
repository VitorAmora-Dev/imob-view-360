import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { ActiveFilterChipsComponent } from './active-filter-chips.component';
import { FilterChip } from '../../home/property-filters';

const CHIPS: FilterChip[] = [
  { key: 'type', labelKey: 'UPLOAD.TYPE.APARTMENT', labelText: '' },
  { key: 'location', labelKey: null, labelText: 'Centro' },
];

describe('ActiveFilterChipsComponent', () => {
  let fixture: ComponentFixture<ActiveFilterChipsComponent>;

  async function montar(chips: FilterChip[] = CHIPS) {
    await TestBed.configureTestingModule({
      imports: [ActiveFilterChipsComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(ActiveFilterChipsComponent);
    fixture.componentRef.setInput('chips', chips);
    fixture.detectChanges();
  }

  function botoes(): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button[data-chip]'),
    );
  }

  it('monta um botao por chip', async () => {
    await montar();
    expect(botoes().length).toBe(2);
  });

  // Sem traducao carregada o pipe devolve a chave — e' o que se afirma aqui.
  it('tipo mostra a chave traduzida; localizacao mostra o texto cru', async () => {
    await montar();
    expect(botoes()[0].textContent).toContain('UPLOAD.TYPE.APARTMENT');
    expect(botoes()[1].textContent).toContain('Centro');
  });

  it('clicar num chip emite a chave dele', async () => {
    await montar();
    const emitidos: string[] = [];
    fixture.componentInstance.remove.subscribe((k) => emitidos.push(k));

    botoes()[1].click();

    expect(emitidos).toEqual(['location']);
  });

  it('cada chip tem nome acessivel de remocao', async () => {
    await montar();
    expect(botoes()[1].getAttribute('aria-label')).toContain('HOME.FILTERS.REMOVE_CHIP');
  });

  it('o limpar tudo emite clear', async () => {
    await montar();
    let limpou = 0;
    fixture.componentInstance.clear.subscribe(() => limpou++);

    ((fixture.nativeElement as HTMLElement)
      .querySelector('button[data-chips-clear]') as HTMLButtonElement).click();

    expect(limpou).toBe(1);
  });

  it('sem chips nao renderiza nada', async () => {
    await montar([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('ul')).toBeNull();
  });
});
