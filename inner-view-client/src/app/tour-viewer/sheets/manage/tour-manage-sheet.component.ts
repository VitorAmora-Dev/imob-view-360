import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { TourSheetComponent } from '../../../components/tour-sheet/tour-sheet.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { urlDaImagem } from '../../../models/panorama-image.util';
import { VirtualTourService } from '../../../services/virtual-tour.service';
import { TourViewerStore } from '../../tour-viewer.store';
import { panoramaFilename } from './panorama-download.util';

/** Altura suficiente para a lista completa sem esconder o último item. */
const PARADAS = [0, 0.62];

/**
 * Escape hatch do visualizador: ações menos frequentes vivem nesta lista.
 *
 * O componente não duplica decisões do contrato. Publicar, permissões, link e
 * sheet aberto vêm do `TourViewerStore`; daqui saem apenas os efeitos que
 * pertencem a um item da lista.
 */
@Component({
  selector: 'app-tour-manage-sheet',
  standalone: true,
  imports: [TourSheetComponent, TranslatePipe],
  templateUrl: './tour-manage-sheet.component.html',
  styleUrls: ['./tour-manage-sheet.component.scss'],
})
export class TourManageSheetComponent {
  /** A foto realmente exibida, não a próxima cena que ainda está carregando. */
  readonly panoramaAtual = input<Panorama | null>(null);

  private readonly store = inject(TourViewerStore);
  private readonly router = inject(Router);
  private readonly virtualTourService = inject(VirtualTourService);

  readonly paradas = PARADAS;
  readonly aberto = computed(() => this.store.sheet() === 'manage');
  readonly podeEditar = this.store.podeEditar;
  readonly podePublicar = this.store.podePublicar;
  readonly publicando = this.store.publicando;
  readonly podeCompartilhar = computed(() => Boolean(this.store.tourId() && this.store.linkPublico()));
  readonly podeBaixar = computed(() => this.panoramaAtual() !== null);

  async publicar(): Promise<void> {
    if (this.publicando()) return;

    const publicou = await this.store.publicar();
    if (!publicou) {
      this.store.mostrarToast('TOUR_VIEWER.TOAST.PUBLISH_ERROR');
      return;
    }

    this.store.fecharSheet();
    this.store.mostrarToast('TOUR_VIEWER.TOAST.PUBLISHED');
  }

  /** Abre diretamente a etapa Informações, sem mudar a entrada comum do editor. */
  abrirConfiguracoes(): void {
    const id = this.store.tourId();
    if (!id) return;

    this.store.fecharSheet();
    this.store.mostrarToast('TOUR_VIEWER.TOAST.OPENING_EDITOR');
    void this.router.navigate(['/tour', id, 'editar'], { queryParams: { etapa: 4 } });
  }

  /**
   * Usa a folha nativa quando disponível e copia como fallback.
   *
   * A métrica é intencionalmente best effort: falhar ao contá-la nunca impede
   * o link de sair. Cancelar a folha nativa segue o padrão já usado na tela de
   * publicação e oferece a cópia como segundo caminho.
   */
  async compartilhar(): Promise<void> {
    const id = this.store.tourId();
    const url = this.store.linkPublico();
    if (!id || !url) return;

    if (navigator.share) {
      try {
        await navigator.share({ url });
        this.registrarCompartilhamento(id, 'native');
        return;
      } catch {
        // Cancelamento ou indisponibilidade da folha: ainda é possível copiar.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      this.registrarCompartilhamento(id, 'clipboard');
      this.store.mostrarToast('TOUR_VIEWER.TOAST.LINK_COPIED');
    } catch {
      this.store.mostrarToast('TOUR_VIEWER.TOAST.COPY_ERROR');
    }
  }

  /**
   * Migração do download da página antiga: a URL é a mesma do viewer e tende a
   * vir do cache do navegador, sem transportar a imagem dentro do JSON.
   */
  async baixarCena(): Promise<void> {
    const panorama = this.panoramaAtual();
    if (!panorama) return;

    try {
      const resposta = await fetch(urlDaImagem(panorama));
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

      const blobUrl = URL.createObjectURL(await resposta.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = panoramaFilename(this.store.tourName(), panorama.roomName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      this.store.mostrarToast('TOUR_VIEWER.TOAST.DOWNLOAD_SUCCESS');
    } catch {
      this.store.mostrarToast('TOUR_VIEWER.TOAST.DOWNLOAD_ERROR');
    }
  }

  fechar(): void {
    this.store.fecharSheet();
  }

  private registrarCompartilhamento(tourId: string, canal: 'native' | 'clipboard'): void {
    this.virtualTourService.recordShare(tourId, canal).subscribe({ error: () => undefined });
  }
}
