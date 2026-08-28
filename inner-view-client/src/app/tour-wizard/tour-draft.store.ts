import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VirtualTour } from '../models/virtual-tour.model';
import { CaptureFrameUpload, CaptureGeometry } from '../services/virtual-tour.service';
import { PanoramaImageCache } from '../services/panorama-image-cache.service';
import { PropertyService } from '../services/property.service';
import {
  AndamentoDaMontagem,
  TreatmentStatus,
  VirtualTourService,
} from '../services/virtual-tour.service';
import { toCreateTourPayload } from './publish-payload';
import * as grafo from './scene-graph';
import { desligar, ligar } from './passagens/fila';
import {
  AddressDraft,
  EMPTY_PROPERTY,
  EQUIRECTANGULAR_RATIO,
  MAX_FILE_BYTES,
  PropertyDraft,
  RATIO_TOLERANCE,
  ROOM_NAME_MAX,
  TOTAL_ETAPAS,
  WizardHotspot,
  WizardScene,
  WizardSceneAiState,
  WizardSceneRejection,
  WizardStep,
} from './tour-wizard.model';

/**
 * Campos do endereço que a validação cobra. Ficam numa lista porque o acordeão
 * precisa saber se algum deles está errado para se abrir — ver `addressHasError`.
 */
const ADDRESS_FIELDS = ['street', 'city', 'state'] as const;

/**
 * Teto prático das imagens de UMA publicação.
 *
 * O tour inteiro sobe numa requisição só, e o servidor corta em 50 MB de corpo
 * (`IMAGE_BODY_LIMIT`). Base64 infla cada byte em ~33%, então o que cabe de
 * imagem de verdade são ~37 MB; 34 deixa folga para o JSON em volta — nomes,
 * hotspots, geometria.
 *
 * O limite por arquivo não protege disto: são 25 MB CADA, sem teto de
 * quantidade, e duas fotos grandes já estouram o corpo.
 */
const MAX_PUBLISH_BYTES = 34 * 1024 * 1024;

/**
 * Fotos originais mínimas para o servidor tratar em vez de dispensar.
 *
 * Espelha o `MINIMO_DE_FOTOS` de `treat-panorama.service.ts`. Duplicado de
 * propósito: aqui ele evita uma ida à rede para receber um SKIPPED previsível,
 * e lá é a regra de verdade. Se os dois divergirem, o pior caso é o cliente
 * pedir uma montagem que o servidor recusa — nunca o contrário.
 */
const MINIMO_DE_REFERENCIAS = 4;

/**
 * Teto da espera com o corretor parado olhando o loader.
 *
 * A montagem leva ~60s por cômodo. Dois minutos cobrem uma que demorou mais
 * que o normal sem transformar a captura numa tela travada — passado isso, o
 * panorama costurado é entregue e ele segue. O `acompanharMontagem` admite dez
 * minutos por padrão, que serve para segundo plano e não para isto.
 */
const LIMITE_DA_ESPERA_MS = 2 * 60 * 1000;

/**
 * Largura que o card da etapa 1 e o rail da etapa 2 pedem ao servidor.
 *
 * Os dois desenham um retângulo perto de 196×110. Sem esta largura a rota de
 * preview devolve a equirretangular inteira — dezenas de MB por cômodo, no 4G,
 * para preencher algo do tamanho de um selo. 320 dá margem para tela de alta
 * densidade sem chegar perto do custo da imagem cheia.
 */
const LARGURA_DA_MINIATURA = 320;

/**
 * Título que `garantirRascunho()` grava no imóvel enquanto os dados de verdade
 * não existem.
 *
 * Marcador, não dado — e o discriminador que a retomada usa para saber que
 * `type` e `purpose` daquele imóvel também são marcadores. Ver
 * `retomarRascunho()`.
 */
const IMOVEL_SEM_DADOS = 'Captura em andamento';

/**
 * Como o estado do servidor vira o estado da tela.
 *
 * `PENDING` e `PROCESSING` viram a mesma coisa de propósito: para quem espera,
 * "na fila" e "sendo montado" são o mesmo minuto, e separar os dois só daria
 * duas mensagens para o mesmo nada.
 *
 * `FAILED` e `SKIPPED` continuam distintos aqui mesmo que a tela trate os dois
 * calando a boca — é a diferença entre "tentamos e não deu" e "olhamos e não
 * havia o que fazer", e ela aparece no suporte.
 */
const ESTADO_DA_IA: Record<TreatmentStatus, WizardSceneAiState> = {
  PENDING: 'processing',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

/**
 * Estado do rascunho do wizard.
 *
 * DONO: Frente A. A Frente B não edita este arquivo — muta cenas pelo
 * `patchScene` a partir do `HotspotEditorStore`. É a regra que mantém as duas
 * frentes fora do mesmo merge (SPRINT-3-TOUR-WIZARD.md §7).
 *
 * As ASSINATURAS públicas são congeladas (§4.3); os corpos são da Frente A.
 * No commit-zero está implementado o que a Frente B precisa para trabalhar
 * (navegação, seleção, cenas, `patchScene`); o que é só da Frente A está
 * marcado com TODO e o número da tarefa.
 *
 * Fornecido pela página, não em `root`: o rascunho morre junto com a tela, e
 * "Criar outro tour" é só reinstanciar. Estado de criação de tour vazando
 * entre visitas seria pior que perdê-lo.
 */
@Injectable()
export class TourDraftStore {
  private readonly propertyService = inject(PropertyService);
  private readonly virtualTourService = inject(VirtualTourService);
  private readonly imagens = inject(PanoramaImageCache);

  /**
   * Corta o acompanhamento da montagem quando a tela morre.
   *
   * O store é fornecido pela página, então some com ela. O laço de
   * acompanhamento, não: ele seguiria por até dez minutos chamando `set()` num
   * store destruído e segurando, pela closure, as cenas inteiras em base64.
   * Sair da tela no meio da montagem — o voltar do navegador basta — era o
   * suficiente. A montagem em si continua no servidor; o que para aqui é só
   * ficar olhando.
   */
  private readonly abortar = new AbortController();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abortar.abort());
  }

  // ---- estado ------------------------------------------------------------
  readonly step = signal<WizardStep>(1);
  readonly scenes = signal<WizardScene[]>([]);
  readonly selectedSceneId = signal<string | null>(null);
  readonly property = signal<PropertyDraft>({ ...EMPTY_PROPERTY });
  readonly published = signal(false);
  /** Trava o botão do rodapé enquanto o publicar está em voo. */
  readonly publishing = signal(false);

  // ---- derivados ---------------------------------------------------------

  /** Cenas que passaram na validação — as únicas que contam para qualquer coisa. */
  readonly readyScenes = computed(() =>
    this.scenes().filter((s) => s.state === 'ready'),
  );

  readonly selectedScene = computed<WizardScene | null>(() => {
    const id = this.selectedSceneId();
    return this.scenes().find((s) => s.id === id) ?? null;
  });

  /**
   * Única regra bloqueante do fluxo: sem imagem não há tour, e as etapas 2 e 3
   * não fazem sentido. Vale para o botão "Próximo" e para os chips do stepper.
   */
  /**
   * A regra da imagem: sem foto nenhuma, nada nas etapas 2 e 3 se sustenta.
   *
   * Separada de `canAdvance` porque as duas já foram a mesma coisa e não são
   * mais. Esta responde "o rascunho existe?"; a outra, "dá para sair da etapa
   * em que estou?". Quem cuida de recuperação — voltar à etapa 1 quando a
   * última imagem some — quer ESTA, senão um tour com ambiente ilhado jogaria o
   * corretor duas telas atrás no meio da edição.
   */
  readonly temImagem = computed(() => this.readyScenes().length > 0);

  /**
   * A etapa 2 é opcional quando não há segundo ambiente — e só então.
   *
   * Vale para o texto da barra de progresso, para o subtítulo da etapa e para o
   * botão "Pular": os três diziam "opcional" sem condição nenhuma, e agora
   * dizem a mesma coisa a partir do mesmo lugar. Três cópias da regra é como
   * uma delas fica para trás.
   */
  readonly etapaPassagensOpcional = computed(
    () => this.readyScenes().length < 2,
  );

  /** Dica da barra de progresso. Ver `etapaPassagensOpcional`. */
  readonly hintKey = computed(() =>
    this.step() === 3 && !this.etapaPassagensOpcional()
      ? 'TOUR_WIZARD.COMMON.HINT_3_REQUIRED'
      : `TOUR_WIZARD.COMMON.HINT_${this.step()}`,
  );

  /**
   * Ambientes com imagem e sem nome.
   *
   * Segura a etapa 1. A cobrança é aqui, e não duas telas adiante, porque é
   * aqui que a FOTO está — e a foto é a única coisa que diz como chamar o
   * ambiente. Nomear na etapa 2, olhando uma lista de destinos, é nomear de
   * memória.
   */
  readonly ambientesSemNome = computed(() =>
    this.readyScenes().filter((s) => !s.room.trim()),
  );

  /** Ambientes que o visitante não alcança, e de onde ele não sai. Ver `scene-graph`. */
  readonly ambientesIlhados = computed(() => grafo.ambientesIlhados(this.scenes()));
  readonly becosSemSaida = computed(() => grafo.becosSemSaida(this.scenes()));

  /**
   * Dá para sair da etapa atual.
   *
   * A etapa 2 deixou de ser opcional, e a razão é da tela do visitante, não de
   * gosto: o `embed` é só o viewer, e o viewer não tem lista de ambientes nem
   * menu — o ÚNICO jeito de trocar de ambiente é clicar num hotspot. Publicar
   * cinco ambientes sem ligação entrega um tour em que se vê um só, e os outros
   * quatro ficam pagos e invisíveis.
   *
   * A regra é alcançabilidade, e não "pelo menos um ponto": com cinco
   * ambientes, um ponto liga dois e deixa três de fora — a contagem passaria e
   * o tour continuaria quebrado.
   *
   * Com UM ambiente a etapa segue opcional de verdade: não há destino possível,
   * e o `ambientesIlhados` devolve vazio.
   */
  readonly canAdvance = computed(() => {
    if (!this.temImagem()) return false;
    if (this.step() === 1) return this.ambientesSemNome().length === 0;
    // A trava de ambiente ilhado vale na etapa de PASSAGENS. Na de ordenação
    // ela travaria a tela por um defeito que só a etapa seguinte pode consertar
    // — lá o aviso é informativo, e vem de `ilhadosPorConexao`.
    if (this.step() === 3) return this.ambientesIlhados().length === 0;
    return true;
  });

  /** Soma de TODOS os ambientes, não só o selecionado — é o que o resumo mostra. */
  readonly totalHotspots = computed(() =>
    this.scenes().reduce((n, s) => n + s.hotspots.length, 0),
  );

  readonly progressPct = computed(() =>
    this.published() ? 100 : (this.step() / TOTAL_ETAPAS) * 100,
  );

  /** Capa do tour: a primeira cena válida. */
  readonly coverScene = computed<WizardScene | null>(
    () => this.readyScenes()[0] ?? null,
  );

  /**
   * As imagens somam mais do que cabe numa publicação.
   *
   * Avisa, não bloqueia: a conta é uma estimativa do lado de cá, e travar o
   * botão por causa dela impediria de publicar alguém que talvez coubesse. O
   * 413, se vier, agora tem mensagem própria.
   */
  readonly oversized = computed(
    () =>
      this.readyScenes().reduce((n, s) => n + s.fileSize, 0) >
      MAX_PUBLISH_BYTES,
  );

  // ---- navegação ---------------------------------------------------------

  /**
   * Uma etapa é alcançável se já foi visitada, ou se a regra da imagem permite.
   * Os chips bloqueados do stepper não respondem ao clique.
   */
  canReach(step: WizardStep): boolean {
    return step <= this.step() || this.canAdvance();
  }

  goTo(step: WizardStep): void {
    if (!this.canReach(step)) return;
    this.irPara(step);
  }

  /**
   * Troca de etapa, apaga as marcas de erro e salva.
   *
   * `showErrors` significa "esta pessoa já tentou e não deu" — e isso é sobre a
   * etapa em que ela tentou. Carregá-lo para a seguinte faria a etapa 3 abrir
   * com campos em vermelho antes de qualquer tentativa, que é exatamente o
   * "repreender antes de haver erro" que ele existe para evitar.
   *
   * É o FUNIL dos três caminhos que trocam de etapa — `next()`, `back()` e os
   * chips do stepper via `goTo()` — e por isso é aqui, e não em cada um deles,
   * que mora o salvamento: cada etapa fecha um bloco de trabalho (nome dos
   * cômodos, hotspots, dados do imóvel), e salvar na fronteira entre elas é o
   * ponto em que há mais a perder e menos a atrapalhar. `next()` na etapa 3
   * sai para `publish()` ANTES de chegar aqui, então não há gravação em
   * dobro com a que ele já faz por dentro. Fogo-e-esquece: nenhum dos três
   * chamadores é async, e falhar aqui não pode travar a troca de etapa —
   * ninguém pediu para salvar, só para navegar.
   *
   * Só salva quando há cômodo pronto, a mesma guarda das outras duas portas de
   * auto-save (`tour-wizard.page.ts`, ao sair e ao esconder o app).
   * `salvarRascunhoAgora()` começa por `garantirRascunho()`, que CRIA imóvel e
   * tour: sem esta linha, tocar no chip da etapa em que já se está — `goTo(1)`
   * com `canReach(1)` trivialmente verdadeiro — bastava para deixar na home um
   * cartão "Nenhum ambiente ainda" que só some em 30 dias.
   */
  private irPara(step: WizardStep): void {
    this.showErrors.set(false);
    this.step.set(step);
    if (!this.readyScenes().length) return;
    void this.salvarRascunho().catch(() => undefined);
  }

  next(): void {
    const current = this.step();
    if (current === TOTAL_ETAPAS) {
      void this.publish();
      return;
    }
    // O handler devolve cedo quando inválido, além do botão já vir desabilitado:
    // teclado e leitor de tela chegam aqui por caminhos que não passam pelo
    // estado visual do botão.
    if (!this.canAdvance()) {
      // Tentou e não deu: agora os campos podem se marcar. Antes disso, não.
      this.showErrors.set(true);
      return;
    }
    this.irPara((current + 1) as WizardStep);
  }

  back(): void {
    const current = this.step();
    if (current === 1) return;
    this.irPara((current - 1) as WizardStep);
  }

  // ---- cenas -------------------------------------------------------------

  /**
   * Recebe arquivos do seletor, da câmera ou do drop e cria um ambiente por
   * arquivo, no fim da lista.
   *
   * O card aparece na hora, em `reading`, e só depois recebe a imagem e o
   * veredito. Numa seleção de oito fotos de 20 MB, esperar todas para mostrar
   * qualquer coisa dá vários segundos de tela parada — e a lista chegando aos
   * poucos já responde ao que a pessoa acabou de fazer.
   */
  async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const rejection = rejectionFor(file);
      const scene: WizardScene = {
        id: crypto.randomUUID(),
        room: defaultRoomName(),
        fileName: file.name,
        fileSize: file.size,
        imageData: '',
        order: this.scenes().length,
        hotspots: [],
        state: rejection ? 'rejected' : 'reading',
        ...(rejection ? { rejectedReason: rejection } : {}),
      };
      this.scenes.update((list) => [...list, scene]);
      if (rejection) continue;

      try {
        const imageData = await readAsDataUrl(file);
        const ratio = await measureAspectRatio(imageData);
        this.patchScene(scene.id, (s) => ({
          ...s,
          imageData,
          state: 'ready',
          ...(isEquirectangular(ratio) ? {} : { warning: 'ratio' as const }),
        }));
        // Só cena válida pode virar a selecionada, e por isso isto está DENTRO
        // do try: fora dele, um arquivo recusado no meio da leitura continuava
        // sendo escolhido, e a etapa 2 abria o editor de hotspots sobre uma cena
        // sem imagem — cujos pontos o publicar depois descarta em silêncio.
        this.selectedSceneId.update((id) => id ?? scene.id);
      } catch {
        this.patchScene(scene.id, (s) => ({
          ...s,
          state: 'rejected',
          rejectedReason: 'type',
        }));
      }
    }
  }

  /** Cenas aceitas mas com ressalva — alimenta o aviso antes de publicar. */
  readonly warnedScenes = computed(() =>
    this.scenes().filter((s) => s.state === 'ready' && s.warning),
  );

  /**
   * Adiciona um ambiente já pronto — usado pela captura 360 guiada (A6).
   *
   * O tamanho é medido aqui, e não recebido: o chamador só tem a dataURL, e o
   * comprimento dela não é o tamanho do arquivo. A captura também passa pelo
   * mesmo teto de tamanho do upload — uma costura grande demais era aceita como
   * válida e só estourava lá na frente, no publicar.
   */
  addCapturedScene(
    scene: Omit<WizardScene, 'id' | 'order' | 'hotspots' | 'state' | 'fileSize'>,
  ): void {
    const fileSize = dataUrlBytes(scene.imageData);
    const rejeitada = fileSize > MAX_FILE_BYTES;
    const created: WizardScene = {
      ...scene,
      fileSize,
      id: crypto.randomUUID(),
      order: this.scenes().length,
      hotspots: [],
      state: rejeitada ? 'rejected' : 'ready',
      ...(rejeitada ? { rejectedReason: 'size' as const } : {}),
    };
    this.scenes.update((list) => [...list, created]);
    if (!rejeitada) this.selectedSceneId.update((id) => id ?? created.id);
  }

  // ---- montagem por IA, durante a captura --------------------------------

  /**
   * Cria o imóvel e o tour na primeira captura, e devolve o mesmo tour depois.
   *
   * O imóvel nasce como marcador: os dados de verdade só existem na etapa 3, e
   * esperar por eles adiaria a montagem para depois da captura inteira. Ele não
   * aparece em lugar nenhum enquanto o tour estiver em rascunho — a listagem
   * filtra.
   */
  private async garantirRascunho(): Promise<string> {
    const jaTem = this.rascunhoTourId();
    if (jaTem) return jaTem;

    const propertyId =
      this.rascunhoPropertyId() ??
      (
        await firstValueFrom(
          this.propertyService.createProperty({
            code: `IML-${Date.now().toString(36).toUpperCase()}`,
            // Marcadores, não dados. A etapa 3 sobrescreve os três por PATCH,
            // e `retomarRascunho()` usa o título para saber que os OUTROS DOIS
            // também são marcadores.
            title: IMOVEL_SEM_DADOS,
            type: 'HOUSE',
            purpose: 'SALE',
          }),
        )
      ).id;
    this.rascunhoPropertyId.set(propertyId);

    const tour = await firstValueFrom(
      this.virtualTourService.createTour(propertyId, [], 'DRAFT'),
    );
    this.rascunhoTourId.set(tour.id);
    return tour.id;
  }

  /**
   * Sobe um cômodo recém-capturado e espera a IA montá-lo.
   *
   * Chamado PELO MODAL DE CAPTURA, que segura a tela com o loader enquanto isto
   * roda — por isso é a única coisa neste store que faz o usuário esperar de
   * propósito. A alternativa, tratar em segundo plano enquanto ele fotografa o
   * próximo cômodo, escondia melhor a espera mas entregava a ele o panorama
   * cru no momento em que ele mais olha para o resultado: logo depois de girar
   * 360° com o celular na mão.
   *
   * Devolve `null` quando não deu — rede fora, tempo estourado, IA desabilitada
   * no servidor. Quem chama mostra o panorama costurado e segue: falhar aqui
   * degrada a qualidade do tour, nunca o impede.
   */
  async tratarCaptura(captura: {
    imageData: string;
    frames: CaptureFrameUpload[];
    geometry: CaptureGeometry | null;
    sinal?: AbortSignal;
  }): Promise<{ panoramaId: string; treatedUrl: string } | null> {
    try {
      const tourId = await this.garantirRascunho();

      const panorama = await firstValueFrom(
        this.virtualTourService.addPanorama(tourId, {
          // O nome ainda não existe: ele é perguntado DEPOIS, na tela de
          // preview, com a foto à vista. `publish` reconcilia todos no fim.
          roomName: `Ambiente ${this.scenes().length + 1}`,
          imageData: captura.imageData,
          order: this.scenes().length,
          initialPanorama: this.scenes().length === 0,
          ...(captura.geometry ?? {}),
        }),
      );

      const { uploaded } = await this.virtualTourService.uploadCaptureFrames(
        panorama.id,
        captura.frames,
      );
      // Menos de quatro referências e o servidor dispensa em vez de tratar.
      // Pedir a montagem gastaria uma ida à rede para receber um SKIPPED.
      if (uploaded < MINIMO_DE_REFERENCIAS) {
        return { panoramaId: panorama.id, treatedUrl: '' };
      }

      await firstValueFrom(this.virtualTourService.montarTour(tourId));

      const pronto = await this.esperarPanorama(tourId, panorama.id, captura.sinal);
      if (!pronto) return { panoramaId: panorama.id, treatedUrl: '' };

      const blob = await firstValueFrom(
        this.virtualTourService.baixarPreview(panorama.id, 'treated'),
      );
      return { panoramaId: panorama.id, treatedUrl: URL.createObjectURL(blob) };
    } catch {
      return null;
    }
  }

  /**
   * Espera ESTE panorama chegar a um estado terminal.
   *
   * O andamento é por tour, então o laço olha a entrada deste id dentro dele —
   * é para isso que o servidor passou a devolver a lista cômodo a cômodo.
   *
   * O teto é curto de propósito. O `acompanharMontagem` admite dez minutos, que
   * serve para um acompanhamento em segundo plano e é inaceitável com alguém
   * parado olhando: passado o limite, é melhor entregar o panorama costurado do
   * que continuar segurando a tela.
   */
  private async esperarPanorama(
    tourId: string,
    panoramaId: string,
    sinal?: AbortSignal,
  ): Promise<boolean> {
    // Controlador próprio para poder encerrar o laço no instante em que ESTE
    // cômodo termina, sem esperar os outros do tour. Ele também repassa a
    // desistência de quem chamou — o botão de seguir sem melhorar, ou a tela
    // morrendo.
    const controle = new AbortController();
    const encerrar = () => controle.abort();
    sinal?.addEventListener('abort', encerrar, { once: true });
    this.abortar.signal.addEventListener('abort', encerrar, { once: true });

    let terminou = false;
    try {
      await this.virtualTourService.acompanharMontagem(
        tourId,
        (andamento) => {
          const meu = andamento.panoramas.find((p) => p.id === panoramaId);
          if (meu && meu.status !== 'PENDING' && meu.status !== 'PROCESSING') {
            terminou = meu.status === 'DONE';
            // Só este cômodo interessa: os outros já foram tratados nas
            // capturas anteriores, e esperar por eles seria esperar de novo.
            controle.abort();
          }
        },
        { sinal: controle.signal, limiteMs: LIMITE_DA_ESPERA_MS },
      );
    } finally {
      sinal?.removeEventListener('abort', encerrar);
      this.abortar.signal.removeEventListener('abort', encerrar);
    }
    return terminou;
  }

  renameScene(id: string, room: string): void {
    this.patchScene(id, (s) => ({ ...s, room }));
  }

  /**
   * Remove um ambiente e limpa o que apontava para ele.
   *
   * Hotspot cujo destino deixou de existir vira um ponto morto: some do viewer
   * do visitante e ninguém entende por quê. Zerar o destino devolve o ponto ao
   * estado "sem destino", que a etapa 2 sabe mostrar e o corretor sabe corrigir.
   */
  removeScene(id: string): void {
    // O ambiente pode já existir no servidor: o wizard sobe cômodo a cômodo
    // durante a captura. Sem este apagar, remover um cômodo na etapa 1 o tirava
    // só da tela, e ele reaparecia no tour publicado — com a foto e a montagem
    // por IA que o corretor acabou de descartar.
    //
    // Best-effort e sem `await`: falhar aqui deixa um cômodo a mais num tour
    // que ainda nem é público, e prender a remoção da tela numa ida à rede
    // seria pior. O que sobrar é varrido por `yarn limpar-rascunhos`.
    const alvo = this.scenes().find((s) => s.id === id);
    // O `blob:` da imagem tratada foi criado no modal de captura e vive fora do
    // ciclo do Angular: sem revogar, cada cômodo removido deixa alguns MB
    // presos até a aba fechar.
    if (alvo?.treatedImageUrl) URL.revokeObjectURL(alvo.treatedImageUrl);

    const remoto = alvo?.serverPanoramaId;
    if (remoto) {
      void firstValueFrom(this.virtualTourService.deletePanorama(remoto)).catch(
        () => undefined,
      );
    }

    // Os hotspots que nasceram NESTA cena somem junto com ela, e não pelo
    // filtro comum de `patchScene` — a cena inteira sai da lista. Sem
    // empilhar os `serverId` deles aqui, o laço de exclusão de
    // `salvarRascunho()`, que só percorre `scenes()`, nunca mais os veria.
    const orfaos = (alvo?.hotspots ?? [])
      .map((h) => h.serverId)
      .filter((sid): sid is string => !!sid);
    if (orfaos.length) {
      this.hotspotsParaApagar.update((ids) => [...ids, ...orfaos]);
    }

    this.scenes.update((list) =>
      list
        .filter((s) => s.id !== id)
        .map((s, i) => ({
          ...s,
          order: i,
          // Na MESMA escrita que limpa o hotspot órfão: duas transações para a
          // mesma remoção é como uma delas fica para trás.
          connections: (s.connections ?? []).filter((cid) => cid !== id),
          hotspots: s.hotspots.map((h) =>
            h.target === id ? { ...h, target: null } : h,
          ),
        })),
    );
    if (this.selectedSceneId() === id) {
      // `readyScenes`, não `scenes`: cair numa cena recusada deixaria a etapa 2
      // apontada para algo sem imagem.
      this.selectedSceneId.set(this.readyScenes()[0]?.id ?? null);
    }
    // Removeu a última imagem: as etapas 2 e 3 deixam de se sustentar. Ficar
    // parado nelas deixaria o corretor com o botão do rodapé desabilitado e o
    // conserto duas telas atrás — e o stepper marcando a etapa 1 como concluída
    // sem nenhuma foto. Devolver à etapa 1 põe o problema e a solução no mesmo
    // lugar.
    //
    // `temImagem` e não `canAdvance`: remover uma cena pode ilhar outra, e aí
    // `canAdvance` fica falso na etapa 2 — usar essa aqui teria arrastado o
    // corretor de volta à etapa 1 no meio da edição, para consertar uma ligação
    // que se conserta na etapa 2 mesmo.
    if (!this.temImagem()) this.step.set(1);
  }

  /**
   * Reordena os ambientes, movendo o de `de` para a posição `para`.
   *
   * Mexe no ARRAY, e não só no campo `order`: quem manda na sequência do tour é
   * a posição no array — `publish-payload.ts` faz `ready.map((scene, i) => …)`
   * com `order: i` e `initialPanorama: i === 0`. Mexer só no campo não mudaria
   * nada em lugar nenhum.
   *
   * O `order` é reescrito junto para não ficar mentindo, mas ele continua sendo
   * consequência, não causa.
   *
   * Não toca nas conexões: reordenar é sobre a sequência, não sobre o grafo.
   */
  moveScene(de: number, para: number): void {
    const atual = this.scenes();
    if (de === para) return;
    if (de < 0 || de >= atual.length) return;
    if (para < 0 || para >= atual.length) return;

    const lista = [...atual];
    const [movida] = lista.splice(de, 1);
    lista.splice(para, 0, movida);

    this.scenes.set(lista.map((s, i) => ({ ...s, order: i })));
  }

  /**
   * Liga dois ambientes, nos dois sentidos.
   *
   * A regra mora em `passagens/fila.ts`, pura e testada; aqui só se escreve o
   * resultado no sinal. Idempotente: tocar no card da Cozinha para escolher a
   * Sala, quando a ligação já nasceu do lado da Sala, não duplica.
   */
  ligarAmbientes(aId: string, bId: string): void {
    this.scenes.update((list) => ligar(list, aId, bId));
  }

  /**
   * Desliga dois ambientes e devolve os pontos que foram apagados.
   *
   * Quem chama usa o retorno para PERGUNTAR antes de confirmar — apagar
   * trabalho posicionado sem aviso é o que a spec manda evitar.
   *
   * O `serverId` dos pontos apagados vai para a fila de exclusão do rascunho:
   * eles já existem no servidor, e o laço de `salvarRascunho()` só percorre
   * `scenes()` — sem este registro, um ponto apagado na tela continuaria vivo
   * no banco.
   */
  desligarAmbientes(aId: string, bId: string): WizardHotspot[] {
    const { cenas, perdidos } = desligar(this.scenes(), aId, bId);

    const remotos = perdidos
      .map((h) => h.serverId)
      .filter((sid): sid is string => !!sid);
    if (remotos.length) {
      this.hotspotsParaApagar.update((ids) => [...ids, ...remotos]);
    }

    this.scenes.set(cenas);
    return perdidos;
  }

  selectScene(id: string): void {
    this.selectedSceneId.set(id);
  }

  // ---- imóvel ------------------------------------------------------------

  patchProperty(patch: Partial<Omit<PropertyDraft, 'address'>>): void {
    this.property.update((p) => ({ ...p, ...patch }));
  }

  patchAddress(patch: Partial<AddressDraft>): void {
    this.property.update((p) => ({ ...p, address: { ...p.address, ...patch } }));
  }

  /**
   * Endereço é tudo-ou-nada e é opcional: ou o corretor preencheu, ou o bloco
   * inteiro fica de fora. Serve para não mandar à API um endereço pela metade,
   * que é pior que endereço nenhum — vira imóvel que não aparece em busca por
   * bairro e ninguém percebe.
   */
  readonly addressTouched = computed(() =>
    Object.values(this.property().address).some((v) => v.trim() !== ''),
  );

  /**
   * Mutador de baixo nível de uma cena.
   *
   * É a ÚNICA porta pela qual o `HotspotEditorStore` (Frente B) altera cenas.
   * Existe para que as duas frentes não escrevam no mesmo arquivo — ver §7 do
   * plano do sprint. Não remova nem mude a assinatura sem avisar a Frente B.
   *
   * É também por aqui que passa TODA remoção de hotspot com `serverId` — a de
   * hoje (`HotspotEditorStore.remove()`) e qualquer futura: comparando os
   * hotspots antes e depois da mutação, quem sumiu com um `serverId` vai para
   * `hotspotsParaApagar`. Sem isto, o laço de exclusão de `salvarRascunho()`
   * jamais veria esse id — ele só percorre o que ainda está em `scenes()`.
   */
  patchScene(id: string, fn: (scene: WizardScene) => WizardScene): void {
    const antes = this.scenes().find((s) => s.id === id);
    const depois = antes ? fn(antes) : undefined;

    if (antes && depois) {
      const idsDepois = new Set(
        depois.hotspots.map((h) => h.serverId).filter(Boolean),
      );
      const sumiram = antes.hotspots
        .map((h) => h.serverId)
        .filter((sid): sid is string => !!sid && !idsDepois.has(sid));
      if (sumiram.length) {
        this.hotspotsParaApagar.update((ids) => [...ids, ...sumiram]);
      }
    }

    this.scenes.update((list) =>
      list.map((s) => (s.id === id ? depois! : s)),
    );
  }

  // ---- validação ---------------------------------------------------------

  /**
   * Campos que impedem a publicação.
   *
   * Nome, tipo e finalidade são exigidos pela API — não é rigor nosso. O
   * endereço é opcional, mas se o corretor começou a preencher tem que
   * terminar: rua, cidade e UF. Meio endereço passa na API e some da busca por
   * bairro, que é justamente para que ele serve.
   */
  readonly invalidFields = computed<string[]>(() => {
    const p = this.property();
    const bad: string[] = [];
    if (!p.name.trim()) bad.push('name');
    if (!p.type) bad.push('type');
    if (!p.purpose) bad.push('purpose');
    if (this.addressTouched()) {
      if (!p.address.street.trim()) bad.push('street');
      if (!p.address.city.trim()) bad.push('city');
      if (p.address.state.trim().length !== 2) bad.push('state');
    }
    return bad;
  });

  /**
   * Erros só aparecem depois da primeira tentativa de publicar. Marcar de
   * vermelho um formulário que a pessoa ainda nem começou a preencher é
   * repreender antes de haver erro.
   */
  readonly showErrors = signal(false);

  hasError(field: string): boolean {
    return this.showErrors() && this.invalidFields().includes(field);
  }

  /**
   * Há erro dentro do bloco de endereço, que é colapsável.
   *
   * O acordeão usa isto para se abrir sozinho: campo inválido escondido atrás
   * de um cabeçalho fechado é um botão "Publicar" que não faz nada e não diz
   * por quê. Quem erra tem que ver onde errou.
   */
  readonly addressHasError = computed(() =>
    ADDRESS_FIELDS.some((f) => this.hasError(f)),
  );

  // ---- publicar ----------------------------------------------------------

  /**
   * Tour e imóvel do rascunho, criados na primeira captura.
   *
   * Existem muito antes do publicar: é o que permite à montagem por IA rodar
   * enquanto o corretor fotografa. No publicar eles não são recriados — só
   * passam a `PUBLISHED`.
   */
  readonly rascunhoTourId = signal<string | null>(null);
  readonly rascunhoPropertyId = signal<string | null>(null);

  /**
   * Ids de hotspot que sumiram de `scenes()` sem que `salvarRascunho()` ainda
   * tivesse rodado, e por isso continuam vivos no servidor.
   *
   * Cada ponto guarda o próprio `serverId` (ver `WizardHotspot`); esta lista
   * não duplica esse dado — ela existe só para o que já NÃO tem mais onde
   * guardar id nenhum, porque o ponto (ou a cena inteira) saiu da tela.
   * Populada por `patchScene` e por `removeScene`; `salvarRascunho()`
   * consome e esvazia a cada chamada seguinte.
   */
  private readonly hotspotsParaApagar = signal<string[]>([]);

  /** Id do tour publicado — vira o link de compartilhamento na tela de sucesso. */
  readonly publishedTourId = signal<string | null>(null);
  readonly publishedPropertyId = signal<string | null>(null);


  /** Pontos sem destino que ficaram de fora. Vira aviso, não erro. */
  readonly discardedHotspots = signal(0);

  readonly publishError = signal<string | null>(null);

  /**
   * Traz de volta uma captura interrompida.
   *
   * As fotos e o tratamento por IA nunca se perderam — eles sobem durante a
   * captura, cômodo a cômodo. O que se perdia ao tocar em voltar era o nome
   * dos ambientes, os hotspots e os dados do imóvel, que só existiam aqui.
   *
   * Não baixa foto. Um tour de seis cômodos são dezenas de MB de equirect, e
   * reidratar todas antes de mostrar qualquer coisa seria pior do que não
   * retomar. A imagem chega pelo `PanoramaImageCache` quando o viewer pedir.
   */
  async retomarRascunho(tourId: string): Promise<void> {
    const rascunho = await firstValueFrom(
      this.virtualTourService.lerRascunho(tourId),
    );

    this.rascunhoTourId.set(rascunho.id);
    this.rascunhoPropertyId.set(rascunho.propertyId);

    // Uma cena local por panorama, antes dos hotspots: eles apontam para
    // panoramaId e precisam do mapa completo para traduzir ao id local.
    const porPanoramaId = new Map<string, string>();
    const cenas: WizardScene[] = rascunho.panoramas.map((p) => {
      const idLocal = crypto.randomUUID();
      porPanoramaId.set(p.id, idLocal);
      return {
        id: idLocal,
        room: p.roomName,
        fileName: p.roomName,
        fileSize: 0,
        // Vazio de propósito. Ver o comentário do campo no modelo: cena com
        // `imageData` vazio E `serverPanoramaId` presente é íntegra — a foto
        // chega sob demanda, pelo `PanoramaImageCache`.
        imageData: '',
        order: p.order,
        hotspots: [],
        state: 'ready',
        serverPanoramaId: p.id,
        // Pelo mapa, e não por um `=== 'DONE'`: `PENDING`/`PROCESSING` viravam
        // `idle`, o selo "melhorando" sumia do card e o corretor via como
        // pronto um cômodo que a IA ainda estava montando. `FAILED`/`SKIPPED`
        // perdiam a distinção que o comentário do próprio mapa diz que importa
        // no suporte.
        aiState: ESTADO_DA_IA[p.treatmentStatus] ?? 'idle',
      };
    });

    for (const p of rascunho.panoramas) {
      const cena = cenas.find((c) => c.serverPanoramaId === p.id)!;
      cena.hotspots = p.hotspots.map((h) => ({
        id: crypto.randomUUID(),
        u: h.positionX,
        v: h.positionY,
        label: h.label ?? '',
        target: porPanoramaId.get(h.targetId) ?? null,
        serverId: h.id,
      }));
    }

    // `scenes.set(...)`, não `patchScene` cena a cena: o que chega aqui é o
    // estado inteiro vindo do servidor, e nada nele "sumiu" da tela — não há
    // hotspot para `patchScene` empilhar em `hotspotsParaApagar`. E a própria
    // fila é zerada a seguir: um resíduo de sessão anterior (ambiente
    // removido sem salvar, por exemplo) apontaria para um hotspot de um
    // rascunho que este retomar sequer carregou.
    this.scenes.set(cenas);
    this.hotspotsParaApagar.set([]);
    this.selectedSceneId.set(cenas[0]?.id ?? null);
    this.step.set(1);

    const endereco = rascunho.property.address;
    // `title`, `type` e `purpose` são gravados JUNTOS por `garantirRascunho()`,
    // os três como marcador e nenhum como escolha do corretor. O servidor não
    // distingue as duas coisas, então o critério aqui é o único disponível:
    // enquanto o título ainda é o marcador, os outros dois também são.
    //
    // Devolvê-los como escolha abria a etapa 3 com Casa/Venda pré-selecionados,
    // `invalidFields()` passava, e um apartamento para alugar era publicado
    // rotulado como casa à venda — sem ninguém ter tocado nos campos.
    const soMarcadores = rascunho.property.title === IMOVEL_SEM_DADOS;
    this.property.set({
      ...EMPTY_PROPERTY,
      name: soMarcadores ? '' : rascunho.property.title,
      type: soMarcadores ? '' : (rascunho.property.type as PropertyDraft['type']),
      purpose: soMarcadores
        ? ''
        : (rascunho.property.purpose as PropertyDraft['purpose']),
      ...(endereco
        ? {
            address: {
              street: endereco.street,
              number: endereco.number ?? '',
              complement: endereco.complement ?? '',
              district: endereco.district ?? '',
              city: endereco.city,
              state: endereco.state,
              zip: endereco.zipCode ?? '',
            },
          }
        : {}),
    });
  }

  /**
   * A foto de um cômodo, venha ela da memória ou do servidor.
   *
   * Cena recém-capturada já tem tudo: a dataURL da costura e o `blob:` da
   * tratada, entregues pelo modal. Cena retomada não tem nada — o rascunho é
   * lido sem coluna de imagem de propósito, porque reidratar seis
   * equirretangulares antes de mostrar qualquer coisa seria pior do que não
   * retomar.
   *
   * Então a regra é: usa o que está em memória; se não houver, baixa uma vez e
   * guarda na cena. O download passa pelo `PanoramaImageCache` porque a rota é
   * autenticada e o `TextureLoader` não leva token.
   */
  async garantirImagem(
    sceneId: string,
    variante: 'treated' | 'original',
  ): Promise<string> {
    const cena = this.scenes().find((s) => s.id === sceneId);
    if (!cena) return '';

    const jaTenho = variante === 'treated' ? cena.treatedImageUrl : cena.imageData;
    if (jaTenho) return jaTenho;

    const panoramaId = cena.serverPanoramaId;
    // Cena que nunca subiu e não tem foto em memória não existe na prática;
    // devolver vazio deixa quem chamou decidir, em vez de estourar.
    if (!panoramaId) return '';

    const url = await this.imagens.obter(panoramaId, variante);
    this.patchScene(sceneId, (s) =>
      variante === 'treated'
        ? { ...s, treatedImageUrl: url }
        : { ...s, imageData: url },
    );
    return url;
  }

  /**
   * `blob:` da MINIATURA de cada cena, por id local.
   *
   * Fora da `WizardScene` de propósito. `treatedImageUrl` é a foto que o viewer
   * da etapa 2 sobe para a GPU como textura; guardar ali uma versão de 320px
   * faria a esfera abrir borrada por causa de um card da etapa 1 que carregou
   * antes. São duas imagens diferentes do mesmo cômodo, e cada uma tem o seu
   * lugar — o cache também as separa, pela largura na chave.
   */
  readonly miniaturas = signal<Record<string, string>>({});

  /**
   * Panoramas cuja miniatura já falhou nesta sessão.
   *
   * O card e o rail pedem a miniatura de dentro de um `effect`, que reroda a
   * cada mutação da cena — uma tecla digitada no nome do ambiente basta. Sem
   * esta memória, uma falha de rede virava um download novo por tecla.
   */
  private readonly miniaturasQueFalharam = new Set<string>();

  /** A miniatura de uma cena, ou vazio enquanto ela não chegou. */
  miniatura(sceneId: string): string {
    return this.miniaturas()[sceneId] ?? '';
  }

  /**
   * Baixa a miniatura de um cômodo retomado, pequena.
   *
   * Separado de `garantirImagem` porque o que se pede é outra imagem, e não a
   * mesma em outro tamanho: quem chama aqui desenha um selo de 196×110, e
   * pagar a equirretangular inteira por isso era o custo que a faixa da home
   * cobrava em toda visita.
   *
   * Não rejeita: quem chama é um `effect`, e uma promise rejeitada ali não tem
   * onde ser tratada. Miniatura que não veio é um card sem foto, não um erro.
   */
  async garantirMiniatura(sceneId: string): Promise<string> {
    const jaTenho = this.miniaturas()[sceneId];
    if (jaTenho) return jaTenho;

    const panoramaId = this.scenes().find((s) => s.id === sceneId)
      ?.serverPanoramaId;
    if (!panoramaId) return '';
    if (this.miniaturasQueFalharam.has(panoramaId)) return '';

    try {
      const url = await this.imagens.obter(
        panoramaId,
        'treated',
        LARGURA_DA_MINIATURA,
      );
      this.miniaturas.update((atual) => ({ ...atual, [sceneId]: url }));
      return url;
    } catch {
      this.miniaturasQueFalharam.add(panoramaId);
      return '';
    }
  }

  /**
   * Grava no servidor o que hoje só existe na memória do wizard.
   *
   * É o miolo do `publish()`, extraído. O corretor perdia o nome dos cômodos,
   * os hotspots e os dados do imóvel ao tocar em voltar ou recarregar, porque
   * essas três coisas só subiam no publicar — enquanto as fotos e o
   * tratamento por IA, que são o caro, já subiam durante a captura.
   *
   * Chamado de três lugares: ao publicar, ao sair do wizard, e quando o app
   * vai para segundo plano. Publicar exercitar o mesmo caminho é de propósito:
   * é o que impede o salvamento de apodrecer sem ninguém notar.
   *
   * Lança em falha de rede. Quem chama decide — publicar aborta, sair não.
   */
  async salvarRascunho(): Promise<void> {
    // Trava de reentrância COM borda de saída. Antes só o clique em
    // "Publicar" chamava isto — um botão que a própria tela desabilita
    // enquanto `publishing()` está em voo. A Tarefa 12 passou a chamar
    // sozinha, sem gesto nenhum do corretor: ao trocar de etapa e quando o
    // app vai para segundo plano. Isso abriu uma janela que não existia
    // antes — trocar de etapa e minimizar o app quase no mesmo instante
    // dispara duas chamadas antes da primeira terminar.
    //
    // Devolver a MESMA promise da gravação em voo para o segundo chamador
    // (a primeira versão desta trava) é regressão: aquela gravação já
    // fotografou `readyScenes()`/`property()` ANTES desta chamada nova (ver
    // os pontos `cenasFinais` e `camposDoImovel` abaixo), e o segundo
    // chamador seria informado "salvei" sem a edição que motivou a sua
    // própria chamada — inclusive quem sai do wizard logo depois, achando
    // que ficou tudo salvo.
    //
    // Por isso, quem chama durante uma gravação em voo não recebe aquela
    // promise: fica marcado como "há mais uma rodada pendente" e uma ÚNICA
    // rodada nova é encadeada para rodar assim que a atual terminar — lendo
    // o estado JÁ ATUALIZADO no momento em que ela de fato começa. Todo
    // mundo que chamar nessa janela compartilha essa MESMA próxima rodada,
    // em vez de abrir uma cada.
    //
    // A geração é lida AQUI, na intenção de salvar, e cobrada lá na frente,
    // quando a rodada de fato começa. Ver `geracao` e `salvarRascunhoAgora()`.
    const geracao = this.geracao;

    if (!this.salvandoRascunho) {
      return this.iniciarGravacao(geracao);
    }
    if (!this.proximaGravacao) {
      let resolver!: () => void;
      let rejeitar!: (erro: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolver = res;
        rejeitar = rej;
      });
      this.proximaGravacao = { promise, resolver, rejeitar };
      this.salvandoRascunho
        .finally(() => {
          // `reset()` pode ter passado por aqui enquanto a rodada em voo
          // terminava e já ter resolvido esta pendente. Sem esta saída, o
          // `!` de antes estourava um TypeError dentro do `finally`.
          const propria = this.proximaGravacao;
          if (!propria) return;
          this.proximaGravacao = null;
          this.iniciarGravacao(geracao).then(propria.resolver, propria.rejeitar);
        })
        // A promise derivada do `finally` não tem dono. Se a gravação em voo
        // rejeitar — rede fora, que é o caso esperado deste fluxo —, ela
        // rejeitava sem handler nenhum. Quem espera o resultado é
        // `proximaGravacao.promise`, entregue a quem chamou.
        .catch(() => undefined);
    }
    return this.proximaGravacao.promise;
  }

  /**
   * Conta quantas vezes o rascunho foi zerado.
   *
   * Uma rodada de gravação enfileirada leva consigo a geração em que foi
   * PEDIDA, e desiste se o rascunho tiver sido descartado antes de ela rodar.
   * Sem isso a sequência era: troca de etapa dispara a rodada A → um
   * `visibilitychange` enfileira a B → o corretor toca em voltar e descarta →
   * `reset()` zera os ids → a rodada A settla → a B roda, vê `rascunhoTourId`
   * nulo e RECRIA um imóvel "Captura em andamento" com tour DRAFT, que
   * reaparece na faixa da home. É o mesmo desfecho que a trava de reentrância
   * da página existe para impedir, por outra porta.
   */
  private geracao = 0;

  /** A promise da gravação em voo agora, ou `null` quando nenhuma está. */
  private salvandoRascunho: Promise<void> | null = null;

  /**
   * A rodada seguinte, quando alguém chama `salvarRascunho()` durante uma já
   * em voo — ver o comentário de `salvarRascunho()` para o porquê de não
   * reaproveitar a que já está rodando.
   */
  private proximaGravacao: {
    promise: Promise<void>;
    resolver: () => void;
    rejeitar: (erro: unknown) => void;
  } | null = null;

  /**
   * Dispara uma gravação de verdade e devolve a promise dela.
   *
   * `this.salvandoRascunho` é atribuído ANTES de chamar `salvarRascunhoAgora()`
   * — não depois — para a garantia de "nunca duas rodadas em voo ao mesmo
   * tempo" não depender de nada no prefixo síncrono dela continuar sem
   * reentrar. Hoje é seguro dos dois jeitos (nada nesse prefixo chama
   * `salvarRascunho()` de novo), mas a invariante fica correta por
   * construção, e não por sorte de quem mexer depois.
   */
  private iniciarGravacao(geracao: number): Promise<void> {
    let resolver!: () => void;
    let rejeitar!: (erro: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolver = res;
      rejeitar = rej;
    });
    this.salvandoRascunho = promise;
    this.salvarRascunhoAgora(geracao).then(
      () => {
        if (this.salvandoRascunho === promise) this.salvandoRascunho = null;
        resolver();
      },
      (erro: unknown) => {
        if (this.salvandoRascunho === promise) this.salvandoRascunho = null;
        rejeitar(erro);
      },
    );
    return promise;
  }

  /** Corpo de fato do `salvarRascunho()` — ver a trava de reentrância acima. */
  private async salvarRascunhoAgora(geracao: number): Promise<void> {
    // O rascunho que esta rodada foi pedida para salvar não existe mais: ela
    // foi enfileirada antes de um descarte e só chegou a rodar depois dele.
    // Seguir daqui recriaria no servidor o imóvel que o corretor acabou de
    // mandar apagar. Ver `geracao`.
    if (geracao !== this.geracao) return;

    // Sem espera de fila: cada cômodo já subiu e foi tratado dentro do modal
    // de captura, antes mesmo de o corretor dar nome a ele.
    const tourId = await this.garantirRascunho();
    const prontas = this.readyScenes();

    // Cena vinda de arquivo nunca passou pelo envio em segundo plano, porque
    // não tem fotos originais e não haveria o que a IA tratar. Ela entra
    // aqui, no mesmo caminho, só que sem montagem.
    for (const [ordem, scene] of prontas.entries()) {
      if (scene.serverPanoramaId) continue;
      const panorama = await firstValueFrom(
        this.virtualTourService.addPanorama(tourId, {
          // `Ambiente N` e nunca `fileName`: ver `nomeDeRascunho`.
          roomName: scene.room.trim() || `Ambiente ${ordem + 1}`,
          imageData: scene.imageData,
          order: ordem,
          initialPanorama: ordem === 0,
          ...(scene.geometry ?? {}),
        }),
      );
      this.patchScene(scene.id, (s) => ({ ...s, serverPanoramaId: panorama.id }));
    }

    // Reconcilia o que mudou depois de o panorama já estar no servidor. O
    // `order` foi gravado na hora da captura e sai do lugar quando o corretor
    // remove um ambiente ou renomeia outro; sem isto o tour publicado abriria
    // por um cômodo que não é a capa, com nomes velhos.
    //
    // Sem `imageData` de propósito: o servidor lê foto nova como refotografia
    // e zera o tratamento junto, jogando fora uma montagem já paga.
    const cenasFinais = this.readyScenes();
    await Promise.all(
      cenasFinais.map((scene, ordem) => {
        const id = scene.serverPanoramaId;
        if (!id) return Promise.resolve(null);
        return firstValueFrom(
          this.virtualTourService.atualizarPanorama(id, {
            // Cômodo sem nome não manda `roomName` NENHUM — ver
            // `nomeDeRascunho`. O servidor fica com o marcador que já tinha, e
            // o vazio continua vazio de cá.
            ...nomeDeRascunho(scene),
            order: ordem,
            initialPanorama: ordem === 0,
          }),
        );
      }),
    );

    // Hotspots só agora: eles ligam um ambiente a outro, e o destino precisa
    // existir no servidor. Durante a captura, metade deles apontaria para um
    // cômodo ainda não fotografado.
    const porCena = new Map(cenasFinais.map((s) => [s.id, s.serverPanoramaId]));
    let descartados = 0;

    // Reconciliação incremental, e não apagar-e-recriar.
    //
    // Apagar todos e recriar era aceitável quando isto rodava uma vez, no
    // publicar: a janela em que o tour ficava sem hotspot durava
    // milissegundos e ninguém a via. Rodando a cada troca de etapa, essa
    // janela passa a existir muitas vezes — e uma queda de rede dentro dela
    // devolve o rascunho retomado sem os pontos que o corretor marcou.
    for (const scene of cenasFinais) {
      const origem = porCena.get(scene.id);
      for (const h of scene.hotspots) {
        const destino = h.target ? porCena.get(h.target) : undefined;
        // Ponto sem destino é inerte: some do viewer do visitante e ninguém
        // entende por quê. Descartar e avisar é melhor que publicar morto.
        if (!origem || !destino) {
          descartados++;
          // Já tinha `serverId`? Ele existe no servidor e não devia mais
          // existir. Limpar o campo aqui — via `patchScene`, não com um
          // `deleteHotspot` direto — é o que faz a própria captura de diff
          // empilhar o id em `hotspotsParaApagar`: o MESMO caminho de
          // exclusão de um ponto removido da tela, e não um segundo. Sem
          // isto, o ponto — se reapontado num salvamento seguinte —
          // chegaria com um `serverId` já apagado no servidor, e o PATCH em
          // cima dele falharia para sempre.
          if (h.serverId) {
            this.patchScene(scene.id, (s) => ({
              ...s,
              hotspots: s.hotspots.map((x) =>
                x.id === h.id ? { ...x, serverId: undefined } : x,
              ),
            }));
          }
          continue;
        }

        const dados = {
          positionX: h.u,
          positionY: h.v,
          ...(h.label.trim() ? { label: h.label.trim() } : {}),
        };

        if (h.serverId) {
          await firstValueFrom(
            this.virtualTourService.atualizarHotspot(h.serverId, dados),
          );
          continue;
        }

        const criado = await firstValueFrom(
          this.virtualTourService.createHotspot({
            panoramaId: origem,
            targetId: destino,
            ...dados,
          }),
        );

        // O laço percorre o SNAPSHOT `cenasFinais`, e o corretor continua
        // editando durante os `await`. Um ponto apagado nesse meio-tempo ainda
        // chega até aqui e é criado no servidor — e o `patchScene` abaixo não
        // acharia onde gravar o `serverId`. Como a captura de diff do
        // `patchScene` também não veria `serverId` nenhum sumir (nunca houve
        // um), o hotspot ficaria no servidor para sempre e reapareceria na
        // próxima retomada. Empilhar o id novo na fila de exclusão o manda
        // embora pelo mesmo caminho de qualquer outro ponto removido.
        const aindaExiste = this.scenes()
          .find((s) => s.id === scene.id)
          ?.hotspots.some((x) => x.id === h.id);
        if (!aindaExiste) {
          this.hotspotsParaApagar.update((ids) => [...ids, criado.id]);
          continue;
        }

        // Gravado UM A UM: se o laço morrer no meio, o retry precisa saber
        // exatamente o que já entrou para não criar em dobro.
        this.patchScene(scene.id, (s) => ({
          ...s,
          hotspots: s.hotspots.map((x) =>
            x.id === h.id ? { ...x, serverId: criado.id } : x,
          ),
        }));
      }
    }
    this.discardedHotspots.set(descartados);

    // Todo hotspot que precisa sumir do servidor chega aqui pelo MESMO
    // caminho: o que perdeu o destino (limpo acima, no laço principal) e o
    // que saiu da tela inteiramente — removido pelo editor ou levado junto
    // de uma cena apagada (`patchScene`/`removeScene`). Um só mecanismo de
    // exclusão, não dois.
    const paraApagar = this.hotspotsParaApagar();
    for (const id of paraApagar) {
      // Falha aqui é benigna: um ponto órfão a mais é melhor que abortar a
      // publicação inteira.
      await firstValueFrom(this.virtualTourService.deleteHotspot(id)).catch(
        () => undefined,
      );
    }
    // Drena só o que este laço consumiu, nunca o sinal inteiro: uma remoção
    // concorrente durante os `await` acima — o corretor apagando outro ponto
    // enquanto este salvamento está em voo — empilharia um id novo ali, e um
    // `set([])` o jogaria fora sem nunca virar `DELETE`.
    this.hotspotsParaApagar.update((ids) =>
      ids.filter((id) => !paraApagar.includes(id)),
    );

    const p = this.property();
    // Monta só o que tem conteúdo. Um rascunho recém-começado não tem nada da
    // etapa 3, e `PATCH /properties/:id` recusa corpo vazio de propósito —
    // mandar assim trocaria "não havia o que salvar" por um 400 que quem
    // chamou não sabe distinguir de rede fora. No `publish()`, os três campos
    // já passaram por `invalidFields()` e chegam aqui sempre preenchidos —
    // a diferença só aparece no salvamento intermediário.
    const camposDoImovel = {
      ...(p.name.trim() ? { title: p.name.trim() } : {}),
      ...(p.type ? { type: p.type as string } : {}),
      ...(p.purpose ? { purpose: p.purpose as string } : {}),
      ...(this.addressTouched()
        ? {
            address: {
              street: p.address.street.trim(),
              number: p.address.number.trim() || undefined,
              complement: p.address.complement.trim() || undefined,
              district: p.address.district.trim() || undefined,
              city: p.address.city.trim(),
              state: p.address.state.trim().toUpperCase(),
              zipCode: p.address.zip.replace(/\D/g, '') || undefined,
            },
          }
        : {}),
    };

    if (Object.keys(camposDoImovel).length) {
      await firstValueFrom(
        this.propertyService.updateProperty(
          this.rascunhoPropertyId()!,
          camposDoImovel,
        ),
      );
    }
  }

  /**
   * Fecha o tour: garante que tudo o que está na tela foi salvo, e publica.
   *
   * Curto porque o trabalho pesado já não é dele — `salvarRascunho()` cuida do
   * formulário do imóvel, dos hotspots e da reconciliação dos panoramas. O que
   * sobra aqui é só a troca de status, que é o único passo que torna o tour
   * visível fora da imobiliária.
   *
   * Ambiente ainda em montagem NÃO segura a publicação. O tratamento termina no
   * servidor, e `GET /panoramas/:id/image` passa a servir a imagem tratada
   * assim que ela existe. Prender o corretor numa tela de espera por algo que
   * acontece sozinho era o custo que este fluxo veio eliminar.
   */
  async publish(): Promise<void> {
    if (this.publishing()) return;

    if (this.invalidFields().length) {
      // O botão já vem desabilitado, mas teclado e leitor de tela chegam aqui
      // por caminhos que não passam pelo estado visual dele.
      this.showErrors.set(true);
      return;
    }

    this.publishing.set(true);
    this.publishError.set(null);
    try {
      await this.salvarRascunho();

      // Por último: até esta linha nada é visível fora da imobiliária. Se algo
      // acima falhar, o rascunho continua rascunho e o retry reaproveita tudo o
      // que já subiu, em vez de duplicar imóvel a cada tentativa.
      await firstValueFrom(
        this.virtualTourService.publicarTour(this.rascunhoTourId()!),
      );

      this.publishedTourId.set(this.rascunhoTourId());
      this.publishedPropertyId.set(this.rascunhoPropertyId());
      this.published.set(true);
    } catch (error) {
      this.publishError.set(publishErrorKey(error));
    } finally {
      this.publishing.set(false);
    }
  }

  /**
   * Joga fora a captura em andamento.
   *
   * Apaga o **imóvel**, não o tour. `VirtualTour.property` é
   * `onDelete: Cascade`, então uma chamada derruba tour, panoramas, hotspots e
   * frames de uma vez — e apagar só o tour deixaria para trás um imóvel órfão
   * chamado "Captura em andamento". Imóvel sem tour nenhum passa pelo filtro
   * da listagem, que esconde quem tem tour DRAFT e não quem não tem tour: o
   * descarte pela metade apareceria no catálogo como a linha vazia que aquele
   * filtro existe para evitar.
   */
  async descartarRascunho(): Promise<void> {
    // Antes da ida à rede, e não só no `reset()` do fim: o que invalida uma
    // gravação enfileirada é a DECISÃO de descartar, não a confirmação do
    // servidor. Entre uma e outra cabe a rodada que recriaria o imóvel.
    this.geracao++;

    const propertyId = this.rascunhoPropertyId();
    if (propertyId) {
      await firstValueFrom(this.propertyService.deleteProperty(propertyId));
    }
    this.reset();
  }

  /** "Criar outro tour": volta tudo ao estado inicial. */
  reset(): void {
    // Mesma razão do `removeScene`: os blobs das imagens tratadas não somem
    // sozinhos quando a lista é zerada.
    for (const scene of this.scenes()) {
      if (scene.treatedImageUrl) URL.revokeObjectURL(scene.treatedImageUrl);
    }
    // As cenas retomadas que já chegaram a pedir a própria foto (Tarefa 10)
    // guardam o `blob:` no cache, não na cena — soltar aqui é o que falta
    // para nenhum dos dois jeitos de imagem sobreviver ao reset.
    this.imagens.liberar();
    this.step.set(1);
    this.scenes.set([]);
    this.selectedSceneId.set(null);
    this.property.set({ ...EMPTY_PROPERTY });
    this.published.set(false);
    this.publishing.set(false);
    this.showErrors.set(false);
    this.publishedTourId.set(null);
    this.publishedPropertyId.set(null);
    this.discardedHotspots.set(0);
    this.publishError.set(null);
    // O rascunho anterior já virou tour publicado; zerar aqui faz a próxima
    // captura criar o seu, em vez de acrescentar cômodos ao imóvel recém-criado.
    this.rascunhoTourId.set(null);
    this.rascunhoPropertyId.set(null);
    this.hotspotsParaApagar.set([]);
    this.miniaturas.set({});
    this.miniaturasQueFalharam.clear();

    // A partir daqui, toda gravação PEDIDA antes deste ponto vira no-op: sem
    // isto, uma rodada enfileirada antes de um descarte rodava depois dele,
    // via os ids nulos e recriava no servidor o imóvel que acabou de ser
    // apagado. Ver `geracao`.
    this.geracao++;
    this.salvandoRascunho = null;
    // A rodada pendente é RESOLVIDA, não rejeitada: não há mais rascunho a
    // salvar, e quem a espera (sair do wizard, publicar) não tem o que fazer
    // com um erro sobre um rascunho que deixou de existir.
    const pendente = this.proximaGravacao;
    this.proximaGravacao = null;
    pendente?.resolver();
  }
}

/**
 * Mensagem à altura do que falhou.
 *
 * 413 é a falha previsível deste fluxo — as fotos somam mais do que o servidor
 * aceita numa requisição — e é a única com conserto do lado do corretor: tirar
 * um ambiente ou reduzir as imagens. Dizer só "não deu para publicar" o deixaria
 * repetindo o mesmo envio de dezenas de MB para receber o mesmo resultado.
 */
function publishErrorKey(error: unknown): string {
  const status = (error as HttpErrorResponse | undefined)?.status;
  return status === 413
    ? 'TOUR_WIZARD.STEP3.WARN_SIZE'
    : 'TOUR_WIZARD.SUCCESS.PUBLISH_ERROR';
}

/**
 * O `roomName` que um SALVAMENTO DE RASCUNHO pode mandar ao servidor.
 *
 * Nome vazio manda campo nenhum, e nunca o `fileName`. O salvamento de rascunho
 * roda por caminhos que não passam por `canAdvance` — o `visibilitychange`, por
 * exemplo, dispara com o app indo para segundo plano —, e gravar
 * "captura-360-1.jpg" ali fazia esse texto voltar como nome de verdade na
 * retomada: `ambientesSemNome` ficava vazio e o portão da etapa 1 parava de
 * proteger justamente quem mais precisava dele.
 *
 * No publicar isso não muda nada: para chegar à etapa 3 é preciso ter passado
 * pelo portão da etapa 1, que só libera com todo ambiente nomeado.
 */
function nomeDeRascunho(scene: WizardScene): { roomName?: string } {
  const nome = scene.room.trim();
  return nome ? { roomName: nome } : {};
}

function rejectionFor(file: File): WizardSceneRejection | null {
  if (!file.type.startsWith('image/')) return 'type';
  if (file.size > MAX_FILE_BYTES) return 'size';
  return null;
}

/**
 * Bytes reais por trás de uma dataURL base64.
 *
 * `dataUrl.length` conta caracteres, e base64 gasta 4 caracteres a cada 3
 * bytes: usar o comprimento direto inflava o tamanho em ~33%, mostrando "12,3
 * MB" para um panorama de 9 MB — perto do teto de 25 MB que a própria tela
 * anuncia, e portanto assustando à toa.
 */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * O ambiente nasce SEM nome, de propósito.
 *
 * Antes vinha o nome do arquivo sem a extensão, e o efeito era o contrário do
 * pretendido: "IMG_2841" num campo de texto lê como "já preenchido", e ninguém
 * sente que precisa mexer. O preço aparecia duas telas depois, na etapa 2, onde
 * o seletor de destino oferecia "IMG_2841, IMG_2843, IMG_2847" — impossível
 * saber qual é a cozinha.
 *
 * Campo vazio com placeholder pede para ser preenchido. E, junto com a regra
 * que segura a etapa 1 enquanto houver ambiente sem nome, dá a garantia que se
 * quereria de uma etapa dedicada a nomear — sem etapa nenhuma a mais.
 *
 * O `fileName` continua guardado na cena e segue servindo de reserva no
 * publicar: nome vazio que escape por algum caminho vira o arquivo, e não vazio.
 */
function defaultRoomName(): string {
  return '';
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Largura ÷ altura da imagem.
 *
 * Decodificar é a única forma de saber: o `type` do File diz que é JPEG, não
 * que é um panorama. Um `<img>` fora do documento basta — só as dimensões
 * interessam, e nada disso vai para a tela.
 */
function measureAspectRatio(dataUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
    // Não decodificou como imagem: o arquivo mentiu no tipo, e aí é recusa de
    // verdade — quem chama transforma isso em `rejected`.
    img.onerror = () => reject(new Error('not a decodable image'));
    img.src = dataUrl;
  });
}

function isEquirectangular(ratio: number): boolean {
  return Math.abs(ratio - EQUIRECTANGULAR_RATIO) <= RATIO_TOLERANCE;
}
