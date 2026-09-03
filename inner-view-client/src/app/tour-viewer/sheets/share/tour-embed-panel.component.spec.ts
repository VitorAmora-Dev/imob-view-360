import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { VirtualTour } from '../../../models/virtual-tour.model';
import { TourViewerStore } from '../../tour-viewer.store';
import { TourEmbedPanelComponent } from './tour-embed-panel.component';

const TOUR = {
  id: 't1',
  status: 'PUBLISHED',
  propertyId: 'p1',
  createdAt: '',
  updatedAt: '',
  panoramas: [],
} as unknown as VirtualTour;

/**
 * O desenho do sheet — arrasto, trap de foco, paradas — é do
 * `TourSheetComponent`, e as abas e o rodapé são do `TourShareSheetComponent`.
 * O que se prova aqui é o que é DESTE painel: o código que muda com o formato,
 * o parâmetro do interruptor, e a promessa de que o que se lê é o que se copia.
 *
 * Sem `<ion-modal>` no meio do caminho desde que ele deixou de ser um sheet: o
 * painel renderiza direto, e o `querySelector` acha o bloco de código sem
 * esperar apresentação nenhuma.
 */
describe('TourEmbedPanelComponent', () => {
  let fixture: ComponentFixture<TourEmbedPanelComponent>;
  let painel: TourEmbedPanelComponent;
  let store: TourViewerStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TourEmbedPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        TourViewerStore,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourEmbedPanelComponent);
    painel = fixture.componentInstance;
    store = TestBed.inject(TourViewerStore);

    store.tour.set(TOUR);
    store.loading.set(false);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('o código muda com o formato escolhido', () => {
    expect(store.codigoDoEmbed()).toContain('width="100%"');
    expect(store.codigoDoEmbed()).toContain('height="600"');

    painel.escolherFormato(1);
    expect(store.codigoDoEmbed()).toContain('width="960"');
    expect(store.codigoDoEmbed()).toContain('height="540"');

    painel.escolherFormato(2);
    expect(store.codigoDoEmbed()).toContain('width="600"');
    expect(store.codigoDoEmbed()).toContain('height="600"');
  });

  it('um índice fora da tabela de formatos não muda nada', () => {
    const antes = store.codigoDoEmbed();
    painel.escolherFormato(7);
    expect(store.codigoDoEmbed()).toBe(antes);
  });

  /**
   * O defeito clássico do embed, e o motivo de o código ser fatiado por uma
   * função só (`pedacosDoIframe`) em vez de escrito duas vezes: o destaque de
   * sintaxe da tela e a string do clipboard divergirem, e a pessoa colar no
   * site um `<iframe>` diferente do que leu.
   *
   * O risco AUMENTOU com a reorganização, e é por isso que este teste ficou:
   * quem desenha o código e quem o copia deixaram de ser o mesmo componente —
   * o bloco é deste painel, o botão "Copiar código" é do rodapé do sheet.
   *
   * Comparado contra o DOM RENDERIZADO, e não contra `pedacos()`: é o texto na
   * tela que a pessoa lê, e é ali que um espaço a mais no template apareceria.
   */
  it('o código que aparece na tela é exatamente o que vai para o clipboard', () => {
    const bloco = fixture.nativeElement.querySelector('.tv-embed__codigo') as HTMLElement;

    expect(bloco.textContent).toBe(store.codigoDoEmbed());
    expect(store.codigoDoEmbed()).toBe(
      `<iframe src="${store.linkPublico()}" width="100%" height="600" ` +
        `frameborder="0" allowfullscreen></iframe>`,
    );
  });

  describe('o interruptor "Mostrar controles"', () => {
    it('nasce ligado, e ligado a URL não leva parâmetro nenhum', () => {
      expect(painel.mostrarControles()).toBeTrue();
      expect(store.linkPublico()).not.toContain('controles');
    });

    it('desligado, põe `controles=0` no link E no código', () => {
      painel.alternarControles();

      expect(store.linkPublico()).toContain('?controles=0');
      expect(store.codigoDoEmbed()).toContain('?controles=0');
    });

    it('religado, tira o parâmetro de volta', () => {
      painel.alternarControles();
      painel.alternarControles();

      expect(store.linkPublico()).not.toContain('controles');
    });
  });
});
