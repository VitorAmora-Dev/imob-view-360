import { Injectable, computed, signal } from '@angular/core';
import {
  EMPTY_PROPERTY,
  MAX_FILE_BYTES,
  PropertyDraft,
  ROOM_NAME_MAX,
  WizardScene,
  WizardSceneRejection,
  WizardStep,
} from './tour-wizard.model';

/**
 * Estado do rascunho do wizard.
 *
 * DONO: Frente A. A Frente B não edita este arquivo — muta cenas pelo
 * `patchScene` a partir do `HotspotEditorStore`. É a regra que mantém as duas
 * frentes fora do mesmo merge (SPRINT-3-TOUR-WIZARD.md §7).
 *
 * As ASSINATURAS públicas são congeladas (§4.3); os corpos são da Frente A.
 * No commit-zero está implementado o que a Frente B precisa para trabalhar
 * (navegação, seleção, cenas, `patchScene`); o que é só da Frente A está
 * marcado com TODO e o número da tarefa.
 *
 * Fornecido pela página, não em `root`: o rascunho morre junto com a tela, e
 * "Criar outro tour" é só reinstanciar. Estado de criação de tour vazando
 * entre visitas seria pior que perdê-lo.
 */
@Injectable()
export class TourDraftStore {
  // ---- estado ------------------------------------------------------------
  readonly step = signal<WizardStep>(1);
  readonly scenes = signal<WizardScene[]>([]);
  readonly selectedSceneId = signal<string | null>(null);
  readonly property = signal<PropertyDraft>({ ...EMPTY_PROPERTY });
  readonly published = signal(false);
  /** Trava o botão do rodapé enquanto o publicar está em voo. */
  readonly publishing = signal(false);

  // ---- derivados ---------------------------------------------------------

  /** Cenas que passaram na validação — as únicas que contam para qualquer coisa. */
  readonly readyScenes = computed(() =>
    this.scenes().filter((s) => s.state === 'ready'),
  );

  readonly selectedScene = computed<WizardScene | null>(() => {
    const id = this.selectedSceneId();
    return this.scenes().find((s) => s.id === id) ?? null;
  });

  /**
   * Única regra bloqueante do fluxo: sem imagem não há tour, e as etapas 2 e 3
   * não fazem sentido. Vale para o botão "Próximo" e para os chips do stepper.
   */
  readonly canAdvance = computed(() => this.readyScenes().length > 0);

  /** Soma de TODOS os ambientes, não só o selecionado — é o que o resumo mostra. */
  readonly totalHotspots = computed(() =>
    this.scenes().reduce((n, s) => n + s.hotspots.length, 0),
  );

  readonly progressPct = computed(() =>
    this.published() ? 100 : (this.step() / 3) * 100,
  );

  /** Capa do tour: a primeira cena válida. */
  readonly coverScene = computed<WizardScene | null>(
    () => this.readyScenes()[0] ?? null,
  );

  // ---- navegação ---------------------------------------------------------

  /**
   * Uma etapa é alcançável se já foi visitada, ou se a regra da imagem permite.
   * Os chips bloqueados do stepper não respondem ao clique.
   */
  canReach(step: WizardStep): boolean {
    return step <= this.step() || this.canAdvance();
  }

  goTo(step: WizardStep): void {
    if (!this.canReach(step)) return;
    this.step.set(step);
  }

  next(): void {
    const current = this.step();
    if (current === 3) {
      void this.publish();
      return;
    }
    // O handler devolve cedo quando inválido, além do botão já vir desabilitado:
    // teclado e leitor de tela chegam aqui por caminhos que não passam pelo
    // estado visual do botão.
    if (!this.canAdvance()) return;
    this.step.set((current + 1) as WizardStep);
  }

  back(): void {
    const current = this.step();
    if (current === 1) return;
    this.step.set((current - 1) as WizardStep);
  }

  // ---- cenas -------------------------------------------------------------

  /**
   * Recebe arquivos do seletor, da câmera ou do drop e cria um ambiente por
   * arquivo, no fim da lista.
   *
   * TODO(A7): falta a validação de proporção ~2:1 (equirretangular), que exige
   * decodificar a imagem. Tipo e tamanho já são checados aqui porque são
   * síncronos e baratos.
   */
  async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const rejection = rejectionFor(file);
      const scene: WizardScene = {
        id: crypto.randomUUID(),
        room: defaultRoomName(file.name),
        fileName: file.name,
        fileSize: file.size,
        imageData: '',
        order: this.scenes().length,
        hotspots: [],
        state: rejection ? 'rejected' : 'reading',
        ...(rejection ? { rejectedReason: rejection } : {}),
      };
      this.scenes.update((list) => [...list, scene]);
      if (rejection) continue;

      try {
        const imageData = await readAsDataUrl(file);
        this.patchScene(scene.id, (s) => ({ ...s, imageData, state: 'ready' }));
      } catch {
        this.patchScene(scene.id, (s) => ({
          ...s,
          state: 'rejected',
          rejectedReason: 'type',
        }));
      }
      this.selectedSceneId.update((id) => id ?? scene.id);
    }
  }

  /** Adiciona um ambiente já pronto — usado pela captura 360 guiada (A6). */
  addCapturedScene(scene: Omit<WizardScene, 'id' | 'order' | 'hotspots' | 'state'>): void {
    const created: WizardScene = {
      ...scene,
      id: crypto.randomUUID(),
      order: this.scenes().length,
      hotspots: [],
      state: 'ready',
    };
    this.scenes.update((list) => [...list, created]);
    this.selectedSceneId.update((id) => id ?? created.id);
  }

  renameScene(id: string, room: string): void {
    this.patchScene(id, (s) => ({ ...s, room }));
  }

  /**
   * Remove um ambiente e limpa o que apontava para ele.
   *
   * Hotspot cujo destino deixou de existir vira um ponto morto: some do viewer
   * do visitante e ninguém entende por quê. Zerar o destino devolve o ponto ao
   * estado "sem destino", que a etapa 2 sabe mostrar e o corretor sabe corrigir.
   */
  removeScene(id: string): void {
    this.scenes.update((list) =>
      list
        .filter((s) => s.id !== id)
        .map((s, i) => ({
          ...s,
          order: i,
          hotspots: s.hotspots.map((h) =>
            h.target === id ? { ...h, target: null } : h,
          ),
        })),
    );
    if (this.selectedSceneId() === id) {
      this.selectedSceneId.set(this.scenes()[0]?.id ?? null);
    }
  }

  selectScene(id: string): void {
    this.selectedSceneId.set(id);
  }

  /**
   * Mutador de baixo nível de uma cena.
   *
   * É a ÚNICA porta pela qual o `HotspotEditorStore` (Frente B) altera cenas.
   * Existe para que as duas frentes não escrevam no mesmo arquivo — ver §7 do
   * plano do sprint. Não remova nem mude a assinatura sem avisar a Frente B.
   */
  patchScene(id: string, fn: (scene: WizardScene) => WizardScene): void {
    this.scenes.update((list) =>
      list.map((s) => (s.id === id ? fn(s) : s)),
    );
  }

  // ---- publicar ----------------------------------------------------------

  /**
   * TODO(A12): fluxo real — createProperty → createTour (com os hotspots
   * inline, ver §2.2) → uploadCaptureFrames → montarTour → acompanharMontagem.
   * Portar de `upload-tour.page.ts`, que faz exatamente isso hoje.
   *
   * Por ora só chaveia o estado, para que a tela de sucesso exista e as duas
   * frentes consigam navegar o fluxo inteiro desde o commit-zero.
   */
  async publish(): Promise<void> {
    if (this.publishing()) return;
    this.publishing.set(true);
    try {
      this.published.set(true);
    } finally {
      this.publishing.set(false);
    }
  }

  /** "Criar outro tour": volta tudo ao estado inicial. */
  reset(): void {
    this.step.set(1);
    this.scenes.set([]);
    this.selectedSceneId.set(null);
    this.property.set({ ...EMPTY_PROPERTY });
    this.published.set(false);
    this.publishing.set(false);
  }
}

function rejectionFor(file: File): WizardSceneRejection | null {
  if (!file.type.startsWith('image/')) return 'type';
  if (file.size > MAX_FILE_BYTES) return 'size';
  return null;
}

function defaultRoomName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').slice(0, ROOM_NAME_MAX);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}
