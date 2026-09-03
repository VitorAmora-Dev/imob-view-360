import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { InnerViewPagePage } from './inner-view-page.page';
import { TourSheetStore } from '../components/tour-sheet/tour-sheet.store';

describe('InnerViewPagePage', () => {
  let component: InnerViewPagePage;
  let fixture: ComponentFixture<InnerViewPagePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InnerViewPagePage],
      providers: [
        provideIonicAngular(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InnerViewPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('sheet de cenas', () => {
    it('o botao de cenas abre o sheet', () => {
      const store = TestBed.inject(TourSheetStore);
      expect(store.aberto()).toBeNull();

      component.abrirCenas();

      expect(store.aberto()).toBe('cenas');
    });

    // O viewer ja expoe `irPara(id)` publico -- nao ha API nova a inventar.
    it('escolher uma cena manda o viewer trocar', () => {
      const irPara = jasmine.createSpy('irPara');
      component.viewer = { irPara } as never;

      component.onCenaSelecionada({ id: 'c2' } as never);

      expect(irPara).toHaveBeenCalledWith('c2');
    });
  });
});
