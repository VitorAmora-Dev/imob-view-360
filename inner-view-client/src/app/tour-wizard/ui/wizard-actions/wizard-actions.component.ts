import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { TOTAL_ETAPAS } from '../../tour-wizard.model';

/**
 * A partir de quando o rodapé admite que a montagem está demorando.
 *
 * Noventa segundos POR CÔMODO, contra uma média medida de sessenta. Um vez e
 * meia, e não a média crua: no valor médio metade das esperas normais estoura
 * o limite, e um aviso de anormalidade que aparece em metade dos casos normais
 * ensina a ignorá-lo. Multiplicado pelo tamanho do lote porque três cômodos em
 * três minutos é o esperado, não uma anomalia.
 */
const ESPERA_NORMAL_POR_COMODO_MS = 90_000;

/**
 * De quanto em quanto tempo o rodapé reconfere se já passou do esperado.
 *
 * Grosso de propósito. O texto não mostra segundos — só vira, uma vez, quando
 * o limite acima é cruzado —, então um tique por segundo seria detecção de
 * mudança sessenta vezes por minuto para nada. Cinco segundos atrasam a troca
 * da frase em no máximo cinco segundos de um limite de noventa.
 */
const PASSO_DO_RELOGIO_MS = 5000;

/**
 * Barra de ação do rodapé.
 *
 * DONO: Frente A (tarefa A3).
 *
 * A ação primária fica AQUI, no desktop e no mobile — nunca junto à barra de
 * progresso. Progresso é indicador de estado, não comando, e a ação tem que vir
 * depois do conteúdo que a confirma. Consistência deliberada entre plataformas.
 */
@Component({
  selector: 'app-wizard-actions',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './wizard-actions.component.html',
  styleUrls: ['./wizard-actions.component.scss'],
})
export class WizardActionsComponent implements OnDestroy {
  readonly store = inject(TourDraftStore);
  readonly blockedFeedback = signal<string | null>(null);
  private feedbackTimer: number | null = null;

  /**
   * O relógio de parede, atualizado de cinco em cinco segundos — e SÓ enquanto
   * existe lote em andamento.
   *
   * Precisa existir como sinal porque `demorado()` compara com `Date.now()`, e
   * uma leitura direta do relógio dentro de um `computed` nunca reavaliaria:
   * o tempo não é reativo. Aqui a passagem do tempo vira uma dependência
   * explícita, como qualquer outra.
   */
  private readonly agora = signal(Date.now());
  private relogio: number | null = null;

  constructor() {
    // Liga e desliga o relógio junto com o lote. O intervalo não fica de pé o
    // tempo todo: fora do tratamento não há frase para trocar, e um timer
    // eterno num rodapé que vive em todas as etapas é custo puro.
    effect(() => {
      const inicio = this.store.inicioDoLote();
      this.pararRelogio();
      if (inicio === null) return;

      this.agora.set(Date.now());
      this.relogio = window.setInterval(
        () => this.agora.set(Date.now()),
        PASSO_DO_RELOGIO_MS,
      );
    });
  }

  /** A etapa 1 está esperando a IA agora. É o que faz a barra existir. */
  readonly tratando = computed(
    () => this.store.step() === 1 && this.store.emTratamento().length > 0,
  );

  /**
   * Passou do tempo em que isto costuma terminar.
   *
   * Só troca a frase — não cancela, não alerta, não sugere recarregar. A
   * montagem segue no servidor, e o acompanhamento tem teto próprio de dez
   * minutos. O que este sinal conserta é o silêncio: sem ele, a mesma frase
   * otimista fica na tela enquanto o corretor conclui sozinho que travou.
   */
  readonly demorado = computed(() => {
    const inicio = this.store.inicioDoLote();
    if (inicio === null) return false;

    const esperado =
      ESPERA_NORMAL_POR_COMODO_MS * Math.max(1, this.store.loteDaIA().total);
    return this.agora() - inicio > esperado;
  });

  /**
   * A frase da espera.
   *
   * Três casos, e o de um cômodo é separado por um motivo: "0 de 1 prontas"
   * não é progresso, é uma fração parada que fica sessenta segundos no zero.
   * Ali o que informa é a expectativa — "leva cerca de 1 minuto" —, não a
   * contagem.
   *
   * Nenhuma das três dá ordem. A frase antiga era "Espere a IA terminar de
   * melhorar as fotos": manda esperar, não diz o que se ganha, e some em 2,8
   * segundos. Estas dizem o que está sendo feito e o que dá para fazer
   * enquanto isso — que é continuar capturando, coisa que o corretor pode e
   * quase nunca descobre.
   */
  readonly textoDaEspera = computed(() => {
    if (this.demorado()) return 'TOUR_WIZARD.STEP1.TRATANDO_DEMORADO';
    return this.store.loteDaIA().total > 1
      ? 'TOUR_WIZARD.STEP1.TRATANDO_VARIOS'
      : 'TOUR_WIZARD.STEP1.TRATANDO_UM';
  });

  /**
   * A parte cheia da barra. Discreta: anda em degraus de um cômodo.
   *
   * `total` zero não chega aqui — a barra só existe com `tratando()` —, mas o
   * piso fica porque `0/0` viraria `NaN` e `width: NaN%` é uma barra sem
   * largura nenhuma, que é o defeito mais difícil de enxergar na tela.
   */
  readonly pctPronto = computed(() => {
    const { prontas, total } = this.store.loteDaIA();
    return total > 0 ? Math.round((prontas / total) * 100) : 0;
  });

  /**
   * Quem publica é a ÚLTIMA etapa, hoje a 4.
   *
   * Ficou em 3 na renumeração, e a etapa de passagens passou a anunciar
   * "Publicar tour" num botão que só avançava. Prometer a ação final e entregar
   * outra tela é pior do que um rótulo feio: quem aperta acha que terminou.
   */
  readonly primaryLabelKey = computed(() => {
    if (this.store.step() === 1) return 'TOUR_WIZARD.COMMON.DONE';
    if (this.store.step() !== TOTAL_ETAPAS) return 'TOUR_WIZARD.COMMON.NEXT';

    // Em edição o tour já está no ar: prometer "Publicar" seria descrever uma
    // ação que não vai acontecer, e deixaria o corretor achando que o link
    // muda ou que o tour sai e volta do ar.
    return this.store.editando()
      ? 'TOUR_WIZARD.COMMON.SAVE_CHANGES'
      : 'TOUR_WIZARD.COMMON.PUBLISH';
  });

  readonly primaryDisabled = computed(
    () => !this.store.canAdvance() || this.store.publishing(),
  );

  /**
   * Por que o botão está desligado, para o `title` do hover.
   *
   * A falta de imagem e a falta de ligação travam o mesmo botão por motivos
   * diferentes, e a frase genérica de antes ("envie uma imagem") mandaria o
   * corretor para a etapa errada.
   *
   * Cada etapa tem a SUA frase porque tem o seu conserto: na ordenação falta
   * escolher com quem o ambiente se conecta; nas passagens falta marcar onde
   * fica a porta. Depois da renumeração este método só perguntava pela etapa 2,
   * então a 3 travava em silêncio — botão apagado e nenhuma palavra na tela,
   * que é o que o comentário do próprio template existe para evitar.
   */
  readonly motivoBloqueio = computed(() => {
    if (!this.store.temImagem()) return 'TOUR_WIZARD.COMMON.NEEDS_IMAGE';
    // Antes do nome de propósito: nomear é coisa que ele resolve num toque,
    // esperar a IA não. Dizer "faltam nomes" a quem já nomeou tudo e está
    // olhando um selo girando manda procurar o problema no lugar errado.
    if (this.store.step() === 1 && this.store.emTratamento().length) {
      return 'TOUR_WIZARD.COMMON.NEEDS_TREATMENT';
    }
    if (this.store.step() === 1 && this.store.ambientesSemNome().length) {
      return 'TOUR_WIZARD.STEP1.NEEDS_NAMES';
    }
    if (this.store.step() === 2 && this.store.ilhadosPorConexao().length) {
      return 'TOUR_WIZARD.STEP_ORDER.NEEDS_LINKS';
    }
    if (this.store.step() === 3 && this.store.ambientesIlhados().length) {
      return 'TOUR_WIZARD.PASSAGES.NEEDS_LINKS';
    }
    return null;
  });

  onPrimaryClick(): void {
    if (this.store.publishing()) return;

    if (!this.store.canAdvance()) {
      // `next()` marca os campos que precisam de correção. Na etapa de
      // imagens somamos uma explicação breve e temporária, porque ali o botão
      // apagado continua tocável justamente para responder "por quê?".
      this.store.next();
      if (this.store.step() === 1) this.showBlockedFeedback();
      return;
    }

    this.blockedFeedback.set(null);
    this.store.next();
  }

  ngOnDestroy(): void {
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.pararRelogio();
  }

  private pararRelogio(): void {
    if (this.relogio === null) return;
    window.clearInterval(this.relogio);
    this.relogio = null;
  }

  private showBlockedFeedback(): void {
    const key = this.motivoBloqueio();
    if (!key) return;

    // O tratamento já tem a barra, que fica na tela o tempo todo e diz mais do
    // que este balão diria. Repetir a mesma informação em dois lugares, um
    // deles sumindo em 2,8 segundos, é o que faz o corretor achar que os dois
    // falam de coisas diferentes.
    if (key === 'TOUR_WIZARD.COMMON.NEEDS_TREATMENT') return;

    this.blockedFeedback.set(key);
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => {
      this.blockedFeedback.set(null);
      this.feedbackTimer = null;
    }, 2800);
  }
}
