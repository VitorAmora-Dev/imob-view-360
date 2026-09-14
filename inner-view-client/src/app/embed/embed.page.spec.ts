import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama, VirtualTour } from '../models/virtual-tour.model';
import { EmbedPage } from './embed.page';

function panorama(id: string, order: number): Panorama {
  return {
    id,
    roomName: `Cômodo ${order + 1}`,
    // Data-URI de 1x1 para o viewer não sair pedindo foto ao servidor de teste.
    imageUrl:
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    order,
    initialPanorama: order === 0,
    originHotspots: [
      order === 0
        ? { id: 'h-a', positionX: 0.75, positionY: 0.6, targetId: 'b', label: 'Quarto' }
        : { id: 'h-b', positionX: 0.25, positionY: 0.6, targetId: 'a', label: 'Sala' },
    ],
    measurements: [],
  };
}

const TOUR: VirtualTour = {
  id: 't1',
  status: 'PUBLISHED',
  propertyId: 'p1',
  createdAt: '',
  updatedAt: '',
  panoramas: [panorama('a', 0), panorama('b', 1)],
};

/**
 * O embed passou a montar o MESMO visualizador do sistema.
 *
 * Duas coisas estão sob teste aqui, e a segunda é a que importa. A primeira é
 * que as peças novas aparecem — faixa de cenas, pontos de passagem novos,
 * ocultar e compartilhar. A segunda é que as peças do DONO não aparecem, e não
 * por estarem escondidas: elas não existem nesta tela.
 *
 * A distinção não é preciosismo. Um `@if` que esconde o botão de editar é uma
 * linha que alguém inverte sem perceber, e o custo do engano seria um caminho
 * de edição na frente de qualquer visitante de qualquer site que incorpore o
 * tour. O que não está no `imports` do componente não pode ser renderizado por
 * engano depois.
 */
describe('EmbedPage — o visualizador atual dentro do iframe', () => {
  let fixture: ComponentFixture<EmbedPage>;
  let page: EmbedPage;

  /**
   * Os parâmetros da URL desta montagem.
   *
   * Uma variável, e não um provider por caso, porque o `ActivatedRoute` é lido
   * no `ngOnInit` — depois de o módulo já estar configurado. O getter abaixo é
   * o que deixa `montar()` escolher os parâmetros no último instante, sem
   * reconfigurar o TestBed.
   *
   * Isto já foi um `TestBed.resetTestingModule()` dentro do `montar()`, e o
   * preço apareceu longe: com o módulo reconstruído no meio do caso, o
   * elemento da fixture fica FORA do documento, `getComputedStyle` devolve
   * string vazia para tudo, e os casos de camada passam a comparar '' com
   * 'none' — falhando sem dizer por quê.
   */
  let parametros: Record<string, string> = {};

  beforeEach(async () => {
    parametros = {};

    await TestBed.configureTestingModule({
      imports: [EmbedPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 't1' }),
              get queryParamMap() {
                return convertToParamMap(parametros);
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  /**
   * Monta a página com o tour já na tela e a primeira foto anunciada.
   *
   * O `detectChanges` inicial roda o `ngOnInit`, que chama `carregarPorTour()`
   * e liga o `loading` na primeira linha — por isso os dados entram DEPOIS.
   * A requisição fica pendurada no backend de teste e nunca é respondida: o que
   * está sob teste é o ARRANJO com dados na tela, não a busca deles.
   *
   * O anúncio da primeira foto faz parte da linha de base porque a camada de
   * hotspots segue a FOTO na tela, e não a cena pedida.
   */
  function montar(queryParams: Record<string, string> = {}): void {
    parametros = queryParams;

    fixture = TestBed.createComponent(EmbedPage);
    page = fixture.componentInstance;

    fixture.detectChanges();
    page.store.tour.set(TOUR);
    page.store.loading.set(false);
    fixture.detectChanges();

    page.aoTrocarPanorama(TOUR.panoramas[0]);
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  /**
   * Espera um quadro — e é obrigatório antes de qualquer `getComputedStyle`.
   *
   * `ion-content` é um componente Stencil: o shadow root nasce VAZIO e o
   * `<slot>` só aparece no render seguinte. Enquanto não aparece, os filhos em
   * light DOM não são atribuídos a slot nenhum — logo não são renderizados —, e
   * o Chrome devolve string vazia para TODAS as propriedades computadas deles.
   * O caso então compara '' com 'none' e falha sem dizer por quê.
   */
  const umQuadro = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  const achar = (seletor: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(seletor);

  /** O viewer de verdade — o spec monta o componente, e não um dublê. */
  const viewerReal = (): PanoramicViewerComponent =>
    fixture.debugElement.query(By.directive(PanoramicViewerComponent))
      .componentInstance as PanoramicViewerComponent;

  describe('o que passou a existir', () => {
    it('monta faixa de cenas, barra de ações e os pontos de passagem novos', () => {
      montar();

      expect(achar('app-tour-scenes-strip')).not.toBeNull();
      expect(achar('app-tour-actions-bar')).not.toBeNull();
      expect(achar('app-tv-hotspot-overlay')).not.toBeNull();
    });

    /**
     * Os pins VELHOS eram sprites desenhados dentro da cena 3D, e a navegação
     * de ambientes era a pílula do próprio viewer. As duas coisas continuavam
     * ligadas no embed porque ele não tinha substituto; agora tem, e deixá-las
     * ligadas daria duas navegações e dois desenhos de ponto na mesma tela.
     */
    it('desliga a navegação e os pins do viewer, que agora têm substituto', () => {
      montar();

      const viewer = fixture.debugElement.query(By.directive(PanoramicViewerComponent))
        .componentInstance as PanoramicViewerComponent;

      expect(viewer.roomNav).toBeFalse();
      expect(viewer.hotspotMode).toBe('none');
    });

    /**
     * Veio da #85 e continua valendo com o visualizador novo.
     *
     * O zoom do tour é curto (1,1x) e sem controle na tela. Ele NÃO saiu na
     * troca de layout: quem incorpora o tour num site espera que a roda do
     * mouse e a pinça façam alguma coisa dentro do iframe, e o teste da #85
     * media isso num dublê de viewer que esta reescrita aposentou.
     */
    it('habilita o zoom curto e invisível no panorama incorporado', () => {
      montar();

      const viewer = fixture.debugElement.query(By.directive(PanoramicViewerComponent))
        .componentInstance as PanoramicViewerComponent;

      expect(viewer.zoomLimitado).toBeTrue();
    });

    it('a barra traz ocultar, deitar e compartilhar', () => {
      montar();

      expect(achar('.tv-actions__button--visibility')).not.toBeNull();
      expect(achar('.tv-actions__button--orientation')).not.toBeNull();
      expect(achar('.tv-actions__button--share')).not.toBeNull();
    });
  });

  describe('o que não pode existir', () => {
    /**
     * A asserção de segurança desta tela.
     *
     * `podeEditar` deixou de ser `true` cravado no store justamente por causa
     * deste caminho: quem entra por `carregarPorTour()` não edita.
     */
    it('não põe caminho nenhum para editar na frente do visitante', () => {
      montar();

      expect(page.store.podeEditar()).toBeFalse();
      expect(achar('.tv-actions__button--edit')).toBeNull();
    });

    /**
     * A prova de que a ausência é ESTRUTURAL, e não um `@if` invertível.
     *
     * Forçar `sheet()` para 'manage' e 'delete' é exatamente o que um bug de
     * template faria. Na tela do dono isso abriria as duas folhas; aqui não há
     * o que abrir, porque elas não estão na lista de `imports` da página.
     */
    it('não instancia a folha de gerenciar nem a de excluir, mesmo com o sheet forçado', () => {
      montar();

      page.store.sheet.set('manage');
      fixture.detectChanges();
      expect(achar('app-tour-manage-sheet')).toBeNull();

      page.store.sheet.set('delete');
      fixture.detectChanges();
      expect(achar('app-tour-delete-sheet')).toBeNull();
    });

    it('não mostra o cabeçalho do imóvel nem o cluster do desktop', () => {
      montar();

      expect(achar('app-tv-header')).toBeNull();
      expect(achar('app-tour-desktop-chrome')).toBeNull();
    });
  });

  /**
   * A OUTRA METADE do interruptor "Mostrar controles" do sheet Incorporar
   * (TV-4). Lá o store acrescenta `?controles=0` ao link; aqui o parâmetro vira
   * alguma coisa. Enquanto esta metade não existia, o interruptor gerava uma
   * URL diferente e um embed idêntico — e a tela de quem configurava mostrava
   * que tinha funcionado.
   */
  describe('o parâmetro `controles`', () => {
    it('`controles=0` esconde a moldura inteira', () => {
      montar({ controles: '0' });

      expect(achar('.tv-chrome')).toBeNull();
      expect(achar('app-tour-scenes-strip')).toBeNull();
      expect(achar('app-tour-actions-bar')).toBeNull();
    });

    /**
     * E NÃO esconde os pontos de passagem.
     *
     * Eles não são moldura: são o único jeito de andar pelo tour com a
     * interface desligada. Escondidos junto, `controles=0` entregaria um cômodo
     * só — menos do que o embed antigo já fazia, onde os sprites do viewer
     * ficavam. É a mesma regra do modo imersivo.
     */
    it('mas mantém a foto e os pontos de passagem', () => {
      montar({ controles: '0' });

      expect(achar('app-panoramic-viewer')).not.toBeNull();
      expect(achar('app-tv-hotspot-overlay')).not.toBeNull();
    });

    it('sem parâmetro nenhum, a interface aparece', () => {
      montar();
      expect(achar('.tv-chrome')).not.toBeNull();
    });

    it('`controles=1` deixa como está', () => {
      montar({ controles: '1' });
      expect(achar('.tv-chrome')).not.toBeNull();
    });

    /**
     * Um valor que ninguém previu mantém os controles. O padrão é o
     * comportamento completo: um parâmetro digitado errado não deveria mutilar
     * em silêncio o tour de quem incorporou.
     */
    it('um valor desconhecido não desliga nada', () => {
      montar({ controles: 'talvez' });
      expect(achar('.tv-chrome')).not.toBeNull();
    });
  });
  /**
   * O que só se descobre com a tela montada e as folhas de estilo aplicadas.
   *
   * Estes casos existem por um defeito real, achado no navegador e não em
   * teste: na tela do dono, a camada de hotspots ganhou a classe `.tv-slot` ao
   * ser encaixada, e a regra `pointer-events: auto` dos filhos do chrome —
   * declarada depois, com a mesma especificidade — venceu o `none` da camada.
   * O resultado foi uma placa invisível de `inset: 0` sobre a foto: o panorama
   * parou de girar, sem erro nenhum no console e com a suíte inteira verde.
   *
   * O embed monta as MESMAS camadas, e agora inclui o mesmo esqueleto de
   * estilo. Repetir estes casos aqui é o que impede o arranjo desta tela de
   * reintroduzir o defeito por conta própria — dentro do site de outra pessoa,
   * onde ninguém da equipe olharia.
   */
  describe('as camadas, com as folhas aplicadas', () => {
    beforeEach(async () => {
      montar();
      await umQuadro();
      fixture.detectChanges();
    });

    it('a camada de hotspots NÃO intercepta o arrasto do panorama', () => {
      expect(getComputedStyle(achar('app-tv-hotspot-overlay')!).pointerEvents).toBe('none');
    });

    it('o container do chrome também não intercepta — só os filhos dele', () => {
      expect(getComputedStyle(achar('.tv-chrome')!).pointerEvents).toBe('none');
    });

    it('os scrims não interceptam', () => {
      const scrims = fixture.nativeElement.querySelectorAll('.tv-scrim');

      expect(scrims.length).toBe(2);
      for (const scrim of scrims) {
        expect(getComputedStyle(scrim as HTMLElement).pointerEvents).toBe('none');
      }
    });

    it('a faixa de cenas recebe o toque de volta', () => {
      expect(getComputedStyle(achar('app-tour-scenes-strip')!).pointerEvents).toBe('auto');
    });

    /**
     * O mesmo defeito um andar abaixo. O slot das ações é uma faixa de ponta a
     * ponta da tela; no imersivo ela perde a placa de vidro e fica invisível,
     * mas transparência não conta para hit test — ela continuaria engolindo o
     * arrasto do panorama nos 70px de baixo, que é onde o polegar começa o
     * gesto.
     */
    it('no imersivo a faixa das ações devolve o arrasto ao panorama', () => {
      const slot = achar('.tv-slot--acoes')!;
      expect(getComputedStyle(slot).pointerEvents).toBe('auto');

      page.store.chromeVisible.set(false);
      fixture.detectChanges();

      expect(slot.classList).toContain('is-imersivo');
      expect(getComputedStyle(slot).pointerEvents).toBe('none');
      // E o botão que sobrou continua clicável, senão não há volta.
      const botao = slot.querySelector('.tv-actions__button--visibility') as HTMLElement;
      expect(getComputedStyle(botao).pointerEvents).toBe('auto');
    });

    /**
     * Os pins ficam ATRÁS do chrome na tela (z-index 2 contra 3) e DEPOIS dele
     * na ordem de tabulação. Quem decide a pilha é o z-index; quem decide o Tab
     * é a ordem dos nós.
     */
    it('os hotspots vêm depois do chrome na ordem de tabulação', () => {
      const chrome = achar('.tv-chrome')!;
      const pins = achar('app-tv-hotspot-overlay')!;

      expect(chrome.compareDocumentPosition(pins) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    });
  });
  /**
   * O embed ABRE deitado — a única tela do produto que faz isso.
   *
   * Em pé o tour mostra cerca de 39 graus na horizontal, e essa é a primeira
   * impressão que o cliente final tem do imóvel. Deitado são uns 105.
   */
  describe('abrir deitado', () => {
    it('nasce com o palco girado, sem ninguém tocar em nada', () => {
      montar();

      expect(page.store.deitado()).toBeTrue();
      expect(page.store.palcoGirado()).toBeTrue();
      expect(achar('.tv-palco')!.classList).toContain('tv-palco--deitado');
    });

    /**
     * Num iframe largo a INTENÇÃO fica escrita e o GIRO não acontece.
     *
     * Um embed de 960×540 já é largo, mesmo aberto num celular — girá-lo seria
     * pôr conteúdo em pé dentro de uma caixa deitada. A página não repete essa
     * conta: quem a faz é `palcoGirado`, num lugar só.
     */
    it('num iframe largo a intenção fica escrita e o giro não acontece', () => {
      montar();

      page.store.cabeGirar.set(false);
      fixture.detectChanges();

      expect(page.store.deitado()).toBeTrue();
      expect(achar('.tv-palco')!.classList).not.toContain('tv-palco--deitado');
    });

    /**
     * A ASSERÇÃO QUE GUARDA O DEFEITO.
     *
     * A classe do palco gira a imagem; o `rotacaoDaTela` do viewer gira o
     * ARRASTO — ele desliga o `OrbitControls` e troca os eixos do dedo. As duas
     * metades já viveram de condições diferentes, e a foto andava perpendicular
     * ao dedo quando elas discordavam.
     *
     * Percorrer as quatro combinações, e não só a boa, é o que transforma "elas
     * concordam hoje" em "elas não podem discordar".
     */
    it('a imagem e o arrasto nunca discordam sobre estar girados', () => {
      montar();

      for (const intencao of [true, false]) {
        for (const largura of [true, false]) {
          page.store.deitado.set(intencao);
          page.store.cabeGirar.set(largura);
          fixture.detectChanges();

          const imagemGirada = achar('.tv-palco')!.classList.contains('tv-palco--deitado');
          const arrastoGirado = viewerReal().rotacaoDaTela !== 0;

          expect(arrastoGirado)
            .withContext(`intenção=${intencao}, cabe girar=${largura}`)
            .toBe(imagemGirada);
        }
      }
    });
  });
});
