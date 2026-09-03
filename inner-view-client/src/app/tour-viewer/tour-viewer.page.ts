import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { CenasSheetComponent } from '../components/cenas-sheet/cenas-sheet.component';
import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';
import { Property } from '../models/property.model';
import { Panorama } from '../models/virtual-tour.model';
import { TvHeaderComponent } from './chrome/tv-header.component';
import { TvImmersiveToggleComponent } from './chrome/tv-immersive-toggle.component';
import { TvScenePillComponent } from './chrome/tv-scene-pill.component';
import { TvToastComponent } from './chrome/tv-toast.component';
import { TourHotspotOverlayComponent } from './hotspots/tour-hotspot-overlay.component';
import { TourScenesStripComponent } from './scenes/tour-scenes-strip.component';
import { TourDeleteSheetComponent } from './sheets/delete/tour-delete-sheet.component';
import { TourEmbedSheetComponent } from './sheets/embed/tour-embed-sheet.component';
import { TourActionsBarComponent } from './tour-actions-bar/tour-actions-bar.component';
import { TourViewerScene } from './tour-viewer.model';
import { TourViewerStore } from './tour-viewer.store';

/**
 * Visualização de um tour, pelo DONO dele (SPRINT-4-TOUR-VIEWER.md).
 *
 * Esta página é só o ARRANJO. Ela não tem estado próprio e quase não tem
 * comportamento: quem sabe das coisas é o `TourViewerStore`, e quem as desenha
 * são os componentes de cada frente, encaixados nos slots do template.
 *
 * O arranjo nasceu pronto no commit-zero (TV-0) exatamente por isso: é o único
 * arquivo que as três frentes tocariam, e um template que cresce por três lados
 * ao mesmo tempo é conflito garantido. Cada frente substitui o SEU marcador no
 * `.html` e não mexe no resto.
 *
 * A rota é `inner-view-page/:id`, e o `:id` é o do IMÓVEL — não o do tour.
 * Decisão D10 do plano: mudar isso arrastaria home, cards, guards e todo link
 * que já foi enviado por aí.
 */
@Component({
  selector: 'app-tour-viewer',
  templateUrl: './tour-viewer.page.html',
  styleUrls: ['./tour-viewer.page.scss'],
  standalone: true,
  providers: [TourViewerStore],
  imports: [
    CenasSheetComponent,
    IonContent,
    IonSpinner,
    PanoramicViewerComponent,
    TourDeleteSheetComponent,
    TourEmbedSheetComponent,
    TourHotspotOverlayComponent,
    TourScenesStripComponent,
    TranslatePipe,
    TvHeaderComponent,
    TvImmersiveToggleComponent,
    TvScenePillComponent,
    TvToastComponent,
    TourActionsBarComponent,
  ],
})
export class TourViewerPage implements OnInit {
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

  readonly offline = signal(!navigator.onLine);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  constructor() {
    /**
     * O único lugar que reage a uma MUDANÇA de cena pedida.
     *
     * Os quatro caminhos de troca de cena — pill, faixa de miniaturas, card do
     * sheet e hotspot — escrevem todos em `currentSceneIndex`, e só este efeito
     * lê dali para o viewer. Quatro chamadas espalhadas de `navigateTo` dariam
     * quatro jeitos sutilmente diferentes de chegar ao mesmo lugar.
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

    // A faixa de aviso segue a rede de verdade, e não um palpite do carregamento:
    // o tour continua navegável com o que já baixou, e some quando a rede volta.
    const aoMudarRede = () => this.offline.set(!navigator.onLine);
    window.addEventListener('online', aoMudarRede);
    window.addEventListener('offline', aoMudarRede);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', aoMudarRede);
      window.removeEventListener('offline', aoMudarRede);
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/home']);
      return;
    }

    // A home navega com o imóvel já em mãos. Aproveitar isso é o que evita uma
    // tela cinza de meio segundo em cima de um dado que já estava carregado.
    const emMemoria = this.router.getCurrentNavigation()?.extras.state?.['property'] as
      | Property
      | undefined;

    void this.store.carregar(id, emMemoria);
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

  /**
   * O EDITAR da tab bar e do cluster do desktop.
   *
   * Leva ao wizard em MODO DE EDIÇÃO (TV-11), e não à retomada de rascunho: a
   * rota de retomada recusa tour publicado de propósito, porque o wizard
   * aberto por ela oferece "Descartar captura" — que apagaria o imóvel inteiro,
   * com as fotos, os hotspots e o link que já foi enviado ao cliente.
   */
  editarTour(): void {
    const id = this.store.tourId();
    if (!id) return;

    this.store.mostrarToast('TOUR_VIEWER.TOAST.OPENING_EDITOR');
    void this.router.navigate(['/tour', id, 'editar']);
  }

  voltar(): void {
    void this.router.navigate(['/home']);
  }
}
