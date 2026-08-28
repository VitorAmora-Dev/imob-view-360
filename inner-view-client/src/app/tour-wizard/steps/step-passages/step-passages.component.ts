import {
  Component,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { GuidedBannerComponent } from '../../hotspots/guided/guided-banner.component';
import { HotspotOverlayComponent } from '../../hotspots/hotspot-overlay/hotspot-overlay.component';
import { corDoAmbiente } from '../../passagens/cores';
import { nomeDoAmbiente } from '../../passagens/fila';
import { PassagensSheetComponent } from '../../passagens/passagens-sheet.component';
import { PassagensStore } from '../../passagens/passagens.store';
import { TourDraftStore } from '../../tour-draft.store';

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
    PanoramicViewerComponent,
    HotspotOverlayComponent,
    GuidedBannerComponent,
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

  private readonly viewerRef = viewChild(PanoramicViewerComponent);

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

  constructor() {
    this.passagens.abrir();

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
  }

  onPlaced(evento: { positionX: number; positionY: number }): void {
    this.passagens.marcar(evento.positionX, evento.positionY);
  }

  /** "Voltar aos ambientes": a etapa de ordenacao e a 2. */
  voltarParaOrdenacao(): void {
    this.draft.goTo(2);
  }
}
