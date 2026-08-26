import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/**
 * O tour inteiro para quem vai voltar a editá-lo.
 *
 * Existe separado do `FindVirtualTourService` pela mesma razão que o
 * `/panoramas/:id/preview` existe separado do `/image`: aquela rota é pública,
 * e por isso filtra `PUBLISHED` — sem o filtro, qualquer um com um uuid leria
 * o rascunho de qualquer imobiliária. Aqui a autorização vem do token e do
 * escopo por agência, e o status deixa de importar.
 *
 * Nenhuma coluna de imagem, pelo mesmo motivo daquela consulta: elas são TOAST
 * de dezenas de MB e o wizard só precisa da foto do cômodo que está à vista.
 */
@Injectable()
export class FindDraftTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const tour = await this.prisma.virtualTour.findFirst({
      where: { id, property: { agencyId: currentUser.agencyId } },
      select: {
        id: true,
        propertyId: true,
        status: true,
        updatedAt: true,
        property: {
          select: {
            title: true,
            type: true,
            purpose: true,
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
      },
    });
    // 404 e não 403: 403 confirmaria que o id existe em outra imobiliária.
    if (!tour) throw new NotFoundException('Virtual tour not found');

    return {
      ...tour,
      panoramas: tour.panoramas.map(({ originHotspots, ...panorama }) => ({
        ...panorama,
        hotspots: originHotspots,
      })),
    };
  }
}
