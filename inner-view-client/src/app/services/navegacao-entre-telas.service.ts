import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, filter, map } from 'rxjs';

/**
 * "Esta tela voltou a aparecer?" — a pergunta que o cache de página do Ionic
 * obriga a fazer.
 *
 * O app usa `<ion-router-outlet>`, que MANTÉM a página na pilha: sair da home
 * para o wizard e voltar reusa a `HomePage` viva, e `ngOnInit` não roda de
 * novo. Toda tela que busca dados no `ngOnInit` fica, a partir daí, mostrando
 * o que era verdade quando foi aberta — a home afirmando "captura em
 * andamento" sobre um tour já publicado, ou sem o imóvel que o corretor acabou
 * de criar.
 *
 * Aqui, e não copiada em cada tela, porque a regra tem uma armadilha que já
 * custou uma rodada de correção: os filtros da home moram na QUERY STRING, e
 * cada troca de filtro é uma navegação para `/home` também. Comparar só o
 * destino faz a tela recarregar a cada tecla digitada. O critério certo é ter
 * estado em OUTRA tela — e escrevê-lo uma vez é o que impede o segundo
 * consumidor de repetir o erro do primeiro.
 */
@Injectable({ providedIn: 'root' })
export class NavegacaoEntreTelas {
  private readonly router = inject(Router);

  /**
   * Emite quando a tela de quem chama volta a aparecer depois de o corretor ter
   * estado em outra. Nunca emite por navegação DENTRO da própria tela.
   *
   * `ehEstaTela` recebe o caminho já sem query string nem fragmento — é o que
   * torna `/home` e `/home?type=HOUSE` a mesma tela, que é o ponto.
   *
   * A navegação que CRIA quem chama não conta: o componente é ativado antes de
   * o `NavigationEnd` dela ser anunciado, e quem busca no `ngOnInit` já
   * carregou por ela. Por isso o estado inicial é "estou aqui" — quem assina
   * isto vive nesta tela, ou não teria como assinar.
   */
  aoVoltarPara(ehEstaTela: (caminho: string) => boolean): Observable<void> {
    let estavaAqui = true;

    return this.router.events.pipe(
      filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
      map((evento) => ehEstaTela(caminhoDe(evento.urlAfterRedirects))),
      filter((agoraAqui) => {
        const voltou = agoraAqui && !estavaAqui;
        estavaAqui = agoraAqui;
        return voltou;
      }),
      map(() => undefined),
    );
  }
}

/** O caminho da URL, sem query string nem fragmento. */
export function caminhoDe(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * A home responde por `/home`; a raiz redireciona para ela (`app.routes.ts`) e
 * o `urlAfterRedirects` já entrega o destino resolvido.
 */
export function ehAHome(caminho: string): boolean {
  return caminho === '/home';
}
