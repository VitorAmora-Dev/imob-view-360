import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { OwlLoaderComponent } from '../../../components/owl-loader/owl-loader.component';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama, VirtualTour } from '../../../models/virtual-tour.model';
import { TourHotspotOverlayComponent } from '../../../tour-viewer/hotspots/tour-hotspot-overlay.component';
import { TourViewerScene, cenasDoTour } from '../../../tour-viewer/tour-viewer.model';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { GuidedBannerComponent } from '../../hotspots/guided/guided-banner.component';
import { HotspotOverlayComponent } from '../../hotspots/hotspot-overlay/hotspot-overlay.component';
import { corDoAmbiente } from '../../passagens/cores';
import { nomeDoAmbiente } from '../../passagens/fila';
import {
  CenaDaFaixa,
  PassagesSceneStripComponent,
} from '../../passagens/passages-scene-strip.component';
import { PassagensSheetComponent } from '../../passagens/passagens-sheet.component';
import { PassagensStore } from '../../passagens/passagens.store';
import { LARGURA_DA_MINIATURA, TourDraftStore } from '../../tour-draft.store';

/**
 * Etapa 3 -- posicionar as passagens escolhidas.
 *
 * Percorre a fila na ordem de selecao, permanecendo na mesma foto ate acabarem
 * os destinos daquele ambiente.
 */
@Component({
  selector: 'app-tour-step-passages',
  standalone: true,
  imports: [
    TranslatePipe,
    OwlLoaderComponent,
    PanoramicViewerComponent,
    HotspotOverlayComponent,
    TourHotspotOverlayComponent,
    GuidedBannerComponent,
    PassagesSceneStripComponent,
    PassagensSheetComponent,
  ],
  // O HotspotEditorStore era fornecido pela etapa 2 antiga, que saiu. Ele
  // guarda o estado EFEMERO de edicao (arraste do pino), e por isso vive aqui:
  // fornecido na pagina, sobreviveria a sair da etapa e voltar.
  providers: [HotspotEditorStore, PassagensStore],
  templateUrl: './step-passages.component.html',
  styleUrls: ['./step-passages.component.scss'],
})
export class StepPassagesComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);
  readonly passagens = inject(PassagensStore);

  /**
   * Público porque a revisão liga o overlay de hotspots nele.
   *
   * Um `viewChild` só para os dois viewers desta etapa, e não um por estado:
   * eles vivem em ramos `@if` mutuamente exclusivos, então nunca há dois no
   * DOM ao mesmo tempo.
   */
  readonly viewerRef = viewChild(PanoramicViewerComponent);

  readonly nomeDoAlvo = computed(() => {
    const p = this.passagens.atual();
    return p ? nomeDoAmbiente(p.destino) : '';
  });

  readonly corDoAlvo = computed(() => {
    const p = this.passagens.atual();
    if (!p) return corDoAmbiente(0);
    const i = this.draft.readyScenes().findIndex((s) => s.id === p.destino.id);
    return corDoAmbiente(Math.max(0, i));
  });

  readonly temPonto = computed(() => this.passagens.atual()?.feita ?? false);

  readonly nomes = computed(() =>
    this.draft.readyScenes().map(nomeDoAmbiente),
  );

  /**
   * Os pontos do ambiente que pertencem a fila.
   *
   * Todos, e nao so o do passo: com varios destinos na mesma foto, esconder os
   * ja confirmados faz o corretor empilhar duas portas no mesmo ponto da esfera
   * sem perceber.
   */
  readonly pinos = computed(() => {
    const p = this.passagens.atual();
    if (!p) return [];
    const destinos = new Set(p.origem.connections ?? []);
    return p.origem.hotspots.filter((h) => h.target && destinos.has(h.target));
  });

  readonly roomNames = computed<Record<string, string>>(() => {
    const mapa: Record<string, string> = {};
    for (const s of this.draft.readyScenes()) mapa[s.id] = nomeDoAmbiente(s);
    return mapa;
  });

  /**
   * O id da FOTO a vista -- e so o id.
   *
   * Existe para o `effect` do reset de camera ter uma dependencia que muda
   * quando a foto muda, e nao a cada ponto marcado nem a cada troca de destino
   * dentro da mesma foto. `atual()` devolve objeto novo a cada mutacao de cena;
   * um `computed` de string usa `Object.is` e a corrente para aqui.
   *
   * Foi exatamente assim que a camera voltava ao centro a cada toque, em
   * producao.
   */
  private readonly fotoAtualId = computed(
    () => this.passagens.atual()?.origem.id ?? null,
  );

  /**
   * O tour inteiro, navegável — a revisão do fim da etapa.
   *
   * Os pontos vão como `originHotspots`, que é o que o viewer desenha como
   * esferas clicáveis fora do modo de edição. É o MESMO caminho do tour
   * publicado: clicar num ponto troca de ambiente, exatamente como o visitante
   * fará.
   *
   * Existe porque o corretor acabou de marcar os pontos às cegas — ele tocou
   * onde ACHA que fica a porta. Sem andar pelo resultado, descobrir que o ponto
   * caiu na parede acontece depois de publicar, na frente do cliente.
   */
  readonly tourCompleto = computed<Panorama[]>(
    () =>
      this.draft.readyScenes().map((cena, i) => ({
        id: cena.id,
        roomName: nomeDoAmbiente(cena),
        imageUrl: cena.treatedImageUrl ?? cena.imageData,
        order: cena.order,
        initialPanorama: i === 0,
        originHotspots: cena.hotspots
          .filter((h) => !!h.target)
          .map((h) => ({
            id: h.id,
            label: h.label,
            positionX: h.u,
            positionY: h.v,
            targetId: h.target as string,
          })),
        measurements: [],
      })),
    {
      equal: (a, b) =>
        a.length === b.length &&
        a.every(
          (p, i) =>
            p.id === b[i].id &&
            p.imageUrl === b[i].imageUrl &&
            p.originHotspots.length === b[i].originHotspots.length,
        ),
    },
  );

  /**
   * Todas as fotos em mão.
   *
   * A revisão só monta quando a última chega, e a razão é o `ngOnChanges` do
   * viewer: qualquer mudança em `panoramas` o faz voltar ao ambiente inicial.
   * Montando cedo, uma foto que chegasse enquanto o corretor estivesse no
   * terceiro cômodo o jogaria de volta ao primeiro, sem explicação.
   */
  readonly tourPronto = computed(() =>
    this.draft
      .readyScenes()
      .every((s) => !!(s.treatedImageUrl || s.imageData)),
  );

  readonly viewerPanoramas = computed<Panorama[]>(
    () => {
      const cena = this.passagens.atual()?.origem;
      if (!cena) return [];
      return [
        {
          id: cena.id,
          roomName: cena.room,
          imageUrl: cena.treatedImageUrl ?? cena.imageData,
          order: cena.order,
          initialPanorama: true,
          originHotspots: [],
          measurements: [],
        },
      ];
    },
    {
      equal: (a, b) =>
        a.length === b.length &&
        a.every(
          (p, i) =>
            p.id === b[i].id &&
            p.imageUrl === b[i].imageUrl &&
            p.order === b[i].order,
        ),
    },
  );

  // ---- a revisão: o tour inteiro, navegável ------------------------------

  /**
   * A cena cuja FOTO está na tela durante a revisão.
   *
   * A mesma regra R4 do visualizador, e pelo mesmo motivo: entre o toque no
   * pin e a textura pronta existe um intervalo, e tudo o que é desenhado EM
   * CIMA da foto tem de ler daqui. Ligados à intenção, os pins do DESTINO
   * boiariam sobre a foto da ORIGEM — e clicáveis.
   */
  private readonly idNaTela = signal<string | null>(null);

  /**
   * As cenas da revisão no vocabulário do VISUALIZADOR.
   *
   * `cenasDoTour()` é reusado inteiro de propósito: ele traz a eleição do
   * hotspot principal e a resolução do rótulo ("o label, ou o nome da cena
   * destino"). Reimplementar isso aqui daria dois tours com pins diferentes
   * para os mesmos dados — e a revisão existe justamente para mostrar o que o
   * visitante vai ver.
   *
   * `imageUrl`/`thumbUrl` do resultado NÃO servem aqui e não são lidos: eles
   * saem de `urlDaImagem()`, que devolve o `blob:` do wizard intacto, e o
   * `thumbUrl` ainda lhe grudaria um `?w=` que um `blob:` não aceita. Quem
   * desenha foto nesta tela é o viewer, com `tourCompleto()`; quem desenha
   * miniatura é a faixa, com o cache do rascunho.
   */
  readonly cenasDaRevisao = computed<TourViewerScene[]>(() =>
    cenasDoTour({ panoramas: this.tourCompleto() } as VirtualTour),
  );

  readonly cenaNaTela = computed<TourViewerScene | null>(
    () => this.cenasDaRevisao().find((c) => c.id === this.idNaTela()) ?? null,
  );

  /** As cenas como a faixa as desenha: nome e miniatura, nada mais. */
  readonly cenasDaFaixa = computed<CenaDaFaixa[]>(() =>
    this.draft.readyScenes().map((cena) => ({
      id: cena.id,
      nome: nomeDoAmbiente(cena),
      thumb: this.draft.miniatura(cena.id),
    })),
  );

  /**
   * A foto do passo ainda não chegou.
   *
   * O que a coruja cobre é a espera REAL desta etapa: entrar nela dispara o
   * download da equirretangular do ambiente, e sem aviso o palco fica preto
   * por segundos — medido em ~4s no ambiente de desenvolvimento. Não é o mesmo
   * que a espera da página, que é a do tour inteiro descendo.
   */
  readonly esperandoFoto = computed(() => {
    const cena = this.passagens.atual()?.origem;
    if (!cena) return false;
    return !(cena.treatedImageUrl || cena.imageData);
  });

  /** O viewer trocou de foto na revisão. Fecha o ciclo de `idNaTela`. */
  aoTrocarPanorama(panorama: Panorama): void {
    this.idNaTela.set(panorama.id);
  }

  /** Um pin ou a faixa pediram outro cômodo. */
  irParaCena(sceneId: string): void {
    this.viewerRef()?.navigateTo(sceneId);
  }

  constructor() {
    this.passagens.abrir();

    /**
     * As miniaturas da faixa da revisão.
     *
     * Tamanho de selo (o padrão de `garantirMiniatura`) e não a foto cheia: a
     * faixa desenha 104×70, e a equirretangular do cômodo já está sendo baixada
     * pelo viewer por outro caminho. Pedir a grande aqui dobraria o tráfego da
     * etapa para desenhar um retângulo.
     */
    effect(() => {
      if (!this.passagens.acabou()) return;
      for (const cena of untracked(() => this.draft.readyScenes())) {
        if (this.draft.miniatura(cena.id, LARGURA_DA_MINIATURA)) continue;
        void this.draft.garantirMiniatura(cena.id);
      }
    });

    // Trocar de FOTO devolve a camera ao angulo inicial. A dependencia e o id,
    // e nao a passagem: ver `fotoAtualId`.
    effect(() => {
      this.fotoAtualId();
      untracked(() => this.viewerRef()?.resetView());
    });

    // A cena retomada chega sem foto; sem isto a esfera fica branca.
    effect(() => {
      const cena = this.passagens.atual()?.origem;
      if (!cena || cena.treatedImageUrl || cena.imageData) return;
      void this.draft.garantirImagem(cena.id, 'treated').catch(() => undefined);
    });

    // Na revisão o corretor anda pelo tour inteiro, então TODAS as fotos
    // precisam estar em mão — não só a do passo. A dependência é o booleano de
    // `acabou()`, e não a fila: um `computed` de objeto reagiria a cada ponto
    // marcado e dispararia o lote a cada toque.
    effect(() => {
      if (!this.passagens.acabou()) return;
      for (const cena of untracked(() => this.draft.readyScenes())) {
        if (cena.treatedImageUrl || cena.imageData) continue;
        void this.draft.garantirImagem(cena.id, 'treated').catch(() => undefined);
      }
    });
  }

  onPlaced(evento: { positionX: number; positionY: number }): void {
    this.passagens.marcar(evento.positionX, evento.positionY);
  }

  /** "Voltar aos ambientes": a etapa de ordenacao e a 2. */
  voltarParaOrdenacao(): void {
    this.draft.goTo(2);
  }
}
