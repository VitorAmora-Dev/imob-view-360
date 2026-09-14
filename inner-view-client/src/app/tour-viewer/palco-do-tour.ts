import {
  Directive,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama } from '../models/virtual-tour.model';
import { TourViewerScene } from './tour-viewer.model';
import { TourViewerStore } from './tour-viewer.store';

/**
 * A cola entre a INTENÇÃO guardada no store e a REALIDADE que está no canvas.
 *
 * Duas telas montam o mesmo palco: a visualização do dono (`/inner-view-page`)
 * e o embed público (`/embed`). O que difere entre elas é a lista de peças de
 * chrome — cabeçalho, editar, gerenciar — e é só isso. Esta classe é o resto:
 * saber qual foto está de fato na tela, mandar o viewer navegar quando a
 * escolha muda, e lembrar de QUAL cena falhou.
 *
 * Ela existe porque essas regras são sutis e caras de redescobrir. A distinção
 * entre `currentScene()` e `cenaNaTela()` já custou pins boiando sobre a foto
 * errada, e a distinção entre "uma cena falhou" e "a cena que a pessoa está
 * pedindo falhou" já custou uma tela de erro por cima de um cômodo que estava
 * perfeitamente carregado. Copiadas para uma segunda página, elas divergiriam
 * no primeiro ajuste — e a cópia divergente seria justamente a que ninguém
 * abre para conferir.
 *
 * `@Directive()` sem seletor é o que faz o Angular recolher os metadados de
 * `viewChild` daqui. Sem o decorador a consulta não é herdada, `viewerRef()`
 * devolve `undefined` na subclasse, e nada acusa o erro.
 *
 * O que NÃO mora aqui: rota, carga e navegação para fora. Cada página entra no
 * tour pela sua porta — uma por imóvel, a outra pelo id do tour — e é
 * justamente essa diferença que decide se há permissão de editar.
 */
@Directive()
export abstract class PalcoDoTour {
  readonly store = inject(TourViewerStore);

  /**
   * O viewer, para quem precisa da câmera dele.
   *
   * `viewChild` e não variável de template porque o overlay de hotspots vive
   * DEPOIS do chrome no DOM (ordem de tabulação), e uma referência declarada
   * dentro de um bloco `@if` só existe dentro dele.
   */
  readonly viewerRef = viewChild(PanoramicViewerComponent);

  /**
   * Qual cômodo o viewer está mostrando AGORA.
   *
   * Não é o mesmo que `store.currentScene()`: entre o toque na miniatura e a
   * textura pronta existe um intervalo, e é justamente ele que diz se falta
   * navegar. Mora na página, e não no store, porque é estado do VIEWER — o
   * store fala do tour, e quem o lê não deveria precisar saber que existe uma
   * textura carregando.
   */
  private readonly panoramaAtual = signal<string | null>(null);

  /**
   * A cena cuja FOTO está na tela — a REALIDADE, contra a intenção que
   * `store.currentScene()` guarda.
   *
   * Tudo o que é desenhado EM CIMA da foto tem de ler daqui, e não do store.
   * Os hotspots são o caso que dói: eles são posições dentro de uma
   * equirretangular específica, e `currentScene()` vira no instante do toque
   * enquanto a textura ainda leva segundos para chegar. Ligados ao store, os
   * pins do DESTINO ficavam boiando sobre a foto da ORIGEM, em lugares que não
   * correspondiam a nada visível — e clicáveis, levando a um terceiro cômodo a
   * partir de um pin que nunca esteve ali.
   *
   * `null` até a primeira textura chegar: antes disso não há foto, e portanto
   * não há nada para desenhar em cima.
   */
  readonly cenaNaTela = computed<TourViewerScene | null>(() => {
    const id = this.panoramaAtual();
    if (!id) return null;
    return this.store.scenes().find((cena) => cena.id === id) ?? null;
  });

  /** Panorama cru correspondente à textura que já terminou de carregar. */
  readonly panoramaNaTela = computed<Panorama | null>(() => {
    const id = this.panoramaAtual();
    return this.store.panoramas().find((panorama) => panorama.id === id) ?? null;
  });

  /**
   * QUAL cena não carregou, e não apenas "alguma não carregou".
   *
   * Guardar o id em vez de um booleano é o que faz o aviso pertencer a uma
   * cena. Com booleano, duas coisas davam errado: uma falha que chegasse
   * atrasada — de um pedido que o corretor já tinha abandonado — levantava o
   * erro em tela cheia por cima de um cômodo perfeitamente carregado; e o erro
   * de uma cena continuava de pé depois de voltar para outra que estava boa,
   * sem nada para derrubá-lo além do próprio botão de tentar de novo.
   */
  private readonly cenaComErro = signal<string | null>(null);

  /** O aviso de falha só aparece para a cena que a pessoa está pedindo. */
  readonly mostrarErroDaCena = computed(
    () => this.cenaComErro() !== null && this.cenaComErro() === this.store.currentScene()?.id,
  );

  constructor() {
    /**
     * O único lugar que reage a uma MUDANÇA de cena pedida.
     *
     * Os caminhos de troca de cena — faixa de miniaturas, card do sheet e
     * hotspot — escrevem todos em `currentSceneIndex`, e só este efeito lê dali
     * para o viewer. Três chamadas espalhadas de `navigateTo` dariam três
     * jeitos sutilmente diferentes de chegar ao mesmo lugar.
     *
     * `tentarDeNovo()` chama `navigateTo` por fora, e é a única exceção: lá a
     * cena pedida NÃO mudou, então não há sinal novo a que reagir.
     *
     * Só age depois de o viewer anunciar a primeira foto: até lá ele está
     * carregando a cena inicial por conta própria, e mandar navegar para ela
     * seria baixar a mesma equirretangular duas vezes.
     */
    effect(() => {
      const cena = this.store.currentScene();
      const atual = this.panoramaAtual();
      if (!cena || !atual || atual === cena.id) return;

      // Uma tentativa NOVA torna sem efeito a falha anterior. Sem esta linha, a
      // cena que já falhou uma vez reabria com o aviso de erro em pé enquanto a
      // segunda tentativa ainda estava baixando.
      this.cenaComErro.set(null);
      this.viewerRef()?.navigateTo(cena.id);
    });
  }

  /** O viewer trocou de foto. É o que fecha o ciclo do efeito acima. */
  aoTrocarPanorama(panorama: Panorama): void {
    this.panoramaAtual.set(panorama.id);
    this.cenaComErro.set(null);
  }

  /**
   * A foto de UMA cena não veio — e o parâmetro diz de qual.
   *
   * O `@Output` sempre carregou o panorama; era este ouvinte que jogava fora o
   * argumento e ligava um booleano. O caso que isso quebrava: dois toques
   * rápidos deixam duas cargas em voo, a segunda chega bem, e a falha atrasada
   * da PRIMEIRA cobria com "não carregou" um cômodo que estava na tela,
   * correto, e do qual não havia como sair a não ser recarregando.
   */
  aoFalharCena(panorama: Panorama): void {
    this.cenaComErro.set(panorama.id);
  }

  /**
   * O "Tentar de novo" dos dois estados de erro.
   *
   * São falhas diferentes e a resposta muda: o tour inteiro não carregou (nem
   * há cena para pedir) ou a foto de UMA cena não veio. Um botão só porque, do
   * lado de cá da tela, os dois casos são "não apareceu, tenta de novo".
   *
   * É a ÚNICA exceção ao efeito lá de cima ser o único a mandar o viewer
   * navegar, e a exceção é necessária: aqui a cena pedida não mudou, então não
   * há sinal novo para o efeito reagir. Repetir o mesmo pedido não é mudar de
   * intenção — é insistir na mesma.
   *
   * `recarregar()` escolhe sozinho a porta de entrada: por imóvel na tela do
   * dono, pelo id do tour no embed. É por isso que este método serve às duas.
   */
  tentarDeNovo(): void {
    const cena = this.store.currentScene();
    this.cenaComErro.set(null);

    if (cena) {
      this.viewerRef()?.navigateTo(cena.id);
      return;
    }
    void this.store.recarregar();
  }

  /**
   * Um toque na foto alterna o modo imersivo.
   *
   * O viewer só avisa em toque de verdade: o arrasto que gira a esfera e o
   * toque que acerta um hotspot não chegam aqui. Sem essa distinção, girar a
   * foto esconderia a interface a cada gesto.
   */
  aoTocarNaFoto(): void {
    this.store.alternarChrome();
  }
}
