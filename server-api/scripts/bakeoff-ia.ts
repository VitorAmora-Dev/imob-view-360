import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import {
  FACE_NAMES,
  FaceName,
  LATERAL_FACES,
  POLE_FACES,
  Raster,
  composeEquirect,
  equirectToCubemap,
  faceSizeFor,
} from '../src/shared/imaging/cubemap';
import {
  Orientacao,
  erodirCobertura,
  faixaCoberta,
  fracaoCoberta,
  lerOrientacoes,
  mascaraDeCobertura,
  mascaraDeCoberturaFace,
} from '../src/shared/imaging/coverage';
import { RelatorioFotometrico, emStops, luminancia, medirFotometria } from '../src/shared/imaging/fotometria';
import {
  GeminiImageProvider,
  ImageEditProvider,
  OpenAIImageProvider,
  ResultadoEdicao,
  descontinuidadeNaBorda,
  diferencaMedia,
} from '../src/shared/imaging/providers';
import { promptDeIluminacao, promptDePolo, promptDeRemendo } from '../src/shared/imaging/prompts';
import {
  escrever,
  lerRaster,
  marcarBuraco,
  rasterParaJpeg,
  rasterParaPng,
} from '../src/shared/imaging/raster';

/**
 * Bake-off: qual rota resolve cada defeito dos panoramas, medido nas imagens
 * reais do projeto antes de comprometer arquitetura de produção.
 *
 * A tese que está sendo testada é que mandar o equirect inteiro para um modelo
 * generativo não funciona — nem cabe na resolução dos modelos, nem sobrevive à
 * projeção, nem é seguro para anúncio — e que o caminho é decompor em cubemap e
 * gerar apenas onde não existe pixel fotografado.
 *
 * Quatro experimentos:
 *   A  nadir/zênite     generativo mascarado nas faces py/ny
 *   B  emenda/paralaxe  remendo pontual, só se houver `remendos.json`
 *   C  iluminação       rota tonal (sharp) contra rota generativa
 *   D  exposição/WB     medição pura, sem IA — dimensiona trabalho de stitcher
 *
 *   yarn bakeoff-ia                      # D + decomposição; NÃO chama API
 *   yarn bakeoff-ia --gerar              # roda também A e C (custa dinheiro)
 *   yarn bakeoff-ia --capturas=a,b       # limita o corpus
 *   yarn bakeoff-ia --seeds=2            # repetições por modelo
 *
 * Saída em `imagens-exportadas/bakeoff/`.
 */

const RAIZ = process.env.BAKEOFF_OUT_DIR
  ? path.resolve(process.env.BAKEOFF_OUT_DIR)
  : path.resolve(__dirname, '../../../imagens-exportadas');

const SAIDA = path.join(RAIZ, 'bakeoff');

/** Corpus padrão: três capturas com defeitos deliberadamente diferentes. */
const CORPUS_PADRAO = [
  'mvp1-07-08-sala__mvp-1-sala-07-08',
  '06-08-17-12__cozinha',
  'tripe__cozinha',
];

interface Captura {
  pasta: string;
  vfovDeg: number;
  frameAspect: number;
  orientacoes: Orientacao[];
  panorama: string;
  fotosDir: string;
}

interface MedicaoCaptura {
  pasta: string;
  panorama: { width: number; height: number };
  fotos: number;
  vfovDeg: number;
  faixaCoberta: { pitchMinDeg: number; pitchMaxDeg: number };
  fracaoEsferaCoberta: number;
  buracoPorFace: Record<string, number>;
  fotometria: {
    maiorSaltoStops: number;
    amplitudeAnelStops: number;
    maiorDesvioWB: number;
  };
  geracoes: ResumoGeracao[];
  /** Qual geração venceu em cada polo, e com que `borda`. */
  escolhidas: Partial<Record<string, { de: string; borda: number }>>;
}

/**
 * Largura, em pixels de face, da faixa em que geração e fotografia se misturam.
 * Doze a 1280 é cerca de 1% da face — sobra para o modelo casar textura e some
 * a olho nu, sem virar uma licença para reescrever o cômodo.
 */
const PENA = 12;

/**
 * Experimento B: retângulos, em coordenadas normalizadas da face, sobre quebras
 * de costura conhecidas. Vive num `remendos.json` dentro da pasta da captura em
 * `bakeoff/` porque a região só pode ser escolhida olhando — não há como um
 * script adivinhar qual linha de teto ficou torta.
 *
 *   [{ "face": "nz", "x": 0.42, "y": 0.10, "w": 0.06, "h": 0.55 }]
 */
interface Remendo {
  face: FaceName;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ResumoGeracao {
  experimento: 'A-nadir-zenite' | 'B-remendo' | 'C-iluminacao';
  face: string;
  modelo: string;
  seed: number;
  derivaForaDaMascara: number;
  descontinuidadeNaBorda: number;
  ms: number;
  custoUSD: number;
  erro?: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const gerar = args.includes('--gerar');
  const seeds = Number(valorDe(args, '--seeds') ?? 2);
  const escolhidas = valorDe(args, '--capturas')?.split(',').filter(Boolean) ?? CORPUS_PADRAO;

  const catalogo = lerCatalogo();
  const capturas = await Promise.all(escolhidas.map((pasta) => montarCaptura(pasta, catalogo)));

  const providers = [new GeminiImageProvider(), new OpenAIImageProvider()].filter((p) => {
    if (p.disponivel()) return true;
    console.log(`· ${p.nome}: sem chave configurada, será ignorado.`);
    return false;
  });

  if (gerar && providers.length === 0) {
    throw new Error(
      '--gerar pedido mas nenhuma chave encontrada. Defina GEMINI_API_KEY e/ou OPENAI_API_KEY.',
    );
  }

  if (gerar) {
    // Chamada de API é gasto real: o número aparece antes de gastar, não depois.
    // Os remendos do experimento B ficam de fora porque dependem de quantos
    // retângulos existirem em cada `remendos.json`.
    const porCaptura = providers.length * (seeds * POLE_FACES.length + 1);
    const chamadas = capturas.length * porCaptura;
    console.log(
      `\n! ${chamadas} chamadas previstas (~US$ ${(chamadas * 0.17).toFixed(2)}), ` +
        'fora os remendos do experimento B.\n',
    );
  } else {
    console.log('\n· Modo medição: nenhuma API será chamada. Use --gerar para os experimentos A e C.\n');
  }

  const medicoes: MedicaoCaptura[] = [];
  for (const captura of capturas) {
    console.log(`\n=== ${captura.pasta} ===`);
    medicoes.push(await processar(captura, providers, gerar, seeds));
  }

  await escrever(path.join(SAIDA, 'medicoes.json'), Buffer.from(JSON.stringify(medicoes, null, 2)));
  await escrever(path.join(SAIDA, 'RELATORIO.md'), Buffer.from(montarRelatorio(medicoes, gerar)));

  console.log(`\nRelatório em ${path.join(SAIDA, 'RELATORIO.md')}`);
}

/* -------------------------------------------------------------------------- */
/* Um panorama                                                                 */
/* -------------------------------------------------------------------------- */

async function processar(
  captura: Captura,
  providers: ImageEditProvider[],
  gerar: boolean,
  seeds: number,
): Promise<MedicaoCaptura> {
  const destino = path.join(SAIDA, captura.pasta);
  const equirect = await lerRaster(captura.panorama);
  console.log(`  panorama ${equirect.width}x${equirect.height}, ${captura.orientacoes.length} fotos`);

  /* --- D: medição, sem API ------------------------------------------------ */

  // A estatística de esfera roda numa cópia reduzida: a fração coberta não muda
  // com a resolução, e a 5120×2560 seriam 13 milhões de projeções por nada.
  const opts = { vfovDeg: captura.vfovDeg, frameAspect: captura.frameAspect };
  const mascaraEstat = mascaraDeCobertura(1024, 512, captura.orientacoes, opts);
  const coberta = fracaoCoberta(mascaraEstat);
  const faixa = faixaCoberta(mascaraEstat);
  console.log(
    `  esfera coberta ${(coberta * 100).toFixed(1)}% · faixa ${faixa.pitchMinDeg.toFixed(1)}…${faixa.pitchMaxDeg.toFixed(1)}°`,
  );

  const fotometria = await medirExposicao(captura);
  console.log(
    `  exposição: maior salto ${fotometria.maiorSaltoStops.toFixed(2)} stops · ` +
      `amplitude do anel ${fotometria.amplitudeAnelStops.toFixed(2)} stops · ` +
      `pior desvio de WB ${(fotometria.maiorDesvioWB * 100).toFixed(1)}%`,
  );

  /* --- Decomposição em cubemap ------------------------------------------- */

  const lado = faceSizeFor(equirect.width);
  const faces = equirectToCubemap(equirect, lado);
  const coberturas = {} as Record<FaceName, Raster>;
  const buracoPorFace: Record<string, number> = {};

  for (const face of FACE_NAMES) {
    coberturas[face] = mascaraDeCoberturaFace(face, lado, captura.orientacoes, opts);
    buracoPorFace[face] = 1 - fracaoCoberta(coberturas[face]);

    await escrever(path.join(destino, 'faces', `${face}.png`), await rasterParaPng(faces[face]));
    await escrever(
      path.join(destino, 'mascaras', `${face}.png`),
      await rasterParaPng(coberturas[face]),
    );
  }

  // As faces de polo com o buraco pintado de magenta: é a imagem que mostra o
  // problema a quem não vai abrir o tour.
  for (const face of POLE_FACES) {
    await escrever(
      path.join(destino, 'buracos', `${face}.png`),
      await rasterParaPng(marcarBuraco(faces[face], coberturas[face], [255, 0, 190])),
    );
  }

  console.log(
    `  faces ${lado}px · buraco no nadir ${(buracoPorFace.ny * 100).toFixed(1)}% · ` +
      `no zênite ${(buracoPorFace.py * 100).toFixed(1)}%`,
  );

  const medicao: MedicaoCaptura = {
    pasta: captura.pasta,
    panorama: { width: equirect.width, height: equirect.height },
    fotos: captura.orientacoes.length,
    vfovDeg: captura.vfovDeg,
    faixaCoberta: faixa,
    fracaoEsferaCoberta: coberta,
    buracoPorFace,
    fotometria: {
      maiorSaltoStops: fotometria.maiorSaltoStops,
      amplitudeAnelStops: fotometria.amplitudeAnelStops,
      maiorDesvioWB: fotometria.maiorDesvioWB,
    },
    geracoes: [],
    escolhidas: {},
  };

  /* --- C: rota tonal, que não precisa de API ------------------------------ */

  await escrever(
    path.join(destino, 'luz', 'tonal-nz.png'),
    await rasterParaPng(await tratamentoTonal(faces.nz)),
  );

  if (!gerar) return medicao;

  /* --- A: geração mascarada nos polos ------------------------------------ */

  const referencias = LATERAL_FACES.map((f) => faces[f]);

  // O modelo recebe o buraco AUMENTADO em `PENA` pixels. Ele repinta essa faixa,
  // que é fotografia, e a recomposição mistura os dois ao longo dela em vez de
  // cortar seco — é o que ataca o anel visível na junção.
  const paraModelo = {} as Record<FaceName, Raster>;
  for (const face of POLE_FACES) {
    paraModelo[face] = erodirCobertura(coberturas[face], PENA);
  }

  // Guarda toda geração por face para escolher a melhor no fim, em vez de
  // apostar numa seed. `borda` é calculável sem ninguém olhar, então a escolha
  // sai de graça.
  const melhores: Partial<Record<FaceName, { raster: Raster; borda: number; de: string }>> = {};

  for (const provider of providers) {
    for (let seed = 0; seed < seeds; seed++) {
      const geradas: Partial<Record<FaceName, Raster>> = {};

      for (const face of POLE_FACES) {
        const rotulo = `${provider.nome}-seed${seed}-${face}`;
        try {
          const resultado = await provider.editar({
            face: faces[face],
            cobertura: paraModelo[face],
            coberturaFiel: coberturas[face],
            pena: PENA,
            referencias,
            prompt: promptDePolo(face),
            seed,
          });

          geradas[face] = resultado.face;
          await salvarGeracao(destino, rotulo, resultado);

          const descontinuidade = descontinuidadeNaBorda(resultado.face, coberturas[face]);
          if (!melhores[face] || descontinuidade < melhores[face]!.borda) {
            melhores[face] = { raster: resultado.face, borda: descontinuidade, de: rotulo };
          }
          medicao.geracoes.push({
            experimento: 'A-nadir-zenite',
            face,
            modelo: provider.modelo,
            seed,
            derivaForaDaMascara: resultado.derivaForaDaMascara,
            descontinuidadeNaBorda: descontinuidade,
            ms: resultado.ms,
            custoUSD: resultado.custoUSD,
          });

          console.log(
            `  ${rotulo}: deriva ${resultado.derivaForaDaMascara.toFixed(1)} · ` +
              `borda ${descontinuidade.toFixed(1)} · ${(resultado.ms / 1000).toFixed(1)}s`,
          );
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : String(erro);
          console.log(`  ${rotulo}: FALHOU — ${mensagem}`);
          medicao.geracoes.push({
            experimento: 'A-nadir-zenite',
            face,
            modelo: provider.modelo,
            seed,
            derivaForaDaMascara: 0,
            descontinuidadeNaBorda: 0,
            ms: 0,
            custoUSD: 0,
            erro: mensagem,
          });
        }
      }

      if (Object.keys(geradas).length > 0) {
        // A prova final: só py/ny voltam reamostradas; as laterais são cópia do
        // equirect de entrada, byte a byte.
        const remontado = composeEquirect(equirect, geradas, POLE_FACES);
        await escrever(
          path.join(destino, 'equirect', `${provider.nome}-seed${seed}.jpg`),
          await rasterParaJpeg(remontado),
        );
      }
    }
  }

  // O entregável: cada polo com a melhor geração de todas as tentativas, que
  // não precisa vir do mesmo modelo nem da mesma seed.
  const escolhidas: Partial<Record<FaceName, Raster>> = {};
  for (const face of POLE_FACES) {
    const melhor = melhores[face];
    if (!melhor) continue;
    escolhidas[face] = melhor.raster;
    medicao.escolhidas[face] = { de: melhor.de, borda: melhor.borda };
    console.log(`  melhor ${face}: ${melhor.de} (borda ${melhor.borda.toFixed(1)})`);
  }

  if (Object.keys(escolhidas).length > 0) {
    await escrever(
      path.join(destino, 'equirect', 'MELHOR.jpg'),
      await rasterParaJpeg(composeEquirect(equirect, escolhidas, POLE_FACES)),
    );
  }

  /* --- B: remendo pontual sobre quebra de costura ------------------------- */

  const remendos = lerRemendos(destino, lado);
  if (remendos.length === 0) {
    console.log(
      `  B: sem remendos.json em ${path.join(destino, 'remendos.json')} — experimento pulado.`,
    );
  }

  for (const { remendo, cobertura } of remendos) {
    for (const provider of providers) {
      const rotulo = `${provider.nome}-remendo-${remendo.face}`;
      try {
        const resultado = await provider.editar({
          face: faces[remendo.face],
          cobertura,
          prompt: promptDeRemendo(),
        });

        await salvarGeracao(destino, rotulo, resultado);
        const descontinuidade = descontinuidadeNaBorda(resultado.face, cobertura);

        medicao.geracoes.push({
          experimento: 'B-remendo',
          face: remendo.face,
          modelo: provider.modelo,
          seed: 0,
          derivaForaDaMascara: resultado.derivaForaDaMascara,
          descontinuidadeNaBorda: descontinuidade,
          ms: resultado.ms,
          custoUSD: resultado.custoUSD,
        });

        console.log(
          `  ${rotulo}: deriva ${resultado.derivaForaDaMascara.toFixed(1)} · ` +
            `borda ${descontinuidade.toFixed(1)}`,
        );
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        console.log(`  ${rotulo}: FALHOU — ${mensagem}`);
      }
    }
  }

  /* --- C: rota generativa ------------------------------------------------ */

  for (const provider of providers) {
    const rotulo = `${provider.nome}-luz`;
    try {
      // Sem máscara: iluminação é edição global por natureza. Justamente por
      // isso é a rota mais arriscada, e o contact sheet existe para julgá-la.
      const semMascara = mascaraCheia(faces.nz.width, 0);
      const resultado = await provider.editar({
        face: faces.nz,
        cobertura: semMascara,
        prompt: promptDeIluminacao(),
      });

      await escrever(path.join(destino, 'luz', `${rotulo}.png`), await rasterParaPng(resultado.cru));

      // `derivaForaDaMascara` não serve aqui: com a face inteira marcada como
      // editável não sobra pixel "fora da máscara" para comparar, e ela daria
      // sempre zero. Numa edição global o que importa é a imagem toda.
      const mudanca = diferencaMedia(faces.nz, resultado.cru);

      medicao.geracoes.push({
        experimento: 'C-iluminacao',
        face: 'nz',
        modelo: provider.modelo,
        seed: 0,
        derivaForaDaMascara: mudanca,
        descontinuidadeNaBorda: 0,
        ms: resultado.ms,
        custoUSD: resultado.custoUSD,
      });
      console.log(`  ${rotulo}: mudou ${mudanca.toFixed(1)} níveis em média`);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.log(`  ${rotulo}: FALHOU — ${mensagem}`);
    }
  }

  return medicao;
}

/* -------------------------------------------------------------------------- */
/* Peças                                                                       */
/* -------------------------------------------------------------------------- */

async function medirExposicao(captura: Captura): Promise<RelatorioFotometrico> {
  // Os frames entram reduzidos: a medida é uma média sobre milhares de direções
  // e não ganha nada com 1536×2048, mas decodificar 12 deles em tamanho cheio
  // custaria mais que todo o resto do script.
  const frames: Raster[] = [];
  for (const o of captura.orientacoes) {
    const { data, info } = await sharp(path.join(captura.fotosDir, o.arquivo))
      .resize({ width: 384 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    frames.push({ data: new Uint8ClampedArray(data), width: info.width, height: info.height });
  }

  return medirFotometria(frames, captura.orientacoes, {
    vfovDeg: captura.vfovDeg,
    frameAspect: captura.frameAspect,
  });
}

/**
 * Rota tonal do experimento C: o que dá para fazer sem modelo generativo
 * nenhum. Levanta sombra e normaliza o branco sem tocar em um pixel de
 * geometria — nenhum móvel pode se mover aqui, por construção.
 */
async function tratamentoTonal(face: Raster): Promise<Raster> {
  const png = await rasterParaPng(face);
  const { data, info } = await sharp(png)
    .normalise({ lower: 1, upper: 99 })
    .gamma(1.12)
    .modulate({ saturation: 1.04 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

async function salvarGeracao(destino: string, rotulo: string, r: ResultadoEdicao): Promise<void> {
  await escrever(path.join(destino, 'saidas', `${rotulo}.png`), await rasterParaPng(r.face));
  // O cru fica junto: sem ele não dá para auditar o que o modelo tentou fazer
  // fora da máscara, que é metade do que este bake-off quer descobrir.
  await escrever(path.join(destino, 'saidas', `${rotulo}-cru.png`), await rasterParaPng(r.cru));
}

/**
 * Lê os remendos do experimento B e converte cada um numa máscara de cobertura
 * da face inteira: tudo é fotografia, menos o retângulo apontado à mão. A mesma
 * recomposição do experimento A vale aqui, então o modelo não tem como
 * reescrever o cômodo em volta do remendo.
 */
function lerRemendos(destino: string, lado: number): Array<{ remendo: Remendo; cobertura: Raster }> {
  const arquivo = path.join(destino, 'remendos.json');
  if (!fs.existsSync(arquivo)) return [];

  const cru: unknown = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (!Array.isArray(cru)) throw new Error(`${arquivo}: esperava um array de remendos.`);

  return cru.map((item, i) => {
    const r = item as Partial<Remendo>;
    const numeros = [r.x, r.y, r.w, r.h];

    if (!r.face || !FACE_NAMES.includes(r.face)) {
      throw new Error(`${arquivo}: remendo ${i} sem face válida (${FACE_NAMES.join(', ')}).`);
    }
    if (numeros.some((n) => typeof n !== 'number' || n < 0 || n > 1)) {
      throw new Error(`${arquivo}: remendo ${i} com x/y/w/h fora de 0..1.`);
    }

    const cobertura = mascaraCheia(lado, 255);
    const x0 = Math.round(r.x * lado);
    const y0 = Math.round(r.y * lado);
    const x1 = Math.min(lado, Math.round((r.x + r.w) * lado));
    const y1 = Math.min(lado, Math.round((r.y + r.h) * lado));

    if (x1 <= x0 || y1 <= y0) throw new Error(`${arquivo}: remendo ${i} não cobre nenhum pixel.`);

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const j = (y * lado + x) * 4;
        cobertura.data[j] = cobertura.data[j + 1] = cobertura.data[j + 2] = 0;
      }
    }

    return { remendo: r as Remendo, cobertura };
  });
}

function mascaraCheia(lado: number, valor: number): Raster {
  const data = new Uint8ClampedArray(lado * lado * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = valor;
    data[i + 3] = 255;
  }
  return { data, width: lado, height: lado };
}

/* -------------------------------------------------------------------------- */
/* Catálogo                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * O campo vertical ajustado por captura já está no INDICE.md que o
 * `exportar-capturas` escreve. Ler de lá em vez de manter uma tabela aqui
 * evita que os dois se contradigam quando uma captura nova for exportada.
 */
function lerCatalogo(): Map<string, number> {
  const arquivo = path.join(RAIZ, 'INDICE.md');
  const catalogo = new Map<string, number>();

  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const colunas = linha.split('|').map((c) => c.trim());
    if (colunas.length < 7) continue;

    const pasta = colunas[1].replace(/`/g, '');
    const vfov = Number(colunas[5]);
    if (pasta && Number.isFinite(vfov)) catalogo.set(pasta, vfov);
  }

  if (catalogo.size === 0) throw new Error(`${arquivo}: nenhuma captura com campo vertical.`);
  return catalogo;
}

async function montarCaptura(pasta: string, catalogo: Map<string, number>): Promise<Captura> {
  const fotosDir = path.join(RAIZ, 'fotos-originais', pasta);
  const panorama = path.join(RAIZ, 'panoramas', `${pasta}.jpg`);

  if (!fs.existsSync(fotosDir)) {
    throw new Error(`${pasta}: sem fotos originais exportadas. Rode \`yarn exportar-capturas\`.`);
  }
  if (!fs.existsSync(panorama)) throw new Error(`${pasta}: panorama não exportado.`);

  const vfovDeg = catalogo.get(pasta);
  if (vfovDeg === undefined) {
    throw new Error(`${pasta}: sem campo vertical no INDICE.md — a máscara sairia errada.`);
  }

  // O aspecto vem do frame, não de uma constante: uma captura antiga em outra
  // proporção geraria uma máscara silenciosamente errada.
  const orientacoes = lerOrientacoes(fotosDir);
  const meta = await sharp(path.join(fotosDir, orientacoes[0].arquivo)).metadata();
  if (!meta.width || !meta.height) throw new Error(`${pasta}: frame sem dimensões legíveis.`);

  return {
    pasta,
    vfovDeg,
    frameAspect: meta.width / meta.height,
    orientacoes,
    panorama,
    fotosDir,
  };
}

/* -------------------------------------------------------------------------- */
/* Relatório                                                                   */
/* -------------------------------------------------------------------------- */

function montarRelatorio(medicoes: MedicaoCaptura[], gerou: boolean): string {
  const linhas: string[] = [
    '# Bake-off de IA — resultados',
    '',
    `Gerado por \`yarn bakeoff-ia\`${gerou ? ' --gerar' : ' (modo medição, sem API)'}.`,
    '',
    '## D — o buraco de cobertura e a fotometria',
    '',
    'Nenhuma IA envolvida. `buraco` é a fração da face que nunca foi fotografada —',
    'é o defeito que só geração resolve, porque ali não existe pixel para corrigir.',
    '',
    'As três colunas de exposição são medidas nos frames **crus**, nas direções em que',
    'dois vizinhos se enxergam: é a oscilação da medição automática da câmera, ANTES do',
    'ganho por canal que o stitcher aplica. Ou seja, são o teto do problema, não o',
    'resíduo que sobra no panorama montado. `maior salto` é o pior par de vizinhos;',
    '`amplitude` é o acumulado ao longo da volta, que é o que vira "um lado claro e o',
    'outro escuro"; `pior WB` é dominante de cor depois de descontada a exposição.',
    '',
    '| captura | panorama | fotos | faixa | esfera coberta | buraco nadir | buraco zênite | maior salto | amplitude | pior WB |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];

  for (const m of medicoes) {
    linhas.push(
      `| \`${m.pasta}\` | ${m.panorama.width}×${m.panorama.height} | ${m.fotos} | ` +
        `${m.faixaCoberta.pitchMinDeg.toFixed(1)}…${m.faixaCoberta.pitchMaxDeg.toFixed(1)}° | ` +
        `${(m.fracaoEsferaCoberta * 100).toFixed(1)}% | ` +
        `${(m.buracoPorFace.ny * 100).toFixed(1)}% | ${(m.buracoPorFace.py * 100).toFixed(1)}% | ` +
        `${m.fotometria.maiorSaltoStops.toFixed(2)} | ${m.fotometria.amplitudeAnelStops.toFixed(2)} | ` +
        `${(m.fotometria.maiorDesvioWB * 100).toFixed(1)}% |`,
    );
  }

  const geracoes = medicoes.flatMap((m) => m.geracoes);

  if (geracoes.length === 0) {
    linhas.push(
      '',
      '## A e C — não executados',
      '',
      'Rode `yarn bakeoff-ia --gerar` com `GEMINI_API_KEY` e/ou `OPENAI_API_KEY` definidas.',
      '',
    );
    return linhas.join('\n');
  }

  linhas.push(
    '',
    '## A — nadir e zênite, geração mascarada',
    '',
    '`deriva` é o quanto o modelo mexeu no que era fotografia — a recomposição descarta',
    'isso, então o número mede obediência à máscara, não risco. `borda` é o salto de cor',
    'na junção entre fotografia e geração: é o que aparece como anel no tour.',
    '',
    '| captura | modelo | face | seed | deriva | borda | tempo | custo |',
    '|---|---|---|---|---|---|---|---|',
  );

  for (const m of medicoes) {
    for (const g of m.geracoes.filter((x) => x.experimento === 'A-nadir-zenite')) {
      linhas.push(
        g.erro
          ? `| \`${m.pasta}\` | ${g.modelo} | ${g.face} | ${g.seed} | — | — | — | falhou: ${g.erro} |`
          : `| \`${m.pasta}\` | ${g.modelo} | ${g.face} | ${g.seed} | ` +
            `${g.derivaForaDaMascara.toFixed(1)} | ${g.descontinuidadeNaBorda.toFixed(1)} | ` +
            `${(g.ms / 1000).toFixed(1)}s | US$ ${g.custoUSD.toFixed(3)} |`,
      );
    }
  }

  const remendos = geracoes.filter((g) => g.experimento === 'B-remendo');
  if (remendos.length > 0) {
    linhas.push(
      '',
      '## B — remendo de costura',
      '',
      'Atenção ao ler: a causa raiz da quebra é de captura e de alinhamento, não de prompt.',
      'O que se mede aqui é só quanto o inpaint recupera do que sobra depois do stitcher.',
      '',
      '| captura | modelo | face | deriva | borda | tempo |',
      '|---|---|---|---|---|---|',
    );

    for (const m of medicoes) {
      for (const g of m.geracoes.filter((x) => x.experimento === 'B-remendo')) {
        linhas.push(
          `| \`${m.pasta}\` | ${g.modelo} | ${g.face} | ${g.derivaForaDaMascara.toFixed(1)} | ` +
            `${g.descontinuidadeNaBorda.toFixed(1)} | ${(g.ms / 1000).toFixed(1)}s |`,
        );
      }
    }
  }

  const custo = geracoes.reduce((s, g) => s + g.custoUSD, 0);
  linhas.push('', `Custo total desta execução: **US$ ${custo.toFixed(2)}**.`, '');

  linhas.push(
    '## Como julgar',
    '',
    'Os números acima não decidem sozinhos. Abra cada `equirect/<modelo>-seed<n>.jpg` no',
    'visualizador e **olhe para baixo** — é onde o defeito vive e onde o contact sheet plano',
    'engana. Reprove qualquer saída que tenha inventado móvel, mudado acabamento ou deixado',
    'a junção visível, por melhor que seja a métrica.',
    '',
  );

  return linhas.join('\n');
}

/* -------------------------------------------------------------------------- */

function valorDe(args: string[], nome: string): string | undefined {
  const achado = args.find((a) => a.startsWith(`${nome}=`));
  return achado?.slice(nome.length + 1);
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
