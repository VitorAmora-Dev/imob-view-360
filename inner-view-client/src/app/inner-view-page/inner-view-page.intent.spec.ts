import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ModalController } from '@ionic/angular/standalone';

import { InnerViewPagePage } from './inner-view-page.page';
import { ADD_TOUR_INTENT } from '../models/navigation-intent';
import { NavigationIntentService } from '../services/navigation-intent.service';

const ID = 'p9';

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
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: ID }) } } },
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

  it('o ngOnInit consome a intencao e abre o seletor', () => {
    TestBed.inject(NavigationIntentService).register(ID, ADD_TOUR_INTENT);

    const fixture = TestBed.createComponent(InnerViewPagePage);
    const spy = spyOn(fixture.componentInstance, 'addImage');

    fixture.detectChanges(); // dispara o ngOnInit

    expect(spy).toHaveBeenCalledTimes(1);
  });

  // O reflexo do defeito que derrubou a versao anterior: abrir a pagina sem ter
  // vindo do botao — inclusive num refresh, que zera o servico — nao abre nada.
  it('sem intencao registrada, o ngOnInit nao abre nada', () => {
    const fixture = TestBed.createComponent(InnerViewPagePage);
    const spy = spyOn(fixture.componentInstance, 'addImage');

    fixture.detectChanges();

    expect(spy).not.toHaveBeenCalled();
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
