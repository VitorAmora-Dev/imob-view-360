import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { PanoramaImageReader } from '../panorama-image.reader';
import {
  ARMAZENAMENTO,
  ArmazenamentoDeImagens,
  VALIDADE_DO_LINK_ASSINADO,
  chaveDaCapa,
} from '../../../shared/armazenamento/armazenamento.port';
import { chaveServida } from '../panorama-image';
import { clienteJaTem, etagDe } from '../panorama-miniatura';
import {
  LARGURA_DA_CAPA,
  chaveDeCache,
  larguraPedida,
  reduzirComCache,
} from '../capa-do-panorama';

export type VariantePreview = 'treated' | 'original';
export type RespostaPreview =
  | { tipo: 'desvio'; url: string }
  | { tipo: 'bytes'; etag: string; corpo?: Buffer };

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
    @Inject(ARMAZENAMENTO)
    private readonly armazenamento: ArmazenamentoDeImagens,
  ) {}

  async execute(
    panoramaId: string,
    currentUser: JwtPayload,
    opcoes: {
      variante: VariantePreview;
      largura?: number;
      etagDoCliente?: string;
    },
  ): Promise<RespostaPreview> {
    // A autorização vem PRIMEIRO e não mudou: escopo por agência, e
    // `NotFoundException` em vez de 403 porque 403 confirmaria o id. Emitir um
    // link assinado antes desta linha entregaria a foto de outra imobiliária a
    // quem tivesse o uuid.
    const panorama = await this.prisma.panorama.findFirst({
      where: {
        id: panoramaId,
        virtualTour: { property: { agencyId: currentUser.agencyId } },
      },
      select: {
        id: true,
        updatedAt: true,
        treatmentStatus: true,
        imageKey: true,
        treatedImageKey: true,
      },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    const largura = larguraPedida(opcoes.largura);
    const preferirTratada = opcoes.variante === 'treated';

    const chave = chaveServida(panorama, preferirTratada);
    if (chave) {
      const alvo = largura === null ? chave : chaveDaCapa(chave);
      const url = await this.armazenamento.enderecoAssinado(
        alvo,
        VALIDADE_DO_LINK_ASSINADO,
      );
      if (url) return { tipo: 'desvio', url };
    }

    // Queda: sem chave para esta variante, ou armazenamento que não assina.
    const etag = etagDe(
      panorama.id,
      panorama.updatedAt,
      largura ?? 0,
      opcoes.variante,
    );
    if (clienteJaTem(opcoes.etagDoCliente, etag))
      return { tipo: 'bytes', etag };

    const carregar = async (): Promise<Buffer> => {
      // `treated` aceita cair na original: durante a captura o tratamento pode
      // não ter terminado, e o leitor já faz esse fallback. `original` nunca
      // cai na tratada — é justamente o que ele existe para não fazer.
      const bytes = await this.leitor.carregar(panorama.id, preferirTratada);
      if (!bytes) throw new NotFoundException('Panorama image not available');
      return bytes;
    };

    if (largura === null)
      return { tipo: 'bytes', etag, corpo: await carregar() };

    const capa = await this.leitor.carregarCapa(panorama.id, preferirTratada);
    if (capa) return { tipo: 'bytes', etag, corpo: capa };

    return {
      tipo: 'bytes',
      etag,
      corpo: await reduzirComCache(
        chaveDeCache(
          panorama.id,
          panorama.updatedAt,
          LARGURA_DA_CAPA,
          opcoes.variante,
        ),
        LARGURA_DA_CAPA,
        carregar,
      ),
    };
  }
}
