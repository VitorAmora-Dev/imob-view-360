import { setFlagsFromString } from 'v8';
import { runInNewContext } from 'vm';

/**
 * Devolve ao sistema a memória que um trabalho pesado deixou para trás.
 *
 * Em 10/09/2026 a instância de produção morreu na SEGUNDA montagem de um tour,
 * com as duas correções de pico já no ar. As métricas do Render mostram por quê:
 *
 * ```
 * 18:02  158 MB   processo novo
 * 18:09  271 MB   o corretor abre um tour de 9 cômodos
 * 18:29  368 MB   primeira montagem termina
 * 18:40  411 MB   segunda montagem começa — e o limite de 512 MB estoura
 * ```
 *
 * Repare que nada volta. Entre 18:10 e 18:28 o processo ficou 19 minutos ocioso
 * marcando exatamente os mesmos 271.585.280 bytes, sem variar um único byte.
 *
 * Duas hipóteses foram medidas e as duas caíram:
 *
 * - **Não é vazamento.** Depois de um `gc()` forçado, `external` e
 *   `arrayBuffers` voltam ao valor de partida com precisão de décimo de MB, em
 *   todas as voltas de uma bancada que repete visita e montagem. Nenhuma
 *   referência segura nada.
 * - **Não é o teto do heap.** Rodar a mesma bancada com
 *   `--max-old-space-size=192` deixou a memória externa idêntica: 301,0 MB nos
 *   dois casos. Trocar o teto do heap não move este ponteiro.
 *
 * O que sobra é o mecanismo real: imagem em Node vive em `Buffer`, e `Buffer`
 * mora na memória EXTERNA, que não conta para o teto do heap. O V8 não sente
 * pressão nenhuma, e entre uma montagem e a próxima o processo fica ocioso — não
 * há alocação que provoque uma coleta. O lixo de cada operação continua
 * residente, e as operações passam a SOMAR em vez de se sobrepor.
 *
 * Coletar no fim do trabalho transforma essa soma num máximo. Custa uma pausa de
 * fração de segundo depois de uma montagem de ~55 s.
 *
 * ## O que faltava nesta explicação
 *
 * A primeira versão dela parava aqui, e a correção sozinha não segurou a
 * produção: `443→381` e `497→400 MB` no log, e a instância morreu no terceiro
 * cômodo mesmo tendo devolvido 62 e 97 MB.
 *
 * A bancada que fundamentou o texto acima rodou no Windows. Repetida no Linux,
 * que é onde o servidor roda, ela mostra o resto da história: `external` e
 * `arrayBuffers` voltam ao valor de partida — o coletor faz o serviço — e ainda
 * assim `rss` sobe a cada montagem. Quem segura não é o V8, é o alocador do
 * glibc.
 *
 * O glibc sobe sozinho o limiar a partir do qual usa `mmap`, conforme vê blocos
 * grandes sendo liberados. Passado esse limiar, os rasters de 29,5 MB deixam de
 * vir de `mmap` e passam a sair da arena, que só encolhe pelo topo — liberar
 * deixa de devolver página nenhuma ao sistema. Fixar o limiar
 * (`MALLOC_MMAP_THRESHOLD_`) mantém os buffers grandes no `mmap`, onde liberar
 * devolve na hora. Ver `alocadorSemAjuste` no fim deste arquivo.
 *
 * As duas coisas são necessárias, e são medidas. Três montagens seguidas no
 * Linux, num container de 512 MB:
 *
 * ```
 * coleta  limiar fixo    pico    ao fim
 *   não       não       400 MB   400 MB
 *   sim       não       402 MB   339 MB
 *   não       sim       209 MB   209 MB
 *   sim       sim       208 MB   151 MB
 * ```
 *
 * A coleta é o que torna os blocos liberáveis; o limiar é o que faz liberar
 * devolver ao sistema. Uma sem a outra não chega a um estado que aguente cômodo
 * atrás de cômodo.
 */

/**
 * `undefined` = ainda não tentamos; `null` = o runtime recusou.
 *
 * O coletor é pedido em tempo de execução em vez de `--expose-gc` no comando de
 * start porque o start vive no painel do Render, fora deste repositório: uma
 * correção que depende de alguém lembrar de editar um campo lá não é uma
 * correção. `runInNewContext` pega a função sem publicar `gc` no global daqui.
 */
let coletor: (() => void) | null | undefined;

function obterColetor(): (() => void) | null {
  if (coletor !== undefined) return coletor;

  const jaExposto = (globalThis as { gc?: () => void }).gc;
  if (jaExposto) {
    coletor = jaExposto;
    return coletor;
  }

  try {
    setFlagsFromString('--expose-gc');
    coletor = runInNewContext('gc') as () => void;
  } catch {
    // Sem coletor o processo continua funcionando exatamente como antes desta
    // correção. É degradação, não falha: nada aqui é obrigatório para montar.
    coletor = null;
  } finally {
    setFlagsFromString('--no-expose-gc');
  }

  return coletor;
}

export interface Devolucao {
  /** Bytes residentes antes da coleta. */
  antes: number;
  /** Bytes residentes depois. Igual a `antes` quando não houve coletor. */
  depois: number;
}

/**
 * Duas passadas, e não uma. Medido com 160 MB de `Buffer` inalcançável:
 *
 * ```
 * 1 coleta → 144,0 MB ainda residentes
 * 2 coletas →   0,0 MB
 * 3 coletas →   0,0 MB
 * ```
 *
 * A primeira passada recolhe os objetos que apontavam para os buffers; a área de
 * bytes em si só é liberada na passada seguinte, quando nada mais a referencia.
 * Uma chamada só devolveria 10% e a correção pareceria escrita — que é o pior
 * dos dois defeitos.
 */
const PASSADAS = 2;

export function devolverMemoria(): Devolucao {
  const antes = process.memoryUsage.rss();

  const coletar = obterColetor();
  for (let i = 0; coletar && i < PASSADAS; i++) coletar();

  return { antes, depois: process.memoryUsage.rss() };
}

/** `368→180 MB`, pronto para entrar numa linha de log. */
export function emMB({ antes, depois }: Devolucao): string {
  const mb = (n: number) => Math.round(n / 1024 / 1024);
  return `${mb(antes)}→${mb(depois)} MB`;
}

/**
 * O tamanho a partir do qual o glibc passa a usar `mmap`, em bytes.
 *
 * 1 MB deixa os buffers de imagem — que são de megabytes — no `mmap`, onde
 * liberar devolve a página ao sistema na hora, e deixa as alocações comuns
 * (string do Prisma, JSON, tralha do Nest) no caminho rápido da arena. Medido
 * contra 128 kB: mesma memória, e um pouco menos de tempo.
 */
export const LIMIAR_DE_MMAP = 1048576;

/**
 * A mensagem de aviso quando o processo sobe sem o limiar fixado, ou `null`
 * quando não há o que avisar.
 *
 * Existe porque esta é a única peça da correção que NÃO mora neste repositório:
 * o glibc lê a variável na partida do processo, antes de qualquer linha de
 * TypeScript rodar, então não há como fixá-la de dentro. Numa instância nova,
 * num host novo ou depois de alguém limpar as variáveis do painel, o sintoma
 * seria a instância morrendo no terceiro cômodo de novo, três semanas depois,
 * sem nada no código para explicar. Uma linha no boot é o que impede isso de
 * virar conhecimento perdido.
 *
 * Plataforma e ambiente entram por parâmetro para o teste não precisar mexer em
 * `process`.
 */
export function alocadorSemAjuste(
  plataforma: string = process.platform,
  ambiente: NodeJS.ProcessEnv = process.env,
): string | null {
  // O limiar dinâmico é do glibc. Em macOS e Windows o alocador é outro, e a
  // bancada do Windows mostra a memória voltando sem ajuste nenhum.
  if (plataforma !== 'linux') return null;
  if (ambiente['MALLOC_MMAP_THRESHOLD_']) return null;

  return (
    `MALLOC_MMAP_THRESHOLD_ não está definida. Sem ela o alocador do glibc ` +
    `retém a memória das montagens: medido, o pico dobra (209 para 400 MB) e ` +
    `não volta. Defina MALLOC_MMAP_THRESHOLD_=${LIMIAR_DE_MMAP} no ambiente ` +
    `do serviço. Ver src/shared/memoria.ts.`
  );
}
