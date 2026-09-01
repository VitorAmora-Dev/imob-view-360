import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { ConfiguracoesPage } from './configuracoes.page';
import { AuthService } from '../services/auth.service';
import { LanguageService } from '../services/language.service';

/**
 * A tela que impede um buraco.
 *
 * No celular o bloco `header-desktop` é `display: none`, e até aqui o
 * hambúrguer era o ÚNICO caminho para idioma, sair e "Meus imóveis". Com a
 * barra inferior assumindo a navegação e o hambúrguer saindo, é esta tela que
 * guarda os três — perder qualquer um deles daqui os torna inalcançáveis no
 * telefone, e nada mais no app falharia para avisar.
 */
describe('ConfiguracoesPage', () => {
  let fixture: ComponentFixture<ConfiguracoesPage>;
  let idioma: LanguageService;
  let auth: AuthService;

  function linhas(): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.cfg__linha'),
    );
  }

  function porRotulo(texto: string): HTMLElement {
    return linhas().find((linha) => linha.textContent?.includes(texto))!;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConfiguracoesPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideRouter([]),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });

    idioma = TestBed.inject(LanguageService);
    auth = TestBed.inject(AuthService);

    fixture = TestBed.createComponent(ConfiguracoesPage);
    fixture.detectChanges();
  });

  afterEach(() => fixture?.destroy());

  it('leva a Meus imoveis — o unico caminho do celular depois que o hamburguer sai', () => {
    const link = porRotulo('SETTINGS.MY_PROPERTIES') as HTMLAnchorElement;

    // Link e não botão: é navegação, e quem navega abre em outra aba se quiser.
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/profile');
  });

  it('mostra os dois idiomas a vista, sem precisar abrir nada', () => {
    const rotulos = linhas().map((l) => l.textContent?.trim());

    expect(rotulos.some((r) => r?.includes('Português'))).toBeTrue();
    expect(rotulos.some((r) => r?.includes('English'))).toBeTrue();
  });

  it('trocar de idioma chama o servico que persiste a escolha', () => {
    const usou = spyOn(idioma, 'use');

    porRotulo('English').click();

    expect(usou).toHaveBeenCalledWith('en');
  });

  /**
   * O ✓ é desenho; `aria-pressed` é o que conta ao leitor de tela qual está
   * valendo. Sem ele a lista vira duas opções indistinguíveis.
   */
  it('marca o idioma ativo para quem nao ve a tela', () => {
    idioma.use('pt');
    fixture.detectChanges();

    expect(porRotulo('Português').getAttribute('aria-pressed')).toBe('true');
    expect(porRotulo('English').getAttribute('aria-pressed')).toBe('false');
  });

  it('sair chama o signout, que limpa os tokens e volta ao login', () => {
    const saiu = spyOn(auth, 'signout');

    porRotulo('SETTINGS.SIGNOUT').click();

    expect(saiu).toHaveBeenCalled();
  });
});
