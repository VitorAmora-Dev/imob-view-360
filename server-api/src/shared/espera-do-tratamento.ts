/**
 * A linha de log que diz quanto o corretor esperou pela montagem de um cômodo.
 *
 * Existe porque a única duração que o serviço registrava era a CHAMADA AO
 * MODELO — o `r.ms` da linha "montado com N fotos". Entre o corretor pedir e o
 * cômodo ficar pronto acontecem mais três coisas que aquele número não vê:
 *
 *   1. a espera na fila, quando `CONCORRENCIA` já está ocupada;
 *   2. o download das fotos de referência do banco;
 *   3. a gravação do resultado.
 *
 * A primeira é a que importa e a que faltava: ela é zero com um corretor
 * sozinho e cresce com dois capturando ao mesmo tempo, que é exatamente a
 * situação em que o produto parece lento e o log dizia que estava rápido.
 *
 * Puro e aqui em `shared` de propósito: assim a suíte que não precisa de banco
 * o alcança (`yarn test:scripts`), e o formato fica preso por teste em vez de
 * depender de alguém reler o log do servidor.
 */
export interface EsperaDoTratamento {
  panoramaId: string;
  /** Quando o cômodo entrou na fila — o instante em que o corretor pediu. */
  pedidoEm: number;
  /** Quando a fila o liberou. Igual a `pedidoEm` se não houve espera. */
  comecouEm: number;
  /** Quando terminou, em qualquer desfecho. */
  terminouEm: number;
  /** `DONE`, `FAILED`, `SKIPPED` — ou `ERRO` quando nem chegou a executar. */
  desfecho: string;
}

/** Segundos com uma casa. Milissegundo não muda decisão nenhuma aqui. */
function segundos(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Monta a linha.
 *
 * O total vem primeiro porque é o número que responde à pergunta do corretor.
 * A fila vem em seguida, separada, porque é a parcela que diz se o problema é
 * o modelo ou a concorrência do servidor — e as duas exigem remédios opostos.
 *
 * Relógio para trás não vira número negativo: `Date.now()` pode recuar num
 * ajuste de NTP, e uma espera de "-3,0s" no gráfico é pior que uma de zero.
 */
export function linhaDeEspera(e: EsperaDoTratamento): string {
  const total = Math.max(0, e.terminouEm - e.pedidoEm);
  const fila = Math.max(0, Math.min(e.comecouEm - e.pedidoEm, total));

  return `${e.panoramaId}: espera total ${segundos(total)} · fila ${segundos(fila)} · ${e.desfecho}`;
}
