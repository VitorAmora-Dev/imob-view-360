import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { HomeNoTourBannerComponent } from './home-no-tour-banner.component';

describe('HomeNoTourBannerComponent', () => {
  let fixture: ComponentFixture<HomeNoTourBannerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeNoTourBannerComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeNoTourBannerComponent);
  });

  // `setInput` e nao atribuicao: signal input e' somente leitura de fora. E' o
  // mesmo idioma de `scene-card.component.spec.ts:38`.
  function textoCom(count: number) {
    fixture.componentRef.setInput('count', count);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  // Sem isto a conta com um imovel so — a mais provavel de ver a faixa — leria
  // "1 imoveis ainda nao possuem imagens 360".
  it('usa a chave singular com um imovel', () => {
    expect(textoCom(1)).toContain('HOME.NO_TOUR_BANNER_ONE');
  });

  it('usa a chave plural com dois ou mais', () => {
    expect(textoCom(2)).toContain('HOME.NO_TOUR_BANNER');
    expect(textoCom(2)).not.toContain('HOME.NO_TOUR_BANNER_ONE');
  });
});
