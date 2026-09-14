import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../environments/environment';
import { Panorama, VirtualTour } from '../models/virtual-tour.model';
import { PropertyService } from '../services/property.service';
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
    it('sem chrome não há faixa de cenas', () => {
      store.alternarChrome();

      expect(store.chromeVisible()).toBeFalse();
      expect(store.faixaVisivel()).toBeFalse();
    });

    /**
     * O invariante 1 fala da MOLDURA, e não da foto.
     *
     * Havia um `hotspotsVisiveis` aqui valendo `chromeVisible()`, e ele estava
     * errado: "Ocultar interface" levava junto os pontos de navegação, que são
     * o único jeito de trocar de cômodo sem trazer a interface de volta. O
     * store não tem mais opinião nenhuma sobre isso — quem guarda os pins é
     * `cenaNaTela()`, na página, e é `tour-viewer.page.spec.ts` que prova que
     * eles sobrevivem ao imersivo.
     */
    it('o store não tem sinal nenhum escondendo hotspot', () => {
      store.alternarChrome();

      expect((store as unknown as Record<string, unknown>)['hotspotsVisiveis'])
        .toBeUndefined();
    });

    /**
     * Os sheets sao `ion-modal`, e o Ionic TELEPORTA o modal aberto para o
     * `<ion-app>` — fora do palco, que e quem recebe o giro do modo paisagem.
     * Sem levantar a tela antes, o corretor com o telefone deitado recebe o
     * "Compartilhar" em pe, de lado, e nao ha como girar so ele de volta.
     */
    it('abrir um sheet levanta a tela deitada', () => {
      store.alternarDeitado();
      expect(store.deitado()).toBeTrue();

      store.abrirSheet('manage');

      expect(store.deitado()).toBeFalse();
    });

    /** O Compartilhar entra pela mesma porta — nao por um `sheet.set` proprio. */
    it('o compartilhar tambem levanta a tela, e ja na aba pedida', () => {
      store.alternarDeitado();

      store.abrirCompartilhamento('embed');

      expect(store.deitado()).toBeFalse();
      expect(store.sheet()).toBe('share');
      expect(store.shareTab()).toBe('embed');
    });

    it('deitar e levantar alterna, e comeca em pe', () => {
      expect(store.deitado()).toBeFalse();

      store.alternarDeitado();
      expect(store.deitado()).toBeTrue();

      store.alternarDeitado();
      expect(store.deitado()).toBeFalse();
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
  /**
   * O CAMINHO PÚBLICO — o que `/embed` usa.
   *
   * A tela de visualização entra por `GET /properties/:id`, que é autenticada e
   * escopada por agência no servidor. Era esse trajeto que permitia a
   * `podeEditar` ser `true` cravado: quem chegava aqui só podia ser o dono.
   *
   * O embed não tem token nenhum, e é por isso que estes casos existem. Eles
   * não testam uma conveniência de carregamento: testam que a permissão parou
   * de ser consequência do caminho e virou uma pergunta com resposta.
   */
  describe('carga pública (o embed)', () => {
    let http: HttpTestingController;

    beforeEach(() => {
      http = TestBed.inject(HttpTestingController);
      // O embed começa sem nada. O `beforeEach` de cima deixa um tour em
      // memória, e com ele um erro de carga ficaria indistinguível de sucesso.
      store.tour.set(null);
    });

    // A verificação é METADE da asserção de segurança destes casos: qualquer
    // requisição que ninguém esperava — uma busca de imóvel, um DELETE —
    // derruba o teste aqui, mesmo que nenhum `expect` a mencione.
    afterEach(() => http.verify());

    /**
     * Um passo de macrotask, que drena todos os microtasks pendentes.
     *
     * `expectOne` olha a fila NESTE instante, e as etapas da carga são
     * separadas por `await` dentro do store: a busca do tour só existe depois
     * que a anterior resolveu. Perguntar pelas duas de uma vez falha por
     * motivo nenhum.
     */
    const proximoPasso = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 0));

    /** Responde ao par de chamadas que a carga pública dispara. */
    async function responderTour({ comVisita = true } = {}): Promise<void> {
      await proximoPasso();
      http.expectOne(`${environment.apiUrl}/virtual-tours/t1`).flush(TOUR);
      await proximoPasso();
      if (comVisita) {
        http.expectOne(`${environment.apiUrl}/virtual-tours/t1/views`).flush({});
      }
    }

    it('não passa pelo PropertyService — o visitante não tem token para aquela rota', async () => {
      const espiao = spyOn(TestBed.inject(PropertyService), 'findProperty').and.callThrough();

      const carga = store.carregarPorTour('t1');
      await responderTour();
      await carga;

      expect(espiao).not.toHaveBeenCalled();
      expect(store.tourId()).toBe('t1');
      expect(store.scenes().length).toBe(3);
    });

    /**
     * A asserção de segurança deste PR.
     *
     * `podeEditar` alimenta o botão EDITAR da barra de ações e o cluster do
     * desktop. Enquanto era `computed(() => true)`, reusar esta tela no embed
     * punha "Editar" na frente de qualquer visitante de qualquer site que
     * incorporasse o tour.
     */
    it('depois da carga pública, não se pode editar', async () => {
      const carga = store.carregarPorTour('t1');
      await responderTour();
      await carga;

      expect(store.podeEditar()).toBeFalse();
    });

    it('e a carga por imóvel continua podendo — o dono não perdeu nada', async () => {
      const carga = store.carregar('p1');
      await proximoPasso();
      http
        .expectOne(`${environment.apiUrl}/properties/p1`)
        .flush({ id: 'p1', title: 'Casa', virtualTour: { id: 't1' } });
      await responderTour();
      await carga;

      expect(store.podeEditar()).toBeTrue();
    });

    /**
     * Guarda de profundidade, e não redundância.
     *
     * A página de embed não importa a folha que chama estes dois métodos, o que
     * já os torna inalcançáveis pela tela. Mas o tour carregado pela rota
     * pública TRAZ `propertyId` — é ele que `apagarTour` procura — então o
     * método continua chamável por código, e o que o impediria seria só o
     * servidor. Aqui ele para antes de sair da máquina de quem visita.
     */
    it('apagar recusa em modo público, mesmo com o imóvel vindo dentro do tour', async () => {
      const carga = store.carregarPorTour('t1');
      await responderTour();
      await carga;

      expect(store.tour()?.propertyId).toBe('p1');
      await expectAsync(store.apagarTour()).toBeResolvedTo(false);
      // Nenhum DELETE saiu: quem prova é o `http.verify()` do afterEach.
    });

    it('publicar recusa em modo público', async () => {
      const carga = store.carregarPorTour('t1');
      await responderTour();
      await carga;

      await expectAsync(store.publicar()).toBeResolvedTo(false);
    });

    it('tentar de novo, no embed, volta pela rota pública e não pela de imóvel', async () => {
      const primeira = store.carregarPorTour('t1');
      await responderTour();
      await primeira;

      const segunda = store.recarregar();
      // Sem `views`: a visita já foi contada nesta abertura de tela.
      await responderTour({ comVisita: false });
      await segunda;

      expect(store.loadError()).toBeFalse();
    });

    /**
     * O caso em que o "Tentar de novo" existe para alguma coisa: a PRIMEIRA
     * carga falhou.
     *
     * Aí não há tour em memória, e portanto não há `tourId()` de onde tirar o
     * alvo. Quem lembra do id é o próprio `carregarPorTour`. Sem isso, o botão
     * de tentar de novo fica na tela sem fazer nada — o pior tipo de botão.
     */
    it('recarregar funciona mesmo depois de a primeira carga ter falhado', async () => {
      const primeira = store.carregarPorTour('t1');
      await proximoPasso();
      http
        .expectOne(`${environment.apiUrl}/virtual-tours/t1`)
        .flush('fora do ar', { status: 500, statusText: 'Erro' });
      await primeira;

      expect(store.loadError()).toBeTrue();
      expect(store.tourId()).toBeNull();

      const segunda = store.recarregar();
      await responderTour();
      await segunda;

      expect(store.loadError()).toBeFalse();
      expect(store.tourId()).toBe('t1');
    });
  });
});
