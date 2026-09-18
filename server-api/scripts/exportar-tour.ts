import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Exporta as imagens originais de UM tour, e não da base inteira.
 *
 * `exportar-capturas` varre todos os panoramas, o que num banco remoto significa
 * dezenas de megabytes de TOAST por rodada só para chegar ao imóvel que
 * interessa. Aqui o recorte vem por id — de imóvel ou de tour, aceita os dois
 * porque a URL do visitante carrega o do imóvel.
 *
 * O que sai é o ORIGINAL em ambos os níveis: `imageData`, a equirretangular
 * costurada antes da IA completar nadir e zênite, e as fotos como saíram da
 * câmera. A versão tratada não vem — para essa basta o endpoint público.
 *
 *   DATABASE_URL=... OUT_DIR=... yarn exportar-tour <id>
 *
 * Saída:
 *   <OUT_DIR>/panoramas-sem-ia/<ordem>-<cômodo>.jpg
 *   <OUT_DIR>/fotos-originais/<ordem>-<cômodo>/{00.jpg…, orientacoes.json}
 */
const alvo = process.argv[2];
if (!alvo) {
  console.error('uso: yarn exportar-tour <id do imóvel ou do tour>');
  process.exit(1);
}

const OUT = path.resolve(
  process.env.OUT_DIR ?? path.resolve(__dirname, '../../../imagens-exportadas/tour'),
);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Aceita tanto `data:image/jpeg;base64,…` quanto base64 puro. */
function toBuffer(imageData: string | null | undefined): Buffer | null {
  if (!imageData) return null;
  const comma = imageData.indexOf(',');
  const base64 =
    imageData.startsWith('data:') && comma > 0 ? imageData.slice(comma + 1) : imageData;
  return Buffer.from(base64, 'base64');
}

async function main(): Promise<void> {
  const panoramasDir = path.join(OUT, 'panoramas-sem-ia');
  const originaisDir = path.join(OUT, 'fotos-originais');
  fs.mkdirSync(panoramasDir, { recursive: true });
  fs.mkdirSync(originaisDir, { recursive: true });

  // Sem `imageData`: uma equirretangular passa de 20 MB em base64. Cada uma é
  // buscada adiante, sozinha, para não segurar o tour inteiro em memória.
  const panoramas = await prisma.panorama.findMany({
    where: {
      virtualTour: { OR: [{ id: alvo }, { propertyId: alvo }] },
    },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      roomName: true,
      order: true,
      bandTopDeg: true,
      bandBottomDeg: true,
      fittedVfovDeg: true,
      virtualTour: { select: { property: { select: { title: true } } } },
      _count: { select: { captureFrames: true } },
    },
  });

  if (panoramas.length === 0) {
    console.error(`nenhum panorama para o id ${alvo}`);
    process.exit(1);
  }

  console.log(`${panoramas[0].virtualTour.property.title}: ${panoramas.length} cômodos`);

  for (const panorama of panoramas) {
    const nome = `${String(panorama.order).padStart(2, '0')}-${slug(panorama.roomName)}`;

    const cheio = await prisma.panorama.findUniqueOrThrow({
      where: { id: panorama.id },
      select: { imageData: true },
    });
    const buffer = toBuffer(cheio.imageData);
    if (buffer && buffer.length > 1024) {
      fs.writeFileSync(path.join(panoramasDir, `${nome}.jpg`), buffer);
    }

    let escritas = 0;
    if (panorama._count.captureFrames > 0) {
      const pasta = path.join(originaisDir, nome);
      fs.mkdirSync(pasta, { recursive: true });
      const frames = await prisma.captureFrame.findMany({
        where: { panoramaId: panorama.id },
        orderBy: { index: 'asc' },
      });
      const manifesto = frames.flatMap((frame) => {
        const bytes = toBuffer(frame.imageData);
        if (!bytes) return [];
        const arquivo = `${String(frame.index).padStart(2, '0')}.jpg`;
        fs.writeFileSync(path.join(pasta, arquivo), bytes);
        escritas++;
        return [
          {
            arquivo,
            quaternion: { x: frame.qx, y: frame.qy, z: frame.qz, w: frame.qw },
          },
        ];
      });
      fs.writeFileSync(
        path.join(pasta, 'orientacoes.json'),
        JSON.stringify(
          {
            comodo: panorama.roomName,
            faixaFotografada: {
              inferiorDeg: panorama.bandBottomDeg,
              superiorDeg: panorama.bandTopDeg,
            },
            campoVerticalAjustadoDeg: panorama.fittedVfovDeg,
            fotos: manifesto,
          },
          null,
          2,
        ),
      );
    }

    console.log(
      `+ ${nome}: panorama ${buffer ? `${(buffer.length / 1048576).toFixed(1)} MB` : '—'}, ${escritas} fotos`,
    );
  }

  console.log(`\npronto em ${OUT}`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
