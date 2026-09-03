import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TvHeaderComponent } from './tv-header.component';
import { TvScenePillComponent } from './tv-scene-pill.component';

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

  it('a pill mede 36px e deixa de receber foco no imersivo', () => {
    const fixture: ComponentFixture<TvScenePillComponent> =
      TestBed.createComponent(TvScenePillComponent);
    fixture.componentRef.setInput('sceneName', 'Sala de estar');
    fixture.componentRef.setInput('chromeVisible', false);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(getComputedStyle(button).height).toBe('36px');
    expect(button.classList).toContain('is-hidden');
    expect(button.hasAttribute('inert')).toBeTrue();

    fixture.destroy();
  });
});
