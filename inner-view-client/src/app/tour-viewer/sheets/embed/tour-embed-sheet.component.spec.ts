import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { VirtualTour } from '../../../models/virtual-tour.model';
import { TourViewerStore } from '../../tour-viewer.store';
import { TourEmbedSheetComponent } from './tour-embed-sheet.component';

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
 * `TourSheetComponent`, e o spec dele já cobre isso. O que se prova aqui é o
 * que é DESTE consumidor: o código que muda com o formato, o parâmetro do
 * interruptor, e a promessa de que o que se lê é o que se copia.
 */
describe('TourEmbedSheetComponent', () => {
  let fixture: ComponentFixture<TourEmbedSheetComponent>;
  let sheet: TourEmbedSheetComponent;
  let store: TourViewerStore;

  let copiados: string[];
  let areaDeTransferenciaNega = false;

  const criados: ComponentFixture<unknown>[] = [];

  beforeEach(async () => {
    copiados = [];
    areaDeTransferenciaNega = false;

    // A área de transferência de verdade pede permissão e foco na aba — em
    // Karma nenhum dos dois é garantido. O dublê também é o que permite testar
    // o caminho NEGADO, que é justamente o que não dá para provocar de fora.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (texto: string) => {
          if (areaDeTransferenciaNega) return Promise.reject(new Error('negado'));
          copiados.push(texto);
          return Promise.resolve();
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [TourEmbedSheetComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        TourViewerStore,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourEmbedSheetComponent);
    criados.push(fixture);
    sheet = fixture.componentInstance;
    store = TestBed.inject(TourViewerStore);

    store.tour.set(TOUR);
    store.loading.set(false);
    store.abrirSheet('embed');
    fixture.detectChanges();
  });

  afterEach(() => {
    for (const f of criados.splice(0)) f.destroy();
    delete (navigator as unknown as Record<string, unknown>)['clipboard'];
  });

  /**
   * O conteúdo do `<ng-template>` do `IonModal` só entra no DOM quando ele
   * APRESENTA, e apresentar é assíncrono. O nó é capturado ANTES: ao
   * apresentar, o Ionic TELEPORTA o `<ion-modal>` para o `<body>`, e
   * `fixture.nativeElement.querySelector` passa a devolver `null`.
   */
  function apresentado(): Promise<HTMLElement> {
    const no = fixture.nativeElement.querySelector('ion-modal') as HTMLElement;
    return new Promise((resolve) => {
      no.addEventListener('didPresent', () => resolve(no), { once: true });
    });
  }

  it('só está aberto quando o store diz que a vez é dele', () => {
    expect(sheet.aberto()).toBeTrue();

    store.abrirSheet('delete');
    expect(sheet.aberto()).toBeFalse();
  });

  it('o código muda com o formato escolhido', () => {
    expect(sheet.codigo()).toContain('width="100%"');
    expect(sheet.codigo()).toContain('height="600"');

    sheet.escolherFormato(1);
    expect(sheet.codigo()).toContain('width="960"');
    expect(sheet.codigo()).toContain('height="540"');

    sheet.escolherFormato(2);
    expect(sheet.codigo()).toContain('width="600"');
    expect(sheet.codigo()).toContain('height="600"');
  });

  it('um índice fora da tabela de formatos não muda nada', () => {
    const antes = sheet.codigo();
    sheet.escolherFormato(7);
    expect(sheet.codigo()).toBe(antes);
  });

  /**
   * O defeito clássico deste sheet, e o motivo de o código ser fatiado em vez
   * de escrito duas vezes: o destaque de sintaxe da tela e a string do
   * clipboard divergirem, e a pessoa colar no site um `<iframe>` diferente do
   * que leu.
   *
   * Comparado contra o DOM APRESENTADO, e não contra `pedacos()`: é o texto
   * renderizado que a pessoa lê, e é ali que um espaço a mais no template
   * apareceria.
   */
  it('o código que aparece na tela é exatamente o que vai para o clipboard', async () => {
    const no = await apresentado();
    const bloco = no.querySelector('.tv-embed__codigo') as HTMLElement;

    expect(bloco.textContent).toBe(sheet.codigo());
    expect(sheet.codigo()).toBe(
      `<iframe src="${store.linkPublico()}" width="100%" height="600" ` +
        `frameborder="0" allowfullscreen></iframe>`,
    );
  });

  describe('o interruptor "Mostrar controles"', () => {
    it('nasce ligado, e ligado a URL não leva parâmetro nenhum', () => {
      expect(sheet.mostrarControles()).toBeTrue();
      expect(sheet.link()).not.toContain('controles');
    });

    it('desligado, põe `controles=0` no link E no código', () => {
      sheet.alternarControles();

      expect(sheet.link()).toContain('?controles=0');
      expect(sheet.codigo()).toContain('?controles=0');
    });

    it('religado, tira o parâmetro de volta', () => {
      sheet.alternarControles();
      sheet.alternarControles();

      expect(sheet.link()).not.toContain('controles');
    });
  });

  describe('copiar', () => {
    it('não fecha o sheet — copiar não é escolher', async () => {
      await sheet.copiar(sheet.codigo(), 'TOUR_VIEWER.TOAST.CODE_COPIED');

      expect(store.sheet()).toBe('embed');
      expect(store.toast()).toBe('TOUR_VIEWER.TOAST.CODE_COPIED');
    });

    it('leva o código para a área de transferência, e não o link', async () => {
      await sheet.copiar(sheet.codigo(), 'TOUR_VIEWER.TOAST.CODE_COPIED');
      expect(copiados).toEqual([sheet.codigo()]);
    });

    /**
     * Anunciar "Código copiado" quando a permissão foi negada é pior que ficar
     * calado: a pessoa cola o conteúdo anterior sem saber. O toast de falha é
     * o que a manda selecionar o texto, que continua na tela.
     */
    it('a falha é anunciada como falha, e nunca como sucesso', async () => {
      areaDeTransferenciaNega = true;

      await sheet.copiar(sheet.codigo(), 'TOUR_VIEWER.TOAST.CODE_COPIED');

      expect(store.toast()).toBe('TOUR_VIEWER.TOAST.COPY_ERROR');
      expect(copiados).toEqual([]);
    });
  });
});
