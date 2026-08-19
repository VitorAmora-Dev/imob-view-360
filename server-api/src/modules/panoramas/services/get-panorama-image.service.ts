import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { PanoramaImageReader } from '../panorama-image.reader';
import {
  LARGURA_MAXIMA,
  chaveDeCache,
  clienteJaTem,
  etagDe,
  reduzirComCache,
} from '../panorama-miniatura';

export interface RespostaImagem {
  etag: string;
  /** Ausente quando o cliente já tem esta versão — o controller responde 304. */
  corpo?: Buffer;
}

/**
 * A imagem de um panorama servida como JPEG binário, por URL própria.
 *
 * Antes disso a única forma de obter a foto de um cômodo era baixar o tour
 * inteiro: `GET /virtual-tours/:id` trazia todas as panorâmicas em base64 no
 * mesmo JSON — 58,4 MB medidos no pior tour. O visitante paga por salas que
 * talvez nunca abra, o servidor segura tudo isso em heap, e o navegador não tem
 * como cachear uma foto separada das outras.
 *
 * Sem guard, e por isso a consulta filtra `PUBLISHED`: é a mesma regra da rota
 * pública de tour. Tour não publicado responde 404 e não 403 — 403 confirmaria
 * que o id existe.
 */
@Injectable()
export class GetPanoramaImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leitor: PanoramaImageReader,
  ) {}

  async execute(
    panoramaId: string,
    opcoes: { largura?: number; etagDoCliente?: string } = {},
  ): Promise<RespostaImagem> {
    // Consulta estreita: descobrir se a imagem existe, se mudou e qual coluna
    // pedir não exige tocar em TOAST. É isso que faz o 304 custar quase nada.
    const panorama = await this.prisma.panorama.findFirst({
      where: { id: panoramaId, virtualTour: { status: 'PUBLISHED' } },
      select: { id: true, updatedAt: true, treatmentStatus: true },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    const largura = normalizarLargura(opcoes.largura);
    const etag = etagDe(panorama.id, panorama.updatedAt, largura ?? 0);
    if (clienteJaTem(opcoes.etagDoCliente, etag)) return { etag };

    const tratada = panorama.treatmentStatus === 'DONE';

    // Sem `?w=` a imagem sai como está guardada, e deliberadamente NÃO entra no
    // cache: uma panorâmica chega a 27 MB, e guardar isso em memória de
    // processo trocaria uma leitura de banco por pressão de heap. Só as
    // variantes reduzidas, que são pequenas, valem a pena guardar.
    if (largura === null) {
      const corpo = await this.leitor.carregar(panorama.id, tratada);
      if (!corpo) throw new NotFoundException('Panorama image not available');
      return { etag, corpo };
    }

    const corpo = await reduzirComCache(
      chaveDeCache(panorama.id, panorama.updatedAt, largura),
      largura,
      async () => {
        const original = await this.leitor.carregar(panorama.id, tratada);
        if (!original)
          throw new NotFoundException('Panorama image not available');
        return original;
      },
    );

    return { etag, corpo };
  }
}

/**
 * `null` significa "sem redimensionar".
 *
 * O teto existe porque `?w=` é entrada de quem chama: sem ele, um valor absurdo
 * viraria um `sharp` ampliando uma equirretangular por requisição, numa rota
 * pública. Acima do teto, servir o original é mais barato do que qualquer
 * redimensionamento — e é o que o pedido queria dizer de qualquer forma.
 */
function normalizarLargura(largura?: number): number | null {
  if (!largura || !Number.isFinite(largura)) return null;
  if (largura >= LARGURA_MAXIMA) return null;
  return Math.max(1, Math.floor(largura));
}
