import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { TreatPanoramaService } from '../src/modules/panoramas/services/treat-panorama.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { CUSTO_POR_PANORAMA } from '../src/shared/imaging/montagem-360';

/**
 * Roda a etapa de IA sobre panoramas que já estão no banco.
 *
 * Existe para fechar o ciclo de teste em campo antes de o disparo automático
 * entrar: o corretor captura pelo app normalmente, este comando trata, e o tour
 * já mostra o resultado. Sem isso, testar exigiria confiar de primeira num
 * gatilho assíncrono dentro da rota de criação.
 *
 *   yarn tratar-panorama --listar           # o que existe, sem gastar nada
 *   yarn tratar-panorama --pendentes        # tudo que ainda não foi tratado
 *   yarn tratar-panorama --id=<uuid>        # um panorama específico
 *   yarn tratar-panorama --tour=<uuid>      # todos de um tour
 *   yarn tratar-panorama --pendentes --refazer   # inclui falhas e interrompidos
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const id = valorDe(args, '--id');
  const tour = valorDe(args, '--tour');
  const pendentes = args.includes('--pendentes');
  const refazer = args.includes('--refazer');

  if (args.includes('--listar')) {
    await listar();
    return;
  }

  if (!id && !tour && !pendentes) {
    throw new Error('Escolha um alvo: --id=<uuid>, --tour=<uuid> ou --pendentes. Ou --listar.');
  }

  const servico = new TreatPanoramaService(prisma as unknown as PrismaService);
  if (!servico.habilitado()) {
    throw new Error('OPENAI_API_KEY não configurada.');
  }

  const alvos = await prisma.panorama.findMany({
    where: {
      // Prefixo em vez de igualdade: `--listar` imprime os 8 primeiros
      // caracteres, e obrigar a copiar o UUID inteiro de outro lugar seria
      // atrito sem ganho.
      ...(id ? { id: { startsWith: id } } : {}),
      ...(tour ? { virtualTourId: { startsWith: tour } } : {}),
      ...(pendentes && !refazer ? { treatmentStatus: 'PENDING' } : {}),
      // PROCESSING entra só com `--refazer` porque, com a API no ar, ele pode
      // significar uma montagem realmente em curso — e pegá-la aqui custaria
      // uma segunda chamada paga sobre o mesmo panorama. Quem passa `--refazer`
      // está afirmando que quer retratar o que ficou pelo caminho.
      ...(pendentes && refazer
        ? { treatmentStatus: { in: ['PENDING', 'FAILED', 'PROCESSING'] } }
        : {}),
    },
    select: { id: true, roomName: true, treatmentStatus: true },
    orderBy: { order: 'asc' },
  });

  if (alvos.length === 0) {
    console.log('Nada a tratar.');
    return;
  }

  // O número aparece antes de gastar, não depois: uma chamada por panorama.
  console.log(
    `${alvos.length} panorama(s) · gpt-image-2 · ` +
      `${alvos.length} chamadas, ~US$ ${(alvos.length * CUSTO_POR_PANORAMA).toFixed(2)}.\n`,
  );

  let custo = 0;
  let tratados = 0;

  for (const alvo of alvos) {
    process.stdout.write(`· ${alvo.roomName} (${alvo.id.slice(0, 8)}) … `);

    const r = await servico.execute(alvo.id);
    custo += r.custoUSD;
    if (r.status === 'DONE') tratados++;

    const detalhe =
      r.status === 'DONE'
        ? ` — ${r.fotos} fotos · volta ${r.saltoAntes.toFixed(1)}→${r.saltoDepois.toFixed(1)}`
        : '';

    console.log(`${r.status}${detalhe} (${(r.ms / 1000).toFixed(0)}s)`);
  }

  console.log(`\n${tratados}/${alvos.length} tratados. Custo real: US$ ${custo.toFixed(2)}.`);
}

/**
 * Panorama sem as fotos originais não é montável: sem elas o modelo não tem
 * verdade de campo e repintaria o cômodo a partir da própria imagem. A listagem
 * separa os dois grupos para que isso apareça como informação, e não como um
 * erro no meio do processamento.
 */
async function listar(): Promise<void> {
  const todos = await prisma.panorama.findMany({
    select: {
      id: true,
      roomName: true,
      fittedVfovDeg: true,
      treatmentStatus: true,
      treatmentMeta: true,
      virtualTour: { select: { id: true, property: { select: { title: true } } } },
      _count: { select: { captureFrames: true } },
    },
    orderBy: [{ virtualTourId: 'asc' }, { order: 'asc' }],
  });

  const ok = todos.filter((p) => p._count.captureFrames >= 4);

  console.log(`${todos.length} panorama(s); ${ok.length} com fotos originais.\n`);

  for (const p of ok) {
    const meta = p.treatmentMeta as { saltoNaVolta?: { antes: number; depois: number } } | null;
    const volta = meta?.saltoNaVolta
      ? `volta ${meta.saltoNaVolta.antes.toFixed(1)}→${meta.saltoNaVolta.depois.toFixed(1)}`
      : '';

    console.log(
      `  ${p.id.slice(0, 8)}  ${String(p._count.captureFrames).padStart(2)} fotos  ` +
        `${p.treatmentStatus.padEnd(11)}${volta.padEnd(20)}` +
        `${p.virtualTour.property.title} / ${p.roomName}`,
    );
  }

  const semFotos = todos.length - ok.length;
  if (semFotos > 0) {
    console.log(`\n${semFotos} sem fotos originais suficientes — não montáveis.`);
  }
}

function valorDe(args: string[], nome: string): string | undefined {
  return args.find((a) => a.startsWith(`${nome}=`))?.slice(nome.length + 1);
}

main()
  .catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
