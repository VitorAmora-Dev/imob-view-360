import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map, catchError, throwError } from 'rxjs';

export interface CepAddress {
  street: string;
  complement?: string;
  district?: string;
  city: string;
  state: string;
  zipCode: string;
}

export class CepNotFoundError extends Error {
  constructor() {
    super('CEP not found');
  }
}

interface ViaCepResponse {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean | string;
}

@Injectable({ providedIn: 'root' })
export class CepService {
  private http = inject(HttpClient);

  lookup(cep: string): Observable<CepAddress> {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) {
      return throwError(() => new CepNotFoundError());
    }

    return this.http.get<ViaCepResponse>(`https://viacep.com.br/ws/${digits}/json/`).pipe(
      map(res => {
        // ViaCEP returns 200 with { erro: true } (or "true") for unknown CEPs
        if (res.erro) throw new CepNotFoundError();
        return {
          street: res.logradouro,
          complement: res.complemento || undefined,
          district: res.bairro || undefined,
          city: res.localidade,
          state: res.uf,
          zipCode: res.cep.replace(/\D/g, ''),
        };
      }),
      catchError(err =>
        throwError(() =>
          err instanceof CepNotFoundError || (err instanceof HttpErrorResponse && err.status === 400)
            ? new CepNotFoundError()
            : err
        )
      )
    );
  }
}
