import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BrandLogoComponent } from './brand-logo.component';

describe('BrandLogoComponent', () => {
  let component: BrandLogoComponent;
  let fixture: ComponentFixture<BrandLogoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrandLogoComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BrandLogoComponent);
    component = fixture.componentInstance;
  });

  it('renders the accessible blue horizontal brand by default', () => {
    fixture.detectChanges();

    const image: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(image.getAttribute('src')).toContain('arp-vision-horizontal-blue.svg');
    expect(image.getAttribute('alt')).toBe('ARP VISION');
    expect(image.hasAttribute('aria-hidden')).toBeFalse();
  });

  it('renders a decorative symbol without a duplicated accessible name', () => {
    component.kind = 'symbol';
    component.decorative = true;
    fixture.detectChanges();

    const image: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(image.getAttribute('src')).toContain('arp-vision-symbol-blue-transparent.svg');
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('aria-hidden')).toBe('true');
  });

  it('selects the white horizontal asset for dark surfaces', () => {
    component.tone = 'white';
    fixture.detectChanges();

    const image: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(image.getAttribute('src')).toContain('arp-vision-horizontal-white.svg');
  });
});
