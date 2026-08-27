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

  constructor() {
    /**
     * A cena retomada chega sem foto (Tarefa 9): `imageData` vazio de
     * propósito, ver o campo em `tour-wizard.model.ts`. Sem isto, a etapa 2
     * abre com a esfera branca — `TextureLoader` falha calado com endereço
     * vazio e o material fica sem mapa, o mesmo sintoma corrigido em 036b4ac,
     * por outra causa.
     *
     * Fica NUM EFFECT À PARTE, e não dentro do `computed` de
     * `viewerPanoramas`: aquele computed é comparado por identidade de
     * propósito (ver o comentário dele), e recriar o array a cada resposta
     * deste download recarregaria a equirretangular inteira — exatamente o
     * que o par de testes de identidade protege.
     */
    effect(() => {
      const cena = this.draft.selectedScene();
      if (!cena || cena.treatedImageUrl || cena.imageData) return;
      // `.catch` porque o effect reroda a cada mutação da cena — uma tecla no
      // nome de um ponto basta. Sem ele, uma falha de rede vira uma rejeição
      // sem dono a cada gesto do corretor.
      void this.draft.garantirImagem(cena.id, 'treated').catch(() => undefined);
    });
  }

  // ---- antes e depois da montagem por IA ----------------------------------

  /**
   * O corretor pediu para ver a foto como saiu da câmera.
   *
   * O padrão é a tratada, e não é uma escolha de gosto: ele JÁ aprovou essa
   * versão no modal de captura, onde esperou por ela. Abrir a etapa 2 no
   * panorama cru desfaria na cara dele o que ele acabou de ver.
   */
  readonly vendoOriginal = signal(false);

  /** Só faz sentido oferecer a comparação quando existem as duas imagens. */
  readonly temComparacao = computed(() =>
    Boolean(this.draft.selectedScene()?.treatedImageUrl),
  );

  /**
   * A imagem que o viewer deve dissolver por cima da que está à vista.
   *
   * Nenhum download aqui: o `blob:` da tratada foi criado no modal de captura,
   * enquanto o corretor esperava, e vive na cena. Baixar de novo custaria os
   * mesmos megabytes por uma imagem que já está na memória.
   *
   * A trava por interação é o que impede a troca no meio de um gesto. `pinDrag`
   * é o sinal canônico de arraste — mora no editor porque a lixeira precisa do
   * mesmo dado — e `picker` cobre o seletor de destino aberto: ele é medido uma
   * vez na abertura, e recarregar por baixo dele o deixa fora do lugar.
   */
  readonly revealUrl = computed(() => {
    if (this.editor.pinDrag() || this.editor.picker()) return null;

    const scene = this.draft.selectedScene();
    if (!scene?.treatedImageUrl) return null;

    return this.vendoOriginal() ? scene.imageData : scene.treatedImageUrl;
  });

  /**
   * Liga e desliga o "ver original".
   *
   * A cena retomada chega com `imageData` vazio (Tarefa 9) e ganha
   * `treatedImageUrl` assim que o viewer pede a foto — o que já basta para
   * `temComparacao` ser verdadeiro e o botão aparecer. Só que a original nunca
   * era baixada por ninguém: `revealUrl` devolvia a string vazia e o botão não
   * fazia nada. A variante `'original'` de `garantirImagem` existia desde a
   * Tarefa 10 sem um único chamador.
   *
   * Não é `async`: o template chama isto num `(click)`, e uma promise devolvida
   * ali não teria dono. E só troca DEPOIS de a imagem existir — revelar uma
   * original que não chegou é a mesma tela em branco, só que agora pedida.
   */
  alternarOriginal(): void {
    if (this.vendoOriginal()) {
      this.vendoOriginal.set(false);
      return;
    }

    const cena = this.draft.selectedScene();
    if (!cena) return;
    if (cena.imageData) {
      this.vendoOriginal.set(true);
      return;
    }

    void this.draft
      .garantirImagem(cena.id, 'original')
      .catch(() => '')
      .then((url) => {
        if (url) this.vendoOriginal.set(true);
      });
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
          // A tratada quando existe: ela é o que o corretor aprovou no modal
          // de captura. Cai no data-URI da costura para cena vinda de arquivo,
          // que nunca passa pela IA. `urlDaImagem` reconhece os dois.
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
