import { Injectable, inject, signal } from '@angular/core';

import { PanoramaImageCache } from '../../../services/panorama-image-cache.service';
import { PanoramaWatermarkService } from '../../../services/panorama-watermark.service';

/**
 * Único caminho para baixar uma panorâmica do viewer.
 *
 * O sheet mobile e o cluster desktop compartilham este efeito para que os dois
 * usem a rota autenticada, a marca d'água e a mesma política de object URLs.
 */
@Injectable({ providedIn: 'root' })
export class PanoramaDownloadService {
  private readonly imagens = inject(PanoramaImageCache);
  private readonly marcaDagua = inject(PanoramaWatermarkService);
  private readonly emAndamento = signal(false);

  readonly baixando = this.emAndamento.asReadonly();

  /**
   * Retorna `false` somente quando já existe outro download em andamento.
   * Falhas reais continuam sendo lançadas para a superfície exibir o toast.
   */
  async baixar(panoramaId: string, nomeDoArquivo: string): Promise<boolean> {
    if (this.emAndamento()) return false;

    this.emAndamento.set(true);
    try {
      const sourceUrl = await this.imagens.obter(panoramaId, 'treated');
      const watermarkedBlob = await this.marcaDagua.applyFromObjectUrl(sourceUrl);
      const downloadUrl = URL.createObjectURL(watermarkedBlob);

      try {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = nomeDoArquivo;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(downloadUrl);
      }

      return true;
    } finally {
      this.emAndamento.set(false);
    }
  }
}
