import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Property, PaginatedProperties, ListPropertiesParams } from '../models/property.model';

/**
 * Campo do imóvel que o wizard grava como MARCADOR na primeira captura, porque
 * o servidor os exige e o corretor ainda não informou nenhum. Ver
 * `Property.draftPlaceholders` no schema.
 */
export type CampoMarcador = 'title' | 'type' | 'purpose';

export interface CreatePropertyPayload {
  code: string;
  title: string;
  type: string;
  purpose: string;
  description?: string;
  /** Lista INTEIRA, recalculada a cada gravacão. Ver `CampoMarcador`. */
  draftPlaceholders?: CampoMarcador[];
  address?: {
    street: string;
    number?: string;
    complement?: string;
    district?: string;
    city: string;
    state: string;
    zipCode?: string;
  };
}

/** Tudo opcional: o PATCH leva só o que mudou. `code` não é editável. */
export type UpdatePropertyPayload = Partial<Omit<CreatePropertyPayload, 'code'>>;

@Injectable({ providedIn: 'root' })
export class PropertyService {
  private http = inject(HttpClient);

  listProperties(params: ListPropertiesParams = {}): Observable<PaginatedProperties> {
    let httpParams = new HttpParams();
    if (params.page) httpParams = httpParams.set('page', params.page);
    if (params.limit) httpParams = httpParams.set('limit', params.limit);
    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.type) httpParams = httpParams.set('type', params.type);
    if (params.purpose) httpParams = httpParams.set('purpose', params.purpose);
    if (params.city) httpParams = httpParams.set('city', params.city);
    if (params.state) httpParams = httpParams.set('state', params.state);
    if (params.location) httpParams = httpParams.set('location', params.location);
    return this.http.get<PaginatedProperties>(`${environment.apiUrl}/properties`, { params: httpParams });
  }

  findProperty(id: string): Observable<Property> {
    return this.http.get<Property>(`${environment.apiUrl}/properties/${id}`);
  }

  createProperty(dto: CreatePropertyPayload): Observable<Property> {
    return this.http.post<Property>(`${environment.apiUrl}/properties`, dto);
  }

  /**
   * Grava os dados que só existem no fim do wizard.
   *
   * O imóvel passa a nascer como marcador na primeira captura, para que o tour
   * exista e a montagem por IA possa rodar durante a captura. Título, tipo,
   * finalidade e endereço chegam na última etapa e vêm por aqui.
   */
  updateProperty(id: string, dto: UpdatePropertyPayload): Observable<Property> {
    return this.http.patch<Property>(`${environment.apiUrl}/properties/${id}`, dto);
  }

  deleteProperty(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/properties/${id}`);
  }
}
