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
