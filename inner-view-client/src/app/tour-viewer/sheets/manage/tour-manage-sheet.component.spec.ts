import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { Panorama, VirtualTour } from '../../../models/virtual-tour.model';
import { PanoramaImageCache } from '../../../services/panorama-image-cache.service';
import { VirtualTourService } from '../../../services/virtual-tour.service';
import { TourViewerStore } from '../../tour-viewer.store';
import { TourManageSheetComponent } from './tour-manage-sheet.component';

const PANORAMA: Panorama = {
  id: 'cena-1',
  roomName: 'Sala',
  imageUrl: '/panoramas/cena-1/image',
  order: 0,
  initialPanorama: true,
  originHotspots: [],
  measurements: [],
};

function tour(status: 'DRAFT' | 'PUBLISHED'): VirtualTour {
  return {
    id: 'tour-1',
    propertyId: 'imovel-1',
    status,
    createdAt: '',
    updatedAt: '',
    panoramas: [PANORAMA],
  };
}

describe('TourManageSheetComponent', () => {
  let fixture: ComponentFixture<TourManageSheetComponent>;
  let component: TourManageSheetComponent;
  let store: TourViewerStore;
  let publicarTour: jasmine.Spy;
  let obterImagem: jasmine.Spy;

  beforeEach(async () => {
    publicarTour = jasmine.createSpy('publicarTour').and.returnValue(of({ status: 'PUBLISHED' }));
    obterImagem = jasmine.createSpy('obter').and.resolveTo('blob:cena-1');

    await TestBed.configureTestingModule({
      imports: [TourManageSheetComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        TourViewerStore,
        // O componente não fala mais com o serviço; quem fala é o store, que
        // ele injeta — `publicar()` desce por ali.
        { provide: VirtualTourService, useValue: { publicarTour } },
        { provide: PanoramaImageCache, useValue: { obter: obterImagem } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourManageSheetComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(TourViewerStore);
    store.tour.set(tour('PUBLISHED'));
    store.property.set({ title: 'Casa Azul' } as never);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('esconde publicar e baixar quando os itens estão indisponíveis', () => {
    expect(component.podePublicar()).toBeFalse();
    expect(component.podeBaixar()).toBeFalse();
    expect(component.podeEditar()).toBeTrue();
    expect(component.podeApagar()).toBeTrue();
  });

  it('leva Configurações para a etapa de informações da edição', () => {
    const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    component.abrirConfiguracoes();

    expect(navegar).toHaveBeenCalledWith(
      ['/tour', 'tour-1', 'editar'],
      { queryParams: { etapa: 4 } },
    );
  });

  it('publica somente o rascunho e remove o item depois do sucesso', async () => {
    store.tour.set(tour('DRAFT'));
    fixture.detectChanges();

    await component.publicar();
    fixture.detectChanges();

    expect(publicarTour).toHaveBeenCalledWith('tour-1');
    expect(store.tour()?.status).toBe('PUBLISHED');
    expect(store.toast()).toBe('TOUR_VIEWER.TOAST.PUBLISHED');
  });

  /**
   * Apagar desceu da barra inferior para o fim desta lista. O que NÃO muda é o
   * invariante 4: daqui sai a pergunta, nunca o DELETE.
   */
  describe('apagar tour', () => {
    it('leva à confirmação, e não apaga nada', () => {
      component.apagar();

      expect(store.sheet()).toBe('delete');
      expect(store.apagando()).toBeFalse();
    });

    /**
     * O conteúdo do `<ng-template>` do `IonModal` só entra no DOM quando ele
     * APRESENTA, e apresentar é assíncrono. O nó é capturado ANTES: ao
     * apresentar, o Ionic TELEPORTA o `<ion-modal>` para o `<body>`, e
     * `fixture.nativeElement.querySelector` passa a devolver `null`.
     */
    function apresentado(): Promise<HTMLElement> {
      const no = fixture.nativeElement.querySelector('ion-modal') as HTMLElement;
      const presente = new Promise<HTMLElement>((resolve) => {
        no.addEventListener('didPresent', () => resolve(no), { once: true });
      });
      store.abrirSheet('manage');
      fixture.detectChanges();
      return presente;
    }

    /**
     * O defeito que só o navegador mostrou, e o motivo de `fecharSheet()`
     * receber o nome do sheet.
     *
     * Este teste precisa do modal APRESENTADO de verdade: o passo que quebrava
     * era o `didDismiss` do Gerenciar, que o Ionic emite depois, de forma
     * assíncrona, e que zerava o `sheet` recém-posto em 'delete'. Com o store
     * dublado ou o modal fora do DOM, os dois lados passam.
     */
    it('a confirmação sobrevive ao didDismiss do próprio Gerenciar', async () => {
      const no = await apresentado();
      const saiu = new Promise<void>((resolve) => {
        no.addEventListener('didDismiss', () => resolve(), { once: true });
      });

      (no.querySelector('.tv-manage__item--apagar') as HTMLButtonElement).click();
      fixture.detectChanges();
      await saiu;

      expect(store.sheet()).toBe('delete');
    });

    it('é o último item da lista, e o único fora da cor do texto comum', async () => {
      const no = await apresentado();
      const itens = Array.from(no.querySelectorAll('.tv-manage__item'));
      const apagar = itens[itens.length - 1] as HTMLElement;

      expect(apagar.classList).toContain('tv-manage__item--apagar');
      expect(itens.filter((item) => item.classList.contains('tv-manage__item--apagar')).length)
        .toBe(1);
    });

    /**
     * "Compartilhar link" SAIU daqui: compartilhar virou botão da barra
     * inferior, com sheet e abas. Duas portas para a mesma coisa era o que a
     * reorganização veio desfazer, e o item que restou aqui seria o que
     * ninguém lembraria de manter em dia.
     */
    it('não há mais item de compartilhar nesta lista', async () => {
      const no = await apresentado();
      const chaves = Array.from(no.querySelectorAll('.tv-manage__item strong')).map(
        (elemento) => elemento.textContent?.trim(),
      );

      expect(chaves).not.toContain('TOUR_VIEWER.MANAGE.SHARE');
      expect(chaves).toContain('TOUR_VIEWER.MANAGE.DELETE');
    });
  });

  /** Prepara o `<a>` que o download cria, e devolve o espião do clique. */
  function ancoraDeDownload(): { anchor: HTMLAnchorElement; click: jasmine.Spy } {
    const anchor = document.createElement('a');
    const click = spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.returnValue(anchor);
    return { anchor, click };
  }

  it('mantém o download da cena atual', async () => {
    fixture.componentRef.setInput('panoramaAtual', PANORAMA);
    const { anchor, click } = ancoraDeDownload();

    await component.baixarCena();

    expect(click).toHaveBeenCalled();
    expect(anchor.download).toBe('Casa Azul - Sala.jpg');
    expect(store.toast()).toBe('TOUR_VIEWER.TOAST.DOWNLOAD_SUCCESS');
  });

  /**
   * O caminho é o cache autenticado, e NUNCA `fetch` na rota pública.
   *
   * `/panoramas/:id/image` não tem guard e por isso filtra
   * `virtualTour: { status: 'PUBLISHED' }`: em rascunho ela devolve 404. E o
   * caso não é hipotético — "Publicar tour" só aparece em `DRAFT`, então os
   * dois itens ficam lado a lado nesta lista e o download quebrava exatamente
   * quando o outro estava visível.
   *
   * Por isso o tour DESTE teste é rascunho, e por isso ele afirma que `fetch`
   * não foi chamado: dublar o `fetch` com uma resposta 200 faria a versão
   * defeituosa passar, que foi o que aconteceu.
   */
  it('baixa pelo cache autenticado, que serve rascunho — e não pela rota pública', async () => {
    store.tour.set(tour('DRAFT'));
    fixture.componentRef.setInput('panoramaAtual', PANORAMA);
    const buscaDireta = spyOn(window, 'fetch');
    const { anchor } = ancoraDeDownload();

    await component.baixarCena();

    expect(obterImagem).toHaveBeenCalledWith('cena-1', 'treated');
    expect(buscaDireta).not.toHaveBeenCalled();
    expect(anchor.href).toContain('blob:cena-1');
    expect(store.toast()).toBe('TOUR_VIEWER.TOAST.DOWNLOAD_SUCCESS');
  });

  /**
   * O `blob:` é do cache, que é `providedIn: 'root'` e o compartilha com o
   * viewer e com o wizard. Revogar aqui apagaria a foto debaixo de quem ainda
   * a está mostrando — a tela ficaria branca depois de um download.
   */
  it('não revoga o `blob:`, que não é dele', async () => {
    fixture.componentRef.setInput('panoramaAtual', PANORAMA);
    const revogar = spyOn(URL, 'revokeObjectURL');
    ancoraDeDownload();

    await component.baixarCena();

    expect(revogar).not.toHaveBeenCalled();
  });

  it('a falha do download vira aviso, e não silêncio', async () => {
    obterImagem.and.rejectWith(new Error('404'));
    fixture.componentRef.setInput('panoramaAtual', PANORAMA);
    ancoraDeDownload();

    await component.baixarCena();

    expect(store.toast()).toBe('TOUR_VIEWER.TOAST.DOWNLOAD_ERROR');
  });
});
