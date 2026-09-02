import { Panorama, VirtualTour } from '../models/virtual-tour.model';
import { urlDaImagem } from '../models/panorama-image.util';

/**
 * O vocabulário da tela de visualização (SPRINT-4-TOUR-VIEWER.md, TV-0).
 *
 * CONGELADO: as assinaturas daqui são o contrato entre as três frentes. Mudança
 * só por PR anunciado, com todo mundo ciente.
 *
 * Estes tipos NÃO duplicam `virtual-tour.model.ts` — eles traduzem. O backend
 * fala de `Panorama` com `roomName`, `imageUrl` e `originHotspots`; esta tela
 * fala de CENA, com nome, foto e caminhos de saída. A tradução acontece uma vez
 * só, em `cenasDoTour()`, e é isso que impede cada componente de reimplementar a
 * mesma conversão de um jeito ligeiramente diferente.
 */

/** Qual bottom sheet está aberto. Nunca dois ao mesmo tempo — ver o store. */
export type SheetKind = 'scenes' | 'embed' | 'delete' | 'manage' | null;

/**
 * Formato do iframe no sheet Incorporar. Índice e não string porque é o que o
 * segmented control opera, e a tabela abaixo é a fonte das medidas.
 */
export type EmbedFormat = 0 | 1 | 2;

export const EMBED_FORMATOS: ReadonlyArray<{
  rotuloKey: string;
  width: string;
  height: string;
}> = [
  { rotuloKey: 'TOUR_VIEWER.EMBED.FORMAT_RESPONSIVE', width: '100%', height: '600' },
  { rotuloKey: 'TOUR_VIEWER.EMBED.FORMAT_16_9', width: '960', height: '540' },
  { rotuloKey: 'TOUR_VIEWER.EMBED.FORMAT_SQUARE', width: '600', height: '600' },
];

/**
 * Quanto tempo o toast fica no ar.
 *
 * Vive aqui e não dentro do componente porque o store é quem agenda o
 * desaparecimento — e um segundo número, no CSS da animação, sairia de sincronia
 * na primeira vez que alguém mexesse em um dos dois.
 */
export const TOAST_MS = 2200;

/**
 * Um ponto de navegação no chão, como o overlay o desenha (TV-7).
 *
 * `u`/`v` são as MESMAS coordenadas de `Hotspot.positionX`/`positionY`: UV de 0
 * a 1, com `v = 0` no topo da esfera. Não converta nada aqui — a conversão para
 * pixel é de `hotspot-projection.ts`, que já existe e é testada.
 */
export interface ViewerHotspot {
  id: string;
  targetSceneId: string;
  /** Já resolvido: o label do hotspot ou, na falta dele, o nome da cena destino. */
  label: string;
  u: number;
  v: number;
  /** No máximo UM 'primary' por cena. Ver `marcarPrincipal()`. */
  kind: 'primary' | 'secondary';
}

/** Um cômodo do tour, do ponto de vista de quem está olhando a tela. */
export interface TourViewerScene {
  id: string;
  name: string;
  /** Esfera inteira, para o viewer 360. */
  imageUrl: string;
  /** Versão pequena da mesma foto, para a faixa e o rail. */
  thumbUrl: string;
  hotspots: ViewerHotspot[];
}

/**
 * Largura da miniatura pedida à API.
 *
 * 292 é 2x de 146×92, a maior miniatura da tela (o rail do desktop). Sem este
 * parâmetro a resposta é a equirretangular inteira — dezenas de MB por cômodo,
 * para desenhar um retângulo de 104px. A rota já sabe atender `w` e devolve
 * ETag com cache de um dia.
 */
export const LARGURA_DA_MINIATURA = 292;

/** Junta `w` ao endereço da foto sem supor se ele já tinha query string. */
export function comLargura(url: string, largura: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}w=${largura}`;
}

/**
 * Traduz o tour do backend nas cenas que esta tela desenha.
 *
 * A ordem é a do servidor (`panoramas` já vem com `orderBy: order`), e é ela que
 * define "próxima cena" para a regra do hotspot principal.
 */
export function cenasDoTour(tour: VirtualTour): TourViewerScene[] {
  const nomePorId = new Map(tour.panoramas.map((p) => [p.id, p.roomName]));

  return tour.panoramas.map((panorama, indice) => ({
    id: panorama.id,
    name: panorama.roomName,
    imageUrl: urlDaImagem(panorama),
    thumbUrl: comLargura(urlDaImagem(panorama), LARGURA_DA_MINIATURA),
    hotspots: hotspotsDaCena(panorama, tour, indice, nomePorId),
  }));
}

function hotspotsDaCena(
  panorama: Panorama,
  tour: VirtualTour,
  indice: number,
  nomePorId: Map<string, string>,
): ViewerHotspot[] {
  const proxima = tour.panoramas[indice + 1]?.id ?? null;

  const pontos: ViewerHotspot[] = panorama.originHotspots.map((h) => ({
    id: h.id,
    targetSceneId: h.targetId,
    // UPPERCASE é decisão de CSS, não de dado — ver `03-hotspots.md`.
    label: h.label?.trim() || nomePorId.get(h.targetId) || '',
    u: h.positionX,
    v: h.positionY,
    kind: 'secondary',
  }));

  return marcarPrincipal(pontos, proxima);
}

/**
 * Elege no máximo um hotspot principal da cena — o que ganha halo, anel de
 * pulso e chevron cheio.
 *
 * REGRA PROVISÓRIA, e o lugar certo de revisá-la é o PR da TV-7: o modelo do
 * backend ainda não guarda `kind`, então o caminho principal é deduzido. "O
 * hotspot que leva para a próxima cena na ordem" acerta o caso comum, que é o
 * tour montado em sequência pelo wizard, e erra sem consequência nos outros —
 * todos ficam secundários, que é o estado que o handoff manda usar quando o
 * tour não define um caminho principal.
 *
 * Se um dia `kind` for persistido, esta função vira leitura do campo e some.
 */
export function marcarPrincipal(
  pontos: ViewerHotspot[],
  proximaCenaId: string | null,
): ViewerHotspot[] {
  if (!proximaCenaId) return pontos;

  const principal = pontos.find((p) => p.targetSceneId === proximaCenaId);
  if (!principal) return pontos;

  return pontos.map((p) => (p === principal ? { ...p, kind: 'primary' as const } : p));
}
