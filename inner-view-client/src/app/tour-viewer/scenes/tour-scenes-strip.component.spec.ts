import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { environment } from '../../../environments/environment';
import { PanoramaImageCache } from '../../services/panorama-image-cache.service';
import { Panorama, VirtualTour } from '../../models/virtual-tour.model';
import { LARGURA_DA_MINIATURA } from '../tour-viewer.model';
import { TourViewerStore } from '../tour-viewer.store';
import { TourScenesStripComponent } from './tour-scenes-strip.component';

function panorama(id: string, order: number): Panorama {
  return {
    id,
    roomName: `Cômodo ${order + 1}`,
    imageUrl: `/panoramas/${id}/image?v=1`,
    order,
    initialPanorama: order === 0,
    originHotspots: [],
    measurements: [],
  };
}

const TOUR: VirtualTour = {
  id: 't1',
  status: 'PUBLISHED',
  propertyId: 'p1',
  createdAt: '',
  updatedAt: '',
  panoramas: [panorama('a', 0), panorama('b', 1), panorama('c', 2)],
};

describe('TourScenesStripComponent', () => {
  let fixture: ComponentFixture<TourScenesStripComponent>;
  let faixa: TourScenesStripComponent;
  let store: TourViewerStore;
  let pedidos: Array<[string, string, number | undefined]>;

  beforeEach(async () => {
    pedidos = [];
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [TourScenesStripComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        TourViewerStore,
        {
          // Dublê do cache: além de evitar HTTP, ele REGISTRA o que foi pedido —
          // é o que permite provar que a miniatura desce pelo cache, e reduzida.
          provide: PanoramaImageCache,
          useValue: {
            obter: (id: string, variante: string, largura?: number) => {
              pedidos.push([id, variante, largura]);
              return Promise.resolve(`blob:${id}`);
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TourScenesStripComponent);
    faixa = fixture.componentInstance;
    store = TestBed.inject(TourViewerStore);

    store.tour.set(TOUR);
    store.loading.set(false);
    fixture.detectChanges();
  });

  function miniaturas(): HTMLButtonElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.tv-cenas__item'),
    ) as HTMLButtonElement[];
  }

  it('desenha uma miniatura por cena, na ordem do tour', () => {
    expect(miniaturas().map((b) => b.dataset['cena'])).toEqual(['a', 'b', 'c']);
  });

  /**
   * A regra R4 do sprint, do lado da faixa.
   *
   * `atualId` é a foto que está NA TELA; `store.currentSceneIndex` é a que
   * acabou de ser pedida. Entre as duas há segundos de download, e marcar a
   * segunda faria a faixa apontar para um cômodo que ainda não apareceu — a
   * pessoa vê a sala e a faixa diz que ela está no quarto.
   */
  it('marca a cena que está NA TELA, e não a que acabou de ser pedida', () => {
    fixture.componentRef.setInput('atualId', 'a');
    store.irParaCena(2);
    fixture.detectChanges();

    const marcadas = miniaturas().filter(
      (b) => b.getAttribute('aria-selected') === 'true',
    );
    expect(marcadas.length).toBe(1);
    expect(marcadas[0].dataset['cena']).toBe('a');
  });

  it('tocar numa miniatura troca a cena', () => {
    miniaturas()[2].click();
    expect(store.currentScene()?.id).toBe('c');
  });

  it('expõe tablist e percorre as cenas com as setas', () => {
    fixture.componentRef.setInput('atualId', 'a');
    fixture.detectChanges();

    const trilho = fixture.nativeElement.querySelector('[role="tablist"]');
    expect(trilho).not.toBeNull();
    expect(miniaturas().every((botao) => botao.getAttribute('role') === 'tab')).toBeTrue();

    miniaturas()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();

    expect(store.currentScene()?.id).toBe('b');
  });

  /**
   * A faixa é a navegação sempre à mão: ela não abre nem fecha sheet. Se um dia
   * alguém fizer o toque abrir o sheet de cenas "para confirmar", este teste cai
   * — e é para cair.
   */
  it('tocar numa miniatura NÃO abre sheet nenhum', () => {
    miniaturas()[1].click();
    expect(store.sheet()).toBeNull();
  });

  it('"Ver todas" abre o sheet de cenas que já está montado na página', () => {
    const verTodas = fixture.nativeElement.querySelector(
      '.tv-cenas__acao--faixa',
    ) as HTMLButtonElement;
    verTodas.click();

    expect(store.sheet()).toBe('scenes');
  });

  /**
   * O 401 que este teste guarda: a rota de preview é autenticada, e `<img src>`
   * não passa pelo interceptor. Pedir pelo cache é o que traz o `blob:`.
   *
   * A largura entra junto porque sem ela a resposta é a equirretangular inteira
   * — dezenas de MB por cômodo para desenhar 104px de retângulo.
   */
  it('pede a miniatura ao cache, reduzida, e nunca à API pelo src', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(pedidos).toEqual([
      ['a', 'treated', LARGURA_DA_MINIATURA],
      ['b', 'treated', LARGURA_DA_MINIATURA],
      ['c', 'treated', LARGURA_DA_MINIATURA],
    ]);

    const fontes = Array.from(
      fixture.nativeElement.querySelectorAll('.tv-cenas__thumb'),
    ).map((img) => (img as HTMLImageElement).getAttribute('src'));
    expect(fontes).toEqual(['blob:a', 'blob:b', 'blob:c']);
  });

  describe('o rail recolhido', () => {
    it('sobrevive a recarregar a tela, na mesma aba', () => {
      faixa.alternarRail();
      expect(store.railCollapsed()).toBeTrue();

      // Uma tela nova, o mesmo `sessionStorage` — é o que um F5 faz.
      const outra = TestBed.createComponent(TourScenesStripComponent);
      const outroStore = TestBed.inject(TourViewerStore);
      outroStore.railCollapsed.set(false);
      outra.detectChanges();

      expect(outroStore.railCollapsed()).toBeTrue();
    });

    it('guarda a escolha por TOUR, e não para o app inteiro', () => {
      faixa.alternarRail();
      expect(sessionStorage.getItem('tv:rail:t1')).toBe('1');

      // O outro tour tem escolha própria, e oposta.
      sessionStorage.setItem('tv:rail:outro-tour', '0');
      store.tour.set({ ...TOUR, id: 'outro-tour' });
      store.railCollapsed.set(true);

      const outra = TestBed.createComponent(TourScenesStripComponent);
      outra.detectChanges();

      // Com uma chave só para o app inteiro, o '1' do primeiro tour venceria.
      expect(store.railCollapsed()).toBeFalse();
    });
  });
  /**
   * A MESMA faixa, servindo um visitante do `/embed`.
   *
   * O que muda é só a origem da foto, e a troca não é estética: no embed não há
   * token para o `HttpClient` levar, então a rota de preview responderia 401 e
   * a faixa inteira ficaria cinza — miniaturas sem `src`, que é exatamente o
   * estado de "carregando" que nunca termina.
   */
  describe('no embed (modo público)', () => {
    let http: HttpTestingController;

    /** Uma faixa nascida DEPOIS de o store já estar em modo público. */
    async function faixaPublica(): Promise<ComponentFixture<TourScenesStripComponent>> {
      const carga = store.carregarPorTour('t1');
      await new Promise((resolve) => setTimeout(resolve, 0));
      http.expectOne(`${environment.apiUrl}/virtual-tours/t1`).flush(TOUR);
      await carga;
      http.expectOne(`${environment.apiUrl}/virtual-tours/t1/views`).flush({});

      // Uma instância NOVA: a do `beforeEach` nasceu antes do modo público e já
      // tem as três miniaturas em mãos, então ela não perguntaria nada de novo.
      pedidos.length = 0;
      const outra = TestBed.createComponent(TourScenesStripComponent);
      outra.detectChanges();
      await outra.whenStable();
      outra.detectChanges();
      return outra;
    }

    beforeEach(() => {
      http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('não pede nada ao cache autenticado — não haveria token para levar', async () => {
      await faixaPublica();

      expect(pedidos).toEqual([]);
    });

    it('aponta para a rota pública da imagem, já reduzida', async () => {
      const outra = await faixaPublica();

      const fontes = Array.from(
        outra.nativeElement.querySelectorAll('.tv-cenas__thumb'),
      ).map((img) => (img as HTMLImageElement).getAttribute('src'));

      expect(fontes).toEqual([
        `${environment.apiUrl}/panoramas/a/image?v=1&w=${LARGURA_DA_MINIATURA}`,
        `${environment.apiUrl}/panoramas/b/image?v=1&w=${LARGURA_DA_MINIATURA}`,
        `${environment.apiUrl}/panoramas/c/image?v=1&w=${LARGURA_DA_MINIATURA}`,
      ]);
    });

    /**
     * A armadilha que não aparece na tela.
     *
     * `imageUrl` chega da API com `?v=…`. Emendar a largura com uma SEGUNDA
     * interrogação faz o servidor ignorar o parâmetro: a resposta é 200, a
     * miniatura aparece certinha, e o que desceu foi a equirretangular inteira
     * — de 7 a 27 MB, vezes o número de cômodos, no primeiro frame do embed.
     */
    it('emenda a largura com `&`, e não com uma segunda interrogação', async () => {
      const outra = await faixaPublica();

      const primeira = (
        outra.nativeElement.querySelector('.tv-cenas__thumb') as HTMLImageElement
      ).getAttribute('src')!;

      expect(primeira).toContain(`?v=1&w=${LARGURA_DA_MINIATURA}`);
      expect(primeira).not.toContain('?w=');
    });
  });
});
