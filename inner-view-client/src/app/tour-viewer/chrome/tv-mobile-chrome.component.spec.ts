import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TvHeaderComponent } from './tv-header.component';

describe('Chrome móvel do tour', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('no imersivo esconde título e gerenciar, mas preserva voltar', () => {
    const fixture = TestBed.createComponent(TvHeaderComponent);
    fixture.componentRef.setInput('tourName', 'Cobertura Vila Nova');
    fixture.componentRef.setInput('sceneCount', 6);
    fixture.componentRef.setInput('chromeVisible', false);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const voltar = host.querySelector('.tv-header__circular') as HTMLButtonElement;
    const titulo = host.querySelector('.tv-header__titulo') as HTMLElement;
    const gerenciar = host.querySelector('.tv-header__gerenciar') as HTMLButtonElement;

    expect(voltar.classList).not.toContain('is-hidden');
    expect(getComputedStyle(voltar).width).toBe('40px');
    expect(getComputedStyle(voltar).height).toBe('40px');
    expect(titulo.classList).toContain('is-hidden');
    expect(gerenciar.classList).toContain('is-hidden');
    expect(gerenciar.hasAttribute('inert')).toBeTrue();

    fixture.destroy();
  });

  // A pill de cena e o botão flutuante de ocultar saíram da tela com a
  // reorganização dos menus: a faixa de cenas assumiu a primeira e a barra de
  // ações assumiu o segundo. O que cada um garantia continua testado — a faixa
  // em `tour-scenes-strip.component.spec.ts`, o ocultar em
  // `tour-actions-bar.component.spec.ts`.
});
