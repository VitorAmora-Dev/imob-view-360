import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Apaga tours de captura abandonados no meio.
 *
 * O wizard cria o imóvel e o tour na primeira foto, para que a montagem por IA
 * possa rodar enquanto o corretor fotografa os outros cômodos. Quem desiste no
 * meio deixa para trás um tour `DRAFT` com as panorâmicas e todas as fotos
 * originais da captura em base64 — de 10 a 40 MB por cômodo, invisível na
 * listagem e sem nenhuma tela que o alcance para apagar.
 *
 *   yarn limpar-rascunhos                  # o que seria apagado, sem apagar
 *   yarn limpar-rascunhos --apagar         # apaga de verdade
 *   yarn limpar-rascunhos --dias=3         # outra idade de corte (padrão: 30)
 *
 * Seco por padrão. Um comando que apaga dado de cliente não pode ter o caminho
 * destrutivo como o mais fácil de digitar por engano.
 */

// 30 dias, e não 7. Enquanto o rascunho era invisível, varrer cedo era higiene:
// ninguém sentia falta do que não sabia que existia. Agora ele aparece numa
// faixa na home, e o mesmo script passa a apagar o que o corretor acha que
// guardou — uma captura de sexta, retomada só depois das férias, cabe em 30.
const DIAS_PADRAO = 30;

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? '',
});
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apagar = args.includes('--apagar');
  const dias = Number(valorDe(args, '--dias') ?? DIAS_PADRAO);

  if (!Number.isFinite(dias) || dias < 0) {
    throw new Error(
      `--dias precisa ser um número não-negativo. Recebido: ${valorDe(args, '--dias')}`,
    );
  }

  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  // `updatedAt` e não `createdAt`: o tour é tocado a cada panorama que entra e
  // a cada tratamento que termina, então ele mede quando a captura parou de
  // andar. Por `createdAt`, uma captura longa começada há oito dias e ainda em
  // curso seria apagada debaixo do corretor.
  const rascunhos = await prisma.virtualTour.findMany({
    where: { status: 'DRAFT', updatedAt: { lt: corte } },
    select: {
      id: true,
      propertyId: true,
      updatedAt: true,
      property: { select: { code: true, title: true } },
      _count: { select: { panoramas: true } },
    },
    orderBy: { updatedAt: 'asc' },
  });

  if (rascunhos.length === 0) {
    console.log(`Nenhum rascunho parado há mais de ${dias} dia(s).`);
    return;
  }

  console.log(
    `${rascunhos.length} rascunho(s) parado(s) há mais de ${dias} dia(s):\n`,
  );
  for (const r of rascunhos) {
    const idade = Math.floor(
      (Date.now() - r.updatedAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    console.log(
      `  ${r.id.slice(0, 8)}  ${String(r._count.panoramas).padStart(2)} cômodo(s)  ${String(idade).padStart(3)}d  ${r.property.code} — ${r.property.title}`,
    );
  }

  if (!apagar) {
    console.log('\nNada foi apagado. Repita com --apagar para confirmar.');
    return;
  }

  // Apagar o imóvel basta: `VirtualTour` tem `onDelete: Cascade` a partir de
  // `Property`, e `Panorama`, `CaptureFrame`, `Hotspot` e `Measurement` descem
  // em cascata a partir do tour. Apagar o tour sozinho deixaria o imóvel de
  // marcador para trás — que é justamente o registro que não tem tela nenhuma.
  const { count } = await prisma.property.deleteMany({
    where: { id: { in: rascunhos.map((r) => r.propertyId) } },
  });

  console.log(`\n${count} rascunho(s) apagado(s).`);
}

function valorDe(args: string[], nome: string): string | undefined {
  const achado = args.find((a) => a.startsWith(`${nome}=`));
  return achado?.slice(nome.length + 1);
}

main()
  .catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
