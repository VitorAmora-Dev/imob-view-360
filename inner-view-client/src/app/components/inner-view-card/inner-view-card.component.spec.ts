import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { InnerViewCardComponent } from './inner-view-card.component';
import { Property } from '../../models/property.model';
import { ADD_TOUR_INTENT } from '../../models/navigation-intent';
import { NavigationIntentService } from '../../services/navigation-intent.service';

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
  let intents: NavigationIntentService;

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
    intents = TestBed.inject(NavigationIntentService);
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

  it('mostra o botao quando o imovel nao tem tour', () => {
    const el = render(imovel({ virtualTour: null }));
    expect(el.querySelector('.create-tour-btn')).not.toBeNull();
  });

  // O status padrao de tour e' DRAFT. Exigir PUBLISHED marcaria como "sem tour"
  // todo tour recem-criado pelo wizard.
  it('esconde o botao quando ha tour, inclusive DRAFT', () => {
    const comDraft = render(imovel({ virtualTour: { id: 't1', status: 'DRAFT' } }));
    expect(comDraft.querySelector('.create-tour-btn')).toBeNull();

    const comPublicado = render(imovel({ virtualTour: { id: 't1', status: 'PUBLISHED' } }));
    expect(comPublicado.querySelector('.create-tour-btn')).toBeNull();
  });

  it('nomeia o imovel no aria-label', () => {
    const el = render(imovel({ title: 'Casa da Vila' }));
    const botao = el.querySelector('.create-tour-btn')!;
    // Sem interpolacao carregada, o pipe devolve a chave — o que importa aqui e'
    // que o atributo exista e use a chave com parametro, e nao um texto fixo.
    expect(botao.getAttribute('aria-label')).toContain('HOME.CARD_CREATE_TOUR_LABEL');
  });

  // A intencao vai pelo servico, e NAO no router state: o Angular re-hidrata
  // history.state em extras.state a cada bootstrap, entao pelo router state ela
  // sobreviveria ao refresh e reabriria o seletor para sempre.
  it('registra a intencao no servico, nao no router state', () => {
    const navegou = spyOn(router, 'navigate');
    const registrou = spyOn(intents, 'register');
    const el = render(imovel({ id: 'p9' }));

    (el.querySelector('.create-tour-btn') as HTMLButtonElement).click();

    expect(registrou).toHaveBeenCalledWith('p9', ADD_TOUR_INTENT);
    expect(navegou).toHaveBeenCalledWith(
      ['/inner-view-page', 'p9'],
      { state: { property: component.item } },
    );
  });

  // A assimetria entre os dois caminhos E' o ponto. Sem este teste, alguem
  // "uniformiza" os dois — o que parece limpeza — e a Task 7 para de abrir o
  // seletor, sem nada falhar.
  it('o clique no card NAO leva a intencao', () => {
    const navegou = spyOn(router, 'navigate');
    const registrou = spyOn(intents, 'register');
    const el = render(imovel({ id: 'p9' }));

    el.querySelector('ion-card')!.dispatchEvent(new Event('click'));

    expect(registrou).not.toHaveBeenCalled();
    expect(navegou).toHaveBeenCalledWith(
      ['/inner-view-page', 'p9'],
      { state: { property: component.item } },
    );
  });

  // O ion-card inteiro e' clicavel; sem stopPropagation o handler do card
  // dispara junto e a navegacao COM intencao e' substituida pela sem intencao.
  it('nao dispara o clique do card junto', () => {
    const spy = spyOn(router, 'navigate');
    const el = render(imovel({ id: 'p9' }));

    (el.querySelector('.create-tour-btn') as HTMLButtonElement).click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  // O botao de favoritar (estrela) saiu do card — so curtir e compartilhar
  // ficam.
  it('nao mostra mais o botao de favoritar', () => {
    const el = render(imovel({ virtualTour: { id: 't1', status: 'PUBLISHED' } }));
    expect(el.querySelector('.share-btn ion-icon[name^="star"]')).toBeNull();
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

  describe('compartilhar', () => {
    // Sem tour nao ha link de embed nenhum para compartilhar.
    it('some quando o imovel nao tem tour', () => {
      const el = render(imovel({ virtualTour: null }));
      expect(el.querySelector('.share-btn')).toBeNull();
    });

    // A propria razao do botao: e o link publico do embed, e nao a rota
    // autenticada — quem recebe o link nao tem conta para abrir /inner-view-page.
    it('compartilha o link do embed, nao o da pagina interna', async () => {
      const el = render(imovel({ id: 'p9', virtualTour: { id: 't1', status: 'PUBLISHED' } }));
      const escrito = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      // navigator.share e um metodo comum, nao um getter: spyOnProperty exige
      // um accessor, entao a unica forma de forcar o ramo sem ele e redefinir
      // a propriedade e devolve-la depois.
      const original = navigator.share;
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });

      try {
        (el.querySelector('.share-btn') as HTMLElement).click();
        await fixture.whenStable();

        expect(escrito).toHaveBeenCalledWith(`${window.location.origin}/embed/t1`);
      } finally {
        Object.defineProperty(navigator, 'share', { value: original, configurable: true });
      }
    });
  });
});
