import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ModalController } from '@ionic/angular/standalone';

import { InnerViewPagePage } from './inner-view-page.page';
import { ADD_TOUR_INTENT } from '../models/navigation-intent';

describe('InnerViewPagePage — intencao de criar tour', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InnerViewPagePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        { provide: ModalController, useValue: { create: () => Promise.resolve({ present: () => {}, onDidDismiss: () => Promise.resolve({}) }) } },
      ],
    }).compileComponents();
  });

  it('dispara addImage quando a intencao chega no router state', () => {
    const fixture = TestBed.createComponent(InnerViewPagePage);
    const component = fixture.componentInstance;
    const spy = spyOn(component, 'addImage');

    component.aplicarIntencao(ADD_TOUR_INTENT);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ignora estado sem intencao', () => {
    const fixture = TestBed.createComponent(InnerViewPagePage);
    const component = fixture.componentInstance;
    const spy = spyOn(component, 'addImage');

    component.aplicarIntencao(undefined);
    component.aplicarIntencao('outra-coisa');

    expect(spy).not.toHaveBeenCalled();
  });
});
