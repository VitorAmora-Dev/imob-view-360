import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import {
  cloudUploadOutline,
  codeSlashOutline,
  downloadOutline,
  eyeOffOutline,
  eyeOutline,
  pencilOutline,
  trashOutline,
} from 'ionicons/icons';

import { AppHeaderComponent } from '../../components/app-header/app-header.component';
import { Panorama } from '../../models/virtual-tour.model';
import { PanoramaDownloadService } from '../sheets/manage/panorama-download.service';
import { panoramaFilename } from '../sheets/manage/panorama-download.util';
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
  /** A cena cuja textura terminou de carregar e está realmente na tela. */
  readonly panoramaAtual = input<Panorama | null>(null);

  readonly store = inject(TourViewerStore);
  private readonly download = inject(PanoramaDownloadService);
  readonly podeEditar = computed(() => this.canEdit() ?? this.store.podeEditar());
  readonly baixando = this.download.baixando;
  readonly chaveDoOlho = computed(() =>
    this.store.chromeVisible() ? 'TOUR_VIEWER.HIDE_UI' : 'TOUR_VIEWER.SHOW_UI',
  );

  constructor() {
    addIcons({
      cloudUploadOutline,
      codeSlashOutline,
      downloadOutline,
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

  async baixarCena(): Promise<void> {
    const panorama = this.panoramaAtual();
    if (!panorama || this.baixando()) return;

    try {
      const iniciou = await this.download.baixar(
        panorama.id,
        panoramaFilename(this.store.tourName(), panorama.roomName),
      );
      if (iniciou) this.store.mostrarToast('TOUR_VIEWER.TOAST.DOWNLOAD_SUCCESS');
    } catch {
      this.store.mostrarToast('TOUR_VIEWER.TOAST.DOWNLOAD_ERROR');
    }
  }
}
