import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { Observable, Subscriber } from 'rxjs';

import { TourSheetComponent } from '../../../components/tour-sheet/tour-sheet.component';
import { Property } from '../../../models/property.model';
import { VirtualTour } from '../../../models/virtual-tour.model';
import { VirtualTourService } from '../../../services/virtual-tour.service';
import { TourViewerStore } from '../../tour-viewer.store';
import { TourDeleteSheetComponent } from './tour-delete-sheet.component';

const TOUR = {
  id: 't1',
  status: 'PUBLISHED',
  propertyId: 'p1',
  createdAt: '',
  updatedAt: '',
  panoramas: [
    { id: 'a', roomName: 'Sala', imageUrl: '/x', order: 0, originHotspots: [] },
    { id: 'b', roomName: 'Quarto', imageUrl: '/y', order: 1, originHotspots: [] },
  ],
} as unknown as VirtualTour;

const IMOVEL = { id: 'p1', title: 'Casa da Praia' } as unknown as Property;

/**
 * O invariante 4 do sprint — "ação destrutiva sempre passa por confirmação" —
 * em forma de teste.
 *
 * O que se prova aqui não é o desenho do diálogo, que é do
 * `TourSheetComponent`: é que apagar só sai daqui, que o meio do caminho não
 * fecha, e que a falha devolve a tela em estado inequívoco.
 */
describe('TourDeleteSheetComponent', () => {
  let fixture: ComponentFixture<TourDeleteSheetComponent>;
  let sheet: TourDeleteSheetComponent;
  let store: TourViewerStore;

  let pedidosDeApagar: number;
  let emVoo: Subscriber<void> | null;

  beforeEach(async () => {
    pedidosDeApagar = 0;
    emVoo = null;

    await TestBed.configureTestingModule({
      imports: [TourDeleteSheetComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // Uma rota `home` de verdade: o sucesso de `apagarTour()` navega para
        // lá, e com a tabela vazia a navegação rejeitaria com "Cannot match any
        // routes" — um erro de teste que não diz nada sobre o componente.
        provideRouter([{ path: 'home', children: [] }]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        TourViewerStore,
        {
          // A requisição fica PENDURADA de propósito: é o intervalo em que o
          // sheet mostra "Apagando…", e é ele que os testes precisam habitar.
          provide: VirtualTourService,
          useValue: {
            deleteTour: () => {
              pedidosDeApagar++;
              return new Observable<void>((sub) => {
                emVoo = sub;
              });
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourDeleteSheetComponent);
    sheet = fixture.componentInstance;
    store = TestBed.inject(TourViewerStore);

    store.property.set(IMOVEL);
    store.tour.set(TOUR);
    store.loading.set(false);
    store.abrirSheet('delete');
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  function apresentado(): Promise<HTMLElement> {
    const no = fixture.nativeElement.querySelector('ion-modal') as HTMLElement;
    return new Promise((resolve) => {
      no.addEventListener('didPresent', () => resolve(no), { once: true });
    });
  }

  const shell = () =>
    fixture.debugElement.query(By.directive(TourSheetComponent))
      .componentInstance as TourSheetComponent;

  it('só está aberto quando o store diz que a vez é dele', () => {
    expect(sheet.aberto()).toBeTrue();

    store.abrirSheet('share');
    expect(sheet.aberto()).toBeFalse();
  });

  it('conta as cenas que serão perdidas', () => {
    expect(sheet.quantidadeDeCenas()).toBe(2);
    expect(sheet.nome()).toBe('Casa da Praia');
  });

  it('nada é apagado só por abrir o sheet', () => {
    expect(pedidosDeApagar).toBe(0);
  });

  it('apagar sai daqui, e só depois da confirmação', () => {
    void sheet.confirmar();
    expect(pedidosDeApagar).toBe(1);
  });

  it('cancelar fecha o sheet sem apagar nada', () => {
    sheet.cancelar();

    expect(store.sheet()).toBeNull();
    expect(pedidosDeApagar).toBe(0);
  });

  describe('durante o "Apagando…"', () => {
    it('os três gestos de fechar ficam travados de uma vez', async () => {
      await apresentado();
      void sheet.confirmar();
      fixture.detectChanges();

      expect(sheet.apagando()).toBeTrue();
      expect(shell().travado()).toBeTrue();
      // Os papéis com que o Ionic chega pelo scrim, pelo Esc e pelo arrasto.
      expect(shell().podeFechar(undefined, 'backdrop')).toBeFalse();
      expect(shell().podeFechar(undefined, 'gesture')).toBeFalse();
      // E o fechamento programático continua passando — é ele que derruba o
      // modal quando a página morre.
      expect(shell().podeFechar()).toBeTrue();
    });

    it('os dois botões param de responder', async () => {
      const no = await apresentado();
      void sheet.confirmar();
      fixture.detectChanges();

      const botoes = Array.from(
        no.querySelectorAll<HTMLButtonElement>('.tv-apagar__botao'),
      );
      expect(botoes.length).toBe(2);
      expect(botoes.every((b) => b.disabled)).toBeTrue();
    });

    /**
     * `[travado]` recusa os gestos, mas não o segundo toque no próprio botão.
     * Sem a guarda de reentrada, dois toques rápidos disparam dois DELETE — e o
     * segundo volta 404 sobre um tour que o primeiro apagou com sucesso, ou
     * seja, uma falha anunciada para uma operação que deu certo.
     */
    it('um segundo toque em APAGAR não dispara um segundo DELETE', () => {
      void sheet.confirmar();
      void sheet.confirmar();

      expect(pedidosDeApagar).toBe(1);
    });

    it('cancelar também não responde no meio da requisição', () => {
      void sheet.confirmar();
      sheet.cancelar();

      expect(store.sheet()).toBe('delete');
    });
  });

  describe('quando a rede falha', () => {
    it('o sheet SEGUE aberto, com o aviso', async () => {
      const apagou = sheet.confirmar();
      emVoo!.error(new Error('sem rede'));
      await apagou;

      expect(store.sheet()).toBe('delete');
      expect(store.toast()).toBe('TOUR_VIEWER.TOAST.DELETE_ERROR');
      expect(sheet.apagando()).toBeFalse();
    });

    it('e dá para tentar de novo', async () => {
      const primeira = sheet.confirmar();
      emVoo!.error(new Error('sem rede'));
      await primeira;

      void sheet.confirmar();
      expect(pedidosDeApagar).toBe(2);
    });
  });

  it('no sucesso não sobra aviso nenhum na tela', async () => {
    const apagou = sheet.confirmar();
    emVoo!.next();
    emVoo!.complete();
    await apagou;

    expect(store.toast()).toBeNull();
  });
});
