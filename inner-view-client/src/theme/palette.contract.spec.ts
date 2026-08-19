/**
 * Contrato da paleta.
 *
 * MOTIVO: antes deste arquivo, a suíte inteira passava verde com a paleta toda
 * errada. Nenhum spec olhava para cor, e um erro cromático só apareceria no
 * aparelho de alguém — que é o pior lugar para descobrir.
 *
 * O que ele trava são RELAÇÕES, nunca valores. Um teste que afirmasse
 * `--brand-primary === '#2563eb'` engessaria a cor sem proteger nada, e faria
 * a próxima troca de paleta ser uma caçada a expectativas quebradas. Os quatro
 * contratos abaixo continuam valendo qualquer que seja a paleta.
 *
 * Isto só é possível porque o `angular.json` carrega as três folhas de tema
 * também no target `test` — `global.scss`, `variables.scss`, `tour-wizard.scss`
 * — e o `_palette.scss` entra por `@use` dentro do `variables`.
 */

/**
 * Resolve um token para a cor que o browser realmente pinta.
 *
 * A técnica importa: NÃO lê a custom property (`getPropertyValue`), que
 * devolveria a string crua — `var(--brand-primary)`, ou um hex, ou um
 * `rgba(var(--x-rgb), .2)`, dependendo da camada. Em vez disso aplica o token a
 * uma propriedade de cor de verdade e lê o computed, que volta sempre
 * normalizado em `rgb()`/`rgba()`, com a cadeia de `var()` já percorrida até o
 * fim. É o que torna o teste indiferente à forma do token.
 *
 * E a propriedade é `background-color`, não `color`, por um motivo que só
 * apareceu ao injetar o defeito de propósito: uma cadeia quebrada
 * (`var(--nome-digitado-errado)`) deixa a declaração inválida no momento de
 * computar, e aí o browser aplica a regra de herança. `color` é HERDADO, então
 * o token quebrado voltava como o preto herdado do body — indistinguível de um
 * token preto legítimo, e o teste de integridade passava.
 * `background-color` não é herdado: quebrou, vira `transparent`, que é
 * inconfundível.
 */
function resolve(expressao: string): string {
  const alvo = document.createElement('div');
  alvo.style.backgroundColor = expressao;
  document.body.appendChild(alvo);
  const valor = getComputedStyle(alvo).backgroundColor;
  alvo.remove();
  return valor;
}

function token(nome: string): string {
  return resolve(`var(${nome})`);
}

function canais(cor: string): [number, number, number] {
  const m = cor.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`não é uma cor resolvida: "${cor}"`);
  const partes = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [partes[0], partes[1], partes[2]];
}

/** Luminância relativa da WCAG 2.x. */
function luminancia(cor: string): number {
  const [r, g, b] = canais(cor).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

describe('Contrato da paleta', () => {
  /**
   * 1. Os pares hex/rgb não divergiram.
   *
   * O maior retorno do conjunto. `--ion-color-primary-rgb` exige a tripla
   * literal — não aceita `var()` de um hex —, então é o ÚNICO ponto do sistema
   * onde a mesma verdade está escrita duas vezes. E não é um par decorativo:
   * `--tw-focus-ring` é montado com ele e tem dez consumidores, de modo que uma
   * divergência daria um app azul com anel de foco de outra cor.
   */
  describe('pares hex e rgb', () => {
    const pares: [string, string][] = [
      ['--brand-primary', '--brand-primary-rgb'],
      ['--brand-accent', '--brand-accent-rgb'],
      ['--brand-secondary', '--brand-secondary-rgb'],
      ['--brand-tertiary', '--brand-tertiary-rgb'],
      ['--neutral-ink', '--neutral-ink-rgb'],
      ['--neutral-white', '--neutral-white-rgb'],
      ['--tour-bg', '--tour-bg-rgb'],
      ['--status-success', '--status-success-rgb'],
      ['--status-warning', '--status-warning-rgb'],
      ['--status-error', '--status-error-rgb'],
      ['--ion-color-primary', '--ion-color-primary-rgb'],
      ['--ion-color-secondary', '--ion-color-secondary-rgb'],
      ['--ion-color-tertiary', '--ion-color-tertiary-rgb'],
      ['--ion-color-success', '--ion-color-success-rgb'],
      ['--ion-color-warning', '--ion-color-warning-rgb'],
      ['--ion-color-danger', '--ion-color-danger-rgb'],
      ['--ion-background-color', '--ion-background-color-rgb'],
      ['--ion-text-color', '--ion-text-color-rgb'],
    ];

    for (const [hex, rgb] of pares) {
      it(`${hex} e ${rgb} descrevem a mesma cor`, () => {
        expect(resolve(`rgb(var(${rgb}))`)).toBe(token(hex));
      });
    }
  });

  /**
   * 2. Contraste, por tabela declarada.
   *
   * É aqui que a regra mais fácil de errar da paleta vira executável: o teal
   * claro não aceita texto branco (2,49:1). Se alguém apontar
   * `--tw-accent` para o `#14b8a6` ou trocar um foreground por branco, o teste
   * cai dizendo o número.
   *
   * Pisos da WCAG: 4,5:1 para texto normal, 3:1 para elemento gráfico e para
   * texto grande. O par de preenchimento do Ionic (`-contrast` sobre a base) é
   * chip e badge — texto pequeno mas em negrito sobre cor cheia —, então entra
   * como gráfico. O mais apertado da tabela é o success, em 3,30:1.
   *
   * `--tw-focus-ring` fica FORA: tem alpha 0,2 e o que vale é o resultado
   * composto sobre o fundo real, que varia. Ele entra no roteiro visual.
   */
  describe('contraste', () => {
    const texto: [string, string, string][] = [
      ['texto forte sobre card', '--tw-text-strong', '--tw-surface'],
      ['texto de corpo sobre card', '--tw-text', '--tw-surface'],
      ['texto secundário sobre card', '--tw-text-muted', '--tw-surface'],
      ['texto secundário sobre superfície suave', '--tw-text-muted', '--tw-surface-muted'],
      ['aviso sobre o fundo de aviso', '--tw-warn-text', '--tw-warn-soft'],
      ['aviso sobre card', '--tw-warn-text', '--tw-surface'],
      ['erro sobre o fundo de erro', '--tw-error-text', '--tw-error-soft'],
      ['erro sobre card', '--tw-error-text', '--tw-surface'],
      ['accent sobre o fundo de accent', '--tw-accent', '--tw-accent-soft'],
      ['accent sobre card', '--tw-accent', '--tw-surface'],
      ['texto do visualizador sobre o fundo imersivo', '--tour-text', '--tour-bg'],
      ['sucesso sobre branco', '--status-success-text', '--neutral-white'],
    ];

    for (const [nome, fg, bg] of texto) {
      it(`${nome}: 4,5:1 ou mais`, () => {
        const razao = contraste(token(fg), token(bg));
        expect(razao)
          .withContext(`${fg} sobre ${bg} rendeu ${razao.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(4.5);
      });
    }

    const grafico: [string, string, string][] = [
      ['preenchimento da barra sobre o trilho', '--tw-accent', '--tw-surface-track'],
      ['acento do pin sobre a pílula escura', '--tw-pin-accent', '--tour-bg'],
      ['contraste do primary do Ionic', '--ion-color-primary-contrast', '--ion-color-primary'],
      ['contraste do secondary do Ionic', '--ion-color-secondary-contrast', '--ion-color-secondary'],
      ['contraste do warning do Ionic', '--ion-color-warning-contrast', '--ion-color-warning'],
      ['contraste do danger do Ionic', '--ion-color-danger-contrast', '--ion-color-danger'],
      ['contraste do success do Ionic', '--ion-color-success-contrast', '--ion-color-success'],
    ];

    // FORA da tabela, de propósito: `--tw-border` sobre `--tw-surface` dá
    // 1,48:1. Não é regressão — no design system anterior eram 1,32:1 —, e como
    // hairline decorativo de card ele não está sob a 1.4.11 da WCAG, que fala do
    // que é "necessário para identificar" um componente.
    //
    // Mas o MESMO token desenha a borda dos campos de texto, e ali ele É
    // necessário: é o que diz onde se digita. Corrigir exige um token próprio de
    // borda de campo a 3:1, que é decisão de design e não de troca de paleta.
    // Fica registrado aqui em vez de escondido num teste que ninguém leria.

    for (const [nome, fg, bg] of grafico) {
      it(`${nome}: 3:1 ou mais`, () => {
        const razao = contraste(token(fg), token(bg));
        expect(razao)
          .withContext(`${fg} sobre ${bg} rendeu ${razao.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(3);
      });
    }

    /**
     * O contrário dos testes acima: prova que o teal CLARO continua sendo uma
     * armadilha, e portanto que a separação entre `--brand-accent` e
     * `--brand-accent-dark` tem razão de existir. No dia em que alguém "limpar"
     * os dois num só, este teste cai e explica por quê.
     */
    it('o teal claro segue reprovando com branco — é por isso que existe o -dark', () => {
      expect(contraste(token('--brand-accent'), token('--neutral-white'))).toBeLessThan(4.5);
      expect(contraste(token('--brand-accent-dark'), token('--neutral-white'))).toBeGreaterThanOrEqual(4.5);
    });
  });

  /**
   * 3. A forma dos três slots.
   *
   * A cor cheia de um status quase nunca passa como texto: medidas sobre
   * branco, a de aviso dá 2,15:1 e a de sucesso 3,30:1. O slot `-text` é a
   * resposta, e as três famílias precisam mesmo dele.
   *
   * Este teste já pagou o próprio custo: o erro nascera como alias da base, e
   * foi ele quem mostrou que `#dc2626` sobre o fundo de erro dá 3,95:1.
   */
  describe('forma dos três slots de status', () => {
    for (const familia of ['success', 'warning', 'error']) {
      it(`${familia} tem base, -text e -soft, e o -text passa nos dois fundos`, () => {
        for (const slot of ['', '-text', '-soft']) {
          expect(token(`--status-${familia}${slot}`))
            .withContext(`--status-${familia}${slot} não resolve`)
            .toMatch(/^rgba?\(/);
        }
        const texto = token(`--status-${familia}-text`);
        expect(contraste(texto, token('--neutral-white'))).toBeGreaterThanOrEqual(4.5);
        expect(contraste(texto, token(`--status-${familia}-soft`))).toBeGreaterThanOrEqual(4.5);
      });
    }
  });

  /**
   * 4. Nenhuma cadeia de `var()` quebrada.
   *
   * Este é o risco que a arquitetura em camadas INTRODUZ. Sessenta valores que
   * eram literais viraram cadeias de duas ou três pontas; um nome digitado
   * errado (`var(--brand-primry)`) não dá erro de build, não dá erro de lint e
   * não aparece em nenhuma tela até alguém reparar que um botão está sem cor.
   *
   * Os nomes são varridos das folhas carregadas, não escritos aqui, para que um
   * token novo entre na cobertura sem ninguém lembrar de adicioná-lo. A própria
   * varredura é verificada: se ela achar pouca coisa, o teste falha em vez de
   * passar em silêncio sobre uma lista vazia.
   */
  describe('integridade das cadeias var()', () => {
    function tokensDeCor(): string[] {
      const nomes = new Set<string>();
      for (const folha of Array.from(document.styleSheets)) {
        let regras: CSSRuleList;
        try {
          regras = folha.cssRules;
        } catch {
          continue; // folha de outra origem; não é o nosso caso, mas não custa
        }
        for (const regra of Array.from(regras)) {
          if (!(regra instanceof CSSStyleRule) || !regra.selectorText.includes(':root')) continue;
          for (const prop of Array.from(regra.style)) {
            if (!prop.startsWith('--')) continue;
            // Só o que é cor. Fora ficam raios, sombras, easings, alvos de
            // toque e as triplas -rgb, que não são cor sozinhas.
            if (/-(rgb|radius|shadow|ease|tap|max|family)/.test(prop)) continue;
            if (/^--(brand|neutral|status|accent|tour|app|tw|ion)-/.test(prop)) nomes.add(prop);
          }
        }
      }
      return [...nomes].sort();
    }

    it('varre uma quantidade plausível de tokens', () => {
      // Guarda contra o modo de falha silenciosa: uma varredura que devolvesse
      // lista vazia faria o teste seguinte passar sem verificar nada.
      expect(tokensDeCor().length).toBeGreaterThan(80);
    });

    it('todo token de cor resolve para uma cor de verdade', () => {
      const quebrados: string[] = [];
      for (const nome of tokensDeCor()) {
        const valor = token(nome);
        // Uma cadeia quebrada não dá erro: a declaração fica inválida e o
        // computed cai no valor herdado ou em transparente.
        if (!/^rgba?\(/.test(valor) || valor === 'rgba(0, 0, 0, 0)') quebrados.push(`${nome} -> "${valor}"`);
      }
      expect(quebrados).withContext(`cadeias quebradas:\n${quebrados.join('\n')}`).toEqual([]);
    });
  });
});
