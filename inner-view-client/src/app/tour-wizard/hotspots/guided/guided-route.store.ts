import { Injectable, computed, inject, signal } from '@angular/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import {
  GuidedStep,
  cicloFechado,
  estadoDosDots,
  passoDoRoteiro,
  primeiroPassoIncompleto,
} from './guided-route';

/**
 * Os comandos do assistente guiado.
 *
 * Não muta hotspot: escreve pelo `HotspotEditorStore`, o mesmo do editor livre.
 * Duplicar a regra de mutação criaria duas versões da mesma verdade, e este
 * projeto já pagou uma vez por isso — ver o eixo espelhado do `addHotspots`,
 * documentado em `scene-graph.ts`.
 */
@Injectable()
export class GuidedRouteStore {
  private readonly draft = inject(TourDraftStore);
  private readonly editor = inject(HotspotEditorStore);

  readonly cenas = computed(() => this.draft.readyScenes());

  /**
   * O passo atual é DERIVADO da cena selecionada, e não um `wizardIndex`
   * próprio. Com dois estados, um dia eles discordariam e a tela mostraria a
   * foto da Cozinha sob a instrução do Quarto. Avançar de passo É trocar a cena.
   */
  readonly indice = computed(() => {
    const id = this.draft.selectedSceneId();
    return this.cenas().findIndex((s) => s.id === id);
  });

  readonly passo = computed<GuidedStep | null>(() =>
    passoDoRoteiro(this.cenas(), this.indice()),
  );

  readonly dots = computed(() => estadoDosDots(this.cenas(), this.indice()));
  readonly fechado = computed(() => cicloFechado(this.cenas()));
  readonly disponivel = computed(() => this.cenas().length >= 2);

  /**
   * A gaveta está mostrando o diagrama do ciclo, e não o passo.
   *
   * Precisa ser estado, e não `fechado()` direto: assim que o percurso fecha,
   * `fechado()` fica verdadeiro para sempre — e "Editar conexões" voltaria ao
   * passo 1 com o diagrama ainda na tela, sem jeito de sair dele.
   */
  readonly resumo = signal(false);

  /**
   * Marca a passagem deste passo onde o corretor tocou.
   *
   * Com passagem existente, MOVE. O gesto é "corrigir onde eu marquei", não
   * "marcar de novo" — criar um segundo ponto deixaria duas passagens para o
   * mesmo lugar na mesma foto, e a de baixo ficaria invisível.
   *
   * O destino é derivado da sequência, nunca perguntado: é isso que elimina o
   * segundo gesto que o editor livre exige. E precisa ser gravado de verdade —
   * `toCreateTourPayload` descarta ponto sem destino.
   */
  marcar(u: number, v: number): void {
    const passo = this.passo();
    if (!passo) return;

    if (passo.hotspot) {
      this.editor.update(passo.hotspot.id, { u, v });
      return;
    }

    const id = this.editor.add(u, v);
    if (id) this.editor.update(id, { target: passo.target.id });
  }

  /**
   * Apaga só a passagem deste passo.
   *
   * Os outros pontos do ambiente — marcados no editor livre, levando a outro
   * lugar — não são desta passagem e ficam. "Refazer" refaz este passo, não
   * limpa o ambiente.
   */
  refazer(): void {
    const hotspot = this.passo()?.hotspot;
    if (hotspot) this.editor.remove(hotspot.id);
  }

  /**
   * Avança. Trocar de passo é trocar a cena selecionada, e o índice acompanha.
   *
   * O resumo só volta ao confirmar o ÚLTIMO passo. Sem essa condição, quem
   * clicou em "Editar conexões" para revisar um percurso já fechado veria o
   * diagrama reaparecer no primeiro Confirmar, sem ter chegado ao fim.
   */
  confirmar(): void {
    const passo = this.passo();
    if (!passo?.hotspot) return;

    this.draft.selectScene(passo.target.id);
    if (passo.isLast && cicloFechado(this.cenas())) this.resumo.set(true);
  }

  /**
   * Entrada no assistente: abre no primeiro passo incompleto.
   *
   * Quem já ligou metade no editor livre não deve ter de confirmar de novo o
   * que já está feito; quem já ligou tudo cai direto no diagrama.
   */
  abrir(): void {
    if (!this.disponivel()) return;

    const i = primeiroPassoIncompleto(this.cenas());
    if (i < 0) {
      this.resumo.set(true);
      return;
    }

    this.resumo.set(false);
    this.draft.selectScene(this.cenas()[i].id);
  }

  /** "Editar conexões": sai do diagrama e volta ao passo 1. */
  voltarAoInicio(): void {
    const primeira = this.cenas()[0];
    if (!primeira) return;

    this.resumo.set(false);
    this.draft.selectScene(primeira.id);
  }
}
