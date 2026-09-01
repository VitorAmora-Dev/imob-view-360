import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { throwError } from 'rxjs';

import { LoginPage } from './login.page';
import { AuthService } from '../services/auth.service';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideIonicAngular(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows one page heading and a decorative ARP VISION symbol', () => {
    const heading: HTMLHeadingElement = el().querySelector('.auth-intro h1')!;
    const symbol: HTMLImageElement = el().querySelector('.auth-intro app-brand-logo img')!;
    expect(heading.textContent?.trim()).toBe('AUTH.LOGIN_TITLE');
    expect(el().querySelectorAll('h1').length).toBe(1);
    expect(symbol.getAttribute('src')).toContain('arp-vision-symbol-blue-transparent.svg');
    expect(symbol.getAttribute('alt')).toBe('');
    expect(symbol.getAttribute('aria-hidden')).toBe('true');
  });

  // O header antigo so mostrava a marca, e o link dela levava para /home --
  // rota atras do authGuard, que devolve para /login. Um botao que voltava
  // pra onde ja se estava. A marca continua presente no painel visual e no
  // auth-intro, sem o header.
  it('nao mostra mais o app-header', () => {
    expect(el().querySelector('app-header')).toBeNull();
  });

  // O painel visual so aparece a partir de 744px, mas isso e' feito por CSS
  // (mesmo padrao de .header-desktop em app-header.component.scss) -- ele
  // fica sempre no DOM, e o teste nao depende de media query nenhuma.
  it('o painel visual carrega a logo branca e a tagline', () => {
    const painel = el().querySelector('.login-visual');
    expect(painel).not.toBeNull();

    const logoBranca = painel!.querySelector('app-brand-logo img') as HTMLImageElement;
    expect(logoBranca.getAttribute('src')).toContain('arp-vision-horizontal-white.svg');

    const tagline = painel!.querySelector('.login-visual__tagline');
    expect(tagline?.textContent?.trim()).toBe('AUTH.TAGLINE');
  });

  it('os campos, o botao e o link de criar conta vem do ngx-translate', () => {
    const emailInput = el().querySelector('ion-input[name="email"]') as unknown as {
      label: string;
    };
    const senhaInput = el().querySelector('ion-input[name="password"]') as unknown as {
      label: string;
    };
    const submitBtn = el().querySelector('.login-btn') as HTMLElement;
    const registerBtn = el().querySelector('ion-button[fill="clear"]') as HTMLElement;

    expect(emailInput.label).toBe('AUTH.EMAIL_LABEL');
    expect(senhaInput.label).toBe('AUTH.PASSWORD_LABEL');
    expect(submitBtn.textContent?.trim()).toContain('AUTH.SUBMIT');
    expect(registerBtn.textContent?.trim()).toBe('AUTH.NO_ACCOUNT');
  });

  // A mensagem de erro era string fixa no .ts -- unica que sobrava fora do
  // template. Sai pela mesma razao das do HTML.
  it('erro de login usa a chave de traducao, nao string fixa', () => {
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'signin').and.returnValue(throwError(() => new Error('credenciais invalidas')));

    const component = fixture.componentInstance;
    component.email = 'a@a.com';
    component.password = 'x';
    component.submit();

    expect(component.errorMessage).toBe('AUTH.INVALID_CREDENTIALS');
    expect(component.showToast).toBeTrue();
  });
});
