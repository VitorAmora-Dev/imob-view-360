import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Etapa 1 — Imagens 360°.
 *
 * DONO: Frente A. STUB do commit-zero — tarefas A5 a A8.
 *
 * Falta: dropzone com drag & drop, os dois botões (enviar arquivos / captura
 * guiada via `Capture360Component`), chips informativos, caixa de dica e a
 * lista de ambientes com badge de capa.
 */
@Component({
  selector: 'app-tour-step-images',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <header class="tw-step-head">
      <h2>{{ 'TOUR_WIZARD.STEP1.TITLE' | translate }}</h2>
      <p>{{ 'TOUR_WIZARD.STEP1.SUBTITLE' | translate }}</p>
    </header>

    <!-- Provisório: entrada mínima de arquivos para que a Frente B tenha
         cenas com que trabalhar antes de a A5 ficar pronta. Sai na A5. -->
    <input
      type="file"
      accept="image/*"
      multiple
      (change)="onFiles($event)"
      aria-label="Enviar fotos 360°"
    />

    <ul>
      @for (scene of store.scenes(); track scene.id) {
        <li>{{ scene.room }} — {{ scene.state }}</li>
      } @empty {
        <li>{{ 'TOUR_WIZARD.STEP1.EMPTY' | translate }}</li>
      }
    </ul>
  `,
})
export class StepImagesComponent {
  readonly store = inject(TourDraftStore);

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.store.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }
}
