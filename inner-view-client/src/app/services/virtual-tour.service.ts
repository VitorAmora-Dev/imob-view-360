import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { VirtualTour, Panorama } from '../models/virtual-tour.model';

export interface PanoramaUpload {
  roomName: string;
  imageData: string;
  order?: number;
  initialPanorama?: boolean;
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
