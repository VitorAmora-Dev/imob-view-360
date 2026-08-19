import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { base64Puro } from './panorama-image';

/**
 * Lê UMA das duas colunas de imagem de um panorama.
 *
 * Existe para que a regra de "qual coluna pedir" viva num lugar só. Quem lê
 * imagem hoje são a capa do tour e a rota de imagem por panorama, e as duas
 * precisam da mesma decisão: `imagemServivel` prefere a tratada, mas pedir as
 * duas colunas ao banco para descartar uma em JS é o que fazia a consulta mais
 * pesada do sistema custar o dobro do que precisava.
 *
 * `treatmentStatus` é o discriminador porque anda junto de `treatedImageData`
 * nos dois lugares que a escrevem: `treat-panorama.service.ts` ao concluir e o
 * `SEM_TRATAMENTO` de `update-panorama.service.ts` ao refotografar. Ainda assim
 * é um palpite, e o fallback existe porque um palpite errado aqui viraria tela
 * sem imagem.
 */
@Injectable()
export class PanoramaImageReader {
  constructor(private readonly prisma: PrismaService) {}

  async carregar(
    panoramaId: string,
    preferirTratada: boolean,
  ): Promise<Buffer | null> {
    // O `??` faz o trabalho: com o palpite certo, a segunda consulta nunca roda.
    const imagem =
      (preferirTratada ? await this.tratada(panoramaId) : null) ??
      (await this.original(panoramaId));

    return imagem ? Buffer.from(base64Puro(imagem), 'base64') : null;
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
