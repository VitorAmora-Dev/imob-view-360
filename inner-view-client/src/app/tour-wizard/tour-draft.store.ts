import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VirtualTour } from '../models/virtual-tour.model';
import { PropertyService } from '../services/property.service';
import {
  AndamentoDaMontagem,
  TreatmentStatus,
  VirtualTourService,
} from '../services/virtual-tour.service';
import { toCreateTourPayload } from './publish-payload';
import * as grafo from './scene-graph';
import {
  AddressDraft,
  EMPTY_PROPERTY,
  EQUIRECTANGULAR_RATIO,
  MAX_FILE_BYTES,
  PropertyDraft,
  RATIO_TOLERANCE,
  ROOM_NAME_MAX,
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
  readonly etapa2Opcional = computed(() => this.readyScenes().length < 2);

  /** Dica da barra de progresso. Ver `etapa2Opcional`. */
  readonly hintKey = computed(() =>
    this.step() === 2 && !this.etapa2Opcional()
      ? 'TOUR_WIZARD.COMMON.HINT_2_REQUIRED'
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
    if (this.step() === 2) return this.ambientesIlhados().length === 0;
    return true;
  });

  /** Soma de TODOS os ambientes, não só o selecionado — é o que o resumo mostra. */
  readonly totalHotspots = computed(() =>
    this.scenes().reduce((n, s) => n + s.hotspots.length, 0),
  );

  readonly progressPct = computed(() =>
    this.published() ? 100 : (this.step() / 3) * 100,
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
   * Troca de etapa e apaga as marcas de erro.
   *
   * `showErrors` significa "esta pessoa já tentou e não deu" — e isso é sobre a
   * etapa em que ela tentou. Carregá-lo para a seguinte faria a etapa 3 abrir
   * com campos em vermelho antes de qualquer tentativa, que é exatamente o
   * "repreender antes de haver erro" que ele existe para evitar.
   */
  private irPara(step: WizardStep): void {
    this.showErrors.set(false);
    this.step.set(step);
  }

  next(): void {
    const current = this.step();
    if (current === 3) {
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

    // Sem `await`: a cena já está na lista e a tela precisa responder agora. O
    // corretor está de pé dentro do cômodo, e prendê-lo aqui por um upload é a
    // versão bloqueante que esta mudança existe para evitar.
    if (!rejeitada && created.frames?.length) this.enfileirarEnvio(created.id);
  }

  // ---- montagem por IA em segundo plano ----------------------------------

  /**
   * Envio de um ambiente por vez.
   *
   * Serial de propósito. Duas capturas confirmadas em sequência disputariam a
   * criação do rascunho e criariam dois imóveis, e o paralelismo que interessa
   * — três montagens ao mesmo tempo — já acontece do lado do servidor. Aqui o
   * gargalo é a rede do celular dentro de um imóvel, onde subir dois conjuntos
   * de fotos ao mesmo tempo só deixa os dois mais lentos.
   */
  private filaDeEnvio: Promise<void> = Promise.resolve();

  /**
   * A fila, para o teste poder esperar por ela.
   *
   * O envio é disparado sem `await` de propósito — é isso que faz a captura
   * responder na hora. Sem um ponto de sincronia exposto, um teste do disparo
   * só teria `setTimeout` com um número chutado, que passa na máquina de quem
   * escreveu e falha na de outra pessoa.
   */
  get filaDeEnvioParaTeste(): Promise<void> {
    return this.filaDeEnvio;
  }

  /** Evita dois laços de acompanhamento sobre o mesmo tour. */
  private acompanhando = false;

  private enfileirarEnvio(sceneId: string): void {
    this.filaDeEnvio = this.filaDeEnvio.then(() => this.subirAmbiente(sceneId));
  }

  /**
   * Cria o panorama no servidor, sobe as fotos originais e pede a montagem.
   *
   * A ordem é obrigatória e o servidor documenta por quê: sem pelo menos quatro
   * fotos originais gravadas, `montar` dispensa o panorama na hora e ainda o
   * deixa preso na guarda de idempotência, o que transformaria a chamada
   * seguinte num no-op silencioso.
   *
   * Nada aqui derruba o wizard. Falhar significa que o corretor publica com o
   * panorama costurado — exatamente o que ele teria sem esta etapa.
   */
  private async subirAmbiente(sceneId: string): Promise<void> {
    // Relê do signal em vez de usar o objeto capturado: entre entrar na fila e
    // chegar aqui, a cena pode ter sido renomeada ou removida.
    const scene = this.scenes().find((s) => s.id === sceneId);
    if (!scene || scene.state !== 'ready' || !scene.frames?.length) return;
    if (this.abortar.signal.aborted) return;

    this.marcarIa(sceneId, 'uploading');
    try {
      const tourId = await this.garantirRascunho();
      if (this.abortar.signal.aborted) return;

      const panorama = await firstValueFrom(
        this.virtualTourService.addPanorama(tourId, {
          roomName: scene.room.trim() || scene.fileName,
          imageData: scene.imageData,
          order: scene.order,
          initialPanorama: scene.order === 0,
          ...(scene.geometry ?? {}),
        }),
      );
      this.patchScene(sceneId, (s) => ({ ...s, serverPanoramaId: panorama.id }));

      const { uploaded } = await this.virtualTourService.uploadCaptureFrames(
        panorama.id,
        scene.frames,
      );
      if (this.abortar.signal.aborted) return;

      // Menos de quatro referências e o servidor dispensa em vez de tratar.
      // Pedir a montagem assim mesmo gastaria uma ida à rede para receber um
      // SKIPPED — e o corretor veria "melhorando" por nada.
      if (uploaded < 4) {
        this.marcarIa(sceneId, uploaded === 0 ? 'failed' : 'skipped');
        return;
      }

      await firstValueFrom(this.virtualTourService.montarTour(tourId));
      this.marcarIa(sceneId, 'processing');
      void this.acompanhar(tourId);
    } catch {
      this.marcarIa(sceneId, 'failed');
    }
  }

  /**
   * Cria o imóvel e o tour na primeira captura, e devolve o mesmo tour depois.
   *
   * O imóvel nasce como marcador: os dados de verdade só existem na etapa 3, e
   * esperar por eles adiaria a montagem para depois da captura inteira, que é
   * justamente o que estamos deixando de fazer. Ele não aparece em lugar nenhum
   * enquanto o tour estiver em rascunho — a listagem filtra.
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
            // Marcadores, não dados. A etapa 3 sobrescreve os três por PATCH.
            title: 'Captura em andamento',
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
   * Acompanha a montagem e vai trocando o estado de cada cena conforme ela
   * termina.
   *
   * O laço para quando tudo o que existe hoje chegou a um estado terminal. Um
   * ambiente capturado depois disso reabre o laço pelo `subirAmbiente`, e a
   * verificação no fim cobre a janela em que os dois se cruzam: sem ela, uma
   * captura confirmada no instante exato do último polling ficaria em
   * "melhorando" para sempre.
   */
  private async acompanhar(tourId: string): Promise<void> {
    if (this.acompanhando) return;
    this.acompanhando = true;
    try {
      await this.virtualTourService.acompanharMontagem(
        tourId,
        (a) => this.aplicarAndamento(a),
        { sinal: this.abortar.signal },
      );
    } catch {
      // Perder o acompanhamento não perde a montagem: ela roda no servidor, e
      // a imagem tratada aparece no tour publicado de qualquer forma.
    } finally {
      this.acompanhando = false;
    }

    if (this.abortar.signal.aborted) return;
    if (this.scenes().some((s) => s.aiState === 'processing')) {
      void this.acompanhar(tourId);
    }
  }

  private aplicarAndamento(andamento: AndamentoDaMontagem): void {
    for (const p of andamento.panoramas) {
      const scene = this.scenes().find((s) => s.serverPanoramaId === p.id);
      if (!scene) continue;

      const estado = ESTADO_DA_IA[p.status];
      if (scene.aiState === estado) continue;

      this.patchScene(scene.id, (s) => ({
        ...s,
        aiState: estado,
        ...(estado === 'done'
          ? {
              // O `v` desempata o cache do navegador: a URL é a mesma antes e
              // depois do tratamento, e sem ele o <img>/textura já carregada
              // continuaria valendo.
              treatedImageUrl: this.virtualTourService.urlDoPreview(
                p.id,
                'treated',
                String(Date.now()),
              ),
            }
          : {}),
      }));
    }
  }

  private marcarIa(sceneId: string, aiState: WizardSceneAiState): void {
    this.patchScene(sceneId, (s) => ({ ...s, aiState }));
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
    const remoto = this.scenes().find((s) => s.id === id)?.serverPanoramaId;
    if (remoto) {
      void firstValueFrom(this.virtualTourService.deletePanorama(remoto)).catch(
        () => undefined,
      );
    }

    this.scenes.update((list) =>
      list
        .filter((s) => s.id !== id)
        .map((s, i) => ({
          ...s,
          order: i,
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
   */
  patchScene(id: string, fn: (scene: WizardScene) => WizardScene): void {
    this.scenes.update((list) =>
      list.map((s) => (s.id === id ? fn(s) : s)),
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
   * Ids dos hotspots que já subiram, para o retry poder desfazê-los.
   *
   * Fica aqui e não em `WizardHotspot` porque o modelo afirma que o `id` de um
   * hotspot nunca é o do servidor — e essa afirmação é lida pela outra frente.
   */
  private readonly hotspotsNoServidor = signal<string[]>([]);

  /** Id do tour publicado — vira o link de compartilhamento na tela de sucesso. */
  readonly publishedTourId = signal<string | null>(null);
  readonly publishedPropertyId = signal<string | null>(null);


  /** Pontos sem destino que ficaram de fora. Vira aviso, não erro. */
  readonly discardedHotspots = signal(0);

  readonly publishError = signal<string | null>(null);

  /**
   * Fecha o tour: grava os dados do imóvel, liga os pontos de passagem e
   * publica.
   *
   * Curto porque o trabalho pesado já aconteceu. Os panoramas e as fotos
   * originais subiram durante a captura, cômodo a cômodo, e a montagem por IA
   * rodou junto. O que sobra aqui é o que só existe no fim: o formulário do
   * imóvel, os hotspots — que dependem de todos os ambientes existirem — e a
   * troca de status.
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
      // Espera a fila de envio drenar. Sem isto, um clique em "criar tour"
      // logo depois da última captura publicaria o tour sem o último cômodo —
      // ele ainda estaria a caminho.
      await this.filaDeEnvio;

      const tourId = await this.garantirRascunho();
      const prontas = this.readyScenes();

      // Cena vinda de arquivo nunca passou pelo envio em segundo plano, porque
      // não tem fotos originais e não haveria o que a IA tratar. Ela entra
      // aqui, no mesmo caminho, só que sem montagem.
      for (const [ordem, scene] of prontas.entries()) {
        if (scene.serverPanoramaId) continue;
        const panorama = await firstValueFrom(
          this.virtualTourService.addPanorama(tourId, {
            roomName: scene.room.trim() || scene.fileName,
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
              roomName: scene.room.trim() || scene.fileName,
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
      const ligacoes: Array<{
        panoramaId: string;
        targetId: string;
        positionX: number;
        positionY: number;
        label?: string;
      }> = [];
      let descartados = 0;

      for (const scene of cenasFinais) {
        const origem = porCena.get(scene.id);
        for (const h of scene.hotspots) {
          const destino = h.target ? porCena.get(h.target) : undefined;
          // Ponto sem destino é inerte: some do viewer do visitante e ninguém
          // entende por quê. Descartar e avisar é melhor que publicar morto.
          if (!origem || !destino) {
            descartados++;
            continue;
          }
          ligacoes.push({
            panoramaId: origem,
            targetId: destino,
            positionX: h.u,
            positionY: h.v,
            ...(h.label.trim() ? { label: h.label.trim() } : {}),
          });
        }
      }
      this.discardedHotspots.set(descartados);

      // Apaga o que uma tentativa anterior já tinha criado, e recria do zero.
      //
      // `createHotspot` não é idempotente: cada chamada insere uma linha. Como
      // os passos abaixo — dados do imóvel e publicar — podem falhar depois
      // deste ponto, e o botão volta a ficar clicável, um segundo clique
      // publicava o tour com cada ponto de passagem duplicado. O código antigo
      // não tinha o problema porque os hotspots subiam dentro da transação que
      // criava o tour; foi quebrar o publicar em passos que abriu o buraco.
      //
      // Apagar e recriar, em vez de pular os que já existem: entre a falha e o
      // retry o corretor pode ter apagado ou movido um ponto na etapa 2, e só
      // recriando o tour publicado reflete o que ele está vendo na tela. São
      // poucos pontos por tour, e na primeira tentativa esta lista é vazia.
      for (const id of this.hotspotsNoServidor()) {
        // Falha aqui é benigna: um ponto órfão a mais é melhor que abortar a
        // publicação inteira. O `catch` evita que isso derrube o retry.
        await firstValueFrom(this.virtualTourService.deleteHotspot(id)).catch(
          () => undefined,
        );
      }
      this.hotspotsNoServidor.set([]);

      for (const ligacao of ligacoes) {
        const criado = await firstValueFrom(
          this.virtualTourService.createHotspot(ligacao),
        );
        // Registrado UM A UM, e não em lote no fim: se o laço morrer no meio,
        // o retry precisa saber exatamente o que já entrou para poder apagar.
        this.hotspotsNoServidor.update((ids) => [...ids, criado.id]);
      }

      const p = this.property();
      await firstValueFrom(
        this.propertyService.updateProperty(this.rascunhoPropertyId()!, {
          title: p.name.trim(),
          type: p.type as string,
          purpose: p.purpose as string,
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
        }),
      );

      // Por último: até esta linha nada é visível fora da imobiliária. Se algo
      // acima falhar, o rascunho continua rascunho e o retry reaproveita tudo o
      // que já subiu, em vez de duplicar imóvel a cada tentativa.
      await firstValueFrom(this.virtualTourService.publicarTour(tourId));

      this.publishedTourId.set(tourId);
      this.publishedPropertyId.set(this.rascunhoPropertyId());
      this.published.set(true);
    } catch (error) {
      this.publishError.set(publishErrorKey(error));
    } finally {
      this.publishing.set(false);
    }
  }

  /** "Criar outro tour": volta tudo ao estado inicial. */
  reset(): void {
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
    this.hotspotsNoServidor.set([]);
    this.filaDeEnvio = Promise.resolve();
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
