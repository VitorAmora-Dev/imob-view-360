import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import {
  cloudUploadOutline,
  codeSlashOutline,
  eyeOffOutline,
  eyeOutline,
  pencilOutline,
  trashOutline,
} from 'ionicons/icons';

import { AppHeaderComponent } from '../../components/app-header/app-header.component';
import { TourViewerStore } from '../tour-viewer.store';

/**
 * Chrome exclusivo do desktop: navegação global no topo e ações do tour no
 * rodapé direito. Separar essas duas camadas impede uma ação destrutiva de se
 * misturar a idioma, conta ou retorno aos imóveis.
 */
@Component({
  selector: 'app-tour-desktop-chrome',
  standalone: true,
  imports: [AppHeaderComponent, IonIcon, RouterLink, TranslatePipe],
  templateUrl: './tour-desktop-chrome.component.html',
  styleUrls: ['./tour-desktop-chrome.component.scss'],
})
export class TourDesktopChromeComponent {
  readonly editRequested = output<void>();
  /** Entrada de integração para a futura permissão de leitura. */
  readonly canEdit = input<boolean | null>(null);

  readonly store = inject(TourViewerStore);
  readonly podeEditar = computed(() => this.canEdit() ?? this.store.podeEditar());
  readonly chaveDoOlho = computed(() =>
    this.store.chromeVisible() ? 'TOUR_VIEWER.HIDE_UI' : 'TOUR_VIEWER.SHOW_UI',
  );

  constructor() {
    addIcons({
      cloudUploadOutline,
      codeSlashOutline,
      eyeOffOutline,
      eyeOutline,
      pencilOutline,
      trashOutline,
    });
  }

  async publicar(): Promise<void> {
    if (this.store.publicando()) return;

    const publicou = await this.store.publicar();
    this.store.mostrarToast(
      publicou ? 'TOUR_VIEWER.TOAST.PUBLISHED' : 'TOUR_VIEWER.TOAST.PUBLISH_ERROR',
    );
  }
}
