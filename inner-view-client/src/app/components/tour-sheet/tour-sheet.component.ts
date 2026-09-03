import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { IonModal } from '@ionic/angular/standalone';

import { emViewportMobile } from './media';

/**
 * Paradas PADRÃO do bottom sheet. O `0` é o que permite arrastar até fechar.
 *
 * Exportadas, e não embutidas na declaração do input, porque um consumidor que
 * queira só ACRESCENTAR uma parada precisa saber quais são as de fábrica sem
 * copiar números soltos para o próprio arquivo.
 *
 * `readonly` de propósito: o Ionic ORDENA in place o array que recebe em
 * `breakpoints`. Como esta constante é a origem do default de todas as
 * instâncias, um `sort` (ou um `push` de consumidor descuidado) aqui vazaria
 * para todo mundo. Com `[0, 0.55]` já ordenado nada acontece hoje; o tipo é o
 * que impede a próxima parada, acrescentada fora de ordem, de virar bug
 * compartilhado. (`Object.freeze` não serve: `sort` em array congelado lança.)
 */
export const TOUR_SHEET_BREAKPOINTS: readonly number[] = [0, 0.55];
export const TOUR_SHEET_INICIAL = 0.55;

/**
 * A classe do nó que carrega o `role="dialog"` dentro do shadow DOM do Ionic.
 *
 * Constante, e não string solta no meio do método: é detalhe PRIVADO do Ionic,
 * e no dia em que ele renomear a classe nada quebra visualmente — só o nome
 * acessível some. `hotspot-sheet.component.ts` tem esta mesma string, palavra
 * por palavra; migrá-lo para cá é ticket próprio (a spec deste proíbe tocar
 * nele agora), e uma busca por `SELETOR_WRAPPER_IONIC` acha os dois lados.
 */
export const SELETOR_WRAPPER_IONIC = '.modal-wrapper';

/**
 * O shell de bottom sheet do visualizador.
 *
 * Puramente visual: não sabe quais sheets existem nem o que cada um faz. Quem
 * decide qual está aberto é a tela (no visualizador, `TourViewerStore.sheet`),
 * e quem monta o conteúdo é cada
 * consumidor, por projeção. É o que faz TV-4, TV-5 e TV-6 serem arquivos novos
 * que não editam este.
 *
 * `IonModal` em vez de um painel à mão: arrastar para baixo, prender o foco,
 * fechar no Esc, devolver o foco a quem abriu e a animação de entrada vêm
 * prontos. Escrever isso de novo seria reescrever um trap de foco, que é onde
 * a a11y costuma morrer.
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
   * Recusa os três GESTOS de fechamento — e só eles.
   *
   * Alimenta o `canDismiss` do Ionic, e não o `backdropDismiss`: travar só o
   * scrim deixaria o Esc e o arrasto ativos, e quem pede isto (TV-5, estado
   * "Apagando...") é justamente o caso em que fechar no meio da requisição
   * deixa a tela em estado ambíguo.
   *
   * O que ele NÃO trava é o fechamento programático, e isso é deliberado: o
   * Ionic consulta `canDismiss` dentro de `dismiss()` para QUALQUER papel, de
   * modo que um booleano em `false` vetaria também o consumidor mandando
   * fechar. É o caminho de erro do TV-5 — a requisição falha, o consumidor
   * mostra o toast e chama `fechar()` sem baixar `apagando` no mesmo tick — e
   * ali o sheet ficaria na tela com o Angular achando que `isOpen` é `false`.
   * Como o watcher do Ionic só reage a `true → false`, mandar fechar de novo
   * também não resolveria. Ver `podeFechar`.
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
   *
   * A CÓPIA do default não é enfeite: o Ionic ordena in place o array que
   * recebe, e o inicializador de campo corre uma vez POR INSTÂNCIA — assim
   * cada sheet mexe no próprio array, e nunca no de `TOUR_SHEET_BREAKPOINTS`.
   */
  readonly breakpoints = input<number[]>([...TOUR_SHEET_BREAKPOINTS]);

  /** A parada em que o sheet abre. Configurável pelo mesmo motivo acima. */
  readonly initialBreakpoint = input<number>(TOUR_SHEET_INICIAL);

  readonly fechado = output<void>();

  private readonly destroyRef = inject(DestroyRef);

  /** O `IonModal` do template, para poder mandá-lo fechar por fora do gesto. */
  private readonly modal = viewChild(IonModal);

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

  /**
   * O `canDismiss` do Ionic, em forma de FUNÇÃO.
   *
   * O booleano não serve porque o Ionic consulta `canDismiss` dentro de
   * `dismiss()` para qualquer papel: `false` recusaria também o consumidor
   * mandando fechar (ver `travado`). Em forma de função dá para olhar o papel,
   * e ele separa os dois mundos — os três gestos chegam com `'backdrop'`
   * (scrim e Esc) ou `'gesture'`, e o fechamento programático chega com papel
   * `undefined`.
   *
   * Campo, e não método: o valor precisa ser a MESMA referência entre
   * detecções de mudança, senão o Angular reescreveria a propriedade do
   * elemento a cada ciclo. Ele continua reagindo a `travado` porque lê o sinal
   * na hora da chamada, não na hora da ligação.
   */
  readonly podeFechar = (_dado?: unknown, papel?: string): boolean =>
    papel === undefined || !this.travado();

  /**
   * O último valor de `centrado()` já visto. `undefined` só na primeira
   * execução do effect, que é justamente a que não deve fechar nada.
   */
  private centradoAnterior: boolean | undefined;

  constructor() {
    // Mantém o nome em dia se o título mudar com o sheet já aberto.
    effect(() => {
      const alvo = this.dialogo();
      if (alvo) alvo.setAttribute('aria-label', this.titulo());
    });

    // Trocar a FORMA com o modal vivo deixa um híbrido, e não um diálogo: o
    // Ionic decide `isSheetModal` no instante do `present()`, então mudar
    // `breakpoints` depois muda só a propriedade e a classe. Medido girando o
    // celular com o sheet `adaptavel` aberto: caixa de 480px que continua com
    // grabber, continua arrastável e continua deslocada. O conserto mínimo é
    // fechar e deixar o consumidor reabrir na forma certa -- e ele mora AQUI
    // porque o consumidor não tem como saber que a largura mudou.
    effect(() => {
      const centradoAgora = this.centrado();
      const antes = this.centradoAnterior;
      this.centradoAnterior = centradoAgora;
      if (antes === undefined || antes === centradoAgora) return;
      // `untracked`: este effect existe para reagir à FORMA, e não a abrir e
      // fechar. Ler `isOpen` rastreado o faria correr a cada abertura à toa.
      if (!untracked(() => this.isOpen())) return;
      // Fecha pelo Ionic, e não emitindo `fechado` na mão: o `didDismiss` é
      // que devolve o foco ao gatilho, e emitir por fora daria DUAS emissões
      // (a nossa e a do Ionic) para o store contar.
      this.desmontar();
    });

    // O sheet apresentado precisa morrer junto com quem o abriu.
    //
    // Ao apresentar, o Ionic MOVE o `<ion-modal>` para o `<body>`. Quando o
    // Angular destrói o consumidor, o nó fica lá, apresentado: o `<body>`
    // segue com `backdrop-no-scroll` (o app inteiro para de rolar), o foco
    // continua preso num diálogo invisível e `(fechado)` nunca é emitido. É o
    // caminho do "voltar" do navegador com o sheet aberto, e o
    // `initParentRemovalObserver` do Ionic NÃO cobre esse caso -- medido no
    // navegador: `conectado=true pai=BODY foco=ION-MODAL didDismiss=0`.
    //
    // Resolvido no shell de propósito: é uma vez aqui em vez de três vezes em
    // TV-4, TV-5 e TV-6.
    this.destroyRef.onDestroy(() => this.desmontar());
  }

  /**
   * Manda o Ionic fechar, tolerando um modal que ainda não terminou de abrir.
   *
   * `dismiss()` REJEITA com "framework delegate is missing" quando a
   * apresentação está no meio do caminho — e é exatamente o que acontece ao
   * destruir o consumidor no mesmo tick em que ele abriu o sheet. A promessa
   * rejeitada sem tratamento vira `unhandledrejection` e derruba a suíte, sem
   * que haja nada a fazer a respeito: o modal que não chegou a apresentar
   * também não deixou nada para limpar.
   */
  private desmontar(): void {
    void this.modal()?.dismiss().catch(() => undefined);
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
   * Se o Ionic renomear `SELETOR_WRAPPER_IONIC`, o nome some em silêncio —
   * nada quebra visualmente, e é o teste de a11y que denuncia.
   */
  nomearDialogo(event: Event): void {
    const modal = event.target as HTMLElement;
    const wrapper = modal.shadowRoot?.querySelector(SELETOR_WRAPPER_IONIC) ?? null;
    wrapper?.setAttribute('aria-label', this.titulo());
    this.dialogo.set(wrapper);
  }
}
