import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

const PUBLIC_URLS = ['/auth/signin', '/auth/signup'];

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const authService = inject(AuthService);

  // Absolute URLs are external APIs (backend calls use the relative /api path) — never send the app's JWT
  if (/^https?:\/\//.test(req.url)) {
    return next(req);
  }

  if (PUBLIC_URLS.some(url => req.url.includes(url))) {
    return next(req);
  }

  if (req.url.includes('/auth/refresh')) {
    const token = authService.refreshToken;
    const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
    return next(authReq);
  }

  const token = authService.accessToken;
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && authService.refreshToken) {
        return authService.refresh().pipe(
          switchMap(res => {
            const retryReq = req.clone({ setHeaders: { Authorization: `Bearer ${res.accessToken}` } });
            return next(retryReq);
          }),
          catchError(refreshError => {
            authService.signout();
            return throwError(() => refreshError);
          })
        );
      }
      return throwError(() => error);
    })
  );
};
