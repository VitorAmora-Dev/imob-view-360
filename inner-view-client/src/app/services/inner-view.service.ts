import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { InnerViewItem } from '../models/inner-view.model';

@Injectable({
  providedIn: 'root'
})
export class InnerViewService {
  private http = inject(HttpClient);

  getInnerViewList(): Observable<InnerViewItem[]> {
    return this.http.get<InnerViewItem[]>('/assets/mock/mockInnerViewList.json');
  }
}
