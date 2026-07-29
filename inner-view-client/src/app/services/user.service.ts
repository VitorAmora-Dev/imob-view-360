import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserProfile } from '../models/user.model';

export interface JwtMe {
  sub: string;
  email: string;
  role: string;
  agencyId: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);

  getMe(): Observable<JwtMe> {
    return this.http.get<JwtMe>(`${environment.apiUrl}/auth/me`);
  }

  getUser(): Observable<UserProfile> {
    return this.getMe().pipe(
      switchMap(me => this.http.get<UserProfile>(`${environment.apiUrl}/users/${me.sub}`))
    );
  }
}
