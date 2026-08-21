import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { PanoramaImageReader } from '../panorama-image.reader';
import {
  LARGURA_MAXIMA,
  chaveDeCache,
  clienteJaTem,
  etagDe,
  reduzirComCache,
} from '../panorama-miniatura';
import { RespostaImagem } from './get-panorama-image.service';

export type VariantePreview = 'treated' | 'original';

/**
 * A imagem de um panorama para quem está editando o tour, não para quem o
 * visita.
 *
 * Existe separada de `GetPanoramaImageService` por causa de duas regras que se
 * contradizem. A rota pública é sem guard, e por isso filtra `PUBLISHED` — sem
 * esse filtro, qualquer um com um uuid leria o rascunho de qualquer
 * imobiliária. O wizard precisa do oposto: o tour está em `DRAFT` justamente
 * enquanto o corretor captura, que é quando ele mais precisa ver a foto.
 *
 * A conciliação é o guard: aqui a autorização vem do token e do escopo por
 * agência, como no resto das rotas de edição, e o status do tour deixa de
 * importar. Espelhar isso na rota pública com um parâmetro seria uma flag capaz
 * de desligar o filtro que a protege.
 *
 * A outra diferença é poder escolher a variante. A rota pública decide sozinha
 * (tratada quando `DONE`) porque o visitante quer a melhor imagem e ponto; o
 * wizard mostra as duas lado a lado.
 */
@Injectable()
export class GetPanoramaPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leitor: PanoramaImageReader,
  ) {}

  async execute(
    panoramaId: string,
    currentUser: JwtPayload,
    opcoes: {
      variante: VariantePreview;
      largura?: number;
      etagDoCliente?: string;
    },
  ): Promise<RespostaImagem> {
    // Escopo por agência no padrão das rotas de edição, e `NotFoundException`
    // em vez de 403 pelo mesmo motivo de sempre: 403 confirmaria o id.
    const panorama = await this.prisma.panorama.findFirst({
      where: {
        id: panoramaId,
        virtualTour: { property: { agencyId: currentUser.agencyId } },
      },
      select: { id: true, updatedAt: true, treatmentStatus: true },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    const largura = normalizarLargura(opcoes.largura);

    // A variante entra no ETag e na chave de cache. Sem isso as duas imagens
    // dividiriam a mesma identidade: o botão de comparar pediria a original,
    // o navegador veria o ETag que já tem da tratada e responderia do cache —
    // o antes e o depois viravam a mesma foto, sem nenhuma requisição para
    // denunciar.
    const etag = etagDe(
      panorama.id,
      panorama.updatedAt,
      largura ?? 0,
      opcoes.variante,
    );
    if (clienteJaTem(opcoes.etagDoCliente, etag)) return { etag };

    // `treated` aceita cair na original: durante a captura o tratamento pode
    // não ter terminado, e o leitor já faz esse fallback. `original` nunca cai
    // na tratada — é justamente o que ele existe para não fazer.
    const preferirTratada = opcoes.variante === 'treated';

    if (largura === null) {
      const corpo = await this.leitor.carregar(panorama.id, preferirTratada);
      if (!corpo) throw new NotFoundException('Panorama image not available');
      return { etag, corpo };
    }

    const corpo = await reduzirComCache(
      chaveDeCache(panorama.id, panorama.updatedAt, largura, opcoes.variante),
      largura,
      async () => {
        const original = await this.leitor.carregar(
          panorama.id,
          preferirTratada,
        );
        if (!original)
          throw new NotFoundException('Panorama image not available');
        return original;
      },
    );

    return { etag, corpo };
  }
}

/** Mesma regra da rota pública: acima do teto, o original sai mais barato. */
function normalizarLargura(largura?: number): number | null {
  if (!largura || !Number.isFinite(largura)) return null;
  if (largura >= LARGURA_MAXIMA) return null;
  return Math.max(1, Math.floor(largura));
}
