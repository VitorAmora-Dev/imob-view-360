import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { AppHeaderComponent } from './app-header.component';

describe('AppHeaderComponent', () => {
  let component: AppHeaderComponent;
  let fixture: ComponentFixture<AppHeaderComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AppHeaderComponent],
      providers: [
        provideIonicAngular(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());

  /**
   * Criar a fixture e um passo separado do beforeEach porque o `AuthService` le
   * o token do localStorage no CONSTRUTOR, e ele nasce junto com o componente:
   * quem quer o cabecalho autenticado precisa de `entrar()` antes de `montar()`.
   */
  function montar(): void {
    fixture = TestBed.createComponent(AppHeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function entrar(): void {
    localStorage.setItem('accessToken', 'token-de-teste');
  }

  it('links the accessible blue brand to home by default', () => {
    montar();

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.brand-link');
    const image: HTMLImageElement = fixture.nativeElement.querySelector('.brand-link img');
    expect(link.getAttribute('href')).toBe('/home');
    expect(link.getAttribute('aria-label')).toBe('ARP VISION — início');
    expect(image.getAttribute('src')).toContain('arp-vision-horizontal-blue.svg');
  });

  it('uses the white signature over the immersive viewer', () => {
    montar();
    component.variant = 'overlay';
    fixture.detectChanges();

    const image: HTMLImageElement = fixture.nativeElement.querySelector('.brand-link img');
    expect(image.getAttribute('src')).toContain('arp-vision-horizontal-white.svg');
  });

  it('preserva o voltar e oculta o restante do overlay no modo imersivo', () => {
    montar();
    component.variant = 'overlay';
    component.backHref = '/home';
    component.chromeVisible = false;
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('.app-header');
    expect(header.classList).toContain('app-header--chrome-hidden');
    expect(fixture.nativeElement.querySelector('.back-btn')).not.toBeNull();
  });

  /**
   * A engrenagem e o `.header-desktop` do telefone: abaixo de 744px aquele
   * bloco some, e ela vira o unico caminho para idioma, sair e "Meus imoveis".
   * Sem ela — e sem o hamburguer, que ja saiu — as tres coisas ficariam
   * inalcancaveis no celular, que e o aparelho em que o app e usado.
   */
  it('offers the settings gear to a signed-in user', () => {
    entrar();
    montar();

    const gear: HTMLAnchorElement = fixture.nativeElement.querySelector('.header-config');
    expect(gear).not.toBeNull();
    expect(gear.getAttribute('href')).toBe('/configuracoes');
  });

  it('hides the settings gear from a signed-out visitor', () => {
    montar();

    expect(fixture.nativeElement.querySelector('.header-config')).toBeNull();
  });
});
