import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../tour-draft.store';

/**
 * Estado de sucesso — "Tour publicado".
 *
 * DONO: Frente A (tarefa A11).
 *
 * Substitui todo o corpo do wizard e faz a barra de ação sumir: não há mais
 * nada a avançar, e as ações daqui pertencem ao próprio conteúdo.
 */
@Component({
  selector: 'app-tour-published',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './tour-published.component.html',
  styleUrls: ['./tour-published.component.scss'],
})
export class TourPublishedComponent {
  readonly store = inject(TourDraftStore);
  private readonly router = inject(Router);

  /** Vira "Copiado ✓" por alguns segundos — feedback sem toast. */
  readonly copied = signal(false);

  /**
   * O mesmo formato que o card do imóvel e o perfil já usam para compartilhar.
   * Divergir aqui daria dois links diferentes para o mesmo tour.
   */
  readonly shareUrl = computed(() => {
    const id = this.store.publishedTourId();
    return id ? `${window.location.origin}/embed/${id}` : null;
  });

  /**
   * Compartilhamento nativo quando existe, área de transferência quando não.
   *
   * No celular o corretor manda o link por WhatsApp, e a folha nativa já leva
   * direto para lá — copiar e colar é o caminho longo para a mesma coisa.
   */
  async copyLink(): Promise<void> {
    const url = this.shareUrl();
    if (!url) return;

    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // Cancelar a folha de compartilhamento não é erro — cai para copiar.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      // Sem permissão de área de transferência não há o que fazer em silêncio;
      // o link fica visível na tela para seleção manual.
    }
  }

  openTour(): void {
    const propertyId = this.store.publishedPropertyId();
    if (propertyId) this.router.navigate(['/inner-view-page', propertyId]);
  }
}
