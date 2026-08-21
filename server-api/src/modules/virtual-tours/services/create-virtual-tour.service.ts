import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { CreateVirtualTourDto } from '../dto/create-virtual-tour.dto';

const TOUR_TRANSACTION_OPTIONS = {
  /** Tempo máximo da transação inteira. Padrão do Prisma é 5s. */
  timeout: 60_000,
  /** Tempo para obter conexão do pool: uploads concorrentes seguram a dele por vários segundos. */
  maxWait: 10_000,
};

@Injectable()
export class CreateVirtualTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(dto: CreateVirtualTourDto, currentUser: JwtPayload) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, agencyId: currentUser.agencyId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const existing = await this.prisma.virtualTour.findUnique({
      where: { propertyId: dto.propertyId },
    });
    if (existing)
      throw new ConflictException(
        'Virtual tour already exists for this property',
      );

    // O corpo é limitado a 50MB (body-limit.config.ts), então a transação nunca
    // processa mais que isso — a ~5MB/s pessimistas de compressão TOAST + WAL
    // dá ~10s, e 60s deixa folga sem prender conexão indefinidamente. O padrão
    // do Prisma é 5s, curto demais para 4-6 panorâmicas em base64.
    const tour = await this.prisma.$transaction(async (tx) => {
      const tourCriado = await tx.virtualTour.create({
        data: { propertyId: dto.propertyId, status: dto.status },
      });

      const tempIdMap = new Map<string, string>();

      for (const p of dto.panoramas) {
        const panorama = await tx.panorama.create({
          data: {
            roomName: p.roomName,
            imageData: p.imageData,
            order: p.order,
            initialPanorama: p.initialPanorama,
            fittedVfovDeg: p.fittedVfovDeg,
            bandTopDeg: p.bandTopDeg,
            bandBottomDeg: p.bandBottomDeg,
            virtualTourId: tourCriado.id,
          },
          // Sem isto o Prisma faz um RETURNING de todas as colunas, e a única
          // que interessa é o id: a base64 de 7 a 27 MB que acabou de subir
          // atravessava a conexão de volta, uma vez por cômodo, para ser
          // descartada. O laço continua serial porque o id de cada panorama é o
          // que o `tempIdMap` precisa para ligar os hotspots depois.
          select: { id: true },
        });
        tempIdMap.set(p.tempId, panorama.id);

        if (p.measurements.length) {
          await tx.measurement.createMany({
            data: p.measurements.map((m) => ({
              ...m,
              panoramaId: panorama.id,
            })),
          });
        }
      }

      // Um `createMany` no lugar de um `create` por hotspot. Diferente das
      // panorâmicas, nenhum id volta a ser usado aqui — era ida e volta ao
      // banco por ligação, dentro da transação, para gravar quatro números.
      const hotspots = dto.panoramas.flatMap((p) => {
        const originId = tempIdMap.get(p.tempId)!;
        return p.hotspots.map((h) => {
          const targetId = tempIdMap.get(h.targetTempId);
          if (!targetId)
            throw new BadRequestException(
              `targetTempId "${h.targetTempId}" not found in panoramas list`,
            );
          return {
            label: h.label,
            positionX: h.positionX,
            positionY: h.positionY,
            originId,
            targetId,
          };
        });
      });

      if (hotspots.length) {
        await tx.hotspot.createMany({ data: hotspots });
      }

      return tx.virtualTour.findUnique({
        where: { id: tourCriado.id },
        select: {
          id: true,
          status: true,
          propertyId: true,
          createdAt: true,
          updatedAt: true,
          panoramas: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              roomName: true,
              order: true,
              initialPanorama: true,
              measurements: {
                select: {
                  id: true,
                  description: true,
                  value: true,
                  unit: true,
                },
              },
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
    }, TOUR_TRANSACTION_OPTIONS);

    // A montagem por IA NÃO é disparada aqui. Ela depende das fotos originais,
    // que sobem depois, em requisições próprias — disparar agora encontraria o
    // panorama sem referência nenhuma. Quem comanda é o cliente, por
    // `POST /virtual-tours/:id/montar`, quando o envio das fotos termina.
    return tour;
  }
}
