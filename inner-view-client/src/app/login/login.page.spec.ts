import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { NEVER, of, throwError } from 'rxjs';

import { LoginPage } from './login.page';
import { AuthService, SigninResponse } from '../services/auth.service';

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

  it('exibe uma única superfície simples com a marca horizontal', () => {
    const card = el().querySelector('.login-card');
    const heading = card?.querySelector('h1');
    const logo = card?.querySelector('app-brand-logo img') as HTMLImageElement;

    expect(card).not.toBeNull();
    expect(card?.getAttribute('aria-labelledby')).toBe('login-title');
    expect(heading?.id).toBe('login-title');
    expect(heading?.textContent?.trim()).toBe('AUTH.LOGIN_TITLE');
    expect(el().querySelectorAll('h1').length).toBe(1);
    expect(logo.getAttribute('src')).toContain('arp-vision-horizontal-blue.svg');
    expect(logo.getAttribute('alt')).toBe('ARP VISION');
  });

  it('remove o painel promocional, a coruja 3D e os indicadores animados', () => {
    expect(el().querySelector('.login-visual')).toBeNull();
    expect(el().querySelector('app-owl-loader')).toBeNull();
    expect(el().querySelector('ion-spinner')).toBeNull();
    expect(el().querySelector('ion-toast')).toBeNull();
    expect(el().querySelector('app-header')).toBeNull();
    expect(getComputedStyle(el().querySelector('.login-brand')!).animationName).toBe('none');
  });

  it('preserva os campos acessíveis e os textos internacionalizados', () => {
    const emailInput = el().querySelector('ion-input[name="email"]') as HTMLIonInputElement;
    const passwordInput = el().querySelector('ion-input[name="password"]') as HTMLIonInputElement;
    const submitButton = el().querySelector('.login-btn') as HTMLElement;
    const registerButton = el().querySelector('.login-register') as HTMLElement;

    expect(emailInput.label).toBe('AUTH.EMAIL_LABEL');
    expect(emailInput.type).toBe('email');
    expect(emailInput.inputmode).toBe('email');
    expect(emailInput.autocomplete).toBe('email');
    expect(passwordInput.label).toBe('AUTH.PASSWORD_LABEL');
    expect(passwordInput.type).toBe('password');
    expect(passwordInput.autocomplete).toBe('current-password');
    expect(submitButton.textContent?.trim()).toContain('AUTH.SUBMIT');
    expect(registerButton.textContent?.trim()).toBe('AUTH.NO_ACCOUNT');
  });

  it('usa texto estático durante o carregamento, sem spinner', () => {
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'signin').and.returnValue(NEVER);

    const component = fixture.componentInstance;
    component.email = 'teste@arpvision.com';
    component.password = 'segredo';
    component.submit();
    fixture.detectChanges();

    const submitButton = el().querySelector('.login-btn') as HTMLIonButtonElement;
    expect(component.loading).toBeTrue();
    expect(submitButton.disabled).toBeTrue();
    expect(submitButton.getAttribute('aria-busy')).toBe('true');
    expect(submitButton.textContent?.trim()).toContain('AUTH.SUBMITTING');
    expect(submitButton.querySelector('ion-spinner')).toBeNull();
  });

  it('mostra a falha como texto acessível e sem overlay animado', () => {
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'signin').and.returnValue(
      throwError(() => new Error('credenciais inválidas')),
    );

    const component = fixture.componentInstance;
    component.email = 'teste@arpvision.com';
    component.password = 'incorreta';
    component.submit();
    fixture.detectChanges();

    const alert = el().querySelector('[role="alert"]');
    expect(component.loading).toBeFalse();
    expect(component.errorMessage).toBe('AUTH.INVALID_CREDENTIALS');
    expect(alert?.textContent?.trim()).toBe('AUTH.INVALID_CREDENTIALS');
    expect(el().querySelector('ion-toast')).toBeNull();
  });

  it('limpa um erro anterior ao tentar entrar novamente', () => {
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'signin').and.returnValue(NEVER);

    const component = fixture.componentInstance;
    component.email = 'teste@arpvision.com';
    component.password = 'segredo';
    component.errorMessage = 'AUTH.INVALID_CREDENTIALS';
    component.submit();
    fixture.detectChanges();

    expect(component.errorMessage).toBe('');
    expect(el().querySelector('[role="alert"]')).toBeNull();
  });

  it('navega para a home após autenticar', () => {
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const response = {} as SigninResponse;
    spyOn(auth, 'signin').and.returnValue(of(response));
    spyOn(router, 'navigate').and.resolveTo(true);

    const component = fixture.componentInstance;
    component.email = 'teste@arpvision.com';
    component.password = 'segredo';
    component.submit();

    expect(component.loading).toBeFalse();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/home']);
  });
});
