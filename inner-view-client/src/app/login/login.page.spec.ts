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

    // Escopado pela classe de proposito: o painel tem DUAS marcas agora (o
    // simbolo grande e este letreiro). Um 'app-brand-logo img' solto pegaria
    // a primeira do DOM e passaria a testar outra coisa sem avisar.
    const logoBranca = painel!.querySelector(
      '.login-visual__wordmark img',
    ) as HTMLImageElement;
    expect(logoBranca.getAttribute('src')).toContain('arp-vision-horizontal-white.svg');

    const tagline = painel!.querySelector('.login-visual__tagline');
    expect(tagline?.textContent?.trim()).toBe('AUTH.TAGLINE');
  });

  // A coruja e' o assunto do painel azul. Ela e' a arte AZUL invertida por
  // filtro (nao existe SVG branco do simbolo), entao o que prova que ela
  // aparece sobre o gradiente e' a classe, nao o src.
  it('o painel visual traz o simbolo grande da coruja, branco e decorativo', () => {
    const coruja = el().querySelector('.login-visual__mark img') as HTMLImageElement;
    expect(coruja).not.toBeNull();
    expect(coruja.classList).toContain('brand-logo--white-symbol');
    expect(coruja.getAttribute('alt')).toBe('');
    expect(coruja.getAttribute('aria-hidden')).toBe('true');
  });

  // A inclinacao e' o unico pedaco desta tela que so existe em CSS -- nenhum
  // outro teste percebe se a regra sumir. Aqui a folha do componente ja esta
  // aplicada, entao da' pra cobrar a declaracao. Quem roda a suite com
  // movimento reduzido ligado ve 'none', e isso tambem esta certo.
  //
  // toContain, e nao toBe: a encapsulacao do Angular prefixa a @keyframes com
  // o hash do componente (_ngcontent-a-cNNN_owl-tilt), e esse hash muda a
  // cada build. Prender o nome exato seria um teste quebrando sozinho.
  //
  // As DUAS corujas: a do painel azul (>=744px) e a do auth-intro, que e' a
  // unica que sobra no mobile -- onde o painel azul nem existe. Media query
  // nao entra aqui: as duas regras valem em qualquer largura, e quem esconde
  // cada uma na largura errada e' o display, nao a animacao.
  it('as duas corujas tem a animacao de inclinar, salvo movimento reduzido', () => {
    const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const seletor of [
      '.login-visual__mark app-brand-logo',
      '.login-form-panel .auth-intro app-brand-logo',
    ]) {
      const host = el().querySelector(seletor);
      expect(host).withContext(seletor).not.toBeNull();

      const animacao = getComputedStyle(host!).animationName;
      if (reduzido) {
        expect(animacao).withContext(seletor).toBe('none');
      } else {
        expect(animacao).withContext(seletor).toContain('owl-tilt');
      }
    }
  });

  // A logo se esconde sozinha via [decorative]="true" (checado no teste do
  // simbolo, acima). Se o painel INTEIRO ganhasse aria-hidden de volta, essa
  // tagline -- texto real, nao decoracao -- sumiria de leitor de tela sem
  // que nenhum outro teste denunciasse.
  it('nao esconde a tagline do painel visual de leitor de tela', () => {
    const painel = el().querySelector('.login-visual');
    expect(painel!.getAttribute('aria-hidden')).toBeNull();
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
