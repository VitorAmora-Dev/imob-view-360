import { Injectable, computed, inject, signal } from '@angular/core';
import { TourDraftStore } from './tour-draft.store';
import { WizardHotspot } from './tour-wizard.model';

/** Bottom sheet do mobile: editando um ponto, ou listando os do ambiente. */
export type SheetState =
  | null
  | { mode: 'editor'; hotspotId: string }
  | { mode: 'list' };

/** Gesto de arraste em curso (long-press sobre um pin). */
export interface PinDragState {
  hotspotId: string;
  overTrash: boolean;
}

/**
 * Edição de hotspots da etapa 2.
 *
 * DONO: Frente B. A Frente A não edita este arquivo.
 *
 * Guarda o estado EFÊMERO da etapa (sheet aberto, arraste em curso) e é o
 * único lugar que muta hotspots — sempre via `TourDraftStore.patchScene`,
 * nunca escrevendo em `scenes` direto. Os hotspots em si moram na cena, no
 * store principal, porque é de lá que o publicar os lê.
 *
 * Nenhum método aqui fala com a rede. Durante o wizard não existe panorama no
 * servidor — eles nascem todos no `createTour` do publicar —, então não haveria
 * nem o que atualizar. Ver §2.2 do plano do sprint.
 */
@Injectable()
export class HotspotEditorStore {
  private readonly draft = inject(TourDraftStore);

  // ---- estado efêmero ----------------------------------------------------
  readonly sheet = signal<SheetState>(null);
  readonly pinDrag = signal<PinDragState | null>(null);

  // ---- derivados ---------------------------------------------------------

  readonly hotspots = computed<WizardHotspot[]>(
    () => this.draft.selectedScene()?.hotspots ?? [],
  );

  /**
   * Destinos possíveis: todo ambiente menos o que está aberto — um ponto não
   * leva a si mesmo.
   */
  readonly targetOptions = computed(() => {
    const currentId = this.draft.selectedSceneId();
    return this.draft.readyScenes().filter((s) => s.id !== currentId);
  });

  readonly editing = computed<WizardHotspot | null>(() => {
    const state = this.sheet();
    if (state?.mode !== 'editor') return null;
    return this.hotspots().find((h) => h.id === state.hotspotId) ?? null;
  });

  // ---- comandos ----------------------------------------------------------

  /**
   * Cria um ponto onde o corretor tocou. Nasce sem nome e sem destino: exigir
   * qualquer dos dois no momento do toque transformaria "marcar um ponto" em
   * "preencher um formulário", e a etapa é opcional justamente para não ser isso.
   *
   * Devolve o id para o chamador abrir o editor no mobile.
   */
  add(u: number, v: number): string {
    const sceneId = this.draft.selectedSceneId();
    if (!sceneId) return '';
    const hotspot: WizardHotspot = {
      id: crypto.randomUUID(),
      u,
      v,
      label: '',
      target: null,
    };
    this.draft.patchScene(sceneId, (s) => ({
      ...s,
      hotspots: [...s.hotspots, hotspot],
    }));
    return hotspot.id;
  }

  update(id: string, patch: Partial<Omit<WizardHotspot, 'id'>>): void {
    const sceneId = this.draft.selectedSceneId();
    if (!sceneId) return;
    this.draft.patchScene(sceneId, (s) => ({
      ...s,
      hotspots: s.hotspots.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));
  }

  remove(id: string): void {
    const sceneId = this.draft.selectedSceneId();
    if (!sceneId) return;
    this.draft.patchScene(sceneId, (s) => ({
      ...s,
      hotspots: s.hotspots.filter((h) => h.id !== id),
    }));
    if (this.sheet()?.mode === 'editor') this.closeSheet();
  }

  // ---- sheet -------------------------------------------------------------

  openEditor(hotspotId: string): void {
    this.sheet.set({ mode: 'editor', hotspotId });
  }

  openList(): void {
    this.sheet.set({ mode: 'list' });
  }

  closeSheet(): void {
    this.sheet.set(null);
  }

  // ---- TODO(B9): gesto de arraste ----------------------------------------
  // `pinDrag` já existe acima para que o balão de dica e a lixeira saibam
  // quando aparecer. Falta o gesto: long-press de 320ms com Pointer Events,
  // clamp de 2–98% em X e 2–96% em Y, hit test da lixeira (últimos 96px de
  // altura, faixa central de ±92px) e supressão do clique seguinte.
}
