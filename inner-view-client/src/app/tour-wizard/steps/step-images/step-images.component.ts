import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ModalController } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Capture360Component } from '../../../components/capture-360/capture-360.component';
import { captureSupported } from '../../../components/capture-360/capture-support';
import {
  CaptureFrameUpload,
  CaptureGeometry,
} from '../../../services/virtual-tour.service';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { TrashIconComponent } from '../../ui/trash-icon/trash-icon.component';

interface SceneDeckItem {
  scene: WizardScene;
  depth: number;
  offset: number;
  hidden: boolean;
  dragX: number;
  liveScale: number;
  lift: number;
  tilt: number;
  number: number | null;
  imageUrl: string | null;
  displayName: string;
  accessibleName: string;
  isCover: boolean;
  rejectionKey: string;
}

/**
 * Etapa 1 — Imagens 360°.
 *
 * DONO: Frente A (tarefas A5 e A6; a lista de ambientes é a A8).
 *
 * A imagem vem primeiro no wizard porque sem ela nada mais faz sentido, e
 * porque é o insumo mais caro de obter: quem não tem foto descobre na primeira
 * tela, não depois de preencher um formulário inteiro.
 */
@Component({
  selector: 'app-tour-step-images',
  standalone: true,
  imports: [TranslatePipe, TrashIconComponent],
  templateUrl: './step-images.component.html',
  styleUrls: ['./step-images.component.scss'],
})
export class StepImagesComponent implements OnDestroy {
  readonly store = inject(TourDraftStore);

  private readonly modalController = inject(ModalController);

  private readonly fileInput =
    viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly galleryHeading =
    viewChild<ElementRef<HTMLHeadingElement>>('galleryHeading');
  private readonly roomInput = viewChild<ElementRef<HTMLInputElement>>('roomInput');

  readonly isDragOver = signal(false);
  private readonly focusedSceneId = signal<string | null>(null);
  readonly arrivingSceneId = signal<string | null>(null);
  readonly editingSceneId = signal<string | null>(null);
  readonly dragOffset = signal(0);
  readonly isDragging = signal(false);
  private knownSceneIds = new Set<string>();
  private pendingFileAdditions = 0;
  private arrivalTimer: number | null = null;
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private suppressCardClick = false;

  /**
   * O card em primeiro plano pertence só à tela de imagens.
   *
   * Uma cena recusada também precisa poder vir para a frente para explicar o
   * erro, mas ela nunca pode virar a cena selecionada do viewer. Por isso o
   * foco visual fica local e só cenas prontas atualizam `selectedSceneId` no
   * store.
   */
  readonly activeScene = computed<WizardScene | null>(() => {
    const scenes = this.store.scenes();
    const focused = scenes.find((scene) => scene.id === this.focusedSceneId());
    const selected = scenes.find(
      (scene) => scene.id === this.store.selectedSceneId(),
    );
    return focused ?? selected ?? scenes[0] ?? null;
  });

  readonly environmentCountKey = computed(() =>
    this.store.scenes().length === 1
      ? 'TOUR_WIZARD.STEP1.ENVIRONMENTS_COUNT_ONE'
      : 'TOUR_WIZARD.STEP1.ENVIRONMENTS_COUNT',
  );

  /**
   * A cena ativa fica na frente e as três seguintes formam uma pilha leve.
   * Durante o gesto, a ativa inclina e cede profundidade enquanto a próxima
   * se aproxima — o movimento acompanha o dedo/mouse, não é uma animação
   * decorativa disparada depois do toque.
   */
  readonly deckItems = computed<SceneDeckItem[]>(() => {
    const scenes = this.store.scenes();
    const readyScenes = this.store.readyScenes();
    const drag = this.dragOffset();
    const dragProgress = Math.min(Math.abs(drag) / 96, 1);
    const activeId = this.activeScene()?.id;
    const activeIndex = Math.max(
      0,
      scenes.findIndex((scene) => scene.id === activeId),
    );
    const ordered = [
      ...scenes.slice(activeIndex),
      ...scenes.slice(0, activeIndex),
    ];

    return ordered.map((scene, offset) => {
      const depth = Math.min(offset, 3);
      const isActive = offset === 0;
      const isIncoming = offset === 1;
      const incomingShift = drag < 0 ? 18 * dragProgress : 0;

      const readyIndex = readyScenes.findIndex(
        (candidate) => candidate.id === scene.id,
      );
      const number = scene.state === 'ready' ? readyIndex + 1 : null;
      return {
        scene,
        depth,
        offset,
        hidden: offset > 3,
        dragX: isActive ? drag : isIncoming ? incomingShift : 0,
        liveScale: isActive
          ? 1 - 0.025 * dragProgress
          : isIncoming
            ? 0.96 + 0.035 * dragProgress
            : depth === 2
              ? 0.925
              : 0.895,
        lift: isIncoming ? -8 * dragProgress : 0,
        tilt: isActive ? drag / 32 : isIncoming ? -drag / 120 : 0,
        number,
        imageUrl: this.imageUrl(scene),
        displayName: scene.room.trim() || scene.fileName,
        accessibleName: scene.room.trim() || scene.fileName,
        isCover: this.store.coverScene()?.id === scene.id,
        rejectionKey:
          `TOUR_WIZARD.STEP1.REJECTED_${(scene.rejectedReason ?? 'type').toUpperCase()}`,
      };
    });
  });

  /**
   * `dragenter`/`dragleave` disparam também ao cruzar as bordas dos filhos, o
   * que faz o realce piscar enquanto o cursor atravessa o ícone ou os botões.
   * Contar as entradas e saídas em vez de ligar/desligar resolve: só é saída de
   * verdade quando o contador zera.
   */
  private dragDepth = 0;

  readonly cameraAvailable = captureSupported();

  /** Quantas capturas guiadas já saíram daqui — só para numerar o ambiente. */
  private capturasFeitas = 0;

  constructor() {
    /**
     * Rascunho retomado chega sem a foto grande. O deck mostra todos os
     * ambientes, então pede a mesma miniatura autenticada que o card compacto
     * já usa, sem baixar uma equirretangular inteira para cada item.
    */
    effect(() => {
      for (const scene of this.store.scenes()) {
        // O deck substituiu o SceneCard nesta tela, então ele próprio garante
        // tanto a miniatura ativa quanto as que aparecem nas laterais.
        if (this.imageUrl(scene) || !scene.serverPanoramaId) continue;
        void this.store.garantirMiniatura(scene.id);
      }
    });

    /**
     * Cada arquivo entra no store antes de terminar sua leitura. Quando a
     * inclusão partiu desta tela, traz o card recém-criado para a frente para
     * que ele não nasça escondido no fim de uma pilha grande.
     */
    effect(() => {
      const scenes = this.store.scenes();
      const added = scenes.filter((scene) => !this.knownSceneIds.has(scene.id));
      this.knownSceneIds = new Set(scenes.map((scene) => scene.id));

      if (!this.pendingFileAdditions || !added.length) return;

      this.pendingFileAdditions = Math.max(
        0,
        this.pendingFileAdditions - added.length,
      );
      this.focusScene(added[added.length - 1], true);
    });

    /**
     * Um card pode ser escolhido enquanto ainda está em leitura. Assim que
     * ficar pronto, mantém a seleção visual e a seleção usada pela etapa 2 em
     * sincronia. Arquivos recusados nunca são enviados ao viewer.
     */
    effect(() => {
      const focusedId = this.focusedSceneId();
      const focused = this.store.scenes().find((scene) => scene.id === focusedId);
      if (
        focused?.state === 'ready' &&
        this.store.selectedSceneId() !== focused.id
      ) {
        this.store.selectScene(focused.id);
      }
    });
  }

  // ---- entrada por arquivo -----------------------------------------------

  /**
   * Clicar em qualquer ponto do card abre o seletor. É conveniência de mouse —
   * o caminho acessível é o próprio `<input type="file">`, que fica na ordem de
   * tabulação com o rótulo visível como `<label>`, e não escondido com
   * `display: none`.
   */
  openFilePicker(): void {
    this.fileInput().nativeElement.click();
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) this.addFiles(files);
    // Zerar permite reenviar o mesmo arquivo logo em seguida: sem isso o
    // `change` não dispara de novo para uma seleção idêntica.
    input.value = '';
  }

  // ---- arrastar e soltar --------------------------------------------------

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth++;
    this.isDragOver.set(true);
  }

  /** Sem `preventDefault` no dragover o navegador nunca dispara o `drop`. */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = 0;
    this.isDragOver.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) this.addFiles(files);
  }

  /** Traz um ambiente para a frente sem oferecer cena recusada ao viewer. */
  selectScene(scene: WizardScene): void {
    if (this.suppressCardClick) return;
    this.focusScene(scene);
  }

  previousScene(): void {
    this.moveScene(-1);
  }

  nextScene(): void {
    this.moveScene(1);
  }

  onDeckKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previousScene();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.nextScene();
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest('.tw-deck__control')
    ) {
      return;
    }

    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragOffset.set(0);
    this.isDragging.set(false);
    const host = event.currentTarget as HTMLElement | null;
    try {
      host?.setPointerCapture(event.pointerId);
    } catch {
      // O gesto continua sem captura em navegadores que não a implementam.
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const distance = event.clientX - this.dragStartX;
    this.dragOffset.set(Math.max(-96, Math.min(96, distance)));
    if (Math.abs(distance) > 8) this.isDragging.set(true);
  }

  onPointerEnd(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;

    const distance = event.clientX - this.dragStartX;
    this.dragPointerId = null;
    this.dragOffset.set(0);

    if (Math.abs(distance) >= 48) {
      this.suppressCardClick = true;
      window.setTimeout(() => (this.suppressCardClick = false));
      distance < 0 ? this.nextScene() : this.previousScene();
    }
    this.isDragging.set(false);
    this.releasePointer(event);
  }

  onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    this.dragOffset.set(0);
    this.isDragging.set(false);
    this.releasePointer(event);
  }

  startRename(event: Event, scene: WizardScene): void {
    event.stopPropagation();
    this.editingSceneId.set(scene.id);
    window.setTimeout(() => {
      const input = this.roomInput()?.nativeElement;
      input?.focus();
      input?.select();
    });
  }

  finishRename(): void {
    this.editingSceneId.set(null);
  }

  onRename(scene: WizardScene, event: Event): void {
    this.store.renameScene(
      scene.id,
      (event.target as HTMLInputElement).value,
    );
  }

  onRenameKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    (event.target as HTMLInputElement).blur();
  }

  removeScene(event: Event, scene: WizardScene): void {
    event.stopPropagation();
    this.editingSceneId.set(null);
    this.store.removeScene(scene.id);
  }

  // ---- captura pela câmera ------------------------------------------------

  /**
   * Abre a captura 360° guiada do próprio app — não um `<input capture>`.
   *
   * O handoff sugere `capture="environment"`, que só tira uma foto comum; o
   * projeto já tem captura guiada com costura, que é o que produz um
   * equirretangular de verdade. Onde ela não roda (desktop, navegador sem
   * sensores), cai no seletor de arquivos, que é o mesmo degrau para o qual o
   * `capture` degradaria.
   */
  async openCapture(): Promise<void> {
    if (!this.cameraAvailable) {
      this.openFilePicker();
      return;
    }

    const modal = await this.modalController.create({
      component: Capture360Component,
      cssClass: 'capture-360-modal',
      // Passado por `componentProps` e não resolvido por injeção: o
      // `ModalController` cria o componente fora da árvore da página, então ele
      // não enxerga o `TourDraftStore`, que é provido lá.
      componentProps: {
        tratar: (captura: Parameters<TourDraftStore['tratarCaptura']>[0]) =>
          this.store.tratarCaptura(captura),
      },
    });
    await modal.present();

    const { role, data } = await modal.onDidDismiss<{
      imageData: string;
      frames: CaptureFrameUpload[];
      geometry: CaptureGeometry | null;
      room: string;
      serverPanoramaId: string | null;
      treatedUrl: string;
    }>();
    if (role !== 'confirm' || !data?.imageData) return;

    // O nome vem da tela de preview da captura, onde a pessoa ainda está dentro
    // do cômodo olhando o resultado — que é onde a evidência está. Aqui ele
    // apenas chega; pode vir vazio, e a etapa 1 cobra depois.
    //
    // Antes vinha "Ambiente N" daqui. O badge do card continua mostrando esse
    // número, então a identidade ordinal não se perdeu — o que se perdeu foi um
    // nome de mentira ocupando o campo e fazendo o corretor achar que já estava
    // resolvido, até o seletor de destino da etapa 2 oferecer "Ambiente 1,
    // Ambiente 2".
    //
    // O contador segue existindo para o nome do ARQUIVO: ele anda com o total
    // de capturas da sessão, não com o tamanho da lista, porque derivar de
    // `scenes().length` reaproveitava o número depois de uma remoção.
    const n = ++this.capturasFeitas;
    const wasEmpty = this.store.scenes().length === 0;
    this.store.addCapturedScene({
      room: data.room ?? '',
      fileName: `captura-360-${n}.jpg`,
      imageData: data.imageData,
      frames: data.frames,
      geometry: data.geometry,
      // O cômodo já existe no servidor e já passou pela IA: isso aconteceu
      // dentro do modal, enquanto o corretor esperava, antes de ele dar nome.
      ...(data.serverPanoramaId ? { serverPanoramaId: data.serverPanoramaId } : {}),
      ...(data.treatedUrl ? { treatedImageUrl: data.treatedUrl, aiState: 'done' as const } : {}),
    });

    const scenes = this.store.scenes();
    const added = scenes[scenes.length - 1];
    if (added) this.focusScene(added, true);
    if (wasEmpty) this.focusGallery();
  }

  private addFiles(files: File[]): void {
    const wasEmpty = this.store.scenes().length === 0;
    this.pendingFileAdditions += files.length;

    // `addFiles` inclui o primeiro card antes do primeiro `await`. A troca para
    // a galeria, portanto, acontece no mesmo gesto que fechou o seletor, e os
    // estados "lendo" aparecem sem uma tela intermediária parada.
    void this.store.addFiles(files);
    if (wasEmpty) this.focusGallery();
  }

  private focusScene(scene: WizardScene, arriving = false): void {
    this.editingSceneId.set(null);
    this.focusedSceneId.set(scene.id);
    if (scene.state === 'ready') this.store.selectScene(scene.id);
    if (!arriving) return;

    this.arrivingSceneId.set(scene.id);
    if (this.arrivalTimer !== null) window.clearTimeout(this.arrivalTimer);
    this.arrivalTimer = window.setTimeout(() => {
      if (this.arrivingSceneId() === scene.id) this.arrivingSceneId.set(null);
      this.arrivalTimer = null;
    }, 420);
  }

  private imageUrl(scene: WizardScene): string | null {
    return (
      scene.treatedImageUrl ??
      (scene.imageData || this.store.miniatura(scene.id) || null)
    );
  }

  /**
   * O gatilho que abriu o seletor/modal desaparece quando a galeria entra.
   * Levar o foco ao novo título evita que teclado e leitor de tela fiquem num
   * elemento removido do DOM.
   */
  private focusGallery(): void {
    window.setTimeout(() => this.galleryHeading()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    if (this.arrivalTimer !== null) window.clearTimeout(this.arrivalTimer);
  }

  private moveScene(direction: -1 | 1): void {
    const scenes = this.store.scenes();
    if (scenes.length < 2) return;

    const currentIndex = Math.max(
      0,
      scenes.findIndex((scene) => scene.id === this.activeScene()?.id),
    );
    const nextIndex = (currentIndex + direction + scenes.length) % scenes.length;
    this.focusScene(scenes[nextIndex]);
  }

  private releasePointer(event: PointerEvent): void {
    const host = event.currentTarget as HTMLElement | null;
    try {
      if (host?.hasPointerCapture(event.pointerId)) {
        host.releasePointerCapture(event.pointerId);
      }
    } catch {
      // O gesto já terminou; não há recuperação necessária.
    }
  }
}
