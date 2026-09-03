import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Panorama, VirtualTour } from '../models/virtual-tour.model';
import { TourViewerStore } from './tour-viewer.store';

/**
 * Os invariantes de `06-state-behavior.md`, que o TV-0 declarou e a tela
 * inteira assume (TV-8).
 *
 * Eles moram no store justamente para continuarem verdadeiros quando a quarta
 * frente chegar — e é aqui que isso deixa de ser promessa. Sem estes casos, a
 * regra "sem chrome, sem hotspot" vale até alguém escrever um `@if` a mais no
 * template e ninguém perceber.
 */

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

describe('TourViewerStore', () => {
  let store: TourViewerStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourViewerStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    store = TestBed.inject(TourViewerStore);
    store.tour.set(TOUR);
  });

  describe('navegação entre cenas', () => {
    it('os quatro caminhos chegam ao mesmo lugar', () => {
      // Miniatura e card do sheet mandam o índice; hotspot e pill mandam o id.
      // Se os dois divergissem, trocar de cena pela faixa e pelo ponto de
      // navegação levaria a estados diferentes para o mesmo cômodo.
      store.irParaCena(2);
      const porIndice = store.currentScene();

      store.irParaCena(0);
      store.irParaCenaPorId('c');

      expect(store.currentScene()).toEqual(porIndice!);
      expect(store.currentSceneIndex()).toBe(2);
    });

    it('ignora índice fora da faixa em vez de mostrar tela vazia', () => {
      store.irParaCena(1);

      store.irParaCena(9);
      store.irParaCena(-1);

      expect(store.currentSceneIndex()).toBe(1);
    });

    it('ignora id que não existe no tour', () => {
      store.irParaCena(1);

      store.irParaCenaPorId('cena-que-foi-apagada');

      expect(store.currentSceneIndex()).toBe(1);
    });
  });

  describe('invariantes da tela', () => {
    it('sem chrome não há hotspot — nem faixa de cenas', () => {
      store.alternarChrome();

      expect(store.chromeVisible()).toBeFalse();
      expect(store.hotspotsVisiveis()).toBeFalse();
      expect(store.faixaVisivel()).toBeFalse();
    });

    it('sheet aberto esconde a faixa, para não haver duas listas na tela', () => {
      store.abrirSheet('scenes');

      expect(store.faixaVisivel()).toBeFalse();
      // O chrome continua no ar: quem some é a faixa.
      expect(store.chromeVisible()).toBeTrue();
    });

    it('abrir um segundo sheet substitui o primeiro', () => {
      store.abrirSheet('share');
      store.abrirSheet('delete');

      expect(store.sheet()).toBe('delete');
    });

    /**
     * A aba do Compartilhar é consequência de por onde se entrou, e não memória
     * entre aberturas. Sem gravá-la em toda abertura, o COMPARTILHAR da barra
     * inferior abriria na tela de `<iframe>` para quem tivesse usado o
     * "Incorporar" do desktop antes.
     */
    it('abrir o compartilhar grava a aba, inclusive no valor padrão', () => {
      store.abrirCompartilhamento('embed');
      expect(store.sheet()).toBe('share');
      expect(store.shareTab()).toBe('embed');

      store.fecharSheet();
      store.abrirCompartilhamento();

      expect(store.sheet()).toBe('share');
      expect(store.shareTab()).toBe('link');
    });

    it('tour sem cenas não mostra faixa', () => {
      store.tour.set({ ...TOUR, panoramas: [] });

      expect(store.semCenas()).toBeTrue();
      expect(store.faixaVisivel()).toBeFalse();
    });
  });

  describe('link público', () => {
    it('sai vazio sem tour, para ninguém copiar meia URL', () => {
      store.tour.set(null);

      expect(store.linkPublico()).toBe('');
    });

    it('desligar os controles vira parâmetro na URL', () => {
      expect(store.linkPublico()).toBe(`${window.location.origin}/embed/t1`);

      store.embedShowControls.set(false);

      expect(store.linkPublico()).toBe(`${window.location.origin}/embed/t1?controles=0`);
    });

    /**
     * O bloco de código do painel e o botão "Copiar código" do rodapé do sheet
     * são componentes IRMÃOS desde a reorganização. Os dois leem daqui, e é
     * isso que impede o texto copiado de divergir do texto lido.
     */
    it('o código do embed acompanha link e formato, de uma fonte só', () => {
      store.tour.set(TOUR);

      expect(store.codigoDoEmbed()).toBe(
        store.pedacosDoEmbed().map((pedaco) => pedaco.texto).join(''),
      );
      expect(store.codigoDoEmbed()).toContain(`src="${store.linkPublico()}"`);
      expect(store.codigoDoEmbed()).toContain('width="100%"');

      store.embedFormat.set(1);
      expect(store.codigoDoEmbed()).toContain('width="960"');

      store.embedShowControls.set(false);
      expect(store.codigoDoEmbed()).toContain('?controles=0');
    });
  });

  /**
   * O `publicar()` é do CONTRATO, e não de uma das telas: quem o chama são o
   * item do sheet Gerenciar (TV-6) e o botão do cluster do desktop (TV-9).
   * Duas cópias divergiriam no primeiro ajuste.
   */
  describe('publicar', () => {
    let http: HttpTestingController;

    beforeEach(() => {
      http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    const pedidoDePublicacao = () =>
      http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/virtual-tours/t1'));

    it('só há o que publicar enquanto o tour é rascunho', () => {
      expect(store.podePublicar()).toBeFalse();

      store.tour.set({ ...TOUR, status: 'DRAFT' });

      expect(store.podePublicar()).toBeTrue();
    });

    /**
     * O defeito que este teste existe para impedir, e que só aparece no caminho
     * de SUCESSO: `PATCH /virtual-tours/:id` devolve
     * `{ id, status, propertyId, updatedAt }` e mais nada. Um `tour.set(resposta)`
     * apagaria `panoramas`, e a tela esvaziaria — faixa de cenas vazia e viewer
     * desmontado — no instante em que a publicação dá certo.
     */
    it('não perde as cenas, porque a rota devolve o tour sem elas', async () => {
      store.tour.set({ ...TOUR, status: 'DRAFT' });

      const publicando = store.publicar();
      pedidoDePublicacao().flush({
        id: 't1',
        status: 'PUBLISHED',
        propertyId: 'p1',
        updatedAt: '',
      });

      expect(await publicando).toBeTrue();
      expect(store.scenes().length).toBe(3);
      expect(store.semCenas()).toBeFalse();
      expect(store.podePublicar()).toBeFalse();
    });

    it('a falha devolve `false` e deixa o tour como estava', async () => {
      store.tour.set({ ...TOUR, status: 'DRAFT' });

      const publicando = store.publicar();
      pedidoDePublicacao().error(new ProgressEvent('erro'));

      expect(await publicando).toBeFalse();
      expect(store.podePublicar()).toBeTrue();
      expect(store.publicando()).toBeFalse();
    });

    /**
     * Dois toques rápidos no item da lista não podem virar dois PATCH. O
     * `http.verify()` do `afterEach` é quem denuncia o segundo.
     */
    it('um pedido em voo recusa o segundo', async () => {
      store.tour.set({ ...TOUR, status: 'DRAFT' });

      const primeiro = store.publicar();
      const segundo = store.publicar();

      expect(await segundo).toBeFalse();
      pedidoDePublicacao().flush({ id: 't1', status: 'PUBLISHED' });
      expect(await primeiro).toBeTrue();
    });
  });
});
