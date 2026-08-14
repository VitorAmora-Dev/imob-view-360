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

/** Andamento da montagem por IA de um tour inteiro. */
export interface AndamentoDaMontagem {
  total: number;
  prontos: number;
  falhas: number;
  dispensados: number;
  terminado: boolean;
}

const SESSION_ID_KEY = 'visitorSessionId';

@Injectable({ providedIn: 'root' })
export class VirtualTourService {
  private http = inject(HttpClient);

  findTour(id: string): Observable<VirtualTour> {
    return this.http.get<VirtualTour>(`${environment.apiUrl}/virtual-tours/${id}`);
  }

  createTour(propertyId: string, panoramas: PanoramaUpload[]): Observable<VirtualTour> {
    return this.http.post<VirtualTour>(`${environment.apiUrl}/virtual-tours`, {
      propertyId,
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
            imageData: await blobToDataUrl(frame.blob),
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
   */
  async acompanharMontagem(
    tourId: string,
    aoAvancar: (a: AndamentoDaMontagem) => void,
    intervaloMs = 3000,
    limiteMs = 10 * 60 * 1000,
  ): Promise<AndamentoDaMontagem | null> {
    const ate = Date.now() + limiteMs;
    let ultimo: AndamentoDaMontagem | null = null;

    while (Date.now() < ate) {
      try {
        ultimo = await firstValueFrom(this.andamentoDaMontagem(tourId));
        aoAvancar(ultimo);
        if (ultimo.terminado) return ultimo;
      } catch {
        // Falha de rede não encerra o acompanhamento: a montagem segue no
        // servidor, e a próxima tentativa reencontra o estado.
      }
      await new Promise((r) => setTimeout(r, intervaloMs));
    }

    return ultimo;
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('frame read failed'));
    reader.readAsDataURL(blob);
  });
}
