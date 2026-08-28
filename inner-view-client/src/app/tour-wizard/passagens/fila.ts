import { WizardHotspot, WizardScene } from '../tour-wizard.model';

/**
 * As passagens do tour, como aritmética.
 *
 * Sem DOM, sem Angular, sem store: a regra de "quais passagens existem, em que
 * ordem, e quais já estão feitas" é o miolo desta entrega, e testá-la não deve
 * exigir montar componente.
 *
 * A conexão é RECÍPROCA e simétrica: ligar Sala a Cozinha escreve nos dois.
 * Sem isso o resumo "conecta com Cozinha" mentiria para um dos lados, e o
 * corretor produziria tours de mão única achando que são de mão dupla.
 *
 * Não existe campo "pendente/concluído": `A→B` está feita se e somente se
 * existe hotspot em `A` com aquele destino. Um booleano paralelo seria a
 * segunda versão da mesma verdade — o erro que `scene-graph.ts` documenta ter
 * custado caro neste projeto.
 */

/** Uma passagem a posicionar: de onde, para onde, e se já foi feita. */
export interface Passagem {
  readonly origem: WizardScene;
  readonly destino: WizardScene;
  /** Derivado do hotspot, nunca guardado. */
  readonly feita: boolean;
}

/** Nome de exibição de um ambiente. Mesmo fallback do publicar. */
export function nomeDoAmbiente(cena: WizardScene): string {
  return cena.room.trim() || cena.fileName;
}

/** As cenas que valem: só as prontas, na ordem do array. */
function prontas(cenas: readonly WizardScene[]): WizardScene[] {
  return cenas.filter((s) => s.state === 'ready');
}

/**
 * Liga dois ambientes, nos dois sentidos.
 *
 * Idempotente porque o card da Cozinha oferece a Sala mesmo quando a ligação
 * nasceu do lado da Sala — e tocar ali não pode duplicar. O índice do array é a
 * ordem de seleção, então acrescentar no fim é o que preserva a sequência.
 */
export function ligar(
  cenas: readonly WizardScene[],
  aId: string,
  bId: string,
): WizardScene[] {
  if (aId === bId) return [...cenas];
  const existe = (id: string) => cenas.some((s) => s.id === id);
  if (!existe(aId) || !existe(bId)) return [...cenas];

  const comOutro = (cena: WizardScene, outroId: string): WizardScene => {
    const atuais = cena.connections ?? [];
    if (atuais.includes(outroId)) return cena;
    return { ...cena, connections: [...atuais, outroId] };
  };

  return cenas.map((s) => {
    if (s.id === aId) return comOutro(s, bId);
    if (s.id === bId) return comOutro(s, aId);
    return s;
  });
}

/**
 * Desliga dois ambientes, nos dois sentidos, e apaga os pontos das duas
 * passagens.
 *
 * Devolve os pontos perdidos para quem chama poder PERGUNTAR antes: apagar
 * trabalho posicionado sem aviso é o defeito que a spec manda evitar.
 */
export function desligar(
  cenas: readonly WizardScene[],
  aId: string,
  bId: string,
): { cenas: WizardScene[]; perdidos: WizardHotspot[] } {
  const perdidos: WizardHotspot[] = [];

  const semOutro = (cena: WizardScene, outroId: string): WizardScene => {
    for (const h of cena.hotspots) {
      if (h.target === outroId) perdidos.push(h);
    }
    return {
      ...cena,
      connections: (cena.connections ?? []).filter((id) => id !== outroId),
      hotspots: cena.hotspots.filter((h) => h.target !== outroId),
    };
  };

  const novas = cenas.map((s) => {
    if (s.id === aId) return semOutro(s, bId);
    if (s.id === bId) return semOutro(s, aId);
    return s;
  });

  return { cenas: novas, perdidos };
}

/**
 * A fila inteira, na ordem de trabalho.
 *
 * Agrupada por ambiente na ordem dos cards, e dentro de cada ambiente na ordem
 * em que as conexões foram escolhidas. É isso que faz o corretor permanecer na
 * mesma foto até acabarem os destinos daquele ambiente.
 *
 * Conexão apontando para ambiente que sumiu é descartada: não há foto de
 * destino, e o painel não teria nome para mostrar.
 */
export function filaDePassagens(cenas: readonly WizardScene[]): Passagem[] {
  const validas = prontas(cenas);
  const porId = new Map(validas.map((s) => [s.id, s]));
  const fila: Passagem[] = [];

  for (const origem of validas) {
    for (const destinoId of origem.connections ?? []) {
      const destino = porId.get(destinoId);
      if (!destino) continue;
      fila.push({
        origem,
        destino,
        feita: origem.hotspots.some((h) => h.target === destinoId),
      });
    }
  }

  return fila;
}

/** O índice da primeira passagem sem ponto, ou `-1` se acabaram. */
export function primeiraPendente(fila: readonly Passagem[]): number {
  return fila.findIndex((p) => !p.feita);
}

/**
 * As outras passagens pendentes do MESMO ambiente do passo atual.
 *
 * É a lista da gaveta: o que ainda falta nesta foto, sem contar a que está
 * sendo posicionada agora.
 */
export function pendentesDoAmbiente(
  fila: readonly Passagem[],
  i: number,
): Passagem[] {
  const atual = fila[i];
  if (!atual) return [];

  return fila.filter(
    (p, j) => j !== i && !p.feita && p.origem.id === atual.origem.id,
  );
}

/** Nomes dos ambientes ligados a este, na ordem de seleção. */
export function resumoDeConexoes(
  cena: WizardScene,
  cenas: readonly WizardScene[],
): string[] {
  const porId = new Map(cenas.map((s) => [s.id, s]));
  return (cena.connections ?? [])
    .map((id) => porId.get(id))
    .filter((s): s is WizardScene => !!s)
    .map(nomeDoAmbiente);
}
