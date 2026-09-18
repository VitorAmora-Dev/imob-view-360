import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { base64Puro } from '../src/modules/panoramas/panorama-image';
import { armazenamentoDoAmbiente } from '../src/shared/armazenamento/armazenamento-do-ambiente';
import { ArmazenamentoDeImagens } from '../src/shared/armazenamento/armazenamento.port';

/**
 * Passa as fotos que estão em coluna base64 para o balde de objetos.
 *
 *   yarn migrar-imagens                      # seco: conta o que falta
 *   yarn migrar-imagens --aplicar            # migra
 *   yarn migrar-imagens --aplicar --limite=10
 *   yarn migrar-imagens --conferir           # passo 4: o que ainda não migrou
 *
 * **Idempotente**: só olha linha com bytes e SEM chave, então rodar de novo é
 * no-op. Fosse ao contrário, a segunda execução trocaria todas as chaves e
 * invalidaria o cache de todo visitante.
 *
 * **Retomável**: `--limite` processa N linhas e para. O banco de produção tem
 * 573 MB de foto e a instância tem 512 MB de RAM — rodar tudo de uma vez não é
 * opção, e parar no meio precisa ser seguro.
 *
 * **Seco por padrão.** Um comando que reescreve o banco não pode ter o caminho
 * destrutivo como o mais fácil de digitar por engano.
 *
 * A coluna NÃO é apagada. Ela é a rede de segurança até a etapa 5 da migração
 * — ver `docs/operacao/migracao-das-fotos.md`.
 */

const LIMITE_PADRAO = 25;

export interface ResumoDaMigracao {
  originais: number;
  tratadas: number;
  capturas: number;
  /** O que ficou para a próxima execução. */
  restam: number;
}

export async function conferir(
  prisma: PrismaClient,
): Promise<{ panoramas: number; tratadas: number; capturas: number }> {
  const [panoramas, tratadas, capturas] = await Promise.all([
    prisma.panorama.count({
      where: { imageKey: null, imageData: { not: null } },
    }),
    prisma.panorama.count({
      where: { treatedImageKey: null, treatedImageData: { not: null } },
    }),
    prisma.captureFrame.count({
      where: { imageKey: null, imageData: { not: null } },
    }),
  ]);
  return { panoramas, tratadas, capturas };
}

export async function migrar(
  prisma: PrismaClient,
  armazenamento: ArmazenamentoDeImagens,
  opcoes: { limite: number; aplicar: boolean },
): Promise<ResumoDaMigracao> {
  if (!Number.isSafeInteger(opcoes.limite) || opcoes.limite < 1) {
    throw new Error('--limite precisa ser um inteiro positivo');
  }
  const gravador = new GravadorDeImagens(armazenamento);
  const resumo: ResumoDaMigracao = {
    originais: 0,
    tratadas: 0,
    capturas: 0,
    restam: 0,
  };
  let orcamento = opcoes.limite;

  // Uma linha por vez, de propósito. Em paralelo, N imagens de 14 MB estariam
  // vivas ao mesmo tempo — é a mesma conta que obrigou o tratamento a ser
  // serial, e nenhuma coleta ajuda quando os buffers estão todos em uso.
  const originais = await prisma.panorama.findMany({
    where: { imageKey: null, imageData: { not: null } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: orcamento,
  });
  for (const { id } of originais) {
    if (!opcoes.aplicar) {
      resumo.originais++;
      orcamento--;
      continue;
    }
    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id },
      select: { imageData: true, imageKey: true, updatedAt: true },
    });
    if (!linha.imageData || linha.imageKey) continue;
    // Balde primeiro, banco depois. Se o balde falhar, o `throw` sobe e a
    // linha fica intacta para a próxima execução — que é o que faz uma
    // interrupção no meio ser segura.
    const chave = await gravador.gravarPanorama(
      id,
      Buffer.from(base64Puro(linha.imageData), 'base64'),
      'original',
    );
    // Não atropela uma refotografia ocorrida durante o upload. Nesse caso o
    // objeto fica órfão; a versão mais nova e sua chave permanecem intactas.
    const gravada = await prisma.panorama.updateMany({
      where: { id, imageKey: null, updatedAt: linha.updatedAt },
      data: { imageKey: chave },
    });
    resumo.originais += gravada.count;
    orcamento--;
  }

  if (orcamento > 0) {
    const tratadas = await prisma.panorama.findMany({
      where: { treatedImageKey: null, treatedImageData: { not: null } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: orcamento,
    });
    for (const { id } of tratadas) {
      if (!opcoes.aplicar) {
        resumo.tratadas++;
        orcamento--;
        continue;
      }
      const linha = await prisma.panorama.findUniqueOrThrow({
        where: { id },
        select: {
          treatedImageData: true,
          treatedImageKey: true,
          updatedAt: true,
        },
      });
      if (!linha.treatedImageData || linha.treatedImageKey) continue;
      const chave = await gravador.gravarPanorama(
        id,
        Buffer.from(base64Puro(linha.treatedImageData), 'base64'),
        'tratada',
      );
      const gravada = await prisma.panorama.updateMany({
        where: { id, treatedImageKey: null, updatedAt: linha.updatedAt },
        data: { treatedImageKey: chave },
      });
      resumo.tratadas += gravada.count;
      orcamento--;
    }
  }

  if (orcamento > 0) {
    const capturas = await prisma.captureFrame.findMany({
      where: { imageKey: null, imageData: { not: null } },
      select: { id: true, panoramaId: true, index: true },
      orderBy: { id: 'asc' },
      take: orcamento,
    });
    for (const frame of capturas) {
      if (!opcoes.aplicar) {
        resumo.capturas++;
        orcamento--;
        continue;
      }
      const linha = await prisma.captureFrame.findUniqueOrThrow({
        where: { id: frame.id },
        select: { imageData: true, imageKey: true },
      });
      if (!linha.imageData || linha.imageKey) continue;
      const chave = await gravador.gravarCaptura(
        frame.panoramaId,
        frame.index,
        Buffer.from(base64Puro(linha.imageData), 'base64'),
      );
      const gravada = await prisma.captureFrame.updateMany({
        where: { id: frame.id, imageKey: null, imageData: linha.imageData },
        data: { imageKey: chave },
      });
      resumo.capturas += gravada.count;
      orcamento--;
    }
  }

  const falta = await conferir(prisma);
  resumo.restam = falta.panoramas + falta.tratadas + falta.capturas;
  return resumo;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
  });

  try {
    if (args.includes('--conferir')) {
      const falta = await conferir(prisma);
      console.log(
        `Falta migrar: ${falta.panoramas} panorama(s), ${falta.tratadas} tratada(s), ${falta.capturas} foto(s) de captura.`,
      );
      if (falta.panoramas + falta.tratadas + falta.capturas > 0)
        process.exitCode = 1;
      return;
    }

    const aplicar = args.includes('--aplicar');
    const limite = Number(valorDe(args, '--limite') ?? LIMITE_PADRAO);
    if (!Number.isSafeInteger(limite) || limite < 1) {
      throw new Error(
        `--limite precisa ser um inteiro positivo. Recebido: ${valorDe(args, '--limite')}`,
      );
    }

    const resumo = await migrar(prisma, armazenamentoDoAmbiente(), {
      limite,
      aplicar,
    });
    console.log(
      `${aplicar ? 'Migrados' : 'Migrariam'}: ${resumo.originais} original(is), ${resumo.tratadas} tratada(s), ${resumo.capturas} captura(s). Restam ${resumo.restam}.`,
    );
    if (!aplicar) console.log('\nSeco. Repita com --aplicar para gravar.');
  } finally {
    await prisma.$disconnect();
  }
}

function valorDe(args: string[], nome: string): string | undefined {
  return args.find((a) => a.startsWith(`${nome}=`))?.slice(nome.length + 1);
}

// Atrás da guarda para o teste poder importar `migrar` sem abrir conexão.
if (require.main === module) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
