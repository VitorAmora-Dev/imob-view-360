import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Property } from '../models/property.model';
import { VirtualTour } from '../models/virtual-tour.model';
import { PropertyService } from '../services/property.service';
import { VirtualTourService } from '../services/virtual-tour.service';
import {
  EmbedFormat,
  ShareTab,
  SheetKind,
  TOAST_MS,
  TourViewerScene,
  cenasDoTour,
  pedacosDoIframe,
} from './tour-viewer.model';

/**
 * O estado da tela de visualização de tour (SPRINT-4-TOUR-VIEWER.md, TV-0).
 *
 * ASSINATURAS CONGELADAS: os nomes públicos daqui são o contrato entre as três
 * frentes do sprint. O CORPO de cada método é livre — quem implementar a task
 * dona daquele comportamento preenche o que faltar. Mudar assinatura, não:
 * só por PR anunciado.
 *
 * Fornecido pela PÁGINA e não em `root`, como o `TourDraftStore` do wizard: o
 * estado morre com a tela, e voltar para ela é começar de novo — inclusive o
 * modo imersivo, que o handoff diz explicitamente para não persistir.
 *
 * Os quatro invariantes de `06-state-behavior.md` moram aqui, e não espalhados
 * pelos componentes, porque é o único jeito de eles continuarem verdadeiros
 * quando a quarta frente chegar:
 *
 *   1. Sem chrome, sem faixa de cenas, sem hotspots e sem tab bar — desta
 *      sobra apenas o botão que devolve a interface. Ver `TourActionsBar`.
 *   2. Sheet aberto esconde a faixa de cenas (evita duas listas na tela).
 *   3. Nunca dois sheets ao mesmo tempo.
 *   4. Ação destrutiva sempre passa por confirmação.
 */
@Injectable()
export class TourViewerStore {
  private readonly router = inject(Router);
  private readonly propertyService = inject(PropertyService);
  private readonly virtualTourService = inject(VirtualTourService);

  // ---- dados -------------------------------------------------------------

  readonly property = signal<Property | null>(null);
  readonly tour = signal<VirtualTour | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal(false);

  /** As cenas já traduzidas para o vocabulário da tela. Ver `cenasDoTour()`. */
  readonly scenes = computed<TourViewerScene[]>(() => {
    const tour = this.tour();
    return tour ? cenasDoTour(tour) : [];
  });

  readonly tourId = computed(() => this.tour()?.id ?? null);

  /**
   * As panorâmicas cruas, do jeito que o `PanoramicViewerComponent` as espera.
   *
   * Existe para o template não precisar de `store.tour()!.panoramas`: o `!`
   * dentro do HTML é uma promessa que ninguém verifica, e o dia em que o tour
   * for nulo por outro caminho o erro sai do template, sem pilha útil.
   */
  readonly panoramas = computed(() => this.tour()?.panoramas ?? []);

  readonly tourName = computed(
    () => this.property()?.title ?? '',
  );

  /**
   * Tour existe mas não tem cômodo nenhum.
   *
   * Estado real: dá para apagar o último panorama e continuar na tela. A faixa
   * some, e a tab bar fica com EDITAR e OCULTAR — sem cena não há o que
   * compartilhar.
   */
  readonly semCenas = computed(() => this.scenes().length === 0);

  /**
   * Quem está vendo pode editar e apagar este tour.
   *
   * Hoje é sempre verdadeiro: a rota inteira está atrás do `authGuard` e o
   * backend já filtra por agência, então quem chega aqui é dono. Existe como
   * sinal, e não como `true` cravado no template, porque o handoff especifica a
   * variante da tab bar sem permissão — e no dia em que houver perfil de
   * leitura, é esta linha que muda, não os três componentes que a consomem.
   */
  readonly podeEditar = computed(() => true);

  // ---- navegação entre cenas ---------------------------------------------

  readonly currentSceneIndex = signal(0);

  readonly currentScene = computed<TourViewerScene | null>(
    () => this.scenes()[this.currentSceneIndex()] ?? null,
  );

  irParaCena(indice: number): void {
    if (indice < 0 || indice >= this.scenes().length) return;
    this.currentSceneIndex.set(indice);
  }

  /** O caminho que o hotspot e o card do sheet usam: eles conhecem o id, não o índice. */
  irParaCenaPorId(sceneId: string): void {
    const indice = this.scenes().findIndex((c) => c.id === sceneId);
    if (indice >= 0) this.currentSceneIndex.set(indice);
  }

  // ---- chrome e sheets ---------------------------------------------------

  readonly sheet = signal<SheetKind>(null);
  readonly chromeVisible = signal(true);

  /**
   * Abrir um sheet SUBSTITUI o que estiver aberto — invariante 3. Como é um
   * `set` e não uma pilha, não há como empilhar dois nem por engano.
   */
  abrirSheet(qual: Exclude<SheetKind, null>): void {
    this.sheet.set(qual);
  }

  /** Qual aba do sheet Compartilhar está na frente. */
  readonly shareTab = signal<ShareTab>('link');

  /**
   * Abre o Compartilhar JÁ na aba certa, num passo só.
   *
   * Dois lugares o abrem por portas diferentes — o COMPARTILHAR da barra
   * inferior, que quer a aba do link, e o "Incorporar" do cluster do desktop,
   * que quer a de embed. Sem este método cada um faria `shareTab.set()` seguido
   * de `abrirSheet('share')`, e o dia em que alguém esquecesse a primeira linha
   * o sheet abriria na aba que a visita ANTERIOR deixou.
   *
   * Por isso ele sempre grava a aba, inclusive no valor padrão: a aba não é
   * memória entre aberturas, é consequência de por onde se entrou.
   */
  abrirCompartilhamento(aba: ShareTab = 'link'): void {
    this.shareTab.set(aba);
    this.sheet.set('share');
  }

  /**
   * Fecha o sheet — mas só se `qual` ainda for o da vez.
   *
   * O parâmetro existe por um defeito que só apareceu no navegador, quando
   * "Apagar tour" desceu para dentro do sheet Gerenciar. A sequência é esta:
   *
   *   1. o item chama `abrirSheet('delete')`, e o store passa a dizer 'delete';
   *   2. o Gerenciar vê `aberto()` virar `false` e manda o `IonModal` fechar;
   *   3. o Ionic emite `didDismiss` — DEPOIS, e de forma assíncrona;
   *   4. o ouvinte do Gerenciar chamava `fecharSheet()` sem argumento e
   *      zerava o store, apagando o sheet que o passo 1 tinha acabado de abrir.
   *
   * O sintoma era os dois sheets sumirem e a confirmação nunca aparecer: a
   * ação destrutiva ficava inalcançável, sem erro nenhum no console. Nenhum
   * teste de unidade pegava, porque o passo 3 só existe com o modal
   * apresentado de verdade.
   *
   * Com o argumento, o `didDismiss` do sheet que está SAINDO não fala pelo que
   * está entrando. Sem argumento, continua sendo "fecha o que estiver aberto",
   * que é o que quem fecha por conta própria quer dizer.
   */
  fecharSheet(qual?: Exclude<SheetKind, null>): void {
    if (qual && this.sheet() !== qual) return;
    this.sheet.set(null);
  }

  alternarChrome(): void {
    this.chromeVisible.update((visivel) => !visivel);
  }

  /**
   * A faixa de miniaturas está no ar.
   *
   * Invariantes 1 e 2 juntos, num lugar só: ela some no modo imersivo E
   * enquanto houver sheet aberto, porque o sheet já mostra a grade de cenas.
   */
  readonly faixaVisivel = computed(
    () => this.chromeVisible() && this.sheet() === null && !this.semCenas(),
  );

  /** Os hotspots somem no imersivo — invariante 1, e é o mais fácil de esquecer. */
  readonly hotspotsVisiveis = computed(() => this.chromeVisible());

  // ---- toast -------------------------------------------------------------

  readonly toast = signal<string | null>(null);

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Mensagem efêmera. Recebe a CHAVE de tradução, não o texto: quem traduz é o
   * template, que tem o pipe.
   */
  mostrarToast(chave: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set(chave);
    this.toastTimer = setTimeout(() => this.toast.set(null), TOAST_MS);
  }

  // ---- embed -------------------------------------------------------------

  readonly embedFormat = signal<EmbedFormat>(0);
  readonly embedShowControls = signal(true);

  /**
   * O link público do tour.
   *
   * `/embed/:id` e não uma rota nova: essa é a única rota pública do produto —
   * `/inner-view-page` está atrás do `authGuard`, e quem recebe o link não tem
   * conta. Não existe `publicSlug` no backend, apesar do que o handoff supõe.
   *
   * O `?controles=0` sai daqui e não do componente porque o sheet Incorporar e
   * o "Compartilhar link" do Gerenciar precisam da MESMA URL.
   */
  readonly linkPublico = computed(() => {
    const id = this.tourId();
    if (!id) return '';
    const base = `${window.location.origin}/embed/${id}`;
    return this.embedShowControls() ? base : `${base}?controles=0`;
  });

  /**
   * O `<iframe>` que o painel de embed DESENHA e que o rodapé do sheet COPIA.
   *
   * Mora no store porque os dois componentes são irmãos, e não pai e filho: o
   * `TourShareSheetComponent` tem o botão "Copiar código" no rodapé (fora da
   * área rolável, de propósito), e o `TourEmbedPanelComponent` tem o bloco de
   * código. Cada um montando o seu é exatamente a divergência que
   * `pedacosDoIframe()` existe para impedir.
   */
  readonly pedacosDoEmbed = computed(() =>
    pedacosDoIframe(this.linkPublico(), this.embedFormat()),
  );

  /** O que vai para a área de transferência: os mesmos trechos, emendados. */
  readonly codigoDoEmbed = computed(() =>
    this.pedacosDoEmbed().map((pedaco) => pedaco.texto).join(''),
  );

  // ---- rail do desktop ---------------------------------------------------

  /** Só desktop. A persistência por sessão é assunto da TV-2. */
  readonly railCollapsed = signal(false);

  alternarRail(): void {
    this.railCollapsed.update((recolhido) => !recolhido);
  }

  // ---- ciclo de vida do tour ---------------------------------------------

  readonly apagando = signal(false);

  /** O tour cuja visita já foi contada nesta abertura de tela. */
  private visitaContada: string | null = null;

  readonly publicando = signal(false);

  /**
   * Há o que publicar: o tour ainda é rascunho.
   *
   * Decisão D8 — não existe `pendingChanges` e não vale uma coluna nova neste
   * sprint. Com o modo edição (TV-11) o tour editado continua `PUBLISHED`,
   * então na prática isto quase nunca é verdadeiro, e é o comportamento certo:
   * o item some da lista em vez de aparecer desabilitado.
   */
  readonly podePublicar = computed(() => this.tour()?.status === 'DRAFT');

  /**
   * Publica o tour que ainda era rascunho.
   *
   * Mora aqui pelo mesmo motivo que `apagarTour()`: dois lugares o chamam — o
   * item do sheet Gerenciar (TV-6) e o botão do cluster do desktop (TV-9) — e
   * duas cópias divergiriam no primeiro ajuste.
   *
   * **NÃO substitua o tour pela resposta da rota.** O `PATCH /virtual-tours/:id`
   * devolve `{ id, status, propertyId, updatedAt }` e mais nada: um
   * `tour.set(resposta)` apagaria `panoramas` da tela inteira, e o sintoma
   * seria a faixa de cenas esvaziando e o viewer desmontando no instante em que
   * a publicação dá CERTO. Por isso só o campo que mudou é remendado aqui.
   *
   * Como `apagarTour()`, ele é o DEPOIS da decisão: não confirma nada e não
   * mostra toast. Quem chamou é que sabe o que dizer.
   */
  async publicar(): Promise<boolean> {
    const id = this.tourId();
    if (!id || this.publicando()) return false;

    this.publicando.set(true);
    try {
      await firstValueFrom(this.virtualTourService.publicarTour(id));
      this.tour.update((atual) => (atual ? { ...atual, status: 'PUBLISHED' } : atual));
      return true;
    } catch {
      return false;
    } finally {
      this.publicando.set(false);
    }
  }

  /**
   * Apaga o tour e volta para a listagem.
   *
   * Não confirma nada: quem confirma é o sheet (TV-5), e é assim que o
   * invariante 4 fica visível na leitura — este método é o DEPOIS da
   * confirmação, e chamá-lo de qualquer outro lugar seria o bug que o
   * invariante existe para impedir.
   */
  async apagarTour(): Promise<boolean> {
    const id = this.tourId();
    if (!id) return false;

    this.apagando.set(true);
    try {
      await firstValueFrom(this.virtualTourService.deleteTour(id));
      void this.router.navigate(['/home']);
      return true;
    } catch {
      return false;
    } finally {
      this.apagando.set(false);
    }
  }

  // ---- carga -------------------------------------------------------------

  /**
   * Carrega imóvel e tour a partir do id da ROTA — que é o do IMÓVEL, não o do
   * tour. Ver a decisão D10 do plano do sprint: mudar isso arrastaria home,
   * cards, guards e links já enviados.
   *
   * `propertyEmMemoria` é o que a home passa por `router state` ao navegar: o
   * imóvel já está na mão dela, e refazer a busca custaria uma tela cinza que
   * ninguém precisa ver. Sem ele, busca.
   */
  async carregar(propertyId: string, propertyEmMemoria?: Property): Promise<void> {
    this.loading.set(true);
    this.loadError.set(false);

    try {
      const property =
        propertyEmMemoria?.virtualTour !== undefined
          ? propertyEmMemoria
          : await firstValueFrom(this.propertyService.findProperty(propertyId));

      this.property.set(property);

      const tourId = property.virtualTour?.id;
      if (!tourId) {
        // Imóvel sem tour não é erro: é o estado vazio da tela.
        this.tour.set(null);
        return;
      }

      const tour = await firstValueFrom(this.virtualTourService.findTour(tourId));
      this.tour.set(tour);
      this.currentSceneIndex.set(this.indiceInicial(tour));

      // Métrica, não requisito: falhar aqui não pode custar a tela ao corretor.
      //
      // Uma vez por abertura de tela, e não uma por chamada: `recarregar()` cai
      // aqui de novo, então cada toque em "Tentar de novo" numa rede ruim
      // somava uma visita. O store morre com a página, então o campo é do
      // tamanho certo — voltar ao tour depois conta de novo, que é o correto.
      if (this.visitaContada !== tourId) {
        this.visitaContada = tourId;
        this.virtualTourService.recordView(tourId).subscribe({ error: () => undefined });
      }
    } catch {
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Recarrega tudo. É o "Tentar de novo" do estado de erro (TV-8). */
  async recarregar(): Promise<void> {
    const id = this.property()?.id;
    if (id) await this.carregar(id);
  }

  /**
   * A cena por onde o tour abre.
   *
   * O tour declara qual é (`initialPanorama`); só cai no primeiro da ordem se
   * nenhum estiver marcado, o que acontece em tour antigo.
   */
  private indiceInicial(tour: VirtualTour): number {
    const marcado = tour.panoramas.findIndex((p) => p.initialPanorama);
    if (marcado >= 0) return marcado;

    // O MESMO desempate do viewer (`loadInitialPanorama`): o menor `order`, e
    // não o primeiro do array. Duas regras diferentes para a mesma decisão só
    // concordavam porque o servidor ordena por `order`; numa resposta fora de
    // ordem elas escolheriam cenas diferentes, e o efeito da página mandaria
    // navegar já no primeiro frame — baixando a mesma equirretangular duas
    // vezes, que é exatamente o que aquele efeito existe para evitar.
    let menor = 0;
    for (let i = 1; i < tour.panoramas.length; i++) {
      if (tour.panoramas[i].order < tour.panoramas[menor].order) menor = i;
    }
    return menor;
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.toastTimer) clearTimeout(this.toastTimer);
    });
  }
}
