import { Component, computed, effect, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Card "Resumo do tour" da etapa 3.
 *
 * DONO: Frente A (tarefa A10).
 *
 * Existe para o corretor confirmar o que está prestes a publicar sem voltar
 * duas etapas. É por isso que a contagem de hotspots é a soma de TODOS os
 * ambientes, e não a do que estava aberto na etapa 2: aqui a pergunta é
 * "o tour está pronto?", não "este ambiente está pronto?".
 */
@Component({
  selector: 'app-tour-summary',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './tour-summary.component.html',
  styleUrls: ['./tour-summary.component.scss'],
})
export class TourSummaryComponent {
  readonly store = inject(TourDraftStore);

  constructor() {
    /**
     * Pede a miniatura da capa quando ela ainda não tem foto em memória.
     *
     * Cena retomada chega com `imageData` vazio de propósito — ver o campo em
     * `tour-wizard.model.ts`. Sem isto, ninguém pede a foto da capa nesta tela:
     * a etapa 1 pede a dos seus cards e a de passagens a do cômodo à vista, e
     * a capa pode não ser nenhum dos dois.
     *
     * `garantirMiniatura` e não `garantirImagem`: aqui se desenha um retângulo
     * 16:10 de largura de cartão, e a segunda baixaria a equirretangular
     * inteira — dezenas de MB para ilustrar um resumo.
     */
    effect(() => {
      const capa = this.store.coverScene();
      if (!capa || this.coverUrl()) return;
      void this.store.garantirMiniatura(capa.id);
    });
  }

  /**
   * Fonte da capa: a tratada quando existe, senão a foto original, senão a
   * miniatura baixada para a cena retomada. Mesma cadeia de
   * `scene-card.thumbUrl` e `scene-rail.thumbUrl`.
   *
   * Lia `imageData` direto, e numa cena retomada esse campo é vazio: o
   * retângulo saía hachurado como "sem imagem" — e sai justamente na ÚLTIMA
   * tela antes de publicar, onde o corretor confere o que está prestes a
   * mandar para o cliente. É o terceiro lugar da mesma família; as duas
   * primeiras foram corrigidas antes e esta passou batida.
   *
   * `null` e não `''` quando não há nada: o template distingue os dois
   * estados, e `url('')` desenha ícone de imagem quebrada.
   */
  readonly coverUrl = computed(() => {
    const capa = this.store.coverScene();
    if (!capa) return null;
    return (
      capa.treatedImageUrl ?? (capa.imageData || this.store.miniatura(capa.id))
    ) || null;
  });

  readonly coverName = computed(() => this.store.coverScene()?.room?.trim() || null);

  readonly roomsKey = computed(() =>
    this.store.readyScenes().length === 1
      ? 'TOUR_WIZARD.STEP1.SCENES_COUNT_ONE'
      : 'TOUR_WIZARD.STEP1.SCENES_COUNT',
  );
}
