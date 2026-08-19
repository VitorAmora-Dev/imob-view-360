import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { base64Puro } from '../../panoramas/panorama-image';
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
  constructor(private readonly prisma: PrismaService) {}

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
      () => this.carregarOriginal(capa.id, capa.treatmentStatus === 'DONE'),
    );

    return { etag, corpo };
  }

  /**
   * Lê UMA das duas colunas de imagem, não as duas.
   *
   * `imagemServivel` prefere a tratada quando ela existe, e `treatmentStatus`
   * anda junto de `treatedImageData` nos dois lugares que a escrevem
   * (`treat-panorama.service.ts` ao concluir, `update-panorama.service.ts` ao
   * refotografar). Aqui isso vira um palpite sobre qual coluna pedir — e o
   * fallback existe porque um palpite errado não pode virar tela sem capa.
   */
  private async carregarOriginal(
    panoramaId: string,
    tratada: boolean,
  ): Promise<Buffer> {
    // O `??` faz o trabalho: com o palpite certo, a segunda consulta nunca roda.
    const imagem =
      (tratada ? await this.tratada(panoramaId) : null) ??
      (await this.original(panoramaId));
    if (!imagem) throw new NotFoundException('No thumbnail available');

    return Buffer.from(base64Puro(imagem), 'base64');
  }

  private async tratada(id: string): Promise<string | null> {
    const linha = await this.prisma.panorama.findUnique({
      where: { id },
      select: { treatedImageData: true },
    });
    return linha?.treatedImageData ?? null;
  }

  private async original(id: string): Promise<string | null> {
    const linha = await this.prisma.panorama.findUnique({
      where: { id },
      select: { imageData: true },
    });
    return linha?.imageData ?? null;
  }
}
