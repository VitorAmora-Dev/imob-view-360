import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { EmbedModalComponent } from './embed-modal.component';

/**
 * O painel de embed, agora com dois consumidores: o card da home e "Meus
 * imóveis".
 *
 * O que se prova aqui é o que ele MONTA e o que ele responde — o desenho do
 * `IonModal` é do Ionic, e testá-lo seria testar a biblioteca (mesma regra do
 * spec do `hotspot-sheet`).
 */
describe('EmbedModalComponent', () => {
  let fixture: ComponentFixture<EmbedModalComponent>;

  function montar(tourId: string | null): EmbedModalComponent {
    fixture = TestBed.createComponent(EmbedModalComponent);
    fixture.componentRef.setInput('tourId', tourId);
    return fixture.componentInstance;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('ion-modal').forEach((modal) => modal.remove());
  });

  /**
   * A ROTA PÚBLICA, e não `/inner-view-page`.
   *
   * É a razão de o botão existir: quem recebe o link não tem conta, e a página
   * interna está atrás do `authGuard`. Trocar isto por engano entrega a quem
   * está do outro lado uma tela de login.
   */
  it('monta o link com a rota publica de embed', () => {
    expect(montar('t1').link()).toBe(`${window.location.origin}/embed/t1`);
  });

  it('monta o iframe em volta do mesmo link', () => {
    const codigo = montar('t1').codigo();

    expect(codigo).toContain(`src="${window.location.origin}/embed/t1"`);
    expect(codigo).toContain('allowfullscreen');
  });

  it('sem tour nao monta nada', () => {
    const componente = montar(null);

    expect(componente.link()).toBe('');
    expect(componente.codigo()).toBe('');
  });

  it('copiar avisa que copiou', async () => {
    const componente = montar('t1');
    const escrito = spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    await componente.copiar(componente.link());

    expect(escrito).toHaveBeenCalledWith(`${window.location.origin}/embed/t1`);
    expect(componente.copiou()).toBeTrue();
  });

  /**
   * A área de transferência pode ser negada por permissão. O texto continua à
   * vista e selecionável no campo — anunciar "copiado" quando não foi é pior
   * que ficar calado, porque a pessoa cola outra coisa e só descobre depois.
   */
  it('copiar que falha nao mente dizendo que copiou', async () => {
    const componente = montar('t1');
    spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('negado'));

    await componente.copiar(componente.link());

    expect(componente.copiou()).toBeFalse();
  });

  it('fechar avisa quem abriu, em vez de fechar sozinho', () => {
    const componente = montar('t1');
    let fechou = 0;
    componente.closed.subscribe(() => fechou++);

    componente.fechar();

    // Quem tem o estado é a página: o componente pede, ela decide. Um segundo
    // estado aqui dentro poderia divergir dela.
    expect(fechou).toBe(1);
    expect(componente.tourId()).toBe('t1');
  });
});
