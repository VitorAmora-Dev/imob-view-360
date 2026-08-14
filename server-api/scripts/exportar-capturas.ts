import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Descarrega para o disco as fotos originais de cada captura e o panorama
 * montado a partir delas.
 *
 * O painel de remontagem (`/dev/remontagem` no cliente) lê exatamente esta
 * estrutura, e é assim que uma costura nova é medida sobre uma captura antiga
 * sem pedir ao corretor que fotografe de novo. Enquanto isso era um script
 * solto, cada rodada de investigação começava reescrevendo-o.
 *
 *   yarn exportar-capturas            # só o que ainda não foi exportado
 *   yarn exportar-capturas --tudo     # reescreve tudo
 *
 * Saída, em `imagens-exportadas/`:
 *   fotos-originais/<imóvel>__<cômodo>/{00.jpg…, orientacoes.json}
 *   panoramas/<imóvel>__<cômodo>.jpg
 *   INDICE.md
 */
const OUT = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.resolve(__dirname, '../../../imagens-exportadas');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

/**
 * Nome de pasta a partir do título do imóvel e do nome do cômodo. As acentuadas
 * passam pelo NFD e perdem a marca separada — sem isso o "ã" de "alemão" viraria
 * um hífen na regra seguinte, e o nome deixaria de bater com o das exportações
 * já feitas.
 */
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

interface Linha {
  nome: string;
  quando: string;
  fotos: number;
  faixa: string;
  vfov: string;
  imovel: string;
  comodo: string;
}

async function main(): Promise<void> {
  const tudo = process.argv.includes('--tudo');
  const panoramasDir = path.join(OUT, 'panoramas');
  const originaisDir = path.join(OUT, 'fotos-originais');
  fs.mkdirSync(panoramasDir, { recursive: true });
  fs.mkdirSync(originaisDir, { recursive: true });

  // Sem `imageData`: um panorama chega a 20 MB em base64 e são dezenas deles.
  // O conteúdo de cada um é buscado adiante, um de cada vez.
  const panoramas = await prisma.panorama.findMany({
    select: {
      id: true,
      roomName: true,
      bandTopDeg: true,
      bandBottomDeg: true,
      fittedVfovDeg: true,
      virtualTour: { select: { property: { select: { title: true } } } },
      _count: { select: { captureFrames: true } },
    },
  });

  // Nada impede dois cômodos de terem o mesmo nome no mesmo imóvel, e quando
  // isso acontece as duas capturas caem na mesma pasta: a segunda sobrescreve a
  // primeira, ou é pulada por já encontrar um `orientacoes.json` — de qualquer
  // jeito uma captura some sem aviso. O id desempata.
  const usados = new Set<string>();

  const linhas: Linha[] = [];
  for (const panorama of panoramas) {
    const imovel = panorama.virtualTour.property.title;
    const base = `${slug(imovel)}__${slug(panorama.roomName)}`;
    const nome = usados.has(base) ? `${base}--${panorama.id.slice(0, 6)}` : base;
    usados.add(nome);
    const pasta = path.join(originaisDir, nome);
    const temFotos = panorama._count.captureFrames > 0;
    const jaExportada =
      !tudo && temFotos && fs.existsSync(path.join(pasta, 'orientacoes.json'));

    let escritas = panorama._count.captureFrames;
    let quando = '';

    if (!jaExportada) {
      const cheio = await prisma.panorama.findUniqueOrThrow({
        where: { id: panorama.id },
        select: { imageData: true },
      });
      const buffer = toBuffer(cheio.imageData);
      if (buffer && buffer.length > 1024) {
        fs.writeFileSync(path.join(panoramasDir, `${nome}.jpg`), buffer);
      }

      escritas = 0;
      if (temFotos) {
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
          return [{
            arquivo,
            quaternion: { x: frame.qx, y: frame.qy, z: frame.qz, w: frame.qw },
          }];
        });
        fs.writeFileSync(
          path.join(pasta, 'orientacoes.json'),
          JSON.stringify(manifesto, null, 2),
        );
        quando = isoMinuto(frames[frames.length - 1]?.createdAt);
      }
      console.log(`+ ${nome} (${escritas} fotos)`);
    } else {
      const ultima = await prisma.captureFrame.findFirst({
        where: { panoramaId: panorama.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      quando = isoMinuto(ultima?.createdAt);
      console.log(`= ${nome} (já estava lá)`);
    }

    linhas.push({
      nome,
      quando,
      fotos: escritas,
      faixa:
        panorama.bandTopDeg === null || panorama.bandBottomDeg === null
          ? ''
          : `${panorama.bandBottomDeg.toFixed(1)}° … ${panorama.bandTopDeg.toFixed(1)}°`,
      vfov: panorama.fittedVfovDeg === null ? '' : panorama.fittedVfovDeg.toFixed(1),
      imovel,
      comodo: panorama.roomName,
    });
  }

  escreverIndice(linhas);
  console.log(`\n${linhas.length} panoramas em ${OUT}`);
}

function isoMinuto(date: Date | null | undefined): string {
  return date ? date.toISOString().replace('T', ' ').slice(0, 16) : '';
}

function escreverIndice(linhas: Linha[]): void {
  const corpo = linhas
    .slice()
    // Mais recente primeiro; os panoramas sem fotos originais (importados ou
    // semeados antes da câmera guiada) ficam no fim, onde não atrapalham.
    .sort((a, b) => (b.quando || '').localeCompare(a.quando || ''))
    .map(
      (l) =>
        `| \`${l.nome}\` | ${l.quando || '—'} | ${l.fotos || '—'} | ${l.faixa || '—'} |` +
        ` ${l.vfov || '—'} | ${l.imovel} / ${l.comodo} |`,
    );

  fs.writeFileSync(
    path.join(OUT, 'INDICE.md'),
    [
      '# Capturas exportadas',
      '',
      'Gerado por `yarn exportar-capturas` no `server-api`.',
      '`fotos-originais/<pasta>/` traz as fotos como saíram da câmera com',
      '`orientacoes.json`; `panoramas/<pasta>.jpg` traz o equiretangular montado.',
      'A faixa é a parte da esfera que é pixel fotografado — fora dela o panorama',
      'é preenchido por software.',
      '',
      '| pasta | capturado em | fotos | faixa fotografada | campo vertical | imóvel / cômodo |',
      '|---|---|---|---|---|---|',
      ...corpo,
      '',
    ].join('\n'),
  );
}

main()
  .catch((cause: unknown) => {
    console.error('falhou:', cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
