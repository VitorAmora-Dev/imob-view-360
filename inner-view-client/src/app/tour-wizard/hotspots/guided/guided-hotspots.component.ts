import { Component, computed, effect, inject, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { GuidedBannerComponent } from './guided-banner.component';
import { GuidedCycleComponent } from './guided-cycle.component';
import { HotspotOverlayComponent } from '../hotspot-overlay/hotspot-overlay.component';
import { corDoAmbiente } from './guided-route';
import { GuidedRouteStore } from './guided-route.store';
import { GuidedSheetComponent } from './guided-sheet.component';

/**
 * O assistente guiado: um toque por foto, e o percurso fecha num ciclo.
 *
 * O `GuidedRouteStore` é fornecido aqui — o estado de "estou no resumo" não
 * deve sobreviver a trocar para o editor livre e voltar. O `HotspotEditorStore`
 * NÃO é: ele vem da etapa, compartilhado com o modo livre.
 */
@Component({
  selector: 'app-guided-hotspots',
  standalone: true,
  imports: [
    TranslatePipe,
    PanoramicViewerComponent,
    GuidedBannerComponent,
    GuidedSheetComponent,
    GuidedCycleComponent,
    HotspotOverlayComponent,
  ],
  providers: [GuidedRouteStore],
  templateUrl: './guided-hotspots.component.html',
  styleUrls: ['./guided-hotspots.component.scss'],
})
export class GuidedHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly guided = inject(GuidedRouteStore);

  /**
   * Vem da ETAPA, compartilhado com o editor livre. O assistente escreve pelo
   * `GuidedRouteStore`; o que se usa daqui direto e' so o arraste do pino, que
   * e' gesto de tela e nao decisao de roteiro.
   */
  readonly editor = inject(HotspotEditorStore);

  private readonly viewerRef = viewChild(PanoramicViewerComponent);

  /**
   * So a passagem DESTE passo vai para o overlay.
   *
   * O ambiente pode ter outros pontos, marcados no editor livre. Mostra-los
   * aqui encheria a foto de pinos que nao sao deste passo, com nomes de
   * destinos que o roteiro nao esta perguntando.
   */
  readonly pinoDoPasso = computed(() => {
    const hotspot = this.guided.passo()?.hotspot;
    return hotspot ? [hotspot] : [];
  });

  /** Nomes por id, para o pino poder dizer para onde leva (a11y). */
  readonly roomNames = computed<Record<string, string>>(() => {
    const mapa: Record<string, string> = {};
    for (const s of this.guided.cenas()) mapa[s.id] = s.room.trim() || s.fileName;
    return mapa;
  });

  /** Nomes dos ambientes na ordem do percurso, para o diagrama do ciclo. */
  readonly nomes = computed(() =>
    this.guided.cenas().map((s) => s.room.trim() || s.fileName),
  );

  readonly nomeDoAlvo = computed(() => {
    const alvo = this.guided.passo()?.target;
    return alvo ? alvo.room.trim() || alvo.fileName : '';
  });

  /**
   * A cor de identidade vem da posição do ALVO no percurso, e não da do passo:
   * o swatch existe para reconhecer de relance o ambiente para onde se vai.
   */
  readonly corDoAlvo = computed(() => {
    const passo = this.guided.passo();
    if (!passo) return corDoAmbiente(0);
    return corDoAmbiente((passo.index + 1) % passo.total);
  });

  /**
   * A cena atual no formato que o viewer entende.
   *
   * O `equal` não é otimização, é correção — cópia deliberada da regra do
   * editor livre, com a mesma razão medida lá: `patchScene` cria uma cena nova
   * a cada mutação de hotspot, e sem isto o `ngOnChanges` do viewer chamaria
   * `loadInitialPanorama()` a cada toque, decodificando a equirretangular
   * inteira de novo e subindo megabytes para a GPU por gesto.
   *
   * `originHotspots` vai vazio: quem desenha ponto sobre a foto não é o viewer.
   */
  readonly viewerPanoramas = computed<Panorama[]>(
    () => {
      const scene = this.guided.passo()?.scene;
      if (!scene) return [];

      return [
        {
          id: scene.id,
          roomName: scene.room,
          // A tratada quando existe — é o que o corretor aprovou no modal de
          // captura. Cai no data-URI da costura para cena vinda de arquivo.
          imageUrl: scene.treatedImageUrl ?? scene.imageData,
          order: scene.order,
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

  constructor() {
    // Entrar no assistente pula para o primeiro passo incompleto: quem já ligou
    // metade no editor livre não deve confirmar de novo o que já está feito.
    this.guided.abrir();

    // Trocar de ambiente devolve a câmera ao ângulo inicial. Sem isto o
    // corretor chega na foto nova olhando o ângulo da anterior — que ali não
    // quer dizer nada, porque equirretangulares de celular não compartilham
    // orientação de bússola. Ver `resetView` no viewer.
    effect(() => {
      this.guided.passo()?.scene.id;
      this.viewerRef()?.resetView();
    });
  }

  /**
   * Toque na foto.
   *
   * Com o diagrama aberto não há passo em andamento, e marcar moveria a
   * passagem do passo 1 sem nada na tela dizer isso.
   */
  onPlaced(event: { positionX: number; positionY: number }): void {
    if (this.guided.resumo()) return;
    this.guided.marcar(event.positionX, event.positionY);
  }

  /**
   * "Continuar" no diagrama: a etapa 2 acabou, segue para o resumo do tour.
   *
   * `next()` e não `step.set(3)`: é o mesmo caminho que o botão "Próximo" da
   * barra usa, e portanto passa pelo mesmo `canAdvance`. Com o ciclo fechado
   * ele está satisfeito de qualquer forma — mas escrever a etapa na mão criaria
   * um segundo jeito de avançar, que um dia divergiria do primeiro.
   */
  continuar(): void {
    this.draft.next();
  }
}
