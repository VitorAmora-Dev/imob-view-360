import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

/**
 * O que estes testes protegem é uma premissa que deixou de valer.
 *
 * Em desenvolvimento o `apiUrl` é `/api` e o proxy do Angular torna tudo
 * same-origin, então "URL absoluta" e "API de terceiro" eram sinônimos. Em
 * produção o cliente e a API ficam em hosts diferentes e o `apiUrl` passa a ser
 * absoluto — momento em que a própria API do sistema passa a parecer externa e
 * o token deixa de ser enviado. O sintoma é 401 em tudo logo depois do login,
 * com o login em si funcionando, porque `/auth/signin` é rota pública.
 *
 * Por isso o caso decisivo aqui troca o `apiUrl` por um endereço absoluto: com
 * o `apiUrl` relativo dos testes, o defeito não aparece.
 */
describe('authInterceptor', () => {
  const apiUrlOriginal = environment.apiUrl;
  let http: HttpClient;
  let httpMock: HttpTestingController;

  function configurar(apiUrl: string, accessToken: string | null = 'token-de-acesso') {
    environment.apiUrl = apiUrl;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { accessToken, refreshToken: null } },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    environment.apiUrl = apiUrlOriginal;
    httpMock?.verify();
  });

  it('envia o token quando o apiUrl é absoluto (produção)', () => {
    configurar('https://api.exemplo.com');

    http.get('https://api.exemplo.com/properties').subscribe();

    const req = httpMock.expectOne('https://api.exemplo.com/properties');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-de-acesso');
    req.flush({});
  });

  it('envia o token quando o apiUrl é relativo (desenvolvimento)', () => {
    configurar('/api');

    http.get('/api/properties').subscribe();

    const req = httpMock.expectOne('/api/properties');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-de-acesso');
    req.flush({});
  });

  it('não envia o token para um domínio que não é o da API', () => {
    // A intenção original do interceptor, que a correção precisa preservar:
    // o JWT da aplicação não pode vazar para serviço de terceiro.
    configurar('https://api.exemplo.com');

    http.get('https://terceiro.exemplo.com/dados').subscribe();

    const req = httpMock.expectOne('https://terceiro.exemplo.com/dados');
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush({});
  });

  it('não envia o token no signin, que é rota pública', () => {
    configurar('https://api.exemplo.com');

    http.post('https://api.exemplo.com/auth/signin', {}).subscribe();

    const req = httpMock.expectOne('https://api.exemplo.com/auth/signin');
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush({});
  });
});
