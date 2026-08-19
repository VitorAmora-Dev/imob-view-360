import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { urlDaImagem } from '../../panoramas/panorama-image';

@Injectable()
export class FindVirtualTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string) {
    // Rota pública: só serve tour publicado. DRAFT e ARCHIVED caem no mesmo 404
    // de tour inexistente, sem revelar que o id existe.
    // findFirst (e não findUnique) porque o where combina id + status.
    const tour = await this.prisma.virtualTour.findFirst({
      where: { id, status: 'PUBLISHED' },
      select: {
        id: true,
        status: true,
        propertyId: true,
        createdAt: true,
        updatedAt: true,
        panoramas: {
          // Nenhuma coluna de imagem. Esta consulta trazia `imageData` E
          // `treatedImageData` de cada cômodo para descartar uma delas em JS —
          // era ela que fazia o tour mais pesado sair com 58,4 MB de JSON, e o
          // log de query lenta a pegava em 1,25s. Agora ela não toca em TOAST.
          select: {
            id: true,
            roomName: true,
            updatedAt: true,
            order: true,
            initialPanorama: true,
            originHotspots: {
              select: {
                id: true,
                label: true,
                positionX: true,
                positionY: true,
                targetId: true,
              },
            },
            measurements: {
              select: { id: true, description: true, value: true, unit: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!tour) throw new NotFoundException('Virtual tour not found');

    return {
      ...tour,
      panoramas: tour.panoramas.map(({ updatedAt, ...panorama }) => ({
        ...panorama,
        imageUrl: urlDaImagem(panorama.id, updatedAt),
      })),
    };
  }
}
