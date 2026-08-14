import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IonButton } from '@ionic/angular/standalone';
import { TourDraftStore } from '../tour-draft.store';

/**
 * Estado de sucesso — "Tour publicado".
 *
 * DONO: Frente A. STUB do commit-zero — tarefa A11.
 *
 * Falta: ícone em círculo, "Copiar link" com a URL real e feedback de copiado,
 * e o desenho final. "Criar outro tour" já funciona porque é só `reset()`.
 */
@Component({
  selector: 'app-tour-published',
  standalone: true,
  imports: [TranslatePipe, IonButton],
  template: `
    <div class="tw-published">
      <h2>{{ 'TOUR_WIZARD.SUCCESS.TITLE' | translate }}</h2>
      <p>{{ 'TOUR_WIZARD.SUCCESS.SUBTITLE' | translate }}</p>
      <ion-button (click)="store.reset()">
        {{ 'TOUR_WIZARD.SUCCESS.CREATE_ANOTHER' | translate }}
      </ion-button>
    </div>
  `,
})
export class TourPublishedComponent {
  readonly store = inject(TourDraftStore);
}
