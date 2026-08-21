import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { VirtualTourService } from '../../../services/virtual-tour.service';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { HotspotOverlayComponent } from '../../hotspots/hotspot-overlay/hotspot-overlay.component';
import { HotspotPanelComponent } from '../../hotspots/hotspot-panel/hotspot-panel.component';
import { HotspotSheetComponent } from '../../hotspots/hotspot-sheet/hotspot-sheet.component';
import { HotspotSummaryRowComponent } from '../../hotspots/hotspot-summary-row/hotspot-summary-row.component';
import { HotspotTrashComponent } from '../../hotspots/hotspot-trash/hotspot-trash.component';
import { SceneRailComponent } from '../../hotspots/scene-rail/scene-rail.component';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';

/**
 * Etapa 2 — Hotspots.
 *
 * DONO: Frente B. B1 a B8 de pé; faltam B9, B10 e o resto do B12.
 *
 * O `HotspotEditorStore` é fornecido AQUI, e não na página: o estado de edição
 * não deve sobreviver a sair da etapa 2 e voltar.
 */
@Component({
  selector: 'app-tour-step-hotspots',
  standalone: true,
  imports: [
    TranslatePipe,
    PanoramicViewerComponent,
    HotspotOverlayComponent,
    SceneRailComponent,
    HotspotPanelComponent,
    HotspotSummaryRowComponent,
    HotspotSheetComponent,
    HotspotTrashComponent,
  ],
  providers: [HotspotEditorStore],
  templateUrl: './step-hotspots.component.html',
  styleUrls: ['./step-hotspots.component.scss'],
})
export class StepHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);

  private readonly virtualTourService = inject(VirtualTourService);

  // ---- antes e depois da montagem por IA ----------------------------------

  /**
   * `blob:` da imagem tratada do ambiente à vista, quando ela já existe.
   *
   * Blob e não a URL da rota: o preview é autenticado por cabeçalho e o
   * `TextureLoader` do three.js carrega sem passar pelo interceptor. Só o
   * ambiente selecionado é baixado — manter os seis de um tour em memória
   * somaria dezenas de MB, sobre os data-URI das originais que já estão lá.
   */
  private readonly urlTratada = signal<string | null>(null);

  /** Qual panorama o blob acima representa, para não rebaixar o mesmo duas vezes. */
  private panoramaBaixado: string | null = null;

  /** O corretor pediu para ver a foto como saiu da câmera. */
  readonly vendoOriginal = signal(false);

  /** Só faz sentido oferecer a comparação quando existem as duas imagens. */
  readonly temComparacao = computed(
    () => this.draft.selectedScene()?.aiState === 'done',
  );

  /** Este ambiente ainda está sendo montado. Vira a tag sobre o visualizador. */
  readonly melhorandoAgora = computed(() => {
    const ai = this.draft.selectedScene()?.aiState;
    return ai === 'uploading' || ai === 'processing';
  });

  /**
   * A imagem que o viewer deve dissolver por cima da que está à vista.
   *
   * Vale para os DOIS sentidos, e é por isso que o toggle funciona. A
   * revelação não é um efeito que acontece uma vez: terminada a dissolvência, a
   * imagem nova passa a ser a que está na esfera principal. Voltar à original
   * é, do ponto de vista do viewer, outra revelação — a da foto de câmera por
   * cima da tratada. Devolver `null` aqui não desfaria nada; deixaria a tratada
   * na tela com o botão dizendo o contrário.
   *
   * A trava por interação é o coração disto. `pinDrag` é o sinal canônico de
   * arraste — mora no editor porque a lixeira precisa do mesmo dado — e
   * `picker` cobre o seletor de destino aberto. Trocar a imagem debaixo do dedo
   * de quem está posicionando um ponto é desorientador, e o seletor é medido
   * uma vez na abertura: recarregar por baixo dele o deixa fora do lugar.
   * Quando a interação acaba, o `computed` reavalia e a revelação acontece.
   */
  readonly revealUrl = computed(() => {
    if (this.editor.pinDrag() || this.editor.picker()) return null;

    const scene = this.draft.selectedScene();
    if (!scene || scene.state !== 'ready') return null;

    // O data-URI da costura é o que o viewer já carregou por `panoramas`;
    // devolvê-lo aqui dissolve de volta para ele.
    if (this.vendoOriginal()) return scene.imageData;
    return this.urlTratada();
  });

  constructor() {
    // Baixa a tratada assim que o ambiente à vista termina de ser montado — ou
    // ao trocar para um ambiente que já está pronto.
    effect(() => {
      const scene = this.draft.selectedScene();
      const alvo = scene?.aiState === 'done' ? scene.serverPanoramaId : undefined;
      if (!alvo) {
        if (this.panoramaBaixado) this.descartarTratada();
        return;
      }
      if (alvo === this.panoramaBaixado) return;
      void this.baixarTratada(alvo);
    });

    // O blob vive fora do ciclo do Angular: sem revogar, cada ida e volta entre
    // etapas deixa alguns MB presos até a aba fechar.
    inject(DestroyRef).onDestroy(() => this.descartarTratada());
  }

  private async baixarTratada(panoramaId: string): Promise<void> {
    this.descartarTratada();
    this.panoramaBaixado = panoramaId;
    try {
      const blob = await firstValueFrom(
        this.virtualTourService.baixarPreview(panoramaId, 'treated'),
      );
      // Trocou de ambiente enquanto baixava: este blob não serve mais.
      if (this.panoramaBaixado !== panoramaId) return;
      this.urlTratada.set(URL.createObjectURL(blob));
    } catch {
      // Sem a tratada o corretor segue com a costurada, que é o que ele teria
      // sem esta etapa. Falhar aqui não pode custar a edição dos pontos.
      this.panoramaBaixado = null;
    }
  }

  private descartarTratada(): void {
    const url = this.urlTratada();
    if (url) URL.revokeObjectURL(url);
    this.urlTratada.set(null);
    this.panoramaBaixado = null;
    this.vendoOriginal.set(false);
  }

  alternarOriginal(): void {
    this.vendoOriginal.update((v) => !v);
  }


  /**
   * A cena selecionada no formato que o viewer entende.
   *
   * `originHotspots` vai VAZIO de propósito: quem desenha os pontos é o overlay
   * HTML (B2). Deixar a lista cheia faria o viewer desenhar também os sprites
   * dele, e apareceriam dois pins por hotspot.
   *
   * O `equal` NÃO é otimização — é correção, e custou uma medição para
   * aparecer. `patchScene` cria uma cena nova a cada mutação de hotspot, então
   * este computed devolvia um array novo a cada tecla digitada no nome de um
   * ponto e a cada `pointermove` de um arraste. O `ngOnChanges` do viewer não
   * distingue "trocou a foto" de "mexeu num hotspot": ele vê a referência mudar
   * e chama `loadInitialPanorama()`, que decodifica a equirretangular inteira
   * de novo e a sobe para a GPU.
   *
   * Medido no navegador antes do conserto: 5 teclas no campo de nome = 5
   * recargas de textura; um arraste = mais 18. Com uma foto de 8192×4096 são
   * megabytes por gesto.
   *
   * Comparar só o que o viewer consome faz o Angular preservar a instância
   * anterior quando nada disso mudou, e a ligação para de disparar. O nome do
   * ambiente fica de fora de propósito: renomear não precisa recarregar foto
   * nenhuma.
   */
  readonly viewerPanoramas = computed<Panorama[]>(
    () => {
      const scene = this.draft.selectedScene();
      if (!scene || scene.state !== 'ready') return [];

      return [
        {
          id: scene.id,
          roomName: scene.room,
          // A foto ainda não subiu: o que existe é o data-URI que o navegador
          // leu do arquivo. `urlDaImagem` reconhece `data:` e devolve como está.
          imageUrl: scene.imageData,
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

  /**
   * O viewer já entrega o par no formato do backend (`positionX`, e
   * `positionY` com o eixo vertical invertido). É o mesmo par que o
   * `WizardHotspot` guarda em `u`/`v` — não há conversão aqui.
   */
  /** Destinos possíveis, com o nome já resolvido, para o seletor do overlay. */
  readonly destinos = computed(() =>
    this.editor.targetOptions().map((s) => ({
      id: s.id,
      room: s.room.trim() || s.fileName,
    })),
  );

  onPlaced(event: { positionX: number; positionY: number }): void {
    // Com o seletor aberto, tocar na foto FECHA em vez de criar outro ponto.
    //
    // Sem isto não haveria como dispensá-lo tocando fora: o toque cairia no
    // canvas, criaria um segundo ponto e abriria um segundo seletor. Quem quer
    // sair ganharia um ponto órfão a cada tentativa.
    if (this.editor.picker()) {
      this.editor.closePicker();
      return;
    }

    const id = this.editor.add(event.positionX, event.positionY);

    // Criar o ponto e ABRIR a edição dele, no mesmo gesto.
    //
    // Antes eram dois cliques: um para criar, outro no pin para nomear. O
    // segundo era cerimônia — não há decisão entre "marquei aqui" e "agora
    // configuro" —, e pior, nada na tela contava que ele existia. Dava para
    // criar cinco pontos e nunca descobrir como nomeá-los. O próprio `add()` já
    // devolvia o id "para o chamador abrir o editor", e o retorno era jogado
    // fora: ponta solta, não decisão.
    //
    // O que segurava a mão era a etapa ser opcional — exigir formulário no
    // toque brigaria com isso. Ela deixou de ser (ver `canAdvance`), e um ponto
    // sem destino é descartado na publicação de qualquer forma.
    //
    // O que abre é o SELETOR DE DESTINO, não o editor inteiro. No instante da
    // criação a única coisa obrigatória é o destino — o nome tem reserva e a
    // exclusão mora no painel. O editor completo cobria metade da tela no
    // mobile e, com o toque na metade de baixo da foto, cobria o próprio ponto
    // que se acabou de criar.
    //
    // Com um ambiente só, não abre: não haveria destino nenhum a oferecer, e o
    // seletor só saberia aparecer vazio a cada clique na foto.
    if (id && this.editor.targetOptions().length) this.editor.openPicker(id);
  }

  /**
   * Os ambientes que o visitante não alcança, e os de onde não se sai, por
   * nome.
   *
   * Nome e não contagem: "2 ambientes sem ligação" manda procurar; "Cozinha,
   * Quarto" manda consertar. Sem os nomes, uma regra que bloqueia vira muro.
   *
   * O fallback para `fileName` é o mesmo do publicar — cena sem nome digitado
   * ainda precisa ser chamada de alguma coisa.
   */
  readonly ilhados = computed(() => this.nomes(this.draft.ambientesIlhados()));
  readonly becos = computed(() => this.nomes(this.draft.becosSemSaida()));

  private nomes(cenas: readonly WizardScene[]): string {
    return cenas.map((s) => s.room.trim() || s.fileName).join(', ');
  }

  /** Nomes por id, para o pin poder dizer para onde leva (a11y). */
  readonly roomNames = computed<Record<string, string>>(() => {
    const mapa: Record<string, string> = {};
    for (const s of this.draft.readyScenes()) mapa[s.id] = s.room;
    return mapa;
  });

  /**
   * Clique no pin (B4).
   *
   * Com destino, NAVEGA — e nunca abre o editor. É regra dura do DoD, e a
   * razão é que este é o único lugar onde o corretor confere o que o visitante
   * vai viver: se clicar num ponto abrisse um formulário, ele nunca veria o
   * tour funcionando enquanto o monta.
   *
   * Sem destino não há para onde ir, e aí o clique vira o que resta de útil:
   * abrir a edição daquele ponto.
   */
  onPinActivated(hotspotId: string): void {
    const hotspot = this.editor.hotspots().find((h) => h.id === hotspotId);
    if (!hotspot) return;

    if (hotspot.target) {
      this.editor.closeSheet();
      this.draft.selectScene(hotspot.target);
      return;
    }

    this.editor.openEditor(hotspotId);
  }

  private readonly trash = viewChild(HotspotTrashComponent);

  /**
   * O ponto seguiu o dedo (B9) e, de quebra, a lixeira responde (B10).
   *
   * O hit test é da lixeira, que conhece o próprio retângulo; a etapa é só quem
   * junta as duas pontas, porque é ela que tem as duas na mão. Isso mantém o
   * overlay sem saber que existe lixeira e a lixeira sem saber que existe
   * arraste.
   */
  onPinDragMoved(event: {
    u: number;
    v: number;
    clientX: number;
    clientY: number;
  }): void {
    this.editor.dragTo(event.u, event.v);
    this.editor.setOverTrash(
      this.trash()?.contains(event.clientX, event.clientY) ?? false,
    );
  }
}
