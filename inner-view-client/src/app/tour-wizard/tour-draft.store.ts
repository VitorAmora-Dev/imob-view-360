import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PropertyService } from '../services/property.service';
import { VirtualTourService } from '../services/virtual-tour.service';
import { toCreateTourPayload } from './publish-payload';
import {
  AddressDraft,
  EMPTY_PROPERTY,
  EQUIRECTANGULAR_RATIO,
  MAX_FILE_BYTES,
  PropertyDraft,
  RATIO_TOLERANCE,
  ROOM_NAME_MAX,
  WizardScene,
  WizardSceneRejection,
  WizardStep,
} from './tour-wizard.model';

/**
 * Campos do endereço que a validação cobra. Ficam numa lista porque o acordeão
 * precisa saber se algum deles está errado para se abrir — ver `addressHasError`.
 */
const ADDRESS_FIELDS = ['street', 'city', 'state'] as const;

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
  readonly canAdvance = computed(() => this.readyScenes().length > 0);

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
    if (!this.canAdvance()) return;
    this.step.set((current + 1) as WizardStep);
  }

  back(): void {
    const current = this.step();
    if (current === 1) return;
    this.step.set((current - 1) as WizardStep);
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
        room: defaultRoomName(file.name),
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
      } catch {
        this.patchScene(scene.id, (s) => ({
          ...s,
          state: 'rejected',
          rejectedReason: 'type',
        }));
      }
      this.selectedSceneId.update((id) => id ?? scene.id);
    }
  }

  /** Cenas aceitas mas com ressalva — alimenta o aviso antes de publicar. */
  readonly warnedScenes = computed(() =>
    this.scenes().filter((s) => s.state === 'ready' && s.warning),
  );

  /** Adiciona um ambiente já pronto — usado pela captura 360 guiada (A6). */
  addCapturedScene(scene: Omit<WizardScene, 'id' | 'order' | 'hotspots' | 'state'>): void {
    const created: WizardScene = {
      ...scene,
      id: crypto.randomUUID(),
      order: this.scenes().length,
      hotspots: [],
      state: 'ready',
    };
    this.scenes.update((list) => [...list, created]);
    this.selectedSceneId.update((id) => id ?? created.id);
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
      this.selectedSceneId.set(this.scenes()[0]?.id ?? null);
    }
    // Removeu a última imagem: as etapas 2 e 3 deixam de se sustentar. Ficar
    // parado nelas deixaria o corretor com o botão do rodapé desabilitado e o
    // conserto duas telas atrás — e o stepper marcando a etapa 1 como concluída
    // sem nenhuma foto. Devolver à etapa 1 põe o problema e a solução no mesmo
    // lugar.
    if (!this.canAdvance()) this.step.set(1);
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

  /** Onde o publicar parou, para a tela de espera. Espelha o fluxo antigo. */
  readonly montagem = signal<'fotos' | 'ia' | null>(null);
  readonly montagemProntos = signal(0);
  readonly montagemTotal = signal(0);

  /** Id do tour criado — vira o link de compartilhamento na tela de sucesso. */
  readonly publishedTourId = signal<string | null>(null);
  readonly publishedPropertyId = signal<string | null>(null);

  /** Pontos sem destino que ficaram de fora. Vira aviso, não erro. */
  readonly discardedHotspots = signal(0);

  readonly publishError = signal<string | null>(null);

  /**
   * Cria o imóvel e o tour, sobe as fotos originais e conduz a montagem por IA.
   *
   * O tour inteiro — ambientes e hotspots — sobe numa chamada só: o servidor
   * aceita os hotspots inline e resolve os destinos por `tempId` na mesma
   * transação. Ver §2.2 do plano do sprint.
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
      const { panoramas, discardedHotspots } = toCreateTourPayload(this.scenes());
      this.discardedHotspots.set(discardedHotspots);

      const p = this.property();
      // Tentativa repetida depois de o imóvel já ter sido criado reaproveita o
      // que existe. Sem isto, cada clique no botão — e agora que a falha é
      // visível vai haver cliques — gera um `code` novo e insere OUTRO imóvel,
      // deixando um órfão sem tour na listagem da imobiliária a cada tentativa.
      //
      // O preço é não levar edições do formulário feitas entre a falha e o
      // retry: a API não tem PATCH de imóvel. Duplicata suja o cadastro de quem
      // não fez nada errado; nome desatualizado o corretor conserta depois.
      const propertyId =
        this.publishedPropertyId() ??
        (
          await firstValueFrom(
            this.propertyService.createProperty({
              // O código é gerado aqui como na tela antiga: a API exige um, e o
              // corretor não tem por que inventar um identificador interno.
              code: `IML-${Date.now().toString(36).toUpperCase()}`,
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
          )
        ).id;
      this.publishedPropertyId.set(propertyId);

      const tour = await firstValueFrom(
        this.virtualTourService.createTour(propertyId, panoramas),
      );
      this.publishedTourId.set(tour.id);

      // A partir daqui o tour EXISTE e é navegável. Nada abaixo pode desfazer
      // isso, então a montagem roda em best-effort e a tela de sucesso aparece
      // de qualquer jeito.
      this.published.set(true);
      await this.montarTour(tour.id);
    } catch {
      this.publishError.set('TOUR_WIZARD.SUCCESS.PUBLISH_ERROR');
    } finally {
      this.publishing.set(false);
    }
  }

  /**
   * Sobe as fotos originais e acompanha a montagem por IA.
   *
   * O envio é aguardado: a montagem usa as fotos como referência do que existe
   * de verdade no cômodo, e disparar antes de elas chegarem faz o servidor
   * dispensar o panorama.
   *
   * Nada aqui derruba o tour. Se falhar, o corretor fica com os panoramas
   * originais — que é exatamente o que ele teria sem esta etapa.
   */
  private async montarTour(tourId: string): Promise<void> {
    const comFrames = this.readyScenes().filter((s) => s.frames?.length);
    if (!comFrames.length) return;

    try {
      this.montagem.set('fotos');
      this.montagemProntos.set(0);
      this.montagemTotal.set(comFrames.length);

      const tour = await firstValueFrom(this.virtualTourService.findTour(tourId));
      let enviadas = 0;
      for (const [i, scene] of comFrames.entries()) {
        const panorama = tour.panoramas.find((p) => p.roomName === scene.room);
        if (panorama && scene.frames?.length) {
          const r = await this.virtualTourService.uploadCaptureFrames(
            panorama.id,
            scene.frames,
          );
          enviadas += r.uploaded;
        }
        this.montagemProntos.set(i + 1);
      }

      // Sem nenhuma foto no servidor a montagem não tem verdade de campo e todo
      // panorama seria dispensado. Mostrar uma tela de IA para uma etapa que já
      // se sabe que não vai acontecer é pior que não mostrar nada.
      if (enviadas === 0) return;

      this.montagem.set('ia');
      this.montagemProntos.set(0);
      const inicio = await firstValueFrom(this.virtualTourService.montarTour(tourId));
      this.montagemTotal.set(inicio.total);

      await this.virtualTourService.acompanharMontagem(tourId, (a) => {
        this.montagemTotal.set(a.total);
        this.montagemProntos.set(a.prontos + a.falhas + a.dispensados);
      });
    } catch {
      // O tour já está salvo; seguir para ele é melhor que travar aqui.
    } finally {
      this.montagem.set(null);
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
    this.montagem.set(null);
  }
}

function rejectionFor(file: File): WizardSceneRejection | null {
  if (!file.type.startsWith('image/')) return 'type';
  if (file.size > MAX_FILE_BYTES) return 'size';
  return null;
}

function defaultRoomName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').slice(0, ROOM_NAME_MAX);
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
