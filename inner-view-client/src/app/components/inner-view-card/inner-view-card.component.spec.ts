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

  // O botao de favoritar (estrela) saiu do card — so curtir e embed ficam.
  it('nao mostra mais o botao de favoritar', () => {
    const el = render(imovel({ virtualTour: { id: 't1', status: 'PUBLISHED' } }));
    expect(el.querySelector('ion-icon[name^="star"]')).toBeNull();
    expect(el.querySelectorAll('ion-button').length).toBe(1);
  });

  it('o botao de curtir continua, e alterna de estado', () => {
    const el = render(imovel());
    const coracao = el.querySelector('.heart-btn') as HTMLButtonElement;
    expect(coracao).not.toBeNull();

    coracao.click();
    fixture.detectChanges();

    expect(coracao.classList).toContain('heart-btn--liked');
  });

  describe('embed', () => {
    // Sem tour nao ha o que embutir.
    it('some quando o imovel nao tem tour', () => {
      const el = render(imovel({ virtualTour: null }));
      expect(el.querySelector('.embed-btn')).toBeNull();
    });

    /**
     * O card NAO abre o painel: ele diz qual tour quer divulgar e a pagina
     * abre. Sao vinte cartoes numa grade e um painel so — um `ion-modal` por
     * card seria vinte overlays montados para um que abre.
     */
    it('pede o painel a pagina, com o id do tour', () => {
      const el = render(imovel({ id: 'p9', virtualTour: { id: 't1', status: 'PUBLISHED' } }));
      const pedidos: string[] = [];
      component.embedClick.subscribe((id) => pedidos.push(id));

      (el.querySelector('.embed-btn') as HTMLElement).click();

      expect(pedidos).toEqual(['t1']);
    });

    // O ion-card inteiro e' clicavel; sem stopPropagation o handler dele
    // dispara junto e a navegacao rouba o clique do botao.
    it('nao dispara a navegacao do card junto', () => {
      const navegou = spyOn(router, 'navigate');
      const el = render(imovel({ virtualTour: { id: 't1', status: 'PUBLISHED' } }));

      (el.querySelector('.embed-btn') as HTMLElement).click();

      expect(navegou).not.toHaveBeenCalled();
    });

    // O "<>" e' o simbolo de embed no mercado. Numa grade, "Embed" sozinho nao
    // diz de qual imovel — por isso o rotulo nomeia o item.
    it('usa o icone de codigo e nomeia o imovel no rotulo', () => {
      const el = render(imovel({ title: 'Casa da Vila', virtualTour: { id: 't1', status: 'PUBLISHED' } }));
      const botao = el.querySelector('.embed-btn')!;

      expect(botao.querySelector('ion-icon')!.getAttribute('name')).toBe('code-slash-outline');
      expect(botao.getAttribute('aria-label')).toContain('CARD.EMBED');
    });
  });
});
