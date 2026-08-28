import { WizardScene } from '../tour-wizard.model';

/**
 * As conexões atravessando a fronteira do servidor.
 *
 * Separado de `fila.ts` de propósito, e a divisa é a razão de mudar: `fila.ts`
 * responde "que trabalho falta" e muda quando a etapa de passagens muda; este
 * arquivo responde "como a escolha sobrevive a um fechar de app" e muda quando
 * o formato guardado muda. Juntos, uma mexida no wizard obrigaria a reler a
 * persistência, e vice-versa.
 *
 * Aqui moram os DOIS lados da tradução de identidade, que é o que torna a
 * travessia perigosa: dentro do wizard um ambiente é um uuid local, criado no
 * navegador e jogado fora ao sair; no servidor é o id do `Panorama`. Misturar
 * os dois grava uuid local no banco — que a retomada devolve como conexão para
 * um cômodo que nunca existiu.
 */

/**
 * Os ids de PANORAMA das conexões de uma cena, na ordem em que foram
 * escolhidas.
 *
 * Cômodo sem panorama no servidor sai da lista: ou ele foi apagado, ou o envio
 * ainda não terminou. Nos dois casos o id local não significa nada do lado de
 * lá. Não se perde nada por isso — `connections` continua inteiro em memória e
 * o salvamento seguinte manda a lista de novo, já com o id que faltava.
 */
export function conexoesParaServidor(
  cena: WizardScene,
  panoramaPorCena: ReadonlyMap<string, string | undefined>,
): string[] {
  const ids: string[] = [];
  for (const cenaId of cena.connections ?? []) {
    const panoramaId = panoramaPorCena.get(cenaId);
    if (panoramaId) ids.push(panoramaId);
  }
  return ids;
}

/**
 * Devolve as cenas com `connections` preenchido a partir do rascunho lido.
 *
 * São duas fontes, e a segunda existe porque a primeira pode faltar: o que o
 * servidor guardou em `draftConnections`, e o que os pontos já posicionados
 * provam. Um hotspot de A para B só existe porque alguém ligou A a B — e um
 * rascunho gravado antes desta coluna existir tem os pontos e não tem a
 * coluna. Sem a segunda fonte, esses rascunhos voltariam com a etapa de
 * passagens dizendo que não há nada a fazer, ao lado de pontos já marcados.
 *
 * A ordem importa: o índice do array é a ordem de trabalho da etapa de
 * passagens. Por isso a lista guardada de cada ambiente entra primeiro e
 * inteira, e só depois entram as recíprocas que faltavam e as deduzidas dos
 * pontos.
 *
 * `guardadas` é indexado por id de PANORAMA — dos dois lados, chave e valores.
 * A tradução para id local acontece aqui dentro, contra o `serverPanoramaId`
 * das próprias cenas.
 */
export function conexoesRetomadas(
  cenas: readonly WizardScene[],
  guardadas: ReadonlyMap<string, readonly string[]>,
): WizardScene[] {
  const cenaPorPanorama = new Map<string, string>();
  for (const cena of cenas) {
    if (cena.serverPanoramaId) cenaPorPanorama.set(cena.serverPanoramaId, cena.id);
  }

  const existe = new Set(cenas.map((c) => c.id));
  const ligacoes = new Map<string, string[]>(cenas.map((c) => [c.id, []]));

  /** Escreve UM sentido. A recíproca é uma segunda passada, e não um efeito. */
  const ligar = (de: string, para: string): void => {
    if (de === para || !existe.has(de) || !existe.has(para)) return;
    const lista = ligacoes.get(de);
    if (lista && !lista.includes(para)) lista.push(para);
  };

  // Os pares em ordem de prioridade: primeiro o que cada ambiente guardou, na
  // sequência guardada; depois o que os pontos denunciam.
  const pares: Array<[string, string]> = [];
  for (const cena of cenas) {
    const panoramaId = cena.serverPanoramaId;
    if (!panoramaId) continue;
    for (const outroPanorama of guardadas.get(panoramaId) ?? []) {
      const outro = cenaPorPanorama.get(outroPanorama);
      if (outro) pares.push([cena.id, outro]);
    }
  }
  for (const cena of cenas) {
    for (const ponto of cena.hotspots) {
      if (ponto.target) pares.push([cena.id, ponto.target]);
    }
  }

  // Duas passadas, e não uma com escrita simétrica: escrevendo os dois lados de
  // uma vez, a lista da Cozinha receberia a Sala no momento em que a SALA foi
  // processada, e a ordem que a Cozinha guardou entraria depois de um item que
  // ela mesma não pôs ali primeiro. Todo mundo escreve o seu lado antes de
  // qualquer recíproca chegar.
  for (const [de, para] of pares) ligar(de, para);
  for (const [de, para] of pares) ligar(para, de);

  return cenas.map((cena) => ({ ...cena, connections: ligacoes.get(cena.id) ?? [] }));
}
