import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { armazenamentoDoAmbiente } from '../src/shared/armazenamento/armazenamento-do-ambiente';
import {
  ArmazenamentoDeImagens,
  chaveDaCapa,
} from '../src/shared/armazenamento/armazenamento.port';

/**
 * Recolhe arquivo que nenhuma linha do banco aponta.
 *
 *   yarn varrer-orfaos                  # seco: lista o que seria apagado
 *   yarn varrer-orfaos --apagar
 *   yarn varrer-orfaos --apagar --dias=1
 *
 * Duas origens, as duas previstas:
 *
 * 1. **A versão anterior** de uma imagem retratada. O arquivo é imutável de
 *    propósito (decisão 2): é isso que faz invalidação de CDN sumir como classe
 *    de problema, e o preço é a versão velha ficar para trás.
 * 2. **A gravação que precedeu um banco que falhou** (decisão 10). Gravar no
 *    balde antes é o que impede uma linha apontar para o nada; o troco é este
 *    arquivo sem dono.
 *
 * `--dias` é o que torna a varredura segura: entre a gravação no balde e o
 * `UPDATE` existe uma janela em que um objeto legítimo ainda não tem dono.
 * Apagar por lá seria apagar uma captura em curso. O padrão de 7 dias é
 * folgado de propósito — lixo custa centavos, e apagar foto viva custa a foto.
 *
 * **Seco por padrão.**
 */

const DIAS_PADRAO = 7;

export async function varrer(
  prisma: PrismaClient,
  armazenamento: ArmazenamentoDeImagens,
  opcoes: { apagar: boolean; dias: number },
): Promise<{ examinados: number; orfaos: string[]; apagados: number }> {
  if (!Number.isFinite(opcoes.dias) || opcoes.dias < 0) {
    throw new Error('--dias precisa ser um número não-negativo');
  }
  const vivas = await chavesVivas(prisma);
  const corte = new Date(Date.now() - opcoes.dias * 24 * 60 * 60 * 1000);

  let examinados = 0;
  let apagados = 0;
  const orfaos: string[] = [];

  for (const prefixo of ['panoramas/', 'capturas/']) {
    for await (const objeto of armazenamento.listar(prefixo)) {
      examinados++;
      if (vivas.has(objeto.chave)) continue;
      if (objeto.modificadoEm > corte) continue;

      orfaos.push(objeto.chave);
      if (opcoes.apagar) {
        await armazenamento.apagar(objeto.chave);
        apagados++;
      }
    }
  }

  return { examinados, orfaos, apagados };
}

/**
 * Todo endereço que alguma linha ainda alcança — imagem, tratada, capa de cada
 * uma, e foto de referência.
 *
 * Em memória, e isso tem limite: são duas colunas por panorama mais uma por
 * foto de captura, o que com os 114 panoramas e as ~900 fotos de hoje é ruído.
 * Numa ordem de grandeza acima, esta varredura passa a precisar de paginação
 * por prefixo em vez do conjunto inteiro.
 */
async function chavesVivas(prisma: PrismaClient): Promise<Set<string>> {
  const vivas = new Set<string>();

  const panoramas = await prisma.panorama.findMany({
    select: { imageKey: true, treatedImageKey: true },
  });
  for (const linha of panoramas) {
    for (const chave of [linha.imageKey, linha.treatedImageKey]) {
      if (!chave) continue;
      vivas.add(chave);
      // A capa não tem coluna: ela se deduz da chave da imagem, e por isso
      // precisa ser reconstruída aqui — senão a varredura apagaria todas elas.
      vivas.add(chaveDaCapa(chave));
    }
  }

  const frames = await prisma.captureFrame.findMany({
    where: { imageKey: { not: null } },
    select: { imageKey: true },
  });
  for (const frame of frames) if (frame.imageKey) vivas.add(frame.imageKey);

  return vivas;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apagar = args.includes('--apagar');
  const dias = Number(valorDe(args, '--dias') ?? DIAS_PADRAO);
  if (!Number.isFinite(dias) || dias < 0) {
    throw new Error(
      `--dias precisa ser um número não-negativo. Recebido: ${valorDe(args, '--dias')}`,
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
  });

  try {
    const r = await varrer(prisma, armazenamentoDoAmbiente(), { apagar, dias });
    console.log(
      `${r.examinados} objeto(s) examinado(s), ${r.orfaos.length} órfão(s).`,
    );
    for (const chave of r.orfaos) console.log(`  ${chave}`);
    console.log(
      apagar ? `\n${r.apagados} apagado(s).` : '\nSeco. Repita com --apagar.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

function valorDe(args: string[], nome: string): string | undefined {
  return args.find((a) => a.startsWith(`${nome}=`))?.slice(nome.length + 1);
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
