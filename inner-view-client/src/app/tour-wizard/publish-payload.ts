import { PanoramaUpload } from '../services/virtual-tour.service';
import { WizardScene } from './tour-wizard.model';

/**
 * Converte o rascunho no corpo do `POST /virtual-tours`.
 *
 * DONO: Frente A (é quem chama `publish()`). Função pura de propósito — a
 * conversão é a fronteira entre o modelo da tela e o da API, e testá-la não
 * deve exigir montar componente nenhum.
 *
 * O servidor aceita os hotspots INLINE, dentro de cada panorama, e resolve os
 * destinos por `tempId` na mesma transação (ver `create-virtual-tour.service.ts`
 * no server-api). Por isso o publicar é UMA chamada, e não um create de tour
 * seguido de N creates de hotspot: o `id` local da cena vira o `tempId`, e o
 * servidor devolve os uuids já amarrados.
 */
export interface CreateTourPayload {
  panoramas: PanoramaUpload[];
  /**
   * Quantos hotspots ficaram de fora por não terem destino.
   *
   * Não é erro: o corretor precisa saber, mas a publicação segue. O aviso
   * ("2 pontos sem destino não serão salvos") sai daqui.
   */
  discardedHotspots: number;
}

export function toCreateTourPayload(scenes: WizardScene[]): CreateTourPayload {
  const ready = scenes.filter((s) => s.state === 'ready');
  const validIds = new Set(ready.map((s) => s.id));
  let discardedHotspots = 0;

  const panoramas = ready.map((scene, i) => {
    // Um hotspot sem destino, ou apontando para uma cena que foi removida, é
    // inerte: não leva a lugar nenhum no viewer. O servidor exige destino, e
    // gravar um ponto morto só serviria para confundir depois.
    const hotspots = scene.hotspots.filter(
      (h) => h.target !== null && validIds.has(h.target),
    );
    discardedHotspots += scene.hotspots.length - hotspots.length;

    return {
      tempId: scene.id,
      roomName: scene.room.trim() || scene.fileName,
      imageData: scene.imageData,
      order: i,
      initialPanorama: i === 0,
      hotspots: hotspots.map((h) => ({
        label: h.label.trim() || undefined,
        positionX: h.u,
        positionY: h.v,
        targetTempId: h.target as string,
      })),
      ...(scene.geometry ?? {}),
    };
  });

  return { panoramas, discardedHotspots };
}
