import { Component, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, firstValueFrom } from 'rxjs';

import { PanoramaImageCache } from '../../services/panorama-image-cache.service';
import { PropertyService } from '../../services/property.service';
import { RascunhoResumo, VirtualTourService } from '../../services/virtual-tour.service';

/**
 * Largura da capa que o cartão pede ao servidor.
 *
 * O cartão desenha 196×110. Sem o `w`, a rota de preview devolve a
 * equirretangular inteira — e esta faixa dispara um download por rascunho, em
 * paralelo, no `ngOnInit` da home. Eram dezenas de MB no 4G a cada visita à
 * tela inicial para preencher um punhado de selos.
 */
const LARGURA_DA_CAPA = 320;

/** Uma linha de `listarRascunhos()`, mais a miniatura quando ela já chegou. */
interface CartaoDeRascunho extends RascunhoResumo {
  /** `blob:` da capa, preenchido depois que `PanoramaImageCache` termina o download. */
  miniatura?: string;
}

/**
 * As capturas que ficaram pela metade, no topo da home.
 *
 * As fotos e o tratamento por IA nunca se perderam — sobem durante a própria
 * captura —, mas até esta tarefa não havia nada no aplicativo que levasse o
 * corretor de volta a elas: a listagem de imóveis esconde rascunho de
 * propósito (imóvel sem título apareceria como linha vazia no lugar mais
 * visível do sistema). Esta faixa é o caminho de volta.
 *
 * Diferente do `HomeNoTourBannerComponent` — cujo comentário deixa explícito
 * que quem decide SE ele aparece é a `HomePage`, não ele mesmo —, esta faixa
 * busca os PRÓPRIOS dados (`listarRascunhos()`, uma consulta que a `HomePage`
 * não faz e não tem por que conhecer) e por isso decide sozinha se aparece:
 * sem rascunho, o `@if` do template não desenha nada. Quem é dono do dado é
 * quem tem informação para decidir; empurrar a decisão para a `HomePage`
 * obrigaria ela a duplicar esta mesma consulta só para saber se deve reservar
 * espaço.
 */
@Component({
  selector: 'app-rascunhos-band',
  standalone: true,
  templateUrl: './rascunhos-band.component.html',
  styleUrls: ['./rascunhos-band.component.scss'],
  imports: [DatePipe, TranslatePipe],
})
export class RascunhosBandComponent implements OnInit {
  private readonly virtualTourService = inject(VirtualTourService);
  private readonly propertyService = inject(PropertyService);
  private readonly imagens = inject(PanoramaImageCache);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly translate = inject(TranslateService);

  readonly rascunhos = signal<CartaoDeRascunho[]>([]);

  /**
   * De onde veio a última navegação. Começa na home de propósito — ver o
   * construtor.
   */
  private ultimaRota = '/home';

  /**
   * Recarrega quando a home VOLTA a aparecer, e não só no `ngOnInit`.
   *
   * O app usa `<ion-router-outlet>`, que MANTÉM a página na pilha: voltar do
   * wizard reusa a `HomePage` viva e o `ngOnInit` não roda de novo. Publicar
   * uma captura e voltar deixava o cartão dela na faixa — a home afirmando
   * "em andamento" sobre um tour que já estava no ar, até o app ser recarregado
   * do zero. O mesmo valia para descartar dentro do wizard, ou em outro
   * aparelho.
   *
   * Pelo `Router`, e não por um método público que a `HomePage` chamasse no
   * `ionViewWillEnter` dela: esta faixa é dona do próprio dado — busca a
   * própria lista e decide sozinha se aparece (ver o cabeçalho). Um
   * `@ViewChild` na `HomePage` só para mandar recarregar obrigaria a página a
   * conhecer um filho que ela hoje só posiciona.
   *
   * O critério é VIR DE FORA, e não "chegar na home": os filtros da `HomePage`
   * moram na query string, então cada troca de filtro, cada chip removido e
   * cada busca digitada é uma navegação para `/home` também. Comparar só o
   * destino refazia a busca de rascunhos a cada uma delas — uma requisição e
   * uma rajada de miniaturas por tecla.
   *
   * `ultimaRota` começa em `/home` porque a navegação que CRIA este componente
   * ainda vai emitir o `NavigationEnd` dela (a rota ativa o componente antes
   * de anunciar o fim), e o `ngOnInit` já buscou por essa.
   */
  constructor() {
    this.router.events
      .pipe(
        filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((evento) => {
        const veioDeFora = !ehAHome(this.ultimaRota);
        this.ultimaRota = evento.urlAfterRedirects;
        if (veioDeFora && ehAHome(evento.urlAfterRedirects)) void this.carregar();
      });
  }

  ngOnInit(): void {
    void this.carregar();
  }

  /**
   * Best-effort de propósito: falhar aqui não pode derrubar a home. A faixa é
   * um atalho por cima do catálogo, e é o catálogo que o corretor veio ver.
   *
   * O `try`/`catch` também segura uma falha SÍNCRONA de `listarRascunhos()`
   * (ex.: interceptor que lança antes de devolver o observable) — um `.catch`
   * encadeado só no resultado de `firstValueFrom` não pegaria isso, porque a
   * exceção estouraria antes de `firstValueFrom` chegar a ser chamado.
   */
  private async carregar(): Promise<void> {
    let lista: RascunhoResumo[];
    try {
      lista = await firstValueFrom(this.virtualTourService.listarRascunhos());
    } catch {
      lista = [];
    }

    this.rascunhos.set(lista);
    for (const r of lista) void this.carregarMiniatura(r);
  }

  /**
   * A miniatura passa pelo cache, e não por `<img src="/api/...">` direto.
   *
   * A rota de preview é autenticada, e a tag `<img>` não passa pelo
   * interceptor HTTP — ela não tem como levar o token. O caminho é o mesmo do
   * viewer do wizard: `HttpClient` → `blob:` → tela. Ignorar essa regra foi o
   * que já deixou a tela do tour em branco num bug recente.
   *
   * Pede a variante `'treated'`: é a mesma que o wizard mostra durante a
   * captura, e cai na original sozinha enquanto a montagem por IA não termina
   * (ver o comentário de `urlDoPreview`). E pede com largura: ver
   * `LARGURA_DA_CAPA`.
   */
  private async carregarMiniatura(r: RascunhoResumo): Promise<void> {
    if (!r.capaPanoramaId) return;

    const url = await this.imagens
      .obter(r.capaPanoramaId, 'treated', LARGURA_DA_CAPA)
      .catch(() => '');
    if (!url) return;

    this.rascunhos.update((atual) =>
      atual.map((x) => (x.id === r.id ? { ...x, miniatura: url } : x)),
    );
  }

  retomar(r: CartaoDeRascunho): void {
    void this.router.navigate(['/tour/novo'], {
      queryParams: { rascunho: r.id },
    });
  }

  /**
   * Apaga o IMÓVEL, e não o tour.
   *
   * `VirtualTour.property` é `onDelete: Cascade`: uma chamada derruba tour,
   * panoramas, hotspots e frames de uma vez. Apagar só o tour deixaria um
   * imóvel órfão chamado "Captura em andamento" — e imóvel sem tour nenhum
   * passa pelo filtro da listagem (que esconde quem TEM tour DRAFT, não quem
   * não tem tour nenhum). O descarte pela metade voltaria a aparecer no
   * catálogo como a linha vazia que aquele filtro existe para evitar. Mesma
   * regra de `TourDraftStore.descartarRascunho()`.
   *
   * Por isso a confirmação, no mesmo padrão do alerta de saída do wizard: o
   * botão tem 44px, encosta no cartão e vive dentro de um carrossel de rolagem
   * horizontal — um toque errado apagava, sem pergunta e sem desfazer, as
   * fotos, os hotspots e o tratamento por IA já pago.
   *
   * E o cartão só some se o DELETE tiver dado certo. Engolir a falha e remover
   * o cartão mesmo assim fazia um descarte que não aconteceu parecer concluído
   * — o rascunho reaparecia no próximo carregamento da home, sem explicação.
   */
  async descartar(r: CartaoDeRascunho): Promise<void> {
    if (!(await this.confirmarDescarte())) return;

    try {
      await firstValueFrom(this.propertyService.deleteProperty(r.propertyId));
    } catch {
      await this.avisar(this.texto('HOME.DRAFTS_DISCARD_ERROR'));
      return;
    }

    if (r.capaPanoramaId) this.imagens.liberar(r.capaPanoramaId);
    this.rascunhos.update((atual) => atual.filter((x) => x.id !== r.id));
  }

  /**
   * Decide pelo papel do botão devolvido em `onDidDismiss()`, e não por
   * `handler`: assim tocar fora do alerta — que não chama handler nenhum —
   * conta como desistir, em vez de deixar a promise pendurada para sempre.
   */
  private async confirmarDescarte(): Promise<boolean> {
    const alerta = await this.alertController.create({
      header: this.texto('HOME.DRAFTS_DISCARD_TITLE'),
      message: this.texto('HOME.DRAFTS_DISCARD_MESSAGE'),
      buttons: [
        { text: this.texto('HOME.DRAFTS_DISCARD_CANCEL'), role: 'cancel' },
        { text: this.texto('HOME.DRAFTS_DISCARD_CONFIRM'), role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    return role === 'destructive';
  }

  private async avisar(mensagem: string): Promise<void> {
    const toast = await this.toastController.create({
      message: mensagem,
      duration: 3000,
      position: 'bottom',
      color: 'danger',
    });
    await toast.present();
  }

  private texto(chave: string): string {
    return this.translate.instant(chave) as string;
  }
}

/**
 * A home responde por dois caminhos: `/home` e a raiz, que redireciona para
 * ela (`app.routes.ts`). O `urlAfterRedirects` já entrega o destino resolvido,
 * mas a query string e o fragmento vêm junto — por isso o corte antes de
 * comparar, e não um `===` na URL inteira.
 */
function ehAHome(url: string): boolean {
  return url.split(/[?#]/)[0] === '/home';
}
