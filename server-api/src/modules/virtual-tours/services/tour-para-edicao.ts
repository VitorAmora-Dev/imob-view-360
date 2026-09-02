import { Prisma } from 'generated/prisma/client';

/**
 * O que o wizard precisa saber de um tour para reabri-lo, e o formato em que
 * ele espera receber.
 *
 * Existe fora dos dois serviços que o usam — `FindDraftTourService` e
 * `FindEditableTourService` — porque a diferença entre eles é UMA linha (qual
 * `status` passa), e tudo o mais tem de ser idêntico. Duplicado, o próximo
 * campo novo entraria num só, e a tela abriria completa por um caminho e pela
 * metade pelo outro.
 *
 * NENHUMA coluna de imagem, e isso é regra e não esquecimento: `imageData` e
 * `treatedImageData` são TOAST de dezenas de MB, e o wizard só precisa da foto
 * do cômodo que está à vista — que ele busca depois, uma a uma, pelo
 * `/panoramas/:id/preview`.
 */
export const SELECAO_PARA_EDICAO = {
  id: true,
  propertyId: true,
  status: true,
  updatedAt: true,
  property: {
    select: {
      title: true,
      type: true,
      purpose: true,
      // Quais dos três acima ainda são marcador. Sem isto a retomada precisa
      // adivinhar pelo título, e erra quando só o título foi preenchido.
      draftPlaceholders: true,
      address: {
        select: {
          street: true,
          number: true,
          complement: true,
          district: true,
          city: true,
          state: true,
          zipCode: true,
        },
      },
    },
  },
  panoramas: {
    orderBy: { order: 'asc' },
    select: {
      id: true,
      roomName: true,
      order: true,
      initialPanorama: true,
      treatmentStatus: true,
      // Sem isto a etapa de ordenação volta com todos os cômodos soltos e a
      // fila da etapa de passagens volta vazia — ver `Panorama.draftConnections`.
      draftConnections: true,
      originHotspots: {
        select: {
          id: true,
          label: true,
          positionX: true,
          positionY: true,
          targetId: true,
        },
      },
    },
  },
} satisfies Prisma.VirtualTourSelect;

type TourSelecionado = Prisma.VirtualTourGetPayload<{
  select: typeof SELECAO_PARA_EDICAO;
}>;

/**
 * Renomeia `originHotspots` para `hotspots`.
 *
 * O nome do banco descreve a ARESTA ("os hotspots que saem daqui"); o wizard
 * lê o cômodo e pergunta "quais são os pontos dele". A tradução acontece uma
 * vez, aqui, e não em cada tela.
 */
export function formatarParaEdicao(tour: TourSelecionado) {
  return {
    ...tour,
    panoramas: tour.panoramas.map(({ originHotspots, ...panorama }) => ({
      ...panorama,
      hotspots: originHotspots,
    })),
  };
}
