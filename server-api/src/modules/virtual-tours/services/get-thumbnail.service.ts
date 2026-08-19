import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { PanoramaImageReader } from '../../panoramas/panorama-image.reader';
import {
  LARGURA_MINIATURA,
  chaveDeCache,
  clienteJaTem,
  etagDe,
  reduzirComCache,
} from '../../panoramas/panorama-miniatura';

export interface RespostaMiniatura {
  etag: string;
  /** Ausente quando o cliente já tem esta versão — o controller responde 304. */
  corpo?: Buffer;
}

@Injectable()
export class GetThumbnailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leitor: PanoramaImageReader,
  ) {}

  async execute(
    virtualTourId: string,
    etagDoCliente?: string,
  ): Promise<RespostaMiniatura> {
    // Consulta estreita de propósito: nenhuma coluna de imagem. Descobrir QUAL
    // panorâmica é a capa e se ela mudou não exige tocar em TOAST, e é isso que
    // torna a revalidação (304) barata.
    const capa = await this.prisma.panorama.findFirst({
      // Rota pública: mesmo critério do find — thumbnail só de tour publicado.
      where: { virtualTourId, virtualTour: { status: 'PUBLISHED' } },
      orderBy: [{ initialPanorama: 'desc' }, { order: 'asc' }],
      select: { id: true, updatedAt: true, treatmentStatus: true },
    });
    if (!capa) throw new NotFoundException('No thumbnail available');

    const etag = etagDe(capa.id, capa.updatedAt, LARGURA_MINIATURA);
    if (clienteJaTem(etagDoCliente, etag)) return { etag };

    const corpo = await reduzirComCache(
      chaveDeCache(capa.id, capa.updatedAt, LARGURA_MINIATURA),
      LARGURA_MINIATURA,
      async () => {
        const original = await this.leitor.carregar(
          capa.id,
          capa.treatmentStatus === 'DONE',
        );
        if (!original) throw new NotFoundException('No thumbnail available');
        return original;
      },
    );

    return { etag, corpo };
  }
}
