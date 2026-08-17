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

/** Limites do eixo vertical, do handoff: 2% do topo, 4% da base. */
export const V_MIN = 0.02;
export const V_MAX = 0.96;

/**
 * Segura o ponto longe dos polos.
 *
 * Nos polos o equirretangular está infinitamente esticado e todos os `u`
 * colapsam no mesmo pixel: um ponto de navegação ali não aponta para lugar
 * nenhum. Vale para QUALQUER forma de criar ou mover um ponto — a regra estava
 * só no arraste, e clicar no teto criava exatamente o ponto degenerado que ela
 * existe para impedir.
 *
 * O eixo horizontal não tem limite de propósito: `u` dá a volta, 0 e 1 são o
 * mesmo meridiano, e limitá-lo criaria uma faixa morta na costura da foto.
 */
export function clampV(v: number): number {
  return Math.min(V_MAX, Math.max(V_MIN, v));
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

  /**
   * Ponto recém-criado cujo destino está sendo escolhido — o id, ou nada.
   *
   * É o seletor compacto ancorado no pin, e não o editor inteiro. No instante
   * da criação a única coisa OBRIGATÓRIA é o destino: o nome tem reserva (o
   * número do ponto) e a exclusão vive no painel e na lista. Abrir um
   * formulário completo ali cobria metade da tela no mobile — e, se o toque
   * tivesse sido na metade de baixo da foto, cobria o próprio ponto que se
   * acabou de criar. Nomear às cegas o ponto que você não está vendo.
   */
  readonly picker = signal<string | null>(null);

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
      v: clampV(v),
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
    // Fecha o editor só se o ponto excluído for o que estava aberto. Sem a
    // comparação, largar OUTRO ponto na lixeira descartava a edição em
    // andamento deste, sem explicação nenhuma.
    const aberto = this.sheet();
    if (aberto?.mode === 'editor' && aberto.hotspotId === id) this.closeSheet();
    // Mesma regra para o seletor: ele fica ancorado no pin, e o pin acabou de
    // sumir da foto.
    if (this.picker() === id) this.picker.set(null);
  }

  // ---- sheet -------------------------------------------------------------

  // Sheet e seletor são excludentes: os dois pedem a mesma decisão, e abertos
  // juntos disputariam o mesmo toque. Quem abre um fecha o outro.

  openEditor(hotspotId: string): void {
    this.picker.set(null);
    this.sheet.set({ mode: 'editor', hotspotId });
  }

  openList(): void {
    this.picker.set(null);
    this.sheet.set({ mode: 'list' });
  }

  closeSheet(): void {
    this.sheet.set(null);
  }

  // ---- seletor de destino ------------------------------------------------

  openPicker(hotspotId: string): void {
    this.sheet.set(null);
    this.picker.set(hotspotId);
  }

  closePicker(): void {
    this.picker.set(null);
  }

  /** Escolheu o destino: grava e fecha. É o gesto inteiro numa chamada. */
  pickTarget(hotspotId: string, target: string): void {
    this.update(hotspotId, { target });
    this.picker.set(null);
  }

  // ---- arraste (B9) ------------------------------------------------------

  /**
   * O ponto passou a seguir o dedo. Quem reconhece o gesto é o overlay, que é
   * quem sabe onde os pins estão na tela; aqui só se guarda que há um arraste
   * em curso, para a lixeira (B10) e o estilo do pin saberem.
   */
  startDrag(hotspotId: string): void {
    // O seletor está grudado num pin que agora vai andar pela tela. Ele
    // reabre com um toque no ponto, e não vale a pena persegui-lo.
    this.picker.set(null);
    this.pinDrag.set({ hotspotId, overTrash: false });
  }

  /**
   * Move o ponto em arraste para um par `(u, v)` do panorama.
   *
   * Só o eixo VERTICAL é limitado, e isso é uma divergência consciente do plano
   * (que pede 2–98% em X também). `u` dá a volta: 0 e 1 são o mesmo meridiano,
   * a costura da foto. Limitá-lo criaria uma faixa morta bem ali — e uma
   * incoerência, porque o clique que CRIA um ponto não tem limite nenhum, então
   * daria para criar em u=0,99 e nunca mais arrastar de volta para lá.
   *
   * O limite em `v` é outra história: 0 e 1 são os polos, onde o equirretangular
   * está infinitamente esticado e todos os `u` colapsam no mesmo pixel. Um ponto
   * de navegação ali não aponta para lugar nenhum.
   */
  dragTo(u: number, v: number): void {
    const drag = this.pinDrag();
    if (!drag) return;
    this.update(drag.hotspotId, { u, v: clampV(v) });
  }

  /**
   * O dedo entrou ou saiu do alvo da lixeira (B10). Quem mede é a etapa, que
   * tem o retângulo do alvo; aqui só se guarda, para o alvo saber que estado
   * desenhar.
   */
  setOverTrash(over: boolean): void {
    const drag = this.pinDrag();
    if (!drag || drag.overTrash === over) return;
    this.pinDrag.set({ ...drag, overTrash: over });
  }

  /**
   * Solta o ponto. Sobre a lixeira, exclui.
   *
   * A decisão mora aqui, e não na etapa, porque este é o único lugar que muta
   * hotspot — e porque "soltar" e "soltar na lixeira" são o mesmo gesto com
   * dois fins: separá-los em dois métodos deixaria o chamador escolher o
   * errado.
   */
  endDrag(): void {
    const drag = this.pinDrag();
    this.pinDrag.set(null);
    if (drag?.overTrash) this.remove(drag.hotspotId);
  }
}
