import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Property, PaginatedProperties, ListPropertiesParams } from '../models/property.model';

export interface CreatePropertyPayload {
  code: string;
  title: string;
  type: string;
  purpose: string;
  description?: string;
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

  deleteProperty(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/properties/${id}`);
  }
}
