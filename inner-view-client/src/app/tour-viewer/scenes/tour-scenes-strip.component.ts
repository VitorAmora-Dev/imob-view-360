import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { PanoramaImageCache } from '../../services/panorama-image-cache.service';
import { LARGURA_DA_MINIATURA, TourViewerScene } from '../tour-viewer.model';
import { TourViewerStore } from '../tour-viewer.store';

/**
 * Onde o rail recolhido é lembrado, e por quanto tempo.
 *
 * `sessionStorage` e não `localStorage`: o handoff pede que o estado persista
 * "por sessão". Recolher o rail é uma decisão sobre ESTA visita — quem recolheu
 * para ver a foto inteira num tour não pediu que o próximo tour, semana que
 * vem, abrisse sem a lista de cenas.
 *
 * A chave leva o id do tour porque a decisão é por tour: um tour de trinta
 * cômodos merece o rail aberto, o de dois não.
 */
const CHAVE_RAIL = 'tv:rail:';

/**
 * Abaixo de 1024px o rail NASCE recolhido (`05-desktop.md`, tabela de
 * responsividade). Consultado uma vez, na restauração, e não observado: é um
 * padrão inicial, não um comportamento — girar o tablet no meio da visita não
 * deve desfazer o que a pessoa escolheu.
 */
const QUERY_TABLET = '(min-width: 768px) and (max-width: 1023px)';

/**
 * A lista de cenas do visualizador: faixa horizontal no celular, rail de vidro
 * no desktop (TV-2, `02-mobile.md` e `05-desktop.md`).
 *
 * UM componente para os dois, e não dois: a diferença entre faixa e rail é de
 * medida e de moldura — a mesma lista, os mesmos alvos, a mesma cena marcada.
 * Separados, seriam duas cópias da regra de qual cena está ativa e dois lugares
 * para esquecer o `blob:` da miniatura.
 *
 * Ele INJETA o `TourViewerStore` em vez de receber tudo por `input`, ao
 * contrário do `CenasSheetComponent`. Os dois estão certos: o sheet é uma peça
 * adaptável, reutilizável sem conhecer a página; esta faixa existe somente no
 * visualizador, e o store é fornecido pela página que a hospeda — pedir por
 * `input` as sete coisas que ela lê dali seria plumbing sem comprador.
 *
 * A exceção é `atualId`, que vem de fora justamente porque NÃO está no store:
 * é a `cenaNaTela()` da página, a foto que está no ar. Ver a regra R4 do
 * sprint — o que a faixa marca é o cômodo que se está vendo, e não o que acabou
 * de ser pedido e ainda leva segundos para chegar.
 */
@Component({
  selector: 'app-tour-scenes-strip',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './tour-scenes-strip.component.html',
  styleUrls: ['./tour-scenes-strip.component.scss'],
})
export class TourScenesStripComponent {
  /** A cena cuja FOTO está na tela. Ver o docstring da classe. */
  readonly atualId = input<string | null>(null);

  private readonly store = inject(TourViewerStore);
  private readonly imagens = inject(PanoramaImageCache);

  /**
   * Já vêm na ordem do tour — `cenasDoTour()` preserva a ordem do servidor, que
   * é `orderBy: order`. Não reordene aqui: o sheet de cenas ordena porque
   * recebe `Panorama[]` cru; esta lista recebe o resultado da tradução, e uma
   * segunda ordenação só criaria a chance de as duas discordarem.
   */
  readonly cenas = this.store.scenes;

  readonly recolhido = this.store.railCollapsed;

  /** `sceneId` -> `blob:` da miniatura, conforme o cache vai respondendo. */
  private readonly blobs = signal<Record<string, string>>({});

  /** O tour cuja preferência de rail já foi restaurada. Ver o effect. */
  private restauradoDe: string | null = null;

  constructor() {
    /**
     * As miniaturas descem assim que há cenas.
     *
     * Aqui não há gatilho de abertura como no sheet: a faixa está NA TELA desde
     * o primeiro frame, e adiar o download só a deixaria cinza à vista de todo
     * mundo. Quem segura a conta é o `LARGURA_DA_MINIATURA` — 292px em vez da
     * equirretangular inteira.
     *
     * `untracked` no corpo porque `carregarMiniatura` LÊ `blobs()` para não
     * repetir download: rastreada, cada `blob:` que chega reagendaria o effect.
     */
    effect(() => {
      const cenas = this.cenas();
      untracked(() => {
        for (const cena of cenas) void this.carregarMiniatura(cena);
      });
    });

    /**
     * Restaura o rail recolhido quando o tour chega — uma vez por tour.
     *
     * A guarda por id, e não um booleano de "já restaurei": o store sobrevive a
     * `recarregar()`, e sem ela um "Tentar de novo" reimporia a preferência
     * salva por cima do que a pessoa tivesse acabado de escolher.
     */
    effect(() => {
      const id = this.store.tourId();
      if (!id || this.restauradoDe === id) return;
      this.restauradoDe = id;

      const salvo = this.lerPreferencia(id);
      untracked(() =>
        this.store.railCollapsed.set(salvo ?? matchMedia(QUERY_TABLET).matches),
      );
    });
  }

  /** `undefined` enquanto o download não terminou — ver o template. */
  miniatura(cena: TourViewerScene): string | undefined {
    return this.blobs()[cena.id];
  }

  escolher(cena: TourViewerScene): void {
    // Trocar de cena pela faixa NÃO fecha nada e não abre nada: ela é a
    // navegação sempre à mão, e o handoff é explícito quanto a isso.
    this.store.irParaCenaPorId(cena.id);
  }

  /**
   * Navegação de `tablist`: setas percorrem as cenas, Home/End chegam aos
   * extremos e o foco acompanha a cena ativada. Toque e clique continuam
   * passando pelo mesmo `escolher()`.
   */
  aoTeclar(evento: KeyboardEvent, indiceAtual: number): void {
    const total = this.cenas().length;
    if (!total) return;

    let destino: number | null = null;
    if (evento.key === 'ArrowRight') destino = (indiceAtual + 1) % total;
    if (evento.key === 'ArrowLeft') destino = (indiceAtual - 1 + total) % total;
    if (evento.key === 'Home') destino = 0;
    if (evento.key === 'End') destino = total - 1;
    if (destino === null) return;

    evento.preventDefault();
    this.escolher(this.cenas()[destino]);

    const trilho = (evento.currentTarget as HTMLElement).closest('[role="tablist"]');
    const abas = trilho?.querySelectorAll<HTMLElement>('[role="tab"]');
    abas?.[destino]?.focus();
  }

  /** "Ver todas" abre o sheet que JÁ está montado na página — não outro. */
  verTodas(): void {
    this.store.abrirSheet('scenes');
  }

  alternarRail(): void {
    this.store.alternarRail();
    this.gravarPreferencia();
  }

  /**
   * A miniatura passa pelo cache, e NUNCA por `<img src="/api/...">`.
   *
   * A rota `/panoramas/:id/preview` é autenticada, o token mora no
   * `localStorage` e a tag `<img>` não passa pelo `authInterceptor` — ela não
   * tem como levar o token. O caminho é sempre `HttpClient` -> `blob:` -> tela.
   * É a mesma regra de `cenas-sheet` e da `lista-de-rascunhos`, e ignorá-la foi
   * o que deixou a tela do tour branca em `036b4ac`.
   *
   * Sem `liberar()` no destroy: o cache é `providedIn: 'root'` e estes mesmos
   * `blob:` são os do sheet de cenas e os do viewer. Revogar aqui apagaria a
   * imagem debaixo de quem ainda a está mostrando.
   */
  private async carregarMiniatura(cena: TourViewerScene): Promise<void> {
    if (this.blobs()[cena.id]) return;

    const url = await this.imagens
      .obter(cena.id, 'treated', LARGURA_DA_MINIATURA)
      .catch(() => '');
    if (!url) return;

    this.blobs.update((atual) => ({ ...atual, [cena.id]: url }));
  }

  /**
   * `null` quando não há nada salvo — que é diferente de `false`.
   *
   * A distinção é o que permite ao padrão do tablet valer só na primeira
   * visita: com `false` no lugar do `null`, quem expandiu o rail no tablet o
   * veria recolhido de novo, e quem nunca opinou nunca receberia o padrão.
   *
   * O `try` não é cerimônia: `sessionStorage` LANÇA em Safari privado e com
   * armazenamento de terceiros bloqueado, e uma preferência de layout não é
   * motivo para derrubar a tela.
   */
  private lerPreferencia(tourId: string): boolean | null {
    try {
      const bruto = sessionStorage.getItem(CHAVE_RAIL + tourId);
      return bruto === null ? null : bruto === '1';
    } catch {
      return null;
    }
  }

  private gravarPreferencia(): void {
    const id = this.store.tourId();
    if (!id) return;

    try {
      sessionStorage.setItem(CHAVE_RAIL + id, this.recolhido() ? '1' : '0');
    } catch {
      // Sem armazenamento, a preferência vale só enquanto a tela estiver aberta.
    }
  }
}
