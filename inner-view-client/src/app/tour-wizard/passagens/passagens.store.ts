import { Injectable, computed, inject, signal } from '@angular/core';
import { HotspotEditorStore } from '../hotspot-editor.store';
import { TourDraftStore } from '../tour-draft.store';
import {
  Passagem,
  filaDePassagens,
  pendentesDoAmbiente,
  primeiraPendente,
} from './fila';

/**
 * O ponteiro da fila de passagens, e os comandos que a percorrem.
 *
 * Não muta hotspot: escreve pelo `HotspotEditorStore`, o mesmo do editor livre.
 *
 * O ponteiro é o ÍNDICE NA FILA, e a cena selecionada é consequência dele —
 * invertendo o que o assistente anterior fazia. Lá a cena identificava o passo;
 * aqui vários passos dividem a mesma foto, e ela não identifica mais nada.
 */
@Injectable()
export class PassagensStore {
  private readonly draft = inject(TourDraftStore);
  private readonly editor = inject(HotspotEditorStore);

  private readonly i = signal(0);

  readonly fila = computed<Passagem[]>(() =>
    filaDePassagens(this.draft.scenes()),
  );

  readonly indice = computed(() => this.i());
  readonly atual = computed<Passagem | null>(() => this.fila()[this.i()] ?? null);
  readonly total = computed(() => this.fila().length);

  /** Quantas já foram feitas — o indicador de progresso do painel. */
  readonly feitas = computed(() => this.fila().filter((p) => p.feita).length);

  readonly acabou = computed(() => primeiraPendente(this.fila()) === -1);

  /** As outras pendentes da mesma foto: a lista do painel inferior. */
  readonly pendentes = computed(() => pendentesDoAmbiente(this.fila(), this.i()));

  /**
   * Move o ponteiro E a cena selecionada, juntos, sempre.
   *
   * É o único caminho que mexe no ponteiro, e existe por um defeito concreto:
   * `HotspotEditorStore.add()` e `.update()` escrevem na cena de
   * `draft.selectedSceneId()`, **não** numa cena passada por parâmetro. Um
   * avanço que esquecesse de sincronizar gravaria o ponto na FOTO ERRADA, sem
   * erro nenhum e sem nada na tela denunciando.
   */
  private irPara(indice: number): void {
    this.i.set(indice);
    const passagem = this.fila()[indice];
    if (passagem) this.draft.selectScene(passagem.origem.id);
  }

  /** Entrada na etapa: abre na primeira passagem que ainda não tem ponto. */
  abrir(): void {
    const proxima = primeiraPendente(this.fila());
    this.irPara(proxima >= 0 ? proxima : 0);
  }

  /**
   * Marca a passagem atual onde o corretor tocou.
   *
   * Com ponto existente, MOVE. O gesto é "corrigir onde eu marquei", não
   * "marcar de novo" — dois pontos para o mesmo destino na mesma foto deixariam
   * o de baixo invisível.
   */
  marcar(u: number, v: number): void {
    const passagem = this.atual();
    if (!passagem) return;

    const existente = passagem.origem.hotspots.find(
      (h) => h.target === passagem.destino.id,
    );
    if (existente) {
      this.editor.update(existente.id, { u, v });
      return;
    }

    const id = this.editor.add(u, v);
    if (id) this.editor.update(id, { target: passagem.destino.id });
  }

  /**
   * Apaga só o ponto da passagem atual.
   *
   * Os outros pontos do ambiente — das outras passagens, ou do editor livre —
   * não são desta e ficam.
   */
  refazer(): void {
    const passagem = this.atual();
    if (!passagem) return;

    const alvo = passagem.origem.hotspots.find(
      (h) => h.target === passagem.destino.id,
    );
    if (alvo) this.editor.remove(alvo.id);
  }

  /**
   * Confirma e anda para a próxima pendente.
   *
   * A próxima costuma ser a seguinte no índice, e aí o corretor permanece na
   * mesma foto — que é o que o pedido descreve. Quando os destinos daquele
   * ambiente acabam, a próxima pendente já é de outra foto, e `irPara`
   * sincroniza a cena.
   */
  confirmar(): void {
    const passagem = this.atual();
    if (!passagem?.feita) return;

    const proxima = primeiraPendente(this.fila());
    if (proxima >= 0) this.irPara(proxima);
  }
}
