import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

const PUBLIC_URLS = ['/auth/signin', '/auth/signup'];

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const authService = inject(AuthService);

  // O JWT da aplicação não pode vazar para serviço de terceiro. Isso já era a
  // intenção aqui, mas o teste usado para decidir — "é URL absoluta?" — só
  // funcionava enquanto a API era same-origin: em desenvolvimento o `apiUrl` é
  // `/api` e o proxy do Angular resolve o resto.
  //
  // Em produção cliente e API ficam em hosts diferentes e o `apiUrl` passa a ser
  // absoluto, momento em que a própria API do sistema era classificada como
  // externa e ficava sem token. O sintoma é 401 em tudo logo após entrar, com o
  // login funcionando — porque `/auth/signin` é rota pública e não depende disto.
  //
  // A pergunta certa não é se a URL é absoluta, e sim se ela é a nossa API.
  const apiEhAbsoluta = /^https?:\/\//.test(environment.apiUrl);
  const ehTerceiro =
    /^https?:\/\//.test(req.url) &&
    !(apiEhAbsoluta && req.url.startsWith(environment.apiUrl));

  if (ehTerceiro) {
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
