import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { TourSheetComponent } from '../../../components/tour-sheet/tour-sheet.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { PanoramaImageCache } from '../../../services/panorama-image-cache.service';
import { PanoramaWatermarkService } from '../../../services/panorama-watermark.service';
import { TourViewerStore } from '../../tour-viewer.store';
import { panoramaFilename } from './panorama-download.util';

/** Altura suficiente para a lista completa sem esconder o último item. */
const PARADAS = [0, 0.62];

/**
 * Escape hatch do visualizador: ações menos frequentes vivem nesta lista.
 *
 * O componente não duplica decisões do contrato. Publicar, permissões e sheet
 * aberto vêm do `TourViewerStore`; daqui saem apenas os efeitos que pertencem a
 * um item da lista.
 *
 * A reorganização dos menus mexeu nas duas pontas desta lista. "Compartilhar
 * link" SAIU: compartilhar virou botão próprio na barra inferior, com sheet e
 * abas, e mantê-lo aqui deixaria duas portas para a mesma coisa — que é
 * exatamente a duplicação que a reorganização veio desfazer. "Apagar tour"
 * ENTROU, vindo da barra inferior, e é hoje o último item.
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
  private readonly imagens = inject(PanoramaImageCache);
  private readonly marcaDagua = inject(PanoramaWatermarkService);

  readonly paradas = PARADAS;
  readonly aberto = computed(() => this.store.sheet() === 'manage');
  readonly podeEditar = this.store.podeEditar;
  readonly podePublicar = this.store.podePublicar;
  readonly publicando = this.store.publicando;
  readonly podeApagar = this.store.podeEditar;
  readonly podeBaixar = computed(() => this.panoramaAtual() !== null);

  async publicar(): Promise<void> {
    if (this.publicando()) return;

    const publicou = await this.store.publicar();
    if (!publicou) {
      this.store.mostrarToast('TOUR_VIEWER.TOAST.PUBLISH_ERROR');
      return;
    }

    this.store.fecharSheet('manage');
    this.store.mostrarToast('TOUR_VIEWER.TOAST.PUBLISHED');
  }

  /** Abre diretamente a etapa Informações, sem mudar a entrada comum do editor. */
  abrirConfiguracoes(): void {
    const id = this.store.tourId();
    if (!id) return;

    this.store.fecharSheet('manage');
    this.store.mostrarToast('TOUR_VIEWER.TOAST.OPENING_EDITOR');
    void this.router.navigate(['/tour', id, 'editar'], { queryParams: { etapa: 4 } });
  }

  /**
   * Leva à confirmação, e nunca ao DELETE.
   *
   * `abrirSheet` SUBSTITUI o sheet aberto — este some e o de confirmar entra no
   * lugar. É o invariante 3 (nunca dois sheets) e o 4 (ação destrutiva sempre
   * confirmada) sendo respeitados pela mesma linha.
   *
   * Sem `fecharSheet()` antes: seriam dois `set` no mesmo tique, e o primeiro
   * pediria ao Ionic para desapresentar um modal que o segundo já mandou
   * substituir — o híbrido que o shell do sheet documenta.
   *
   * A OUTRA metade deste caminho está em `TourViewerStore.fecharSheet`: o
   * `didDismiss` deste sheet chega DEPOIS, quando o store já diz 'delete', e
   * antes do argumento ele zerava o sheet recém-aberto. O sintoma era a
   * confirmação nunca aparecer — só apareceu no navegador.
   */
  apagar(): void {
    this.store.abrirSheet('delete');
  }

  /**
   * Migração do download da página antiga — pelo cache autenticado, e NÃO pela
   * rota pública que a página antiga usava.
   *
   * `urlDaImagem()` aponta para `/panoramas/:id/image`, que não tem guard e por
   * isso filtra `virtualTour: { status: 'PUBLISHED' }` na consulta: em tour
   * rascunho ela devolve 404. A página antiga nunca viu rascunho; esta vê — e o
   * caso dói justamente aqui, porque "Publicar tour" só aparece em `DRAFT`, de
   * modo que os dois itens ficam lado a lado nesta mesma lista e um deles
   * quebrava exatamente quando o outro estava visível.
   *
   * `PanoramaImageCache` passa pela rota `/preview`, que é autenticada e serve
   * rascunho. `'treated'` é a mesma variante que está na tela, e a rota já cai
   * na original quando a IA ainda não tratou o cômodo.
   *
   * O `blob:` de origem continua pertencendo ao cache e nunca é revogado aqui.
   * A cópia marcada ganha outro object URL, usado só pelo download e liberado
   * assim que o clique é disparado.
   */
  async baixarCena(): Promise<void> {
    const panorama = this.panoramaAtual();
    if (!panorama) return;

    try {
      const sourceUrl = await this.imagens.obter(panorama.id, 'treated');
      const watermarkedBlob = await this.marcaDagua.applyFromObjectUrl(sourceUrl);
      const downloadUrl = URL.createObjectURL(watermarkedBlob);

      try {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = panoramaFilename(this.store.tourName(), panorama.roomName);
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(downloadUrl);
      }
      this.store.mostrarToast('TOUR_VIEWER.TOAST.DOWNLOAD_SUCCESS');
    } catch {
      this.store.mostrarToast('TOUR_VIEWER.TOAST.DOWNLOAD_ERROR');
    }
  }

  /** O NOME do sheet vai junto: ver `TourViewerStore.fecharSheet`. */
  fechar(): void {
    this.store.fecharSheet('manage');
  }
}
