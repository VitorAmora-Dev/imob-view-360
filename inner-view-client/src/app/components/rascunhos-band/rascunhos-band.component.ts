import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { PanoramaImageCache } from '../../services/panorama-image-cache.service';
import { PropertyService } from '../../services/property.service';
import { RascunhoResumo, VirtualTourService } from '../../services/virtual-tour.service';

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

  readonly rascunhos = signal<CartaoDeRascunho[]>([]);

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
   * (ver o comentário de `urlDoPreview`).
   */
  private async carregarMiniatura(r: RascunhoResumo): Promise<void> {
    if (!r.capaPanoramaId) return;

    const url = await this.imagens.obter(r.capaPanoramaId, 'treated').catch(() => '');
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
   */
  async descartar(r: CartaoDeRascunho): Promise<void> {
    await firstValueFrom(this.propertyService.deleteProperty(r.propertyId)).catch(
      () => undefined,
    );

    if (r.capaPanoramaId) this.imagens.liberar(r.capaPanoramaId);
    this.rascunhos.update((atual) => atual.filter((x) => x.id !== r.id));
  }
}
