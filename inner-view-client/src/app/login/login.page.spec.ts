import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { LoginPage } from './login.page';

describe('LoginPage brand', () => {
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

  it('shows one page heading and a decorative ARP VISION symbol', () => {
    const heading: HTMLHeadingElement = fixture.nativeElement.querySelector('.auth-intro h1');
    const symbol: HTMLImageElement = fixture.nativeElement.querySelector('.auth-intro app-brand-logo img');
    expect(heading.textContent?.trim()).toBe('Entrar');
    expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    expect(symbol.getAttribute('src')).toContain('arp-vision-symbol-blue-transparent.svg');
    expect(symbol.getAttribute('alt')).toBe('');
    expect(symbol.getAttribute('aria-hidden')).toBe('true');
  });
});
