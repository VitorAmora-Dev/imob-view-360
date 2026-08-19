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

    fixture = TestBed.createComponent(AppHeaderComponent);
    component = fixture.componentInstance;
  });

  it('links the accessible blue brand to home by default', () => {
    fixture.detectChanges();

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.brand-link');
    const image: HTMLImageElement = fixture.nativeElement.querySelector('.brand-link img');
    expect(link.getAttribute('href')).toBe('/home');
    expect(link.getAttribute('aria-label')).toBe('ARP VISION — início');
    expect(image.getAttribute('src')).toContain('arp-vision-horizontal-blue.svg');
  });

  it('uses the white signature over the immersive viewer', () => {
    component.variant = 'overlay';
    fixture.detectChanges();

    const image: HTMLImageElement = fixture.nativeElement.querySelector('.brand-link img');
    expect(image.getAttribute('src')).toContain('arp-vision-horizontal-white.svg');
  });
});
