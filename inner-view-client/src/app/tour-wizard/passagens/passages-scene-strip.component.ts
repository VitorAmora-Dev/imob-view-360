import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Um cômodo, do jeito que a faixa precisa dele. */
export interface CenaDaFaixa {
  id: string;
  nome: string;
  /** `blob:` da miniatura, ou vazio enquanto ela não chegou. */
  thumb: string;
}

/**
 * A faixa de cenas da revisão da etapa 3 — a mesma da tela de visualização.
 *
 * POR QUE ELA EXISTE, já que o visualizador tem `TourScenesStripComponent`:
 * aquele componente INJETA o `TourViewerStore`, de propósito e com o motivo
 * escrito no docstring dele ("esta faixa existe somente no visualizador"). O
 * wizard não tem esse store — tem o `TourDraftStore`, com outro vocabulário —,
 * e três das seis coisas que aquele componente lê de lá não existem aqui: o
 * sheet "Ver todas", o rail recolhível do desktop e a preferência por tour em
 * `sessionStorage`.
 *
 * Então esta é PRESENTACIONAL: recebe as cenas e a atual, devolve a escolhida,
 * e não conhece store nenhum. O que ela compartilha com a faixa do visualizador
 * são os TOKENS — `--tv-*`, que o `angular.json` carrega para o app inteiro —,
 * e é isso que faz as duas terem a mesma cara sem terem o mesmo código.
 *
 * Unificar as duas é ticket próprio, e o caminho é extrair a apresentação
 * daquela para um componente como este e deixar o do visualizador como a casca
 * que fala com o store.
 *
 * A acessibilidade é a mesma da TV-12: `tablist` com foco itinerante, setas e
 * Home/End. Ativação AUTOMÁTICA como lá — a seta já troca de cena —, e aqui a
 * troca é barata de verdade: as fotos da revisão já estão todas em memória
 * (`tourPronto()` é a condição para a revisão montar).
 */
@Component({
  selector: 'app-passages-scene-strip',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './passages-scene-strip.component.html',
  styleUrls: ['./passages-scene-strip.component.scss'],
})
export class PassagesSceneStripComponent {
  readonly cenas = input<CenaDaFaixa[]>([]);

  /** A cena cuja FOTO está na tela — não a que acabou de ser pedida. */
  readonly atualId = input<string | null>(null);

  readonly escolhida = output<string>();

  escolher(cena: CenaDaFaixa): void {
    this.escolhida.emit(cena.id);
  }

  /**
   * Setas percorrem as cenas, Home/End chegam aos extremos, e o foco acompanha.
   *
   * Cópia deliberada do `aoTeclar` da faixa do visualizador: enquanto os dois
   * componentes existirem, o teclado tem de se comportar igual nos dois — é
   * mais uma razão para o ticket de unificação.
   */
  aoTeclar(evento: KeyboardEvent, indiceAtual: number): void {
    const total = this.cenas().length;
    if (!total) return;

    let destino: number | null = null;
    if (evento.key === 'ArrowRight') destino = (indiceAtual + 1) % total;
    if (evento.key === 'ArrowLeft') destino = (indiceAtual - 1 + total) % total;
    if (evento.key === 'Home') destino = 0;
    if (evento.key === 'End') destino = total - 1;
    if (destino === null) return;

    evento.preventDefault();
    this.escolher(this.cenas()[destino]);

    const trilho = (evento.currentTarget as HTMLElement).closest('[role="tablist"]');
    trilho?.querySelectorAll<HTMLElement>('[role="tab"]')[destino]?.focus();
  }
}
