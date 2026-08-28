import { WizardHotspot, WizardScene } from '../../tour-wizard.model';

/**
 * O roteiro do assistente guiado, como aritmética.
 *
 * Sem DOM, sem Angular, sem store: a regra de "qual o próximo ambiente e qual
 * ponto é a passagem para ele" é a única parte desta entrega sem plano B
 * barato, e testá-la não deve exigir montar componente.
 *
 * O percurso é um ciclo: o ambiente `i` leva ao `i+1`, e o último leva ao
 * primeiro. É isso que garante que o visitante alcança tudo e volta ao início —
 * um ciclo fechado nunca produz ambiente ilhado nem beco sem saída, então o
 * assistente sempre satisfaz o bloqueio da etapa 2 (`canAdvance`).
 */

/** Quantos tons de identidade de ambiente o tema oferece. Ver `corDoAmbiente`. */
export const TONS_DE_AMBIENTE = 6;

/** Um passo do roteiro: um ambiente, e a passagem que ele precisa ganhar. */
export interface GuidedStep {
  /** 0-based, posição dentro das cenas prontas. */
  readonly index: number;
  readonly total: number;
  readonly scene: WizardScene;
  /** O ambiente seguinte. No último passo, é o primeiro — o ciclo fecha. */
  readonly target: WizardScene;
  readonly isLast: boolean;
  /** A passagem deste passo, se já existir. Ver `passagemDoPasso`. */
  readonly hotspot: WizardHotspot | null;
}

/**
 * A passagem deste passo: o ponto da cena cujo destino é o ambiente alvo.
 *
 * É o mecanismo inteiro da adoção. Se o corretor já marcou esse ponto no editor
 * livre, o assistente o encontra aqui, abre o passo já concluído e nunca cria um
 * segundo. Os outros pontos do ambiente — que levam a outro lugar, ou a lugar
 * nenhum — não são desta passagem e ficam intocados.
 */
export function passagemDoPasso(
  cena: WizardScene,
  alvoId: string,
): WizardHotspot | null {
  return cena.hotspots.find((h) => h.target === alvoId) ?? null;
}

/**
 * O passo `i` sobre as cenas prontas, ou `null` quando não há roteiro.
 *
 * `null` com menos de dois ambientes não é defesa contra o impossível: é o
 * estado normal de quem subiu uma foto só, e a etapa 2 já é opcional aí. E
 * `null` para índice fora da faixa porque o índice vem de um `findIndex`, que
 * devolve -1 enquanto a cena selecionada não está entre as prontas.
 */
export function passoDoRoteiro(
  cenas: readonly WizardScene[],
  i: number,
): GuidedStep | null {
  const total = cenas.length;
  if (total < 2) return null;
  if (i < 0 || i >= total) return null;

  const scene = cenas[i];
  const target = cenas[(i + 1) % total];

  return {
    index: i,
    total,
    scene,
    target,
    isLast: i === total - 1,
    hotspot: passagemDoPasso(scene, target.id),
  };
}

/**
 * O primeiro ambiente sem passagem para o seguinte, ou `-1` se todos têm.
 *
 * Reabrir o assistente não recomeça do passo 1: quem já ligou metade não deve
 * ter de confirmar de novo o que já está feito.
 */
export function primeiroPassoIncompleto(cenas: readonly WizardScene[]): number {
  const total = cenas.length;
  if (total < 2) return -1;

  for (let i = 0; i < total; i++) {
    if (!passagemDoPasso(cenas[i], cenas[(i + 1) % total].id)) return i;
  }
  return -1;
}

/** Todo ambiente tem passagem para o seguinte — o percurso fechou. */
export function cicloFechado(cenas: readonly WizardScene[]): boolean {
  return cenas.length >= 2 && primeiroPassoIncompleto(cenas) === -1;
}

/** Estado de cada bolinha de progresso da gaveta. */
export type DotState = 'atual' | 'concluido' | 'pendente';

/**
 * Uma bolinha por ambiente.
 *
 * O atual ganha do concluído de propósito: a pílula responde "onde eu estou",
 * e essa pergunta não deixa de existir porque o passo já foi resolvido.
 */
export function estadoDosDots(
  cenas: readonly WizardScene[],
  atual: number,
): DotState[] {
  const total = cenas.length;
  if (total < 2) return [];

  return cenas.map((cena, i) => {
    if (i === atual) return 'atual';
    return passagemDoPasso(cena, cenas[(i + 1) % total].id)
      ? 'concluido'
      : 'pendente';
  });
}

/**
 * Cor de identidade do ambiente, ciclando entre os tons do tema.
 *
 * Devolve `var(--app-room-N)` e nunca um hex: a paleta é decidida num lugar só,
 * em `theme/variables.scss`, como manda o `.agents/AGENTS.md`. Com mais de seis
 * ambientes dois repetem a cor — o swatch é apoio para reconhecer o próximo de
 * relance, não identificador.
 */
export function corDoAmbiente(i: number): string {
  const tom = ((i % TONS_DE_AMBIENTE) + TONS_DE_AMBIENTE) % TONS_DE_AMBIENTE;
  return `var(--app-room-${tom + 1})`;
}
