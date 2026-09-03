import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TvImmersiveToggleComponent } from './tv-immersive-toggle.component';

describe('TvImmersiveToggleComponent', () => {
  let fixture: ComponentFixture<TvImmersiveToggleComponent>;
  let component: TvImmersiveToggleComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });

    fixture = TestBed.createComponent(TvImmersiveToggleComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  function render(visivel: boolean): HTMLButtonElement {
    fixture.componentRef.setInput('chromeVisible', visivel);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('button');
  }

  it('alterna rótulo, ícone e aria-pressed com o estado imersivo', () => {
    let button = render(true);
    expect(component.labelKey()).toBe('TOUR_VIEWER.HIDE_UI');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect((button.querySelector('ion-icon') as HTMLIonIconElement).name).toBe(
      'eye-outline',
    );

    button = render(false);
    expect(component.labelKey()).toBe('TOUR_VIEWER.SHOW_UI');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect((button.querySelector('ion-icon') as HTMLIonIconElement).name).toBe(
      'eye-off-outline',
    );
  });

  it('emite a alternância e mantém alvo real de 44px', () => {
    const button = render(true);
    const emit = spyOn(component.toggled, 'emit');

    button.click();

    expect(emit).toHaveBeenCalledOnceWith();
    expect(getComputedStyle(button).width).toBe('44px');
    expect(getComputedStyle(button).height).toBe('44px');
  });
});
