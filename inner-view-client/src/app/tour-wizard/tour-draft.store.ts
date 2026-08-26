import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VirtualTour } from '../models/virtual-tour.model';
import { CaptureFrameUpload, CaptureGeometry } from '../services/virtual-tour.service';
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

  /** "Criar outro tour": volta tudo ao estado inicial. */
  reset(): void {
    // Mesma razão do `removeScene`: os blobs das imagens tratadas não somem
    // sozinhos quando a lista é zerada.
    for (const scene of this.scenes()) {
      if (scene.treatedImageUrl) URL.revokeObjectURL(scene.treatedImageUrl);
    }
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
