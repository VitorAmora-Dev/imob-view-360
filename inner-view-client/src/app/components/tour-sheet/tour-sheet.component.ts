import { Component, computed, effect, input, output, signal } from '@angular/core';
import { IonModal } from '@ionic/angular/standalone';

import { emViewportMobile } from './media';

/**
 * Paradas PADRÃO do bottom sheet. O `0` é o que permite arrastar até fechar.
 *
 * Exportadas, e não embutidas na declaração do input, porque um consumidor que
 * queira só ACRESCENTAR uma parada precisa saber quais são as de fábrica sem
 * copiar números soltos para o próprio arquivo.
 */
export const TOUR_SHEET_BREAKPOINTS = [0, 0.55];
export const TOUR_SHEET_INICIAL = 0.55;

/**
 * O shell de bottom sheet do visualizador.
 *
 * Puramente visual: não sabe quais sheets existem nem o que cada um faz. Quem
 * decide qual está aberto é o `TourSheetStore`, e quem monta o conteúdo é cada
 * consumidor, por projeção. É o que faz TV-4, TV-5 e TV-6 serem arquivos novos
 * que não editam este.
 *
 * `IonModal` em vez de um painel à mão: arrastar para baixo, prender o foco,
 * fechar no Esc, devolver o foco a quem abriu e a animação de entrada vêm
 * prontos. Escrever isso de novo seria reescrever um trap de foco, que é onde
 * a a11y costuma morrer.
 *
 * A API foi fechada contra os QUATRO consumidores do sprint, não só contra o
 * primeiro — duas suposições caíram nesse exercício e estão registradas na
 * spec: "sheet fecha ao escolher" é regra do Cenas (TV-4 diz o contrário com
 * todas as letras), e "sheet é sempre bottom sheet" também não (TV-5 pede
 * diálogo centralizado no desktop).
 */
@Component({
  selector: 'app-tour-sheet',
  standalone: true,
  imports: [IonModal],
  templateUrl: './tour-sheet.component.html',
  styleUrls: ['./tour-sheet.component.scss'],
})
export class TourSheetComponent {
  readonly isOpen = input(false);
  readonly titulo = input('');
  readonly subtitulo = input<string | null>(null);

  /**
   * `sheet` — bottom sheet em qualquer largura.
   * `adaptavel` — bottom sheet no celular, modal centrado de 480px no desktop.
   */
  readonly variante = input<'sheet' | 'adaptavel'>('sheet');

  /**
   * Recusa os três gestos de fechamento. Alimenta o `canDismiss` do Ionic, e
   * não o `backdropDismiss`: travar só o scrim deixaria o Esc e o arrasto
   * ativos, e quem pede isto (TV-5, estado "Apagando...") é justamente o caso
   * em que fechar no meio da requisição deixa a tela em estado ambíguo.
   */
  readonly travado = input(false);

  /**
   * As paradas do sheet, configuráveis PELO CONSUMIDOR.
   *
   * POR QUE não é constante do shell: a altura útil é propriedade do conteúdo,
   * e só quem monta o conteúdo a conhece. O Cenas trava a grade em 340px, então
   * uma parada alta mostraria sheet vazio abaixo do conteúdo — daí o default
   * `[0, 0.55]`, com uma parada útil só. Mas o TV-6 é uma lista que cresce sem
   * teto e precisa de outra altura, como o `HotspotSheet` (`[0, 0.5, 0.9]`) já
   * precisa hoje. Se o valor ficasse fixo aqui, TV-6 abriria este arquivo para
   * mudá-lo — exatamente o que a spec diz que TV-4/5/6 não devem precisar
   * fazer ("arquivos novos que não editam nem o shell nem o store").
   *
   * O `0` da primeira posição é o que permite arrastar para baixo até fechar;
   * quem sobrescrever precisa mantê-lo, senão o arrasto deixa de ser gesto de
   * fechamento.
   */
  readonly breakpoints = input<number[]>(TOUR_SHEET_BREAKPOINTS);

  /** A parada em que o sheet abre. Configurável pelo mesmo motivo acima. */
  readonly initialBreakpoint = input<number>(TOUR_SHEET_INICIAL);

  readonly fechado = output<void>();

  private readonly mobile = emViewportMobile();

  /** O nó do diálogo, que vive no shadow DOM do Ionic. Ver `nomearDialogo`. */
  private readonly dialogo = signal<Element | null>(null);

  /** Verdadeiro quando o Ionic deve desenhar um modal centrado, não um sheet. */
  readonly centrado = computed(() => this.variante() === 'adaptavel' && !this.mobile());

  /**
   * `undefined` quando centrado: é a AUSÊNCIA de `breakpoints` que faz o Ionic
   * desenhar um modal centralizado em vez de um sheet. O grabber some junto,
   * sozinho — que é o certo, não há o que arrastar num diálogo centralizado.
   */
  readonly breakpointsAtivos = computed(() =>
    this.centrado() ? undefined : this.breakpoints(),
  );

  readonly initialBreakpointAtivo = computed(() =>
    this.centrado() ? undefined : this.initialBreakpoint(),
  );

  constructor() {
    // Mantém o nome em dia se o título mudar com o sheet já aberto.
    effect(() => {
      const alvo = this.dialogo();
      if (alvo) alvo.setAttribute('aria-label', this.titulo());
    });
  }

  /**
   * Dá nome ao diálogo.
   *
   * `aria-labelledby` NÃO resolve, e a spec registra isso como correção ao
   * ticket: o nó do diálogo vive no shadow DOM do Ionic e o `<h2>` vive na
   * luz. IDREF não atravessa fronteira de shadow. Nomear o host também não
   * adianta — ele é um nó genérico, e o diálogo continua anônimo.
   *
   * Sobra o `aria-label` literal no wrapper. Sem ele o leitor de tela anuncia
   * "diálogo" e mais nada.
   *
   * Escrito já aqui, além do `effect` do construtor: o `effect` só corre na
   * próxima detecção de mudanças, e o foco entra no diálogo no instante do
   * `didPresent`. Um frame de diálogo anônimo é justamente o frame que o
   * leitor lê.
   *
   * Se o Ionic renomear `.modal-wrapper`, o nome some em silêncio — nada
   * quebra visualmente, e é o teste de a11y que denuncia.
   */
  nomearDialogo(event: Event): void {
    const modal = event.target as HTMLElement;
    const wrapper = modal.shadowRoot?.querySelector('.modal-wrapper') ?? null;
    wrapper?.setAttribute('aria-label', this.titulo());
    this.dialogo.set(wrapper);
  }
}
