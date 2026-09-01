import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { InnerViewCardComponent } from './inner-view-card.component';
import { Property } from '../../models/property.model';

function imovel(overrides: Partial<Property> = {}): Property {
  return {
    id: 'p1',
    code: 'RLX-001',
    title: 'Casa da Vila',
    type: 'HOUSE',
    purpose: 'SALE',
    status: 'AVAILABLE',
    agencyId: 'a1',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    virtualTour: null,
    ...overrides,
  };
}

describe('InnerViewCardComponent', () => {
  let fixture: ComponentFixture<InnerViewCardComponent>;
  let component: InnerViewCardComponent;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InnerViewCardComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InnerViewCardComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
  });

  function render(item: Property) {
    component.item = item;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('should create', () => {
    render(imovel());
    expect(component).toBeTruthy();
  });

  /**
   * O inverso do que este spec provava.
   *
   * "Criar tour" só aparecia quando NÃO havia tour — que é o cartão de imóvel
   * cadastrado sem foto, no catálogo. Criar tour é ação de dono, e a home é a
   * lista de quem procura imóvel; o lugar dela é o wizard, alcançável pelo
   * botão que abre a captura.
   */
  it('nao mostra mais o botao de criar tour', () => {
    const semTour = render(imovel({ virtualTour: null }));
    expect(semTour.querySelector('.create-tour-btn')).toBeNull();
    expect(semTour.textContent).not.toContain('CARD_CREATE_TOUR');
  });

  it('o clique no card leva ao imovel', () => {
    const navegou = spyOn(router, 'navigate');
    render(imovel({ id: 'p9' }));

    (fixture.nativeElement as HTMLElement)
      .querySelector('ion-card')!
      .dispatchEvent(new Event('click'));

    expect(navegou).toHaveBeenCalledWith(
      ['/inner-view-page', 'p9'],
      { state: { property: component.item } },
    );
  });

  /**
   * O cartao ficou com UMA acao: curtir. Favoritar (estrela) saiu antes, e o
   * embed saiu depois — ele disputava a linha do preco com o que o corretor
   * veio ver, e continua inteiro em "Meus imoveis".
   */
  it('nao mostra favoritar nem embed', () => {
    const el = render(imovel({ virtualTour: { id: 't1', status: 'PUBLISHED' } }));

    expect(el.querySelector('ion-icon[name^="star"]')).toBeNull();
    expect(el.querySelector('.embed-btn')).toBeNull();
    expect(el.querySelectorAll('ion-button').length).toBe(0);
  });

  it('o botao de curtir continua, e alterna de estado', () => {
    const el = render(imovel());
    const coracao = el.querySelector('.heart-btn') as HTMLButtonElement;
    expect(coracao).not.toBeNull();

    coracao.click();
    fixture.detectChanges();

    expect(coracao.classList).toContain('heart-btn--liked');
  });
});
