import { Component, computed, effect, inject, signal } from '@angular/core';
import { IonContent, IonModal } from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { HotspotCardComponent } from '../hotspot-card/hotspot-card.component';
import { isMobileViewport } from '../media';

/**
 * Bottom sheet dos hotspots, no mobile (tarefa B8).
 *
 * DONO: Frente B.
 *
 * É o painel do desktop no telefone. Não há largura para uma coluna ao lado da
 * foto, e o sheet resolve isso sem tirar a foto da tela: ele cobre a metade de
 * baixo e o ponto que se está editando continua visível em cima.
 *
 * `IonModal` com `breakpoints` em vez de um painel à mão (§1, item 5 do plano):
 * arrastar para baixo, prender o foco, fechar no Esc, devolver o foco a quem
 * abriu e a animação de entrada vêm prontos. Escrever isso de novo seria
 * reescrever um trap de foco, que é onde a a11y costuma morrer.
 *
 * Dois modos, o mesmo estado do desktop:
 *
 * - `editor` — um ponto só, aberto pelo clique num pin sem destino;
 * - `list` — todos os do ambiente, aberto pelo "Ver todos" da linha-resumo.
 */
@Component({
  selector: 'app-hotspot-sheet',
  standalone: true,
  imports: [IonModal, IonContent, TranslatePipe, HotspotCardComponent],
  templateUrl: './hotspot-sheet.component.html',
  styleUrls: ['./hotspot-sheet.component.scss'],
})
export class HotspotSheetComponent {
  readonly editor = inject(HotspotEditorStore);
  private readonly translate = inject(TranslateService);
  private readonly isMobile = isMobileViewport();

  /**
   * O `0` é o que permite arrastar para baixo até fechar; sem ele o sheet trava
   * na menor parada e a única saída vira o botão.
   */
  readonly breakpoints = [0, 0.5, 0.9];

  readonly mode = computed(() => this.editor.sheet()?.mode ?? null);

  /**
   * No desktop o sheet não abre nunca: quem responde ao mesmo estado lá é o
   * painel ao lado do viewer, que leva o foco ao card do ponto. Abrir os dois
   * daria duas cópias do mesmo formulário na tela.
   */
  readonly isOpen = computed(() => {
    if (!this.isMobile() || this.mode() === null) return false;
    // No modo editor, só abre se o ponto ainda existir.
    //
    // Sem isto o sheet renderiza o cabeçalho de um ponto que já não existe —
    // visto na tela: "Ponto 0" (o `editingIndex` devolve -1) sobre um corpo
    // vazio. O `remove()` do store fecha o editor quando apaga o ponto aberto,
    // então hoje isso não é alcançável pela interface; apareceu ao mexer nas
    // cenas por fora dele.
    //
    // Fica como guarda mesmo assim, pela mesma razão do nome do diálogo: uma
    // tela quebrada que depende de nenhum outro caminho jamais mexer em
    // `scenes` não é uma tela sã, é uma que ainda não encontrou o caminho.
    return this.mode() !== 'editor' || this.editing() !== null;
  });

  /**
   * A lista abre alta porque é para varrer; o editor abre na metade porque o
   * ponto que se está editando está na foto, logo acima — cobri-lo tiraria a
   * única referência do que se está nomeando.
   */
  readonly initialBreakpoint = computed(() => (this.mode() === 'list' ? 0.9 : 0.5));

  readonly hotspots = computed(() => this.editor.hotspots());
  readonly editing = computed(() => this.editor.editing());

  /** Posição do ponto em edição na lista — é o número que o pin mostra. */
  readonly editingIndex = computed(() => {
    const alvo = this.editing();
    return alvo ? this.hotspots().findIndex((h) => h.id === alvo.id) : -1;
  });

  /** Título do sheet — e também o nome acessível do diálogo. */
  readonly title = computed(() =>
    this.mode() === 'list'
      ? this.translate.instant('TOUR_WIZARD.STEP2.SHEET_LIST')
      : this.translate.instant('TOUR_WIZARD.STEP2.SHEET_EDIT', {
          n: this.editingIndex() + 1,
        }),
  );

  /**
   * O `.modal-wrapper` do shadow root, enquanto o sheet está apresentado.
   *
   * Signal e não campo comum para o effect abaixo reagir tanto à apresentação
   * quanto à troca de título.
   */
  private readonly dialogo = signal<Element | null>(null);

  constructor() {
    // O nome do diálogo SEGUE o título, em vez de ser escrito uma vez só no
    // `didPresent`.
    //
    // Hoje o título não muda com o sheet aberto, e isso dá para conferir: só
    // existem dois chamadores de `openEditor`/`openList` em produção — o pin da
    // foto e o "Ver todos" da linha-resumo —, e os dois ficam atrás do backdrop
    // do modal. O `editingIndex` também não escorrega, porque no modo editor só
    // o card do próprio ponto é renderizado e excluí-lo fecha o sheet.
    //
    // Ou seja: cinco fatos independentes se apoiando, nenhum deles escrito em
    // lugar nenhum, para um nome de diálogo continuar certo. Basta alguém fazer
    // o card da lista abrir o editor — pedido nada estranho — e o VoiceOver
    // passa a anunciar a lista enquanto a tela mostra um ponto, sem nada
    // quebrar e sem teste nenhum reclamar. Reagir ao título custa estas quatro
    // linhas e dispensa a prova.
    effect(() => {
      this.dialogo()?.setAttribute('aria-label', this.title());
    });
  }

  /**
   * Dá nome ao diálogo, entrando no shadow DOM do Ionic.
   *
   * Isto é feio e não foi a primeira tentativa. Medido no navegador, com a
   * árvore de acessibilidade na mão:
   *
   * - o `role="dialog"` NÃO fica no `<ion-modal>`, e sim num `.modal-wrapper`
   *   dentro do shadow root;
   * - `aria-label` ou `aria-labelledby` no host nomeiam o host, que é um nó
   *   genérico — o diálogo continua sem nome;
   * - `aria-labelledby` no wrapper também não resolveria: IDREF não atravessa
   *   fronteira de shadow, e o `<h2>` está na luz.
   *
   * Sobra o `aria-label` literal no wrapper. Sem ele o VoiceOver anuncia
   * "diálogo" e mais nada, e o nome é justamente o que diz se a pessoa caiu num
   * ponto ou na lista inteira.
   *
   * Se o Ionic renomear a classe, o nome some em silêncio — nada quebra, mas a
   * verificação de a11y do B12 precisa passar por aqui de novo.
   */
  nomearDialogo(event: Event): void {
    const modal = event.target as HTMLElement;
    const wrapper = modal.shadowRoot?.querySelector('.modal-wrapper') ?? null;
    // Escrito já, além do effect abaixo: o effect só corre na próxima detecção
    // de mudanças, e o foco entra no diálogo no instante do `didPresent`. Um
    // frame de diálogo anônimo é justamente o frame que o leitor de tela lê.
    wrapper?.setAttribute('aria-label', this.title());
    this.dialogo.set(wrapper);
  }

  /**
   * Chamado tanto pelo botão quanto pelo arrasto para baixo e pelo Esc. Zerar o
   * estado nos três casos é o que impede o sheet de "lembrar" de um ponto que
   * já foi fechado e reabrir sozinho na próxima troca de ambiente.
   */
  close(): void {
    this.dialogo.set(null);
    this.editor.closeSheet();
  }
}
