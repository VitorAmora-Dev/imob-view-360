import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { VirtualTour, Panorama } from '../models/virtual-tour.model';

/**
 * Um hotspot enviado junto do panorama que o origina.
 *
 * O destino vai como `targetTempId` porque, na hora do envio, nenhum panorama
 * tem id ainda — todos nascem na mesma transação. O servidor monta um
 * `Map<tempId, uuid>` enquanto cria os panoramas e só então amarra os hotspots.
 */
export interface HotspotUpload {
  label?: string;
  /** UV 0–1, o mesmo par que `PanoramicViewerComponent` emite. */
  positionX: number;
  positionY: number;
  targetTempId: string;
}

export interface PanoramaUpload {
  /**
   * Identificador provisório, escolhido pelo cliente, usado pelos hotspots
   * desta mesma requisição para apontar uns aos outros. Quando ausente,
   * `createTour` gera um por índice.
   */
  tempId?: string;
  roomName: string;
  imageData: string;
  order?: number;
  initialPanorama?: boolean;
  /** Criados junto com o panorama, numa transação só. */
  hotspots?: HotspotUpload[];
  /** Present only for guided captures — see `CaptureGeometry`. */
  fittedVfovDeg?: number;
  bandTopDeg?: number;
  bandBottomDeg?: number;
}

/**
 * What the stitch knows about the sphere it produced.
 *
 * The fill over the poles is deliberately plausible, so nothing in the image
 * itself says which pixels were photographed and which were invented. These
 * three numbers do, and the AI pass has no other way to find out. They double
 * as field telemetry for the FOV fit: a capture arriving with a band far
 * narrower than the lens means the fit is being fooled again.
 */
export interface CaptureGeometry {
  fittedVfovDeg: number;
  bandTopDeg: number;
  bandBottomDeg: number;
}

/**
 * One original photo from a guided capture, still as the bytes the camera
 * produced. Kept as a Blob rather than base64 so only the one being sent is
 * ever expanded — a whole capture as base64 is over 10 MB of string.
 */
export interface CaptureFrameUpload {
  index: number;
  blob: Blob;
  quaternion: { x: number; y: number; z: number; w: number };
}

/** Como o servidor chama os estados do tratamento de um panorama. */
export type TreatmentStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'SKIPPED';

/** Uma linha da lista de capturas em andamento, para a home listar sem baixar o tour inteiro. */
export interface RascunhoResumo {
  id: string;
  propertyId: string;
  updatedAt: string;
  ambientes: number;
  capaPanoramaId: string | null;
}

/** Um cômodo do rascunho, com o que já foi gravado no servidor até agora. */
export interface RascunhoPanorama {
  id: string;
  roomName: string;
  order: number;
  initialPanorama: boolean;
  treatmentStatus: TreatmentStatus;
  hotspots: Array<{ id: string; label: string | null; positionX: number; positionY: number; targetId: string }>;
}

/** O tour em rascunho, como o servidor o guarda, para reidratar o wizard. */
export interface RascunhoCompleto {
  id: string;
  propertyId: string;
  status: string;
  updatedAt: string;
  property: {
    title: string;
    type: string;
    purpose: string;
    address: {
      street: string;
      number: string | null;
      complement: string | null;
      district: string | null;
      city: string;
      state: string;
      zipCode: string | null;
    } | null;
  };
  panoramas: RascunhoPanorama[];
}

/** Situação de um cômodo dentro da montagem, na ordem em que aparece no tour. */
export interface AndamentoDoPanorama {
  id: string;
  status: TreatmentStatus;
}

/** Andamento da montagem por IA de um tour inteiro. */
export interface AndamentoDaMontagem {
  total: number;
  prontos: number;
  falhas: number;
  dispensados: number;
  terminado: boolean;
  /**
   * Situação cômodo a cômodo. Os contadores acima dizem quanto falta; o wizard
   * precisa saber QUAL ficou pronto, para trocar aquela imagem na tela.
   */
  panoramas: AndamentoDoPanorama[];
}

const SESSION_ID_KEY = 'visitorSessionId';

@Injectable({ providedIn: 'root' })
export class VirtualTourService {
  private http = inject(HttpClient);

  findTour(id: string): Observable<VirtualTour> {
    return this.http.get<VirtualTour>(`${environment.apiUrl}/virtual-tours/${id}`);
  }

  /**
   * As capturas em andamento da imobiliária.
   *
   * Rota autenticada e sem paginação: rascunho é trabalho pela metade, não
   * catálogo. Quem tem uma dúzia deles tem outro problema, e a faixa da home
   * mostra os mais recentes primeiro.
   */
  listarRascunhos(): Observable<RascunhoResumo[]> {
    return this.http.get<RascunhoResumo[]>(`${environment.apiUrl}/virtual-tours`, {
      params: { status: 'DRAFT' },
    });
  }

  /**
   * O tour inteiro para reidratar o wizard.
   *
   * `/rascunho` e não `GET /virtual-tours/:id`: aquela é pública, filtra
   * `PUBLISHED`, e devolveria 404 em exatamente todo rascunho que esta função
   * existe para abrir.
   *
   * Não traz imagem. As fotos vêm depois, uma a uma, pelo `PanoramaImageCache`.
   */
  lerRascunho(tourId: string): Observable<RascunhoCompleto> {
    return this.http.get<RascunhoCompleto>(
      `${environment.apiUrl}/virtual-tours/${tourId}/rascunho`,
    );
  }

  /**
   * Move ou renomeia um hotspot que já existe no servidor.
   *
   * Existe para o salvamento não precisar apagar e recriar. Ver
   * `WizardHotspot.serverId`.
   */
  atualizarHotspot(
    id: string,
    dto: { positionX: number; positionY: number; label?: string },
  ): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(
      `${environment.apiUrl}/hotspots/${id}`,
      dto,
    );
  }

  /**
   * Cria o tour. `status` é explícito e sem default de propósito: o servidor
   * agora faz o tour nascer `DRAFT`, e quem sobe as panorâmicas todas de uma
   * vez precisa dizer que já quer o tour à vista. Um default aqui devolveria o
   * problema que o `PUBLISHED` fixo do servidor causava — só que mais escondido.
   */
  createTour(
    propertyId: string,
    panoramas: PanoramaUpload[],
    status: 'DRAFT' | 'PUBLISHED',
  ): Observable<VirtualTour> {
    return this.http.post<VirtualTour>(`${environment.apiUrl}/virtual-tours`, {
      propertyId,
      status,
      panoramas: panoramas.map((p, i) => ({ tempId: `p${i}`, ...p })),
    });
  }

  addPanorama(tourId: string, panorama: PanoramaUpload): Observable<Panorama> {
    return this.http.post<Panorama>(`${environment.apiUrl}/panoramas`, { tourId, ...panorama });
  }

  /**
   * Sends the capture's original photos, one request each, after the panorama
   * exists. The panorama is a computed result: keeping what it was computed
   * from is what lets a better stitch — or the AI pass — be run later without
   * sending anyone back to the property.
   *
   * Best-effort by design. These are an archive, not the deliverable, so a
   * failure here must never cost the user the tour they just captured; the
   * caller gets the tally and decides whether to say anything.
   */
  async uploadCaptureFrames(
    panoramaId: string,
    frames: CaptureFrameUpload[],
  ): Promise<{ uploaded: number; total: number }> {
    let uploaded = 0;
    for (const frame of frames) {
      try {
        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/panoramas/${panoramaId}/frames`, {
            index: frame.index,
            imageData: await frameParaDataUrl(frame.blob),
            quaternion: frame.quaternion,
          }),
        );
        uploaded++;
      } catch {
        // Already-sent frames stay; a retry re-posts by index rather than
        // duplicating, so nothing is lost by stopping here.
      }
    }
    return { uploaded, total: frames.length };
  }

  /**
   * Enfileira a montagem por IA dos panoramas do tour.
   *
   * Tem que ser chamado DEPOIS de `uploadCaptureFrames` terminar: o modelo usa
   * as fotos originais como referência do que existe de verdade no cômodo, e sem
   * elas o panorama é dispensado pelo servidor.
   */
  montarTour(tourId: string): Observable<AndamentoDaMontagem> {
    return this.http.post<AndamentoDaMontagem>(
      `${environment.apiUrl}/virtual-tours/${tourId}/montar`,
      {},
    );
  }

  andamentoDaMontagem(tourId: string): Observable<AndamentoDaMontagem> {
    return this.http.get<AndamentoDaMontagem>(
      `${environment.apiUrl}/virtual-tours/${tourId}/montagem`,
    );
  }

  /**
   * Acompanha a montagem até o fim, avisando a cada passo.
   *
   * Desiste depois de `limiteMs` e devolve o último andamento conhecido em vez
   * de lançar: o tour existe e é navegável desde o primeiro instante, com os
   * panoramas originais. Prender o corretor numa tela de espera indefinida seria
   * pior que abrir o tour com o que já está pronto.
   *
   * `sinal` encerra o laço quando quem pediu foi embora. Sem ele, sair da tela
   * no meio da montagem — o botão voltar do navegador basta — deixava este laço
   * girando por até dez minutos, chamando de volta um componente que já não
   * existe e segurando na memória, pela closure, tudo o que ele carregava.
   * A montagem em si não para: ela roda no servidor, e reabrir o tour mostra
   * onde chegou.
   */
  async acompanharMontagem(
    tourId: string,
    aoAvancar: (a: AndamentoDaMontagem) => void,
    { intervaloMs = 3000, limiteMs = 10 * 60 * 1000, sinal }: OpcoesDeAcompanhamento = {},
  ): Promise<AndamentoDaMontagem | null> {
    const ate = Date.now() + limiteMs;
    let ultimo: AndamentoDaMontagem | null = null;

    while (Date.now() < ate && !sinal?.aborted) {
      try {
        ultimo = await firstValueFrom(this.andamentoDaMontagem(tourId));
        // A resposta pode chegar depois da desistência: avisar aqui seria
        // escrever num estado que já foi destruído.
        if (sinal?.aborted) return ultimo;
        aoAvancar(ultimo);
        if (ultimo.terminado) return ultimo;
      } catch {
        // Falha de rede não encerra o acompanhamento: a montagem segue no
        // servidor, e a próxima tentativa reencontra o estado.
      }
      await espera(intervaloMs, sinal);
    }

    return ultimo;
  }

  /**
   * Publica o tour que estava em rascunho. É o passo final do wizard: até aqui
   * o tour existe, tem as fotos e já passou pela IA, mas nenhuma rota pública o
   * enxerga.
   */
  publicarTour(id: string): Observable<VirtualTour> {
    return this.http.patch<VirtualTour>(`${environment.apiUrl}/virtual-tours/${id}`, {
      status: 'PUBLISHED',
    });
  }

  /**
   * Ajusta o que pode ter mudado depois de o panorama já estar no servidor —
   * nome do cômodo, ordem, qual é a capa.
   *
   * NUNCA mande `imageData` por aqui: o servidor entende foto nova como
   * refotografia e zera o tratamento por IA junto (`update-panorama.service`),
   * jogando fora uma montagem já paga.
   */
  atualizarPanorama(
    id: string,
    patch: { roomName?: string; order?: number; initialPanorama?: boolean },
  ): Observable<Panorama> {
    return this.http.patch<Panorama>(`${environment.apiUrl}/panoramas/${id}`, patch);
  }

  /**
   * Endereço da imagem de um panorama para quem está editando o tour.
   *
   * Diferente de `imageUrl`, que só funciona depois de publicado: durante a
   * captura o tour está em rascunho e a rota pública responde 404. `treated`
   * cai na original enquanto a montagem não terminou.
   *
   * `largura` é o `w` que a rota já sabia atender e que ninguém pedia. Sem ele
   * a resposta é a equirretangular inteira — dezenas de MB —, e quem só vai
   * desenhar uma miniatura de 196×110 pagava esse download por cômodo, em toda
   * visita à home. Quem precisa da esfera (o viewer da etapa 2) continua
   * pedindo sem largura.
   */
  urlDoPreview(
    panoramaId: string,
    variante: 'treated' | 'original',
    opcoes: { largura?: number; versao?: string } = {},
  ): string {
    const v = opcoes.versao ? `&v=${encodeURIComponent(opcoes.versao)}` : '';
    const w = opcoes.largura ? `&w=${opcoes.largura}` : '';
    return `${environment.apiUrl}/panoramas/${panoramaId}/preview?variant=${variante}${w}${v}`;
  }

  /**
   * Baixa a imagem do preview como blob.
   *
   * Tem que passar pelo `HttpClient`: a rota é autenticada, e o `TextureLoader`
   * do three.js carrega por conta própria, sem interceptor e sem cabeçalho —
   * entregar a URL direto a ele devolve 401 e o visualizador fica preto. Quem
   * chama transforma o blob em `URL.createObjectURL` e é responsável por
   * revogá-lo.
   */
  baixarPreview(
    panoramaId: string,
    variante: 'treated' | 'original',
    largura?: number,
  ): Observable<Blob> {
    return this.http.get(this.urlDoPreview(panoramaId, variante, { largura }), {
      responseType: 'blob',
    });
  }

  deleteTour(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/virtual-tours/${id}`);
  }

  deletePanorama(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/panoramas/${id}`);
  }

  createHotspot(dto: {
    panoramaId: string;
    targetId: string;
    positionX: number;
    positionY: number;
    label?: string;
  }): Observable<{ id: string; label?: string; positionX: number; positionY: number; originId: string; targetId: string }> {
    return this.http.post<any>(`${environment.apiUrl}/hotspots`, dto);
  }

  deleteHotspot(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/hotspots/${id}`);
  }

  recordView(tourId: string, durationSeconds?: number): Observable<unknown> {
    return this.http.post(`${environment.apiUrl}/virtual-tours/${tourId}/views`, {
      sessionId: this.getSessionId(),
      durationSeconds,
      device: this.detectDevice(),
    });
  }

  private getSessionId(): string {
    let sessionId = localStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    return sessionId;
  }

  private detectDevice(): string {
    const ua = navigator.userAgent;
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    if (/mobile|android|iphone/i.test(ua)) return 'mobile';
    return 'desktop';
  }
}

export interface OpcoesDeAcompanhamento {
  intervaloMs?: number;
  limiteMs?: number;
  /** Encerra o laço quando quem pediu o acompanhamento foi embora. */
  sinal?: AbortSignal;
}

/**
 * Espera que também acorda quando o sinal aborta.
 *
 * Um `setTimeout` puro deixaria o laço dormindo o intervalo inteiro depois da
 * desistência — pouco, mas é tempo em que o componente já morreu e o callback
 * ainda pode disparar.
 */
function espera(ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (sinal?.aborted) return resolve();
    const fim = () => {
      clearTimeout(id);
      sinal?.removeEventListener('abort', fim);
      resolve();
    };
    const id = setTimeout(fim, ms);
    sinal?.addEventListener('abort', fim, { once: true });
  });
}

/**
 * Largura com que a foto original sobe.
 *
 * O servidor reduz toda referência para 768 px antes de mandar ao modelo
 * (`treat-panorama.service.ts`), e o tratamento é o único consumidor destas
 * fotos. Subir os 2048 px que a câmera entrega é mandar ~4x os bytes para eles
 * serem jogados fora do outro lado — e esses bytes viajam pelo 4G de dentro de
 * um imóvel, uma requisição por foto, de 9 a 15 por cômodo.
 *
 * 1024 e não 768 exatos: o servidor pode querer subir esse número sem que cada
 * captura já enviada vire referência borrada, e a folga custa pouco.
 *
 * NÃO reduza na captura. O `stitcher` usa estes mesmos frames em resolução
 * cheia para montar a equirretangular de 5120×2560; cortá-los lá degradaria o
 * panorama que o corretor vê.
 */
const LARGURA_DA_REFERENCIA = 1024;

/**
 * Reduz o frame antes de virar base64. Falhar aqui cai para a foto inteira: o
 * upload pesado é muito melhor que o panorama dispensado por falta de
 * referência.
 */
async function frameParaDataUrl(blob: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width <= LARGURA_DA_REFERENCIA) return await blobToDataUrl(blob);

      const escala = LARGURA_DA_REFERENCIA / bitmap.width;
      const canvas = document.createElement('canvas');
      canvas.width = LARGURA_DA_REFERENCIA;
      canvas.height = Math.round(bitmap.height * escala);

      const ctx = canvas.getContext('2d');
      if (!ctx) return await blobToDataUrl(blob);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      // 0.82 e não os 0.9 da captura: aqui a foto é referência de conteúdo para
      // o modelo, não o que alguém vai olhar.
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally {
      bitmap.close();
    }
  } catch {
    return blobToDataUrl(blob);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('frame read failed'));
    reader.readAsDataURL(blob);
  });
}
