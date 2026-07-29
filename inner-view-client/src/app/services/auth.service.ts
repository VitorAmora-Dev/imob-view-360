import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SigninResponse {
  user: { id: string; name: string; email: string; type: string; licenseNumber?: string; agencyId: string };
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface SignupRequest {
  agencyName: string;
  cnpj?: string;
  agencyEmail?: string;
  phone?: string;
  name: string;
  email: string;
  password: string;
}

export interface SignupResponse extends SigninResponse {
  agency: { id: string; name: string };
}

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private _accessToken = signal<string | null>(localStorage.getItem(ACCESS_TOKEN_KEY));

  isAuthenticated = computed(() => !!this._accessToken());

  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  signin(email: string, password: string): Observable<SigninResponse> {
    return this.http.post<SigninResponse>(`${environment.apiUrl}/auth/signin`, { email, password }).pipe(
      tap(res => this.storeTokens(res.accessToken, res.refreshToken))
    );
  }

  signup(data: SignupRequest): Observable<SignupResponse> {
    return this.http.post<SignupResponse>(`${environment.apiUrl}/auth/signup`, data).pipe(
      tap(res => this.storeTokens(res.accessToken, res.refreshToken))
    );
  }

  refresh(): Observable<RefreshResponse> {
    return this.http.post<RefreshResponse>(`${environment.apiUrl}/auth/refresh`, {}).pipe(
      tap(res => this.storeTokens(res.accessToken, res.refreshToken))
    );
  }

  signout(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    this._accessToken.set(null);
    this.router.navigate(['/login']);
  }

  private storeTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    this._accessToken.set(accessToken);
  }
}
