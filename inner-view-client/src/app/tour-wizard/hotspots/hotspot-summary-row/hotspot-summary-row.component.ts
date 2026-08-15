import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';

/**
 * Linha-resumo dos pontos, no mobile (tarefa B7).
 *
 * DONO: Frente B.
 *
 * No desktop a lista inteira fica ao lado da foto; no celular não há largura
 * para isso, e empilhar os cards embaixo empurraria a barra de ação para fora
 * da dobra. Sobra uma linha só, que responde à pergunta "o que já marquei
 * aqui?" e abre a lista completa quando a resposta não basta.
 */
@Component({
  selector: 'app-hotspot-summary-row',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './hotspot-summary-row.component.html',
  styleUrls: ['./hotspot-summary-row.component.scss'],
})
export class HotspotSummaryRowComponent {
  readonly editor = inject(HotspotEditorStore);

  readonly count = computed(() => this.editor.hotspots().length);

  /**
   * Nomes unidos por " · ", como o handoff pede.
   *
   * Ponto sem nome entra como o próprio número — some da linha seria pior:
   * o contador diria "3" e a lista mostraria dois, e a diferença ficaria sem
   * explicação.
   */
  readonly names = computed(() =>
    this.editor
      .hotspots()
      .map((h, i) => h.label.trim() || String(i + 1))
      .join(' · '),
  );
}
