import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { PropertyFiltersSheetComponent } from './property-filters-sheet.component';
import { FILTROS_VAZIOS } from '../../home/property-filters';

describe('PropertyFiltersSheetComponent', () => {
  let fixture: ComponentFixture<PropertyFiltersSheetComponent>;

  async function montar(aberto: boolean) {
    await TestBed.configureTestingModule({
      imports: [PropertyFiltersSheetComponent],
      providers: [
        // Sem ele o `IonModal` levanta "framework delegate is missing" ao
        // apresentar: e' o delegate que sabe montar o `ng-template` de dentro.
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PropertyFiltersSheetComponent);
    fixture.componentRef.setInput('filters', FILTROS_VAZIOS);
    fixture.componentRef.setInput('isOpen', aberto);
    fixture.detectChanges();
  }

  // Estes testes apresentam um IonModal de verdade, e um modal apresentado
  // prende o foco no DOCUMENTO, que e' um so para a suite inteira. A
  // apresentacao do Ionic e' assincrona: sem esta limpeza o modal sobrevive ao
  // teardown com o foco em cima e derruba teste de outro arquivo, dependendo
  // da ordem que o Karma sortear. Mesmo cuidado do hotspot-sheet.
  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('ion-modal').forEach((modal) => modal.remove());
    (document.activeElement as HTMLElement | null)?.blur();
  });

  it('o modal comeca fechado quando isOpen e falso', async () => {
    await montar(false);
    // A propriedade, e nao `ng-reflect-is-open`: aquele atributo so existe em
    // modo de desenvolvimento e o Angular esta removendo-o.
    const modal = (fixture.nativeElement as HTMLElement)
      .querySelector('ion-modal') as HTMLElement & { isOpen?: boolean };
    expect(modal.isOpen).toBeFalse();
  });

  // O `0` e' o que permite arrastar para baixo ate fechar; sem ele o sheet
  // trava na menor parada e a unica saida vira o botao.
  it('o primeiro breakpoint e zero', async () => {
    await montar(false);
    expect(fixture.componentInstance.breakpoints[0]).toBe(0);
  });

  it('repassa a mudanca de filtro do formulario', async () => {
    await montar(true);
    const emitidos: unknown[] = [];
    fixture.componentInstance.filtersChange.subscribe((f) => emitidos.push(f));

    fixture.componentInstance.aoMudar({ ...FILTROS_VAZIOS, type: 'HOUSE' });

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, type: 'HOUSE' }]);
  });

  it('fechar emite closed', async () => {
    await montar(true);
    let fechou = 0;
    fixture.componentInstance.closed.subscribe(() => fechou++);

    fixture.componentInstance.close();

    expect(fechou).toBe(1);
  });
});
