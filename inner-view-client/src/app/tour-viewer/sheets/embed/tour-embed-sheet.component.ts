import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { TourSheetComponent } from '../../../components/tour-sheet/tour-sheet.component';
import { EMBED_FORMATOS, EmbedFormat } from '../../tour-viewer.model';
import { TourViewerStore } from '../../tour-viewer.store';

/** Um trecho do código, já com a classe que o pinta. Ver `pedacos`. */
interface PedacoDoCodigo {
  texto: string;
  classe: string;
}

/**
 * Altura do sheet Incorporar.
 *
 * Mais alto que o padrão `[0, 0.55]` do shell porque o conteúdo é mais alto:
 * descrição, seletor de formato, bloco de código e o interruptor, com dois
 * botões no rodapé. Na parada de fábrica o bloco de código já nascia cortado, e
 * a área rolável escondia justamente o que a pessoa veio copiar.
 *
 * O `0` da primeira posição é o que permite arrastar até fechar; quem mexer
 * nesta lista precisa mantê-lo.
 */
const PARADAS = [0, 0.62];

/**
 * O sheet "Incorporar tour" (TV-4, `04-sheets.md` §2).
 *
 * Não guarda estado nenhum: formato escolhido e "mostrar controles" moram no
 * `TourViewerStore`, e o link sai de `linkPublico()`, que é o mesmo que o
 * "Compartilhar link" do TV-6 vai usar. Um segundo lugar guardando o formato
 * daria duas respostas para "qual código está na tela".
 */
@Component({
  selector: 'app-tour-embed-sheet',
  standalone: true,
  imports: [TourSheetComponent, TranslatePipe],
  templateUrl: './tour-embed-sheet.component.html',
  styleUrls: ['./tour-embed-sheet.component.scss'],
})
export class TourEmbedSheetComponent {
  private readonly store = inject(TourViewerStore);

  readonly paradas = PARADAS;
  readonly formatos = EMBED_FORMATOS;

  /**
   * `sheet() === 'embed'` e não um booleano próprio: um sheet por vez é
   * invariante do store, e é ele que fecha este ao abrir outro.
   */
  readonly aberto = computed(() => this.store.sheet() === 'embed');

  readonly formatoAtual = this.store.embedFormat;
  readonly mostrarControles = this.store.embedShowControls;
  readonly link = this.store.linkPublico;

  /**
   * O `<iframe>` fatiado em trechos coloridos — e a ÚNICA descrição dele.
   *
   * O código que se lê e o código que se copia saem daqui, e é a única defesa
   * possível contra o defeito clássico deste sheet: o destaque de sintaxe do
   * template e a string do clipboard divergirem, e a pessoa colar no site um
   * `<iframe>` diferente do que leu na tela.
   *
   * O espaço que separa os atributos entra no TEXTO do trecho, e não como
   * espaço entre elementos no template. O Angular remove nós de texto só de
   * espaço em branco (é o `preserveWhitespaces: false` padrão), então o que
   * ficasse no HTML sumiria na compilação e o código sairia grudado.
   *
   * Fatiado aqui e não montado com `<span>` numa string para `[innerHTML]`:
   * aquilo ligaria o sanitizador do Angular a um texto que contém o link do
   * tour — mais trabalho por menos garantia.
   */
  readonly pedacos = computed<PedacoDoCodigo[]>(() => {
    const formato = EMBED_FORMATOS[this.formatoAtual()];
    const atributos: ReadonlyArray<[string, string | null]> = [
      ['src', this.link()],
      ['width', formato.width],
      ['height', formato.height],
      ['frameborder', '0'],
      // Atributo booleano: existe sem valor, e o `null` é o que diz isso.
      ['allowfullscreen', null],
    ];

    const pedacos: PedacoDoCodigo[] = [{ texto: '<iframe', classe: 'tv-embed__tag' }];

    for (const [nome, valor] of atributos) {
      pedacos.push({ texto: ` ${nome}`, classe: 'tv-embed__attr' });
      if (valor !== null) {
        pedacos.push({ texto: `="${valor}"`, classe: 'tv-embed__valor' });
      }
    }

    pedacos.push({ texto: '></iframe>', classe: 'tv-embed__tag' });
    return pedacos;
  });

  /** O que vai para a área de transferência: os mesmos trechos, emendados. */
  readonly codigo = computed(() => this.pedacos().map((p) => p.texto).join(''));

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

  /**
   * Copiar NÃO fecha o sheet.
   *
   * Copiar não é escolher: quem copia o código com frequência copia o link em
   * seguida, e fechar aqui obrigaria a reabrir o sheet e reescolher o formato
   * para pegar a segunda metade.
   *
   * A falha é anunciada em vez de engolida. Dizer "Código copiado" quando a
   * permissão de área de transferência foi negada é pior que ficar calado — e
   * ficar calado deixa a pessoa colando o conteúdo antigo sem saber. O texto
   * continua na tela e selecionável, e é isso que o toast manda fazer.
   */
  async copiar(texto: string, chaveDeSucesso: string): Promise<void> {
    if (!texto) return;

    try {
      await navigator.clipboard.writeText(texto);
      this.store.mostrarToast(chaveDeSucesso);
    } catch {
      this.store.mostrarToast('TOUR_VIEWER.TOAST.COPY_ERROR');
    }
  }

  fechar(): void {
    this.store.fecharSheet();
  }
}
