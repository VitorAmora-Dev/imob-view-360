import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VirtualTourService } from './virtual-tour.service';

type Variante = 'treated' | 'original';

/**
 * As fotos de panorama que o wizard mostra, como `blob:`.
 *
 * A rota `/panoramas/:id/preview` é autenticada, e o `TextureLoader` do
 * three.js não passa por interceptor nenhum — ele não teria como levar o
 * token. O caminho é sempre `HttpClient` → `blob:` → viewer. (Passar o
 * endereço da API direto ao viewer foi o que deixou a tela branca em `036b4ac`.)
 *
 * Existe como serviço, e não como chamada solta, por duas razões:
 *
 * 1. **Alguém precisa ser dono dos blobs.** `URL.createObjectURL` só é
 *    liberado por `revokeObjectURL` ou pelo fim da aba. Espalhados pelo store
 *    e pelo modal de captura, cada cômodo aberto deixava MB presos.
 * 2. **Retomar um rascunho abriria N downloads.** Com cache por `(id,
 *    variante)`, voltar a um cômodo já visto é de graça, e a promessa em voo é
 *    compartilhada — dois pedidos simultâneos do mesmo cômodo são um download.
 */
@Injectable({ providedIn: 'root' })
export class PanoramaImageCache {
  private readonly virtualTourService = inject(VirtualTourService);

  /** `panoramaId:variante` → `blob:` pronto. */
  private readonly prontos = new Map<string, string>();
  /** `panoramaId:variante` → download em voo, para não duplicar. */
  private readonly emVoo = new Map<string, Promise<string>>();

  async obter(panoramaId: string, variante: Variante): Promise<string> {
    const chave = `${panoramaId}:${variante}`;

    const pronto = this.prontos.get(chave);
    if (pronto) return pronto;

    const emVoo = this.emVoo.get(chave);
    if (emVoo) return emVoo;

    const promessa = firstValueFrom(
      this.virtualTourService.baixarPreview(panoramaId, variante),
    )
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        this.prontos.set(chave, url);
        return url;
      })
      .finally(() => this.emVoo.delete(chave));

    this.emVoo.set(chave, promessa);
    return promessa;
  }

  /**
   * Solta os blobs de um cômodo, ou de todos.
   *
   * Chamado no `reset` do wizard e ao descartar um rascunho. Não cancela
   * download em voo: a promessa já entregue a quem pediu precisa resolver, e
   * o blob que ela criar é pequeno perto de deixar quem chamou pendurado.
   */
  liberar(panoramaId?: string): void {
    for (const [chave, url] of this.prontos) {
      if (panoramaId && !chave.startsWith(`${panoramaId}:`)) continue;
      URL.revokeObjectURL(url);
      this.prontos.delete(chave);
    }
  }
}
