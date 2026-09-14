/**
 * Quanto de campo de visão cabe sem alcançar o que a câmera nunca fotografou.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *
 * A câmera do viewer nasceu com `fov = 75`, e em three.js esse número é o campo
 * VERTICAL. Manter o vertical fixo faz o horizontal — e, pior, a DIAGONAL —
 * crescer junto com a proporção da tela.
 *
 * Num celular em pé (390×844, proporção 0,46) a diagonal do frustum alcança
 * 40° do centro. Deitando a tela (844×390, proporção 2,16) a MESMA câmera passa
 * a alcançar 61°, porque a proporção multiplicou por quase cinco.
 *
 * Sessenta e um graus é onde mora o defeito. A captura guiada cobre uma faixa
 * em torno do equador e deixa de fora, por construção, as duas calotas polares:
 * são os ~27% da esfera que a câmera nunca aponta (ver `Panorama.treatedImageData`
 * em `schema.prisma`). Vinte e sete por cento de uma esfera são duas calotas
 * acima de ±60° — `2·(1 − sen φ) = 0,27` dá `φ = 59,9°`.
 *
 * Então, deitando o celular, os quatro CANTOS da tela cruzam a fronteira e
 * passam a mostrar teto e chão que ninguém fotografou: borrão da costura, ou o
 * preenchimento "deliberadamente plausível" da IA. Escuro, porque teto e chão
 * são mais escuros que parede; e com cara de neblina, porque aquilo não é foto.
 *
 * A pessoa não pediu para olhar para cima. Ela só deitou o telefone.
 *
 * A REGRA
 *
 * Em vez de fixar o campo vertical, fixa-se o alcance da DIAGONAL — que é a
 * grandeza de que o defeito depende — e deduz-se o vertical dela. Em pé a regra
 * não morde (40° já está dentro), e deitado ela devolve os cantos para dentro
 * da faixa fotografada sem desfazer o ganho de largura: o horizontal ainda vai
 * de 39° para ~105°, que é o motivo de existir o botão de deitar.
 */

/**
 * Onde a faixa fotografada acaba, em graus de latitude.
 *
 * Deduzido dos 27% registrados no schema, não estimado: `2·(1 − sen φ) = 0,27`.
 * Número de PROJETO da captura guiada — o valor real de cada panorama fica em
 * `bandTopDeg`/`bandBottomDeg`, que o viewer não recebe. Quando receber, esta
 * constante vira o padrão e a faixa medida passa na frente.
 */
export const LATITUDE_DA_FAIXA_GRAUS = 59.9;

/**
 * Folga antes da fronteira.
 *
 * A borda não é uma linha: a costura vai perdendo fotografia e ganhando
 * invenção ao longo de alguns graus, e a faixa varia de captura para captura
 * conforme a altura em que a pessoa segurou o telefone. Encostar exatamente em
 * 59,9° entregaria o defeito de volta para metade das capturas.
 */
export const MARGEM_GRAUS = 5;

/** O alcance máximo que a diagonal do frustum pode ter, do centro da tela. */
export const CANTO_MAXIMO_GRAUS = LATITUDE_DA_FAIXA_GRAUS - MARGEM_GRAUS;

/** O campo vertical de sempre. É o teto: a regra só reduz, nunca aumenta. */
export const FOV_VERTICAL_PADRAO = 75;

const PARA_RAD = Math.PI / 180;
const PARA_GRAUS = 180 / Math.PI;

/**
 * Quantos graus do centro da tela até o CANTO, para um campo vertical e uma
 * proporção.
 *
 * É a medida que importa, e não o campo horizontal: o canto alcança mais longe
 * que qualquer um dos dois eixos, e é por ele que o borrão entra em cena.
 */
export function cantoDoFrustum(fovVerticalGraus: number, aspecto: number): number {
  const meiaAltura = Math.tan((fovVerticalGraus * PARA_RAD) / 2);
  return Math.atan(meiaAltura * Math.hypot(1, aspecto)) * PARA_GRAUS;
}

/**
 * O campo vertical que mantém os cantos dentro da faixa fotografada.
 *
 * Devolve `fovPadrao` quando ele já cabe — que é o caso de toda tela em pé, e
 * de tablet deitado. Só telas bem largas pagam a redução.
 *
 * Proporção inválida devolve o padrão em vez de `NaN`: um contêiner de altura
 * zero acontece de verdade, entre o Angular criar o elemento e o CSS aplicar a
 * altura, e um `camera.fov = NaN` apaga a tela inteira sem dizer por quê.
 */
export function fovQueCabeNaFaixa(
  aspecto: number,
  fovPadrao: number = FOV_VERTICAL_PADRAO,
  cantoMaximoGraus: number = CANTO_MAXIMO_GRAUS,
): number {
  if (!Number.isFinite(aspecto) || aspecto <= 0) return fovPadrao;

  const meiaAlturaMaxima =
    Math.tan(cantoMaximoGraus * PARA_RAD) / Math.hypot(1, aspecto);
  const fovMaximo = Math.atan(meiaAlturaMaxima) * PARA_GRAUS * 2;

  return Math.min(fovPadrao, fovMaximo);
}
