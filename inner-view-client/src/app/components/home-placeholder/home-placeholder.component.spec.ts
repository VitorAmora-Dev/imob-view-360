import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { HomePlaceholderComponent } from './home-placeholder.component';

describe('HomePlaceholderComponent', () => {
  let fixture: ComponentFixture<HomePlaceholderComponent>;
  let component: HomePlaceholderComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePlaceholderComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePlaceholderComponent);
    component = fixture.componentInstance;
  });

  function render(inputs: Partial<HomePlaceholderComponent>) {
    Object.assign(component, inputs);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  // O live region e' o PARAGRAFO, nao o bloco. `role="status"` implica
  // `aria-atomic`, entao envolver titulo e botao faria qualquer mudanca reler
  // tudo — e o texto de `no-results` carrega o termo buscado, que muda a cada
  // tecla. Este teste existe para impedir que alguem "suba" o role de volta.
  it('anuncia so o texto, e nao o bloco inteiro', () => {
    const el = render({ text: 'HOME.LOADING' });

    const paragrafo = el.querySelector('.home-placeholder__text')!;
    expect(paragrafo.getAttribute('role')).toBe('status');
    expect(paragrafo.getAttribute('aria-live')).toBe('polite');

    const bloco = el.querySelector('.home-placeholder')!;
    expect(bloco.getAttribute('role')).toBeNull();
    expect(bloco.getAttribute('aria-live')).toBeNull();
  });

  it('nao renderiza acao quando nao ha rotulo', () => {
    const el = render({ text: 'HOME.LOADING' });
    expect(el.querySelector('.home-placeholder__action')).toBeNull();
  });

  // As duas configuracoes visuais que a Task 8 usa de verdade — sem estes, um
  // defeito no `@if (spinner) ... @else if (icon)` passaria limpo.
  it('mostra spinner no estado de carregando', () => {
    const el = render({ spinner: true, text: 'HOME.LOADING' });
    expect(el.querySelector('ion-spinner')).not.toBeNull();
    expect(el.querySelector('.home-placeholder__icon')).toBeNull();
  });

  it('mostra icone quando nao ha spinner', () => {
    const el = render({ icon: 'alert-circle-outline', text: 'HOME.ERROR_TEXT' });
    const icone = el.querySelector('.home-placeholder__icon ion-icon')!;
    expect(icone).not.toBeNull();
    expect(icone.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('ion-spinner')).toBeNull();
  });

  it('renderiza a acao e emite ao clicar', () => {
    const el = render({ text: 'HOME.ERROR_TEXT', actionLabel: 'HOME.ERROR_RETRY' });
    const botao = el.querySelector('.home-placeholder__action') as HTMLButtonElement;
    expect(botao).not.toBeNull();
    expect(botao.textContent).toContain('HOME.ERROR_RETRY');

    let emitiu = 0;
    component.action.subscribe(() => emitiu++);
    botao.click();
    expect(emitiu).toBe(1);
  });

  it('titulo e opcional', () => {
    const semTitulo = render({ text: 'HOME.LOADING' });
    expect(semTitulo.querySelector('.home-placeholder__title')).toBeNull();

    const comTitulo = render({ heading: 'HOME.EMPTY_TITLE', text: 'HOME.EMPTY_TEXT' });
    expect(comTitulo.querySelector('.home-placeholder__title')!.textContent)
      .toContain('HOME.EMPTY_TITLE');
  });
});
