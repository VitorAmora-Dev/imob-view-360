import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { EMBED_FORMATOS, EmbedFormat } from '../../tour-viewer.model';
import { TourViewerStore } from '../../tour-viewer.store';

/**
 * O miolo da aba "Incorporar" do sheet Compartilhar.
 *
 * Era o sheet inteiro da TV-4. A reorganização dos menus tirou "Embed" da barra
 * inferior e o transformou na SEGUNDA aba de Compartilhar — então o que era o
 * consumidor do `TourSheetComponent` virou conteúdo projetado dentro de outro
 * consumidor, e a moldura (`<app-tour-sheet>`, título, paradas, rodapé) mudou de
 * dono. O corpo — formatos, bloco de código e interruptor — atravessou intacto,
 * com o teste dele junto.
 *
 * Continua sem estado próprio: formato e "mostrar controles" moram no
 * `TourViewerStore`, e o código vem de `pedacosDoEmbed()`, que é o MESMO sinal
 * que o botão "Copiar código" do rodapé lê. Um segundo lugar montando o
 * `<iframe>` daria duas respostas para "qual código está na tela".
 */
@Component({
  selector: 'app-tour-embed-panel',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './tour-embed-panel.component.html',
  styleUrls: ['./tour-embed-panel.component.scss'],
})
export class TourEmbedPanelComponent {
  private readonly store = inject(TourViewerStore);

  readonly formatos = EMBED_FORMATOS;
  readonly formatoAtual = this.store.embedFormat;
  readonly mostrarControles = this.store.embedShowControls;

  /** Os mesmos trechos que o rodapé do sheet copia. Ver `pedacosDoIframe()`. */
  readonly pedacos = this.store.pedacosDoEmbed;

  /**
   * O `$index` do `@for` é `number`; o store guarda `EmbedFormat`.
   *
   * A guarda não é cerimônia de tipo: é o que impede um índice fora da tabela
   * de virar `EMBED_FORMATOS[3]`, e daí um `undefined.width` dentro do
   * `computed` — erro em tempo de execução no meio do template.
   */
  escolherFormato(indice: number): void {
    if (indice < 0 || indice >= EMBED_FORMATOS.length) return;
    this.store.embedFormat.set(indice as EmbedFormat);
  }

  alternarControles(): void {
    this.store.embedShowControls.update((ligado) => !ligado);
  }
}
