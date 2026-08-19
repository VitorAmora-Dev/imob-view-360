import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { RegisterPage } from './register.page';

describe('RegisterPage brand', () => {
  let fixture: ComponentFixture<RegisterPage>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [
        provideIonicAngular(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterPage);
    fixture.detectChanges();
  });

  it('moves the page title into the form and keeps the symbol decorative', () => {
    const heading: HTMLHeadingElement = fixture.nativeElement.querySelector('.auth-intro h1');
    const symbol: HTMLImageElement = fixture.nativeElement.querySelector('.auth-intro app-brand-logo img');
    expect(heading.textContent?.trim()).toBe('Criar conta');
    expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    expect(symbol.getAttribute('src')).toContain('arp-vision-symbol-blue-transparent.svg');
    expect(symbol.getAttribute('alt')).toBe('');
    expect(symbol.getAttribute('aria-hidden')).toBe('true');
  });
});
