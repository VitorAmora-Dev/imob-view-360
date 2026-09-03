import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { VirtualTour } from '../../../models/virtual-tour.model';
import { VirtualTourService } from '../../../services/virtual-tour.service';
import { TourViewerStore } from '../../tour-viewer.store';
import { TourShareSheetComponent } from './tour-share-sheet.component';

const TOUR = {
  id: 't1',
  status: 'PUBLISHED',
  propertyId: 'p1',
  createdAt: '',
  updatedAt: '',
  panoramas: [],
} as unknown as VirtualTour;

describe('TourShareSheetComponent', () => {
  let fixture: ComponentFixture<TourShareSheetComponent>;
  let sheet: TourShareSheetComponent;
  let store: TourViewerStore;
  let recordShare: jasmine.Spy;

  let copiados: string[];
  let areaDeTransferenciaNega = false;
  let shareOriginal: PropertyDescriptor | undefined;

  beforeEach(async () => {
    copiados = [];
    areaDeTransferenciaNega = false;
    recordShare = jasmine.createSpy('recordShare').and.returnValue(of({}));
    shareOriginal = Object.getOwnPropertyDescriptor(navigator, 'share');

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
      imports: [TourShareSheetComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        TourViewerStore,
        { provide: VirtualTourService, useValue: { recordShare } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourShareSheetComponent);
    sheet = fixture.componentInstance;
    store = TestBed.inject(TourViewerStore);

    store.tour.set(TOUR);
    store.property.set({ title: 'Casa Azul' } as never);
    store.loading.set(false);
    store.abrirCompartilhamento();
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    if (shareOriginal) Object.defineProperty(navigator, 'share', shareOriginal);
    else Reflect.deleteProperty(navigator, 'share');
    TestBed.resetTestingModule();
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

  describe('as duas abas', () => {
    /**
     * A aba não é memória entre aberturas: ela é consequência de por onde se
     * entrou. A barra inferior entra pelo link, o "Incorporar" do desktop entra
     * pelo embed — e reabrir pela barra depois de ter usado o embed precisa
     * voltar ao link, senão o botão COMPARTILHAR abre a tela de `<iframe>`.
     */
    it('abre na aba com que foi chamado, e não na da visita anterior', () => {
      expect(sheet.abaAtual()).toBe('link');

      store.abrirCompartilhamento('embed');
      expect(sheet.abaAtual()).toBe('embed');

      store.fecharSheet();
      store.abrirCompartilhamento();
      expect(sheet.abaAtual()).toBe('link');
    });

    it('a aba inativa fica escondida, mas continua no DOM', async () => {
      const no = await apresentado();
      const paineis = Array.from(
        no.querySelectorAll('[role="tabpanel"]'),
      ) as HTMLElement[];

      expect(paineis.length).toBe(2);
      expect(paineis[0].hidden).toBeFalse();
      expect(paineis[1].hidden).toBeTrue();
      // O painel de embed continua montado: é o que preserva a seleção de
      // texto do bloco de código ao ir e voltar de aba.
      expect(no.querySelector('app-tour-embed-panel')).not.toBeNull();
    });

    /**
     * Foco itinerante: só a aba ativa recebe Tab, e as setas percorrem o resto.
     * Sem isso o Tab pararia em cada aba antes de chegar ao conteúdo.
     */
    it('só a aba ativa está na ordem de tabulação', async () => {
      const no = await apresentado();
      const abas = Array.from(no.querySelectorAll('[role="tab"]')) as HTMLElement[];

      expect(abas.map((aba) => aba.getAttribute('tabindex'))).toEqual(['0', '-1']);
      expect(abas.map((aba) => aba.getAttribute('aria-selected'))).toEqual([
        'true',
        'false',
      ]);
    });

    it('cada painel é nomeado pela SUA aba', async () => {
      const no = await apresentado();
      const abas = Array.from(no.querySelectorAll('[role="tab"]')) as HTMLElement[];
      const paineis = Array.from(no.querySelectorAll('[role="tabpanel"]')) as HTMLElement[];

      for (let i = 0; i < abas.length; i++) {
        expect(abas[i].getAttribute('aria-controls')).toBe(paineis[i].id);
        expect(paineis[i].getAttribute('aria-labelledby')).toBe(abas[i].id);
      }
      // Ids únicos por instância: uma constante literal quebraria em silêncio
      // com dois sheets no documento, e o leitor de tela leria o nome do
      // primeiro para os dois painéis.
      expect(new Set(abas.map((aba) => aba.id)).size).toBe(abas.length);
    });

    it('as setas trocam de aba e levam o foco junto', async () => {
      const no = await apresentado();
      const abas = Array.from(no.querySelectorAll('[role="tab"]')) as HTMLElement[];

      abas[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      fixture.detectChanges();

      expect(sheet.abaAtual()).toBe('embed');
      expect(document.activeElement).toBe(abas[1]);
    });

    it('as setas dão a volta, e Home/End vão aos extremos', async () => {
      const no = await apresentado();
      const abas = Array.from(no.querySelectorAll('[role="tab"]')) as HTMLElement[];

      abas[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(sheet.abaAtual()).toBe('embed');

      abas[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
      expect(sheet.abaAtual()).toBe('link');

      abas[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
      expect(sheet.abaAtual()).toBe('embed');
    });

    it('uma tecla que não é de navegação não troca de aba', async () => {
      const no = await apresentado();
      const abas = Array.from(no.querySelectorAll('[role="tab"]')) as HTMLElement[];

      abas[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(sheet.abaAtual()).toBe('link');
    });
  });

  describe('copiar', () => {
    it('não fecha o sheet — copiar não é escolher', async () => {
      await sheet.copiar(sheet.link(), 'TOUR_VIEWER.TOAST.LINK_COPIED', 'clipboard');

      expect(store.sheet()).toBe('share');
      expect(store.toast()).toBe('TOUR_VIEWER.TOAST.LINK_COPIED');
    });

    it('o rodapé da aba de embed copia o CÓDIGO, e não o link', async () => {
      await sheet.copiar(sheet.codigo(), 'TOUR_VIEWER.TOAST.CODE_COPIED', 'embed');

      expect(copiados).toEqual([store.codigoDoEmbed()]);
      expect(copiados[0]).toContain('<iframe');
    });

    /**
     * Anunciar "Link copiado" quando a permissão foi negada é pior que ficar
     * calado: a pessoa cola o conteúdo anterior sem saber. O toast de falha é
     * o que a manda selecionar o texto, que continua na tela.
     */
    it('a falha é anunciada como falha, e nunca como sucesso', async () => {
      areaDeTransferenciaNega = true;

      await sheet.copiar(sheet.link(), 'TOUR_VIEWER.TOAST.LINK_COPIED', 'clipboard');

      expect(store.toast()).toBe('TOUR_VIEWER.TOAST.COPY_ERROR');
      expect(copiados).toEqual([]);
    });

    /** Cópia negada não é compartilhamento: contar ali inflaria a métrica. */
    it('a falha não conta compartilhamento', async () => {
      areaDeTransferenciaNega = true;

      await sheet.copiar(sheet.link(), 'TOUR_VIEWER.TOAST.LINK_COPIED', 'clipboard');

      expect(recordShare).not.toHaveBeenCalled();
    });
  });

  describe('a métrica de compartilhamento', () => {
    /**
     * Link e código são destinos diferentes do mesmo tour. Um canal só para os
     * dois não responderia a pergunta que motivou a métrica — por onde o tour
     * circula.
     */
    it('separa os canais', async () => {
      await sheet.copiar(sheet.link(), 'TOUR_VIEWER.TOAST.LINK_COPIED', 'clipboard');
      await sheet.copiar(sheet.codigo(), 'TOUR_VIEWER.TOAST.CODE_COPIED', 'embed');

      expect(recordShare.calls.allArgs()).toEqual([
        ['t1', 'clipboard'],
        ['t1', 'embed'],
      ]);
    });

    it('WhatsApp e e-mail abrem o link já pronto, e contam o canal', () => {
      const ancora = document.createElement('a');
      const clique = spyOn(ancora, 'click');
      spyOn(document, 'createElement').and.returnValue(ancora);

      sheet.abrirWhatsApp();
      expect(ancora.href).toContain('wa.me');
      expect(ancora.href).toContain(encodeURIComponent(store.linkPublico()));

      sheet.abrirEmail();
      expect(ancora.href.startsWith('mailto:')).toBeTrue();
      expect(ancora.href).toContain(encodeURIComponent(store.linkPublico()));

      expect(clique).toHaveBeenCalledTimes(2);
      expect(recordShare.calls.allArgs()).toEqual([
        ['t1', 'whatsapp'],
        ['t1', 'email'],
      ]);
    });

    /**
     * Sem `rel`, a página aberta recebe `window.opener` e pode navegar ESTA
     * aba para onde quiser — e esta aba é a do corretor, logado.
     */
    it('o link externo não entrega `window.opener`', () => {
      const ancora = document.createElement('a');
      spyOn(ancora, 'click');
      spyOn(document, 'createElement').and.returnValue(ancora);

      sheet.abrirWhatsApp();

      expect(ancora.rel).toContain('noopener');
      expect(ancora.target).toBe('_blank');
    });

    /** Falhar ao contar nunca pode impedir o link de sair. */
    it('a métrica é best effort: o erro dela não vaza', () => {
      recordShare.and.returnValue({
        subscribe: ({ error }: { error: (e: unknown) => void }) => error(new Error('500')),
      });
      const ancora = document.createElement('a');
      spyOn(ancora, 'click');
      spyOn(document, 'createElement').and.returnValue(ancora);

      expect(() => sheet.abrirWhatsApp()).not.toThrow();
    });
  });

  describe('a folha nativa', () => {
    /**
     * Cancelar a folha NÃO é erro: é a pessoa dizendo que mudou de ideia, e um
     * toast de falha ali culparia o app por uma decisão dela.
     */
    it('cancelar não vira aviso nem conta compartilhamento', async () => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: () => Promise.reject(new Error('AbortError')),
      });

      await sheet.compartilhar();

      expect(store.toast()).toBeNull();
      expect(recordShare).not.toHaveBeenCalled();
    });

    it('concluída, conta o canal nativo', async () => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: () => Promise.resolve(),
      });

      await sheet.compartilhar();

      expect(recordShare).toHaveBeenCalledOnceWith('t1', 'native');
    });
  });
});
