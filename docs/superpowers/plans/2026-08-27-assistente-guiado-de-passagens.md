# Assistente guiado de passagens — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à etapa 2 do wizard de tour um modo guiado que leva o corretor ambiente por ambiente e pede um único toque por foto — onde fica a passagem para o próximo —, fechando o percurso num ciclo.

**Architecture:** O assistente é uma UI nova sobre o modelo de dados que já existe. Ele não muta hotspot direto: escreve pelo `HotspotEditorStore`, o mesmo do editor livre. O passo atual é derivado de `selectedSceneId`, não é estado próprio — avançar de passo **é** trocar a cena selecionada. O destino de cada ponto é derivado da sequência (`(i+1) % N`), nunca perguntado. A aritmética do roteiro fica num módulo puro, testável sem TestBed, no padrão de `scene-graph.ts` e `hotspot-projection.ts`.

**Tech Stack:** Angular 20 (standalone, signals, `@if`/`@switch`, `computed`), Ionic 8.8.9, three.js + OrbitControls, ngx-translate, Karma + Jasmine + ChromeHeadless.

**Spec:** `docs/superpowers/specs/2026-08-27-assistente-guiado-de-passagens-design.md` (commit `2cd1e7f`).

---

## Antes de começar

| Coisa | Onde | Comando |
|---|---|---|
| Branch | raiz do repo | `git checkout feat/assistente-guiado-de-passagens` |
| Testes do cliente | `inner-view-client/` | `npm test -- --watch=false --browsers=ChromeHeadless` |
| Um arquivo só | `inner-view-client/` | `npm test -- --watch=false --browsers=ChromeHeadless --include='**/nome.spec.ts'` |
| Lint | `inner-view-client/` | `npm run lint` |

**Convenções do repo que valem em todo arquivo criado aqui** (`.agents/AGENTS.md`):

- Código em inglês, comentários e documentação em **português**.
- **Nunca hex solto** — usar os tokens `--app-*` / `--ion-color-*`.
- **Nunca string literal em template** — usar `ngx-translate`.
- Alvo de toque ≥ 44px.
- **O repositório inteiro é CRLF.** Arquivo novo criado por ferramenta sai LF e precisa ser convertido antes do commit:

```bash
python -c "
import sys
p = sys.argv[1]
b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
open(p,'wb').write(b)
" caminho/do/arquivo.ts
```

**Nos testes, o pipe `translate` devolve a própria chave.** O harness usa `provideTranslateService` sem loader HTTP, então asserção de texto compara com `'TOUR_WIZARD.STEP2.GUIDED.CONFIRM'`, e não com "Confirmar passagem".

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/app/tour-wizard/hotspots/guided/guided-route.ts` | **Criar.** Puro, sem DOM e sem Angular. O roteiro como aritmética. |
| `.../guided/guided-route.spec.ts` | **Criar.** Testes do módulo puro. |
| `.../guided/guided-route.store.ts` | **Criar.** Comandos do roteiro. Escreve só via `HotspotEditorStore`. |
| `.../guided/guided-route.store.spec.ts` | **Criar.** |
| `.../guided/guided-banner.component.{ts,html,scss}` | **Criar.** Swatch + instrução do passo. |
| `.../guided/guided-sheet.component.{ts,html,scss}` | **Criar.** Dots, próximo ambiente, Refazer, botão primário. |
| `.../guided/guided-cycle.component.{ts,html,scss}` | **Criar.** Diagrama do ciclo e os dois botões finais. |
| `.../guided/guided-hotspots.component.{ts,html,scss}` | **Criar.** Orquestrador: viewer + banner + gaveta. |
| `.../guided/guided-hotspots.component.spec.ts` | **Criar.** |
| `.../hotspots/free/free-hotspots.component.{ts,html,scss}` | **Criar.** O editor livre de hoje, extraído sem mudança de comportamento. |
| `src/app/tour-wizard/steps/step-hotspots/step-hotspots.component.{ts,html,scss}` | **Modificar.** Vira o interruptor entre os dois modos. |
| `src/app/components/panoramic-viewer/panoramic-viewer.component.ts` | **Modificar.** Ganha `resetView()`. |
| `src/theme/variables.scss` | **Modificar.** Seis tokens `--app-room-*`. |
| `src/assets/i18n/pt.json`, `en.json` | **Modificar.** Chaves sob `TOUR_WIZARD.STEP2.GUIDED.*`. |

**Não encostar em:** `hotspot-editor.store.ts`, `publish-payload.ts`, `scene-graph.ts`, `tour-wizard.model.ts`, `tour-draft.store.ts`. Se algum precisar mudar, o desenho errou — parar e reabrir a conversa.

---

### Task 1: `guided-route.ts` — o roteiro como função pura

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-route.ts`
- Test: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-route.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-route.spec.ts`:

```ts
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import {
  cicloFechado,
  corDoAmbiente,
  estadoDosDots,
  passagemDoPasso,
  passoDoRoteiro,
  primeiroPassoIncompleto,
} from './guided-route';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(id: string, hotspots: WizardHotspot[] = []): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
  };
}

/** Sala → Cozinha → Quarto → (volta para Sala). Nenhuma passagem ainda. */
function tresVazias(): WizardScene[] {
  return [cena('sala'), cena('cozinha'), cena('quarto')];
}

describe('passagemDoPasso', () => {
  it('acha o ponto que leva ao ambiente alvo', () => {
    const sala = cena('sala', [ponto('h1', 'cozinha')]);
    expect(passagemDoPasso(sala, 'cozinha')?.id).toBe('h1');
  });

  // O ambiente pode ter outros pontos, do editor livre. Eles não são a
  // passagem deste passo e o assistente não pode confundi-los com ela.
  it('ignora pontos que levam a outro lugar', () => {
    const sala = cena('sala', [ponto('h1', 'varanda'), ponto('h2', 'cozinha')]);
    expect(passagemDoPasso(sala, 'cozinha')?.id).toBe('h2');
  });

  it('ignora ponto sem destino', () => {
    const sala = cena('sala', [ponto('h1', null)]);
    expect(passagemDoPasso(sala, 'cozinha')).toBeNull();
  });

  it('sem passagem devolve null', () => {
    expect(passagemDoPasso(cena('sala'), 'cozinha')).toBeNull();
  });
});

describe('passoDoRoteiro', () => {
  it('o passo i aponta para o ambiente i+1', () => {
    const passo = passoDoRoteiro(tresVazias(), 0);
    expect(passo?.scene.id).toBe('sala');
    expect(passo?.target.id).toBe('cozinha');
    expect(passo?.index).toBe(0);
    expect(passo?.total).toBe(3);
    expect(passo?.isLast).toBeFalse();
  });

  // O ciclo é o que garante que ninguém fica preso: o último fecha no primeiro.
  it('o ultimo passo aponta de volta para o primeiro', () => {
    const passo = passoDoRoteiro(tresVazias(), 2);
    expect(passo?.scene.id).toBe('quarto');
    expect(passo?.target.id).toBe('sala');
    expect(passo?.isLast).toBeTrue();
  });

  it('traz a passagem que ja existe', () => {
    const cenas = [cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')];
    expect(passoDoRoteiro(cenas, 0)?.hotspot?.id).toBe('h1');
  });

  // Com um ambiente só não há percurso a montar, e a etapa 2 já é opcional aí.
  it('menos de dois ambientes nao tem roteiro', () => {
    expect(passoDoRoteiro([cena('sala')], 0)).toBeNull();
    expect(passoDoRoteiro([], 0)).toBeNull();
  });

  // O índice vem de `findIndex`, que devolve -1 quando a cena selecionada não
  // está entre as prontas — durante uma troca, por exemplo.
  it('indice fora da faixa devolve null', () => {
    expect(passoDoRoteiro(tresVazias(), -1)).toBeNull();
    expect(passoDoRoteiro(tresVazias(), 3)).toBeNull();
  });

  it('dois ambientes formam um ciclo de ida e volta', () => {
    const cenas = [cena('sala'), cena('cozinha')];
    expect(passoDoRoteiro(cenas, 0)?.target.id).toBe('cozinha');
    expect(passoDoRoteiro(cenas, 1)?.target.id).toBe('sala');
  });
});

describe('primeiroPassoIncompleto', () => {
  it('pula os passos que ja estao ligados', () => {
    const cenas = [
      cena('sala', [ponto('h1', 'cozinha')]),
      cena('cozinha'),
      cena('quarto'),
    ];
    expect(primeiroPassoIncompleto(cenas)).toBe(1);
  });

  it('tudo ligado devolve -1', () => {
    const cenas = [
      cena('sala', [ponto('h1', 'cozinha')]),
      cena('cozinha', [ponto('h2', 'quarto')]),
      cena('quarto', [ponto('h3', 'sala')]),
    ];
    expect(primeiroPassoIncompleto(cenas)).toBe(-1);
  });

  it('nada ligado comeca do zero', () => {
    expect(primeiroPassoIncompleto(tresVazias())).toBe(0);
  });

  it('menos de dois ambientes devolve -1', () => {
    expect(primeiroPassoIncompleto([cena('sala')])).toBe(-1);
  });
});

describe('cicloFechado', () => {
  it('so com todos ligados', () => {
    const cenas = [
      cena('sala', [ponto('h1', 'cozinha')]),
      cena('cozinha', [ponto('h2', 'sala')]),
    ];
    expect(cicloFechado(cenas)).toBeTrue();
  });

  it('faltando um, nao fechou', () => {
    const cenas = [cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')];
    expect(cicloFechado(cenas)).toBeFalse();
  });

  it('menos de dois ambientes nunca fecha', () => {
    expect(cicloFechado([cena('sala')])).toBeFalse();
  });
});

describe('estadoDosDots', () => {
  it('marca atual, concluido e pendente', () => {
    const cenas = [
      cena('sala', [ponto('h1', 'cozinha')]),
      cena('cozinha'),
      cena('quarto'),
    ];
    expect(estadoDosDots(cenas, 1)).toEqual(['concluido', 'atual', 'pendente']);
  });

  // O atual ganha do concluído: a pílula tem que dizer onde a pessoa está,
  // mesmo que aquele passo já esteja resolvido.
  it('o atual vence mesmo com passagem feita', () => {
    const cenas = [cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')];
    expect(estadoDosDots(cenas, 0)[0]).toBe('atual');
  });

  it('menos de dois ambientes nao tem dots', () => {
    expect(estadoDosDots([cena('sala')], 0)).toEqual([]);
  });
});

describe('corDoAmbiente', () => {
  it('devolve um token do tema, nunca hex', () => {
    expect(corDoAmbiente(0)).toBe('var(--app-room-1)');
    expect(corDoAmbiente(5)).toBe('var(--app-room-6)');
  });

  it('cicla depois do sexto', () => {
    expect(corDoAmbiente(6)).toBe(corDoAmbiente(0));
    expect(corDoAmbiente(13)).toBe(corDoAmbiente(1));
  });
});
```

- [ ] **Step 2: Rodar o teste e conferir que falha**

Run (em `inner-view-client/`): `npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-route.spec.ts'`

Expected: FAIL na compilação — `Cannot find module './guided-route'`.

- [ ] **Step 3: Escrever a implementação**

Criar `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-route.ts`:

```ts
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
```

- [ ] **Step 4: Converter para CRLF**

```bash
cd inner-view-client
python -c "
import sys
for p in sys.argv[1:]:
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
" src/app/tour-wizard/hotspots/guided/guided-route.ts src/app/tour-wizard/hotspots/guided/guided-route.spec.ts
```

- [ ] **Step 5: Rodar o teste e conferir que passa**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-route.spec.ts'`

Expected: PASS, 20 specs, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/hotspots/guided/
git commit -m "feat(client): o roteiro do assistente guiado como funcao pura"
```

---

### Task 2: os seis tokens de cor de ambiente

**Files:**
- Modify: `inner-view-client/src/theme/variables.scss` (bloco dos tokens `--app-*`, por volta da linha 186)

- [ ] **Step 1: Adicionar os tokens**

Em `src/theme/variables.scss`, logo depois da linha `--app-primary-disabled: var(--brand-primary-200);`, inserir:

```scss
  /* Identidade visual de cada ambiente no assistente guiado: o swatch do
     banner e o dot do pino. Seis tons neutros e dessaturados de propósito —
     eles aparecem por cima de fotos de imóvel, e cor saturada ali competiria
     com a foto em vez de ajudar a reconhecer o próximo ambiente de relance.
     `corDoAmbiente()` cicla entre eles; com mais de seis ambientes dois
     repetem, o que é aceitável para um apoio de reconhecimento. */
  --app-room-1: #b7c1cf;
  --app-room-2: #cdb7a1;
  --app-room-3: #b6c3b2;
  --app-room-4: #a9bcc2;
  --app-room-5: #c6bd9c;
  --app-room-6: #c2b3c4;
```

> Estes hex são a **declaração** dos tokens, que é o único lugar onde hex pode
> aparecer — é assim que os `--brand-*` e `--neutral-*` deste mesmo arquivo já
> são definidos. Nenhum componente escreve hex; todos usam `var(--app-room-N)`.

- [ ] **Step 2: Conferir que os seis existem**

Run (em `inner-view-client/`): `grep -c "app-room-" src/theme/variables.scss`

Expected: `6`

- [ ] **Step 3: Rodar o build para garantir que o SCSS compila**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-route.spec.ts'`

Expected: PASS. (O `variables.scss` entra nos `styles` da configuração de teste, então um erro de sintaxe aqui quebra a suíte inteira.)

- [ ] **Step 4: Commit**

```bash
git add inner-view-client/src/theme/variables.scss
git commit -m "feat(client): tokens de cor de identidade de ambiente"
```

---

### Task 3: `resetView()` no viewer

**Files:**
- Modify: `inner-view-client/src/app/components/panoramic-viewer/panoramic-viewer.component.ts`
- Test: `inner-view-client/src/app/components/panoramic-viewer/panoramic-viewer.component.spec.ts`

**Por quê:** `camera.position.set(0, 0, 0.1)` roda uma vez só, dentro de `initThreeJS()`. `loadPanorama()` troca a textura e não mexe no OrbitControls. Hoje, avançar de ambiente deixa o corretor olhando o ângulo em que ele estava no ambiente anterior — um ângulo sem significado na foto nova, já que equirretangulares de celular não compartilham orientação de bússola.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `panoramic-viewer.component.spec.ts`, antes do último `});` do arquivo:

```ts
/**
 * `resetView()` existe para o assistente guiado: avançar de ambiente tem de
 * devolver a câmera ao ângulo inicial, senão o corretor chega na foto nova
 * olhando para um lado que não quer dizer nada.
 */
describe('PanoramicViewerComponent — resetView', () => {
  let fixture: ComponentFixture<PanoramicViewerComponent>;
  let component: PanoramicViewerComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    });
    fixture = TestBed.createComponent(PanoramicViewerComponent);
    component = fixture.componentInstance;
  });

  // Sem cena montada não há câmera. Chamar antes do `ngAfterViewInit` — ou
  // depois do destroy — não pode explodir: quem chama é um `effect`, e ele
  // pode disparar em qualquer ordem em relação ao ciclo de vida do viewer.
  it('antes de montar nao explode', () => {
    expect(() => component.resetView()).not.toThrow();
  });

  it('devolve a camera ao ponto inicial', () => {
    component.panoramas = [];
    fixture.detectChanges();

    const camera = component.viewerCamera;
    if (!camera) {
      pending('WebGL indisponivel neste navegador de teste');
      return;
    }

    camera.position.set(400, 120, -300);
    component.resetView();

    expect(camera.position.x).toBeCloseTo(0, 5);
    expect(camera.position.y).toBeCloseTo(0, 5);
    expect(camera.position.z).toBeCloseTo(0.1, 5);
  });
});
```

Se `ComponentFixture`, `TestBed` ou `provideTranslateService` ainda não estiverem importados no topo do arquivo, adicionar:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
```

- [ ] **Step 2: Rodar o teste e conferir que falha**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/panoramic-viewer.component.spec.ts'`

Expected: FAIL na compilação — `Property 'resetView' does not exist on type 'PanoramicViewerComponent'`.

- [ ] **Step 3: Implementar**

Em `panoramic-viewer.component.ts`, adicionar logo depois do getter `viewerSize()` (por volta da linha 289):

```ts
  /**
   * Devolve a câmera ao ângulo inicial.
   *
   * Público e aditivo: quem não chamar não vê diferença nenhuma. Existe para o
   * assistente guiado, que troca de ambiente a cada passo — e `loadPanorama()`
   * troca só a textura, deixando o OrbitControls no ângulo do ambiente
   * anterior. Num tour montado com fotos de celular, esse ângulo não quer dizer
   * nada na foto nova: equirretangulares não compartilham orientação de bússola.
   *
   * O `(0, 0, 0.1)` é o mesmo valor de `initThreeJS()`, e não um número novo:
   * a câmera vive no centro da esfera, e o 0.1 é o empurrãozinho que dá ao
   * OrbitControls uma direção de partida em vez de um vetor nulo.
   *
   * Silencioso antes de montar e depois do destroy, porque quem chama é um
   * `effect` e ele pode disparar em qualquer ordem em relação ao ciclo de vida.
   */
  resetView(): void {
    if (!this.camera || !this.controls) return;

    this.camera.position.set(0, 0, 0.1);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
```

- [ ] **Step 4: Rodar o teste e conferir que passa**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/panoramic-viewer.component.spec.ts'`

Expected: PASS. Se o teste do reset ficar `pending` por falta de WebGL no ChromeHeadless, isso é aceitável — o teste "antes de montar nao explode" precisa passar de qualquer forma.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/components/panoramic-viewer/
git commit -m "feat(client): resetView no viewer, para o assistente trocar de ambiente"
```

---

### Task 4: `GuidedRouteStore` — os comandos do roteiro

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-route.store.ts`
- Test: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-route.store.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `guided-route.store.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { GuidedRouteStore } from './guided-route.store';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(id: string, hotspots: WizardHotspot[] = []): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
  };
}

describe('GuidedRouteStore', () => {
  let draft: TourDraftStore;
  let guided: GuidedRouteStore;

  function montar(cenas: WizardScene[], selecionada = cenas[0]?.id ?? null) {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        HotspotEditorStore,
        GuidedRouteStore,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    draft.scenes.set(cenas);
    draft.selectedSceneId.set(selecionada);
    guided = TestBed.inject(GuidedRouteStore);
  }

  afterEach(() => TestBed.resetTestingModule());

  function pontosDe(id: string): WizardHotspot[] {
    return draft.scenes().find((s) => s.id === id)?.hotspots ?? [];
  }

  it('o passo vem da cena selecionada, e nao de um indice proprio', () => {
    montar([cena('sala'), cena('cozinha'), cena('quarto')], 'cozinha');
    expect(guided.indice()).toBe(1);
    expect(guided.passo()?.target.id).toBe('quarto');
  });

  it('marcar cria o ponto com o destino derivado da sequencia', () => {
    montar([cena('sala'), cena('cozinha')]);
    guided.marcar(0.3, 0.6);

    const pontos = pontosDe('sala');
    expect(pontos.length).toBe(1);
    expect(pontos[0].target).toBe('cozinha');
    expect(pontos[0].u).toBe(0.3);
    expect(pontos[0].v).toBe(0.6);
  });

  // O gesto é "corrigir onde eu marquei", não "marcar de novo". Criar um
  // segundo ponto deixaria duas passagens para o mesmo lugar na mesma foto.
  it('marcar de novo MOVE a passagem, nao cria uma segunda', () => {
    montar([cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')]);
    guided.marcar(0.8, 0.4);

    const pontos = pontosDe('sala');
    expect(pontos.length).toBe(1);
    expect(pontos[0].id).toBe('h1');
    expect(pontos[0].u).toBe(0.8);
  });

  // A promessa central: o assistente não destrói trabalho do editor livre.
  it('marcar nao encosta nos outros pontos do ambiente', () => {
    montar([
      cena('sala', [ponto('h1', 'varanda'), ponto('h2', null)]),
      cena('cozinha'),
    ]);
    guided.marcar(0.5, 0.5);

    const ids = pontosDe('sala').map((h) => h.id);
    expect(ids).toContain('h1');
    expect(ids).toContain('h2');
    expect(pontosDe('sala').length).toBe(3);
  });

  it('refazer apaga so a passagem deste passo', () => {
    montar([
      cena('sala', [ponto('h1', 'cozinha'), ponto('h2', 'varanda')]),
      cena('cozinha'),
    ]);
    guided.refazer();

    expect(pontosDe('sala').map((h) => h.id)).toEqual(['h2']);
  });

  it('confirmar troca a cena selecionada para o proximo', () => {
    montar([cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')]);
    guided.confirmar();

    expect(draft.selectedSceneId()).toBe('cozinha');
    expect(guided.indice()).toBe(1);
  });

  it('confirmar sem passagem nao faz nada', () => {
    montar([cena('sala'), cena('cozinha')]);
    guided.confirmar();

    expect(draft.selectedSceneId()).toBe('sala');
  });

  it('confirmar o ultimo passo com tudo ligado mostra o resumo', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'cozinha',
    );
    expect(guided.resumo()).toBeFalse();
    guided.confirmar();

    expect(guided.resumo()).toBeTrue();
    expect(guided.fechado()).toBeTrue();
  });

  // Sem isto, "Editar conexões" voltaria ao passo 1 e o diagrama continuaria
  // na tela — o ciclo segue fechado, e a gaveta nunca sairia do resumo.
  it('voltar ao inicio sai do resumo e vai para o passo 1', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'cozinha',
    );
    guided.confirmar();
    guided.voltarAoInicio();

    expect(guided.resumo()).toBeFalse();
    expect(draft.selectedSceneId()).toBe('sala');
  });

  // E confirmar de dentro dessa revisão não pode devolver o resumo na hora:
  // quem clicou em "Editar conexões" quer percorrer os passos.
  it('confirmar um passo do meio nao devolve o resumo', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'quarto')]),
        cena('quarto', [ponto('h3', 'sala')]),
      ],
      'sala',
    );
    guided.confirmar();

    expect(guided.resumo()).toBeFalse();
    expect(draft.selectedSceneId()).toBe('cozinha');
  });

  it('abrir vai para o primeiro passo incompleto', () => {
    montar([cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha'), cena('quarto')], 'quarto');
    guided.abrir();

    expect(draft.selectedSceneId()).toBe('cozinha');
    expect(guided.resumo()).toBeFalse();
  });

  it('abrir com tudo ligado mostra o resumo direto', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'sala',
    );
    guided.abrir();

    expect(guided.resumo()).toBeTrue();
  });

  it('com um ambiente so o assistente nao esta disponivel', () => {
    montar([cena('sala')]);
    expect(guided.disponivel()).toBeFalse();
    expect(guided.passo()).toBeNull();
  });
});
```

> `TourDraftStore.scenes` e `selectedSceneId` são `signal` públicos
> (`tour-draft.store.ts:124-126`), então o teste monta o estado escrevendo
> neles direto. Não adicionar API nova ao store — ele está na lista de "não
> encostar".

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-route.store.spec.ts'`

Expected: FAIL — `Cannot find module './guided-route.store'`.

- [ ] **Step 3: Implementar**

Criar `guided-route.store.ts`:

```ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import {
  GuidedStep,
  cicloFechado,
  estadoDosDots,
  passoDoRoteiro,
  primeiroPassoIncompleto,
} from './guided-route';

/**
 * Os comandos do assistente guiado.
 *
 * Não muta hotspot: escreve pelo `HotspotEditorStore`, o mesmo do editor livre.
 * Duplicar a regra de mutação criaria duas versões da mesma verdade, e este
 * projeto já pagou uma vez por isso (ver o eixo espelhado do `addHotspots`,
 * documentado em `scene-graph.ts`).
 */
@Injectable()
export class GuidedRouteStore {
  private readonly draft = inject(TourDraftStore);
  private readonly editor = inject(HotspotEditorStore);

  readonly cenas = computed(() => this.draft.readyScenes());

  /**
   * O passo atual é DERIVADO da cena selecionada, e não um `wizardIndex`
   * próprio. Com dois estados, um dia eles discordariam e a tela mostraria a
   * foto da Cozinha sob a instrução do Quarto. Avançar de passo É trocar a cena.
   */
  readonly indice = computed(() => {
    const id = this.draft.selectedSceneId();
    return this.cenas().findIndex((s) => s.id === id);
  });

  readonly passo = computed<GuidedStep | null>(() =>
    passoDoRoteiro(this.cenas(), this.indice()),
  );

  readonly dots = computed(() => estadoDosDots(this.cenas(), this.indice()));
  readonly fechado = computed(() => cicloFechado(this.cenas()));
  readonly disponivel = computed(() => this.cenas().length >= 2);

  /**
   * A gaveta está mostrando o diagrama do ciclo, e não o passo.
   *
   * Precisa ser estado, e não `fechado()` direto: assim que o percurso fecha,
   * `fechado()` fica true para sempre — e "Editar conexões" voltaria ao passo 1
   * com o diagrama ainda na tela, sem jeito de sair dele.
   */
  readonly resumo = signal(false);

  /**
   * Marca a passagem deste passo onde o corretor tocou.
   *
   * Com passagem existente, MOVE. O gesto é "corrigir onde eu marquei", não
   * "marcar de novo" — criar um segundo ponto deixaria duas passagens para o
   * mesmo lugar na mesma foto, e a segunda seria invisível debaixo da primeira.
   *
   * O destino é derivado da sequência, nunca perguntado: é isso que elimina o
   * segundo gesto que o editor livre exige. E precisa ser gravado de verdade —
   * `toCreateTourPayload` descarta ponto sem destino.
   */
  marcar(u: number, v: number): void {
    const passo = this.passo();
    if (!passo) return;

    if (passo.hotspot) {
      this.editor.update(passo.hotspot.id, { u, v });
      return;
    }

    const id = this.editor.add(u, v);
    if (id) this.editor.update(id, { target: passo.target.id });
  }

  /**
   * Apaga só a passagem deste passo.
   *
   * Os outros pontos do ambiente — marcados no editor livre, levando a outro
   * lugar — não são desta passagem e ficam. "Refazer" refaz este passo, não
   * limpa o ambiente.
   */
  refazer(): void {
    const hotspot = this.passo()?.hotspot;
    if (hotspot) this.editor.remove(hotspot.id);
  }

  /**
   * Avança. Trocar de passo é trocar a cena selecionada, e o índice acompanha.
   *
   * O resumo só volta ao confirmar o ÚLTIMO passo. Sem essa condição, quem
   * clicou em "Editar conexões" para revisar um percurso já fechado veria o
   * diagrama reaparecer no primeiro Confirmar, sem ter chegado ao fim.
   */
  confirmar(): void {
    const passo = this.passo();
    if (!passo?.hotspot) return;

    this.draft.selectScene(passo.target.id);
    if (passo.isLast && cicloFechado(this.cenas())) this.resumo.set(true);
  }

  /**
   * Entrada no assistente: abre no primeiro passo incompleto.
   *
   * Quem já ligou metade no editor livre não deve ter de confirmar de novo o
   * que já está feito; quem já ligou tudo cai direto no diagrama.
   */
  abrir(): void {
    if (!this.disponivel()) return;

    const i = primeiroPassoIncompleto(this.cenas());
    if (i < 0) {
      this.resumo.set(true);
      return;
    }

    this.resumo.set(false);
    this.draft.selectScene(this.cenas()[i].id);
  }

  /** "Editar conexões": sai do diagrama e volta ao passo 1. */
  voltarAoInicio(): void {
    const primeira = this.cenas()[0];
    if (!primeira) return;

    this.resumo.set(false);
    this.draft.selectScene(primeira.id);
  }
}
```

- [ ] **Step 4: Converter para CRLF e rodar**

```bash
cd inner-view-client
python -c "
import sys
for p in sys.argv[1:]:
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
" src/app/tour-wizard/hotspots/guided/guided-route.store.ts src/app/tour-wizard/hotspots/guided/guided-route.store.spec.ts
npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-route.store.spec.ts'
```

Expected: PASS, 13 specs.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/hotspots/guided/
git commit -m "feat(client): comandos do roteiro guiado, escrevendo pelo editor store"
```

---

### Task 5: extrair o editor livre para um componente próprio

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/hotspots/free/free-hotspots.component.{ts,html,scss}`
- Modify: `inner-view-client/src/app/tour-wizard/steps/step-hotspots/step-hotspots.component.{ts,html,scss}`

**Esta é refatoração pura: nenhum comportamento novo.** É o trecho da entrega com maior chance de regressão silenciosa e o menor de teste novo. O critério é duro: **`step-hotspots.component.spec.ts` precisa passar sem uma linha editada.** Se algum teste de lá precisar mudar, a extração mudou comportamento — parar e investigar.

- [ ] **Step 1: Rodar a suíte da etapa 2 e guardar o resultado**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/step-hotspots.component.spec.ts'`

Expected: PASS. Anotar o número exato de specs — ele tem de ser o mesmo no fim.

- [ ] **Step 2: Criar `free-hotspots.component.ts` com o que hoje é da etapa**

Mover de `step-hotspots.component.ts` para o arquivo novo, sem alterar nenhuma linha do corpo dos métodos: `vendoOriginal`, `temComparacao`, `revealUrl`, `alternarOriginal()`, `viewerPanoramas`, `destinos`, `roomNames`, `onPlaced()`, `onPinActivated()`, `trash`, `onPinDragMoved()`.

```ts
import { Component, computed, inject, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { HotspotOverlayComponent } from '../hotspot-overlay/hotspot-overlay.component';
import { HotspotPanelComponent } from '../hotspot-panel/hotspot-panel.component';
import { HotspotSheetComponent } from '../hotspot-sheet/hotspot-sheet.component';
import { HotspotSummaryRowComponent } from '../hotspot-summary-row/hotspot-summary-row.component';
import { HotspotTrashComponent } from '../hotspot-trash/hotspot-trash.component';
import { SceneRailComponent } from '../scene-rail/scene-rail.component';

/**
 * O editor livre de pontos — o que era o corpo da etapa 2.
 *
 * Extraído para a etapa poder alternar entre ele e o assistente guiado. Nada
 * aqui mudou de comportamento na extração: é o mesmo código, no mesmo store,
 * com os mesmos testes.
 *
 * NÃO fornece o `HotspotEditorStore`: ele vem da etapa, para os dois modos
 * compartilharem a mesma instância. Fornecendo aqui, trocar de modo perderia
 * o estado de edição no meio do caminho.
 */
@Component({
  selector: 'app-free-hotspots',
  standalone: true,
  imports: [
    TranslatePipe,
    PanoramicViewerComponent,
    HotspotOverlayComponent,
    SceneRailComponent,
    HotspotPanelComponent,
    HotspotSummaryRowComponent,
    HotspotSheetComponent,
    HotspotTrashComponent,
  ],
  templateUrl: './free-hotspots.component.html',
  styleUrls: ['./free-hotspots.component.scss'],
})
export class FreeHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);

  // A PARTIR DAQUI: recortar de `step-hotspots.component.ts` as linhas 63 a
  // 270 (de `readonly vendoOriginal` até o fecha-chaves de `onPinDragMoved`)
  // e colar aqui SEM ALTERAR NENHUMA LINHA, tirando só três membros que ficam
  // na etapa: `ilhados`, `becos` e o helper privado `nomes`.
  //
  // Os caminhos de import mudam de `../../../` para `../../` nos que apontam
  // para dentro de `tour-wizard/`, porque o arquivo desceu um nível — o
  // TypeScript acusa cada um.
}
```

> **Recortar e colar, não redigitar.** O objetivo desta task é que o
> comportamento seja idêntico, e digitar de novo 200 linhas é a forma mais
> provável de mudar uma sem perceber. O `git diff` do commit desta task deve
> mostrar quase só linhas movidas.

- [ ] **Step 3: Criar `free-hotspots.component.html` e `.scss`**

`free-hotspots.component.html` recebe, **sem alteração**, o bloco que hoje começa em `@if (viewerPanoramas().length) {` e termina no `}` do `@else` com `tw-viewer__empty`.

`free-hotspots.component.scss` recebe, **sem alteração**, todas as regras de `step-hotspots.component.scss` que casam com os seletores desse bloco (`.tw-step2`, `.tw-step2__stage`, `.tw-viewer`, `.tw-viewer__hint`, `.tw-viewer__empty`, `.tw-step2__row`, `.tw-step2__panel`). O que sobra em `step-hotspots.component.scss` são as regras de `.tw-step-head`, `.tw-step2__bloqueio` e `.tw-step2__aviso`.

- [ ] **Step 4: Reduzir `step-hotspots.component.ts` ao que sobra**

O componente fica com: `draft`, `editor` (e o `providers: [HotspotEditorStore]`), `ilhados`, `becos` e o helper privado `nomes`. Os imports caem para `TranslatePipe` e `FreeHotspotsComponent`.

```ts
import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { FreeHotspotsComponent } from '../../hotspots/free/free-hotspots.component';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';

/**
 * Etapa 2 — pontos de navegação.
 *
 * O `HotspotEditorStore` é fornecido AQUI, e não na página: o estado de edição
 * não deve sobreviver a sair da etapa 2 e voltar. E fica aqui, e não dentro de
 * cada modo, para o guiado e o livre compartilharem a mesma instância.
 */
@Component({
  selector: 'app-tour-step-hotspots',
  standalone: true,
  imports: [TranslatePipe, FreeHotspotsComponent],
  providers: [HotspotEditorStore],
  templateUrl: './step-hotspots.component.html',
  styleUrls: ['./step-hotspots.component.scss'],
})
export class StepHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);

  readonly ilhados = computed(() => this.nomes(this.draft.ambientesIlhados()));
  readonly becos = computed(() => this.nomes(this.draft.becosSemSaida()));

  private nomes(cenas: readonly WizardScene[]): string {
    return cenas.map((s) => s.room.trim() || s.fileName).join(', ');
  }
}
```

`step-hotspots.component.html` fica com o cabeçalho, os dois avisos e a chamada do modo:

```html
<header class="tw-step-head">
  <h2>{{ 'TOUR_WIZARD.STEP2.TITLE' | translate }}</h2>
  <p>
    {{
      (draft.etapa2Opcional()
        ? 'TOUR_WIZARD.STEP2.SUBTITLE_SOLO'
        : 'TOUR_WIZARD.STEP2.SUBTITLE'
      ) | translate
    }}
  </p>
</header>

@if (ilhados()) {
  <p class="tw-step2__bloqueio" role="alert">
    {{ 'TOUR_WIZARD.STEP2.UNREACHABLE' | translate: { ambientes: ilhados() } }}
  </p>
} @else if (becos()) {
  <p class="tw-step2__aviso" role="status">
    {{ 'TOUR_WIZARD.STEP2.DEAD_END' | translate: { ambientes: becos() } }}
  </p>
}

<app-free-hotspots />
```

- [ ] **Step 5: Converter para CRLF e rodar a suíte SEM editar o spec**

```bash
cd inner-view-client
python -c "
import sys
for p in sys.argv[1:]:
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
" src/app/tour-wizard/hotspots/free/free-hotspots.component.ts src/app/tour-wizard/hotspots/free/free-hotspots.component.html src/app/tour-wizard/hotspots/free/free-hotspots.component.scss
npm test -- --watch=false --browsers=ChromeHeadless --include='**/step-hotspots.component.spec.ts'
```

Expected: PASS, com **o mesmo número de specs do Step 1**, e `step-hotspots.component.spec.ts` sem nenhuma linha alterada.

> Se o spec falhar por não achar mais os elementos: ele monta `StepHotspotsComponent`,
> que agora renderiza `FreeHotspotsComponent` dentro — a árvore do DOM continua
> a mesma, então `fixture.nativeElement.querySelector` continua achando tudo.
> O que pode falhar é `TestBed.inject(HotspotEditorStore)` se o provider tiver
> descido de nível por engano. Conferir que ele ficou em `StepHotspotsComponent`.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`

Expected: PASS. Nenhum outro spec pode ter quebrado.

- [ ] **Step 7: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/
git commit -m "refactor(client): extrai o editor livre de pontos para componente proprio"
```

---

### Task 6: `guided-banner` — o swatch e a instrução

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-banner.component.{ts,html,scss}`

- [ ] **Step 1: Criar o componente**

`guided-banner.component.ts`:

```ts
import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * A instrução do passo, sobre a foto.
 *
 * `role="status"` e não `alert`: a instrução muda a cada passo e precisa ser
 * anunciada, mas esperando a vez — interromper o leitor de tela a cada avanço
 * atropelaria a leitura do que a pessoa está fazendo.
 */
@Component({
  selector: 'app-guided-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './guided-banner.component.html',
  styleUrls: ['./guided-banner.component.scss'],
})
export class GuidedBannerComponent {
  /** Nome do ambiente para onde a passagem leva. */
  readonly target = input.required<string>();

  /** Token de cor do ambiente alvo. Vem de `corDoAmbiente()`. */
  readonly cor = input.required<string>();

  /** No último passo a instrução muda: é a passagem de volta ao primeiro. */
  readonly ultimo = input.required<boolean>();
}
```

`guided-banner.component.html`:

```html
<p class="gb" role="status">
  <span class="gb__swatch" [style.background]="cor()" aria-hidden="true"></span>
  <span class="gb__texto">
    {{
      (ultimo()
        ? 'TOUR_WIZARD.STEP2.GUIDED.INSTRUCTION_LAST'
        : 'TOUR_WIZARD.STEP2.GUIDED.INSTRUCTION'
      ) | translate: { ambiente: target() }
    }}
  </span>
</p>
```

`guided-banner.component.scss`:

```scss
/* Vidro sobre a foto: a instrução tem de ser legível sobre qualquer imagem de
   imóvel, clara ou escura, e um fundo sólido cobriria parte do ambiente bem na
   hora em que a pessoa procura a porta nele. */
.gb {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 11px 13px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: var(--app-radius-md);
  background: rgb(20 16 12 / 55%);
  backdrop-filter: blur(10px);
  color: #fff;
}

.gb__swatch {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border-radius: var(--app-radius-sm);
}

.gb__texto {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
```

- [ ] **Step 2: Converter para CRLF**

```bash
cd inner-view-client
python -c "
import sys
for p in sys.argv[1:]:
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
" src/app/tour-wizard/hotspots/guided/guided-banner.component.ts src/app/tour-wizard/hotspots/guided/guided-banner.component.html src/app/tour-wizard/hotspots/guided/guided-banner.component.scss
```

- [ ] **Step 3: Conferir que compila**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-route.spec.ts'`

Expected: PASS. (A suíte compila o projeto inteiro; erro de template ou SCSS aqui aparece agora.)

- [ ] **Step 4: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/hotspots/guided/
git commit -m "feat(client): banner de instrucao do assistente guiado"
```

---

### Task 7: `guided-sheet` — dots, próximo ambiente, Refazer, botão

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-sheet.component.{ts,html,scss}`

- [ ] **Step 1: Criar o componente**

`guided-sheet.component.ts`:

```ts
import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DotState } from './guided-route';

/**
 * A gaveta do assistente: onde ficam o progresso e a decisão.
 *
 * Não é um `IonModal`. O bottom sheet do editor livre é modal porque abre
 * sobre a foto e prende o foco enquanto se edita um ponto; aqui a gaveta é
 * parte da tela, sempre visível, e um modal permanente prenderia o foco o
 * tempo todo e responderia ao Esc fechando o que não deveria fechar.
 */
@Component({
  selector: 'app-guided-sheet',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './guided-sheet.component.html',
  styleUrls: ['./guided-sheet.component.scss'],
})
export class GuidedSheetComponent {
  readonly dots = input.required<DotState[]>();
  /** Nome do ambiente para onde a passagem leva. */
  readonly target = input.required<string>();
  readonly cor = input.required<string>();
  readonly ultimo = input.required<boolean>();
  /** Sem passagem marcada, o botão primário não faz nada e diz isso. */
  readonly temPassagem = input.required<boolean>();

  readonly confirmar = output<void>();
  readonly refazer = output<void>();
}
```

`guided-sheet.component.html`:

```html
<div class="gs">
  <span class="gs__grabber" aria-hidden="true"></span>

  <!--
    A contagem é a mesma informação dos dots, em texto: os dots são cor e forma,
    e quem usa leitor de tela não recebe nada deles.
  -->
  <ol class="gs__dots" [attr.aria-label]="'TOUR_WIZARD.STEP2.GUIDED.PROGRESS_LABEL' | translate">
    @for (estado of dots(); track $index) {
      <li
        class="gs__dot"
        [class.is-atual]="estado === 'atual'"
        [class.is-feito]="estado === 'concluido'"
        [attr.aria-current]="estado === 'atual' ? 'step' : null">
        <span class="tw-visually-hidden">
          {{
            (estado === 'atual'
              ? 'TOUR_WIZARD.STEP2.GUIDED.DOT_CURRENT'
              : estado === 'concluido'
                ? 'TOUR_WIZARD.STEP2.GUIDED.DOT_DONE'
                : 'TOUR_WIZARD.STEP2.GUIDED.DOT_PENDING'
            ) | translate: { n: $index + 1 }
          }}
        </span>
      </li>
    }
  </ol>

  <div class="gs__linha">
    <span class="gs__thumb" [style.background]="cor()" aria-hidden="true"></span>
    <span class="gs__nomes">
      <small>{{ 'TOUR_WIZARD.STEP2.GUIDED.NEXT_ROOM' | translate }}</small>
      <strong>{{ target() }}</strong>
    </span>

    @if (temPassagem()) {
      <button type="button" class="gs__refazer" (click)="refazer.emit()">
        {{ 'TOUR_WIZARD.STEP2.GUIDED.REDO' | translate }}
      </button>
    }
  </div>

  <!--
    `disabled` de verdade, e não só opacidade: um botão que parece clicável e
    não responde não explica nada a ninguém, e some da navegação por teclado
    sem dizer por quê.
  -->
  <button
    type="button"
    class="gs__acao"
    [disabled]="!temPassagem()"
    (click)="confirmar.emit()">
    {{
      (ultimo()
        ? 'TOUR_WIZARD.STEP2.GUIDED.CONFIRM_LAST'
        : 'TOUR_WIZARD.STEP2.GUIDED.CONFIRM'
      ) | translate
    }}
  </button>
</div>
```

`guided-sheet.component.scss`:

```scss
.gs {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 10px 16px 16px;
  border-radius: var(--app-radius-xl) var(--app-radius-xl) 0 0;
  background: var(--app-surface-soft);
}

.gs__grabber {
  align-self: center;
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--app-hairline);
}

.gs__dots {
  display: flex;
  gap: 6px;
  align-self: center;
  margin: 0;
  padding: 0;
  list-style: none;
}

.gs__dot {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: var(--app-hairline);
  transition: width 0.2s ease;

  &.is-feito {
    background: var(--ion-color-primary);
  }

  /* A pílula responde "onde eu estou" de relance, sem contar bolinhas. */
  &.is-atual {
    width: 26px;
    background: var(--ion-color-primary);
  }
}

.gs__linha {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gs__thumb {
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  border-radius: var(--app-radius-md);
}

.gs__nomes {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;

  small {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--app-muted);
  }

  strong {
    overflow: hidden;
    font-size: 17px;
    font-weight: 700;
    color: var(--app-ink);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* 44px de alvo de toque, como manda o AGENTS.md. */
.gs__refazer {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--app-hairline);
  border-radius: var(--app-radius-md);
  background: var(--app-surface-strong);
  font-size: 13px;
  font-weight: 600;
  color: var(--app-muted);
}

.gs__acao {
  min-height: 52px;
  padding: 16px;
  border: 0;
  border-radius: var(--app-radius-lg);
  background: var(--ion-color-primary);
  font-size: 16.5px;
  font-weight: 800;
  color: var(--ion-color-primary-contrast);
  transition: opacity 0.2s ease;

  &:disabled {
    background: var(--app-primary-disabled);
    opacity: 0.55;
    cursor: not-allowed;
  }
}
```

> `.tw-visually-hidden` é a classe de "só para leitor de tela" do projeto, já
> declarada em `src/theme/tour-wizard.scss:237`. Não criar outra.

- [ ] **Step 2: Converter para CRLF e conferir que compila**

```bash
cd inner-view-client
python -c "
import sys
for p in sys.argv[1:]:
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
" src/app/tour-wizard/hotspots/guided/guided-sheet.component.ts src/app/tour-wizard/hotspots/guided/guided-sheet.component.html src/app/tour-wizard/hotspots/guided/guided-sheet.component.scss
npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-route.spec.ts'
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/hotspots/guided/
git commit -m "feat(client): gaveta do assistente guiado"
```

---

### Task 8: `guided-cycle` — o diagrama do percurso fechado

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-cycle.component.{ts,html,scss}`

- [ ] **Step 1: Criar o componente**

`guided-cycle.component.ts`:

```ts
import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * O diagrama do ciclo, quando o percurso fecha.
 *
 * Não é a tela de "tour publicado" — nada foi publicado ainda, e a etapa 3
 * vem depois. É a confirmação de que os toques viraram um percurso, no mesmo
 * lugar onde o percurso foi montado.
 */
@Component({
  selector: 'app-guided-cycle',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './guided-cycle.component.html',
  styleUrls: ['./guided-cycle.component.scss'],
})
export class GuidedCycleComponent {
  /** Nomes dos ambientes, na ordem do percurso. */
  readonly rooms = input.required<string[]>();

  readonly continuar = output<void>();
  readonly editar = output<void>();

  readonly total = computed(() => this.rooms().length);

  /** O projeto resolve plural por sufixo `_ONE` escolhido no TypeScript. */
  readonly textoKey = computed(() =>
    this.total() === 1
      ? 'TOUR_WIZARD.STEP2.GUIDED.CYCLE_TEXT_ONE'
      : 'TOUR_WIZARD.STEP2.GUIDED.CYCLE_TEXT',
  );

  readonly primeiro = computed(() => this.rooms()[0] ?? '');
}
```

`guided-cycle.component.html`:

```html
<div class="gc">
  <span class="gc__grabber" aria-hidden="true"></span>

  <h3 class="gc__titulo">{{ 'TOUR_WIZARD.STEP2.GUIDED.CYCLE_TITLE' | translate }}</h3>
  <p class="gc__texto">{{ textoKey() | translate: { n: total() } }}</p>

  <!--
    O diagrama é decorativo para leitor de tela: a mesma informação já está na
    frase acima, e ler "Sala seta Cozinha seta Quarto volta" ponto a ponto seria
    repetir o que acabou de ser dito, em pior ordem.
  -->
  <p class="gc__ciclo" aria-hidden="true">
    @for (room of rooms(); track room) {
      <span class="gc__chip">{{ room }}</span>
      <span class="gc__seta">{{ $last ? '↩' : '→' }}</span>
    }
  </p>

  <p class="gc__nota" aria-hidden="true">
    {{ 'TOUR_WIZARD.STEP2.GUIDED.CYCLE_NOTE' | translate: { ambiente: primeiro() } }}
  </p>

  <div class="gc__acoes">
    <button type="button" class="gc__primario" (click)="continuar.emit()">
      {{ 'TOUR_WIZARD.STEP2.GUIDED.CONTINUE' | translate }}
    </button>
    <button type="button" class="gc__secundario" (click)="editar.emit()">
      {{ 'TOUR_WIZARD.STEP2.GUIDED.EDIT_LINKS' | translate }}
    </button>
  </div>
</div>
```

`guided-cycle.component.scss`:

```scss
.gc {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 16px 16px;
  border-radius: var(--app-radius-xl) var(--app-radius-xl) 0 0;
  background: var(--app-surface-soft);
  text-align: center;
}

.gc__grabber {
  align-self: center;
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--app-hairline);
}

.gc__titulo {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.4px;
  color: var(--app-ink);
}

.gc__texto {
  margin: 0 auto;
  max-width: 290px;
  font-size: 14.5px;
  color: var(--app-muted);
}

.gc__ciclo {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin: 6px 0 0;
}

.gc__chip {
  padding: 4px 10px;
  border: 1px solid var(--app-hairline-soft);
  border-radius: var(--app-radius-sm);
  background: var(--app-surface-strong);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--app-body);
}

.gc__seta {
  align-self: center;
  color: var(--ion-color-primary);
  font-weight: 700;
}

.gc__nota {
  margin: 0;
  font-size: 11.5px;
  letter-spacing: 1px;
  color: var(--app-muted);
}

.gc__acoes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}

.gc__primario {
  min-height: 52px;
  border: 0;
  border-radius: var(--app-radius-lg);
  background: var(--ion-color-primary);
  font-size: 16.5px;
  font-weight: 800;
  color: var(--ion-color-primary-contrast);
}

.gc__secundario {
  min-height: 48px;
  border: 1px solid var(--app-hairline);
  border-radius: var(--app-radius-lg);
  background: transparent;
  font-size: 15px;
  font-weight: 700;
  color: var(--app-muted);
}
```

- [ ] **Step 2: Converter para CRLF e conferir que compila**

```bash
cd inner-view-client
python -c "
import sys
for p in sys.argv[1:]:
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
" src/app/tour-wizard/hotspots/guided/guided-cycle.component.ts src/app/tour-wizard/hotspots/guided/guided-cycle.component.html src/app/tour-wizard/hotspots/guided/guided-cycle.component.scss
npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-route.spec.ts'
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/hotspots/guided/
git commit -m "feat(client): diagrama do ciclo fechado"
```

---

### Task 9: `guided-hotspots` — o orquestrador

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-hotspots.component.{ts,html,scss}`
- Test: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-hotspots.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { GuidedHotspotsComponent } from './guided-hotspots.component';
import { GuidedRouteStore } from './guided-route.store';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(id: string, hotspots: WizardHotspot[] = []): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
  };
}

describe('GuidedHotspotsComponent', () => {
  let fixture: ComponentFixture<GuidedHotspotsComponent>;
  let draft: TourDraftStore;
  let guided: GuidedRouteStore;

  function montar(cenas: WizardScene[], selecionada = cenas[0]?.id ?? null) {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        HotspotEditorStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    draft.scenes.set(cenas);
    draft.selectedSceneId.set(selecionada);

    fixture = TestBed.createComponent(GuidedHotspotsComponent);
    fixture.detectChanges();
    guided = fixture.debugElement.injector.get(GuidedRouteStore);
  }

  afterEach(() => TestBed.resetTestingModule());

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function botaoPrimario(): HTMLButtonElement | null {
    return el().querySelector('.gs__acao');
  }

  it('mostra a gaveta com o proximo ambiente', () => {
    montar([cena('sala'), cena('cozinha')]);
    expect(el().querySelector('app-guided-sheet')).not.toBeNull();
    expect(el().textContent).toContain('cozinha');
  });

  // A trava é o que impede confirmar um passo sem passagem e avançar deixando
  // um ambiente sem saída — exatamente o que o assistente existe para evitar.
  it('sem passagem, o botao primario fica desabilitado', () => {
    montar([cena('sala'), cena('cozinha')]);
    expect(botaoPrimario()?.disabled).toBeTrue();
  });

  it('com passagem, o botao primario libera', () => {
    montar([cena('sala', [ponto('h1', 'cozinha')]), cena('cozinha')]);
    expect(botaoPrimario()?.disabled).toBeFalse();
  });

  it('o toque na foto marca a passagem com o destino derivado', () => {
    montar([cena('sala'), cena('cozinha')]);
    fixture.componentInstance.onPlaced({ positionX: 0.25, positionY: 0.75 });
    fixture.detectChanges();

    const pontos = draft.scenes().find((s) => s.id === 'sala')?.hotspots ?? [];
    expect(pontos.length).toBe(1);
    expect(pontos[0].target).toBe('cozinha');
    expect(pontos[0].u).toBe(0.25);
  });

  it('ao fechar o ciclo a gaveta troca para o diagrama', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'cozinha',
    );
    guided.confirmar();
    fixture.detectChanges();

    expect(el().querySelector('app-guided-cycle')).not.toBeNull();
    expect(el().querySelector('app-guided-sheet')).toBeNull();
  });

  // Com o diagrama na tela não há passo em andamento; um toque ali moveria a
  // passagem do passo 1 sem que nada na tela dissesse isso.
  it('com o diagrama aberto, o toque na foto nao marca nada', () => {
    montar(
      [
        cena('sala', [ponto('h1', 'cozinha')]),
        cena('cozinha', [ponto('h2', 'sala')]),
      ],
      'cozinha',
    );
    guided.confirmar();
    fixture.detectChanges();

    fixture.componentInstance.onPlaced({ positionX: 0.9, positionY: 0.1 });

    const pontos = draft.scenes().find((s) => s.id === 'sala')?.hotspots ?? [];
    expect(pontos[0].u).toBe(0.5);
  });

  it('com um ambiente so, o assistente nao monta', () => {
    montar([cena('sala')]);
    expect(el().querySelector('app-guided-sheet')).toBeNull();
    expect(el().querySelector('app-guided-cycle')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-hotspots.component.spec.ts'`

Expected: FAIL — `Cannot find module './guided-hotspots.component'`.

- [ ] **Step 3: Implementar o componente**

`guided-hotspots.component.ts`:

```ts
import {
  Component,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { TourDraftStore } from '../../tour-draft.store';
import { GuidedBannerComponent } from './guided-banner.component';
import { GuidedCycleComponent } from './guided-cycle.component';
import { GuidedSheetComponent } from './guided-sheet.component';
import { corDoAmbiente } from './guided-route';
import { GuidedRouteStore } from './guided-route.store';

/**
 * O assistente guiado: um toque por foto, e o percurso fecha num ciclo.
 *
 * O `GuidedRouteStore` é fornecido aqui — o estado de "estou no resumo" não
 * deve sobreviver a trocar para o editor livre e voltar. O `HotspotEditorStore`
 * NÃO é: ele vem da etapa, compartilhado com o modo livre.
 */
@Component({
  selector: 'app-guided-hotspots',
  standalone: true,
  imports: [
    TranslatePipe,
    PanoramicViewerComponent,
    GuidedBannerComponent,
    GuidedSheetComponent,
    GuidedCycleComponent,
  ],
  providers: [GuidedRouteStore],
  templateUrl: './guided-hotspots.component.html',
  styleUrls: ['./guided-hotspots.component.scss'],
})
export class GuidedHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly guided = inject(GuidedRouteStore);

  private readonly viewer = viewChild(PanoramicViewerComponent);

  /** Nomes dos ambientes na ordem do percurso, para o diagrama do ciclo. */
  readonly nomes = computed(() =>
    this.guided.cenas().map((s) => s.room.trim() || s.fileName),
  );

  readonly nomeDoAlvo = computed(() => {
    const alvo = this.guided.passo()?.target;
    return alvo ? alvo.room.trim() || alvo.fileName : '';
  });

  /**
   * A cor de identidade vem da posição do ALVO no percurso, não da do passo:
   * o swatch existe para reconhecer de relance o ambiente para onde se vai.
   */
  readonly corDoAlvo = computed(() => {
    const passo = this.guided.passo();
    if (!passo) return corDoAmbiente(0);
    return corDoAmbiente((passo.index + 1) % passo.total);
  });

  /**
   * A cena atual no formato do viewer.
   *
   * O `equal` não é otimização, é correção — cópia deliberada da regra do
   * editor livre. `patchScene` cria cena nova a cada mutação de hotspot, e sem
   * isto o `ngOnChanges` do viewer chamaria `loadInitialPanorama()` a cada
   * toque, decodificando a equirretangular inteira de novo. `originHotspots`
   * vai vazio porque quem desenha o pino é o overlay.
   */
  readonly viewerPanoramas = computed<Panorama[]>(
    () => {
      const scene = this.guided.passo()?.scene;
      if (!scene) return [];

      return [
        {
          id: scene.id,
          roomName: scene.room,
          imageUrl: scene.treatedImageUrl ?? scene.imageData,
          order: scene.order,
          initialPanorama: true,
          originHotspots: [],
          measurements: [],
        },
      ];
    },
    {
      equal: (a, b) =>
        a.length === b.length &&
        a.every(
          (p, i) =>
            p.id === b[i].id &&
            p.imageUrl === b[i].imageUrl &&
            p.order === b[i].order,
        ),
    },
  );

  constructor() {
    // Entrar no assistente pula para o primeiro passo incompleto.
    this.guided.abrir();

    // Trocar de ambiente devolve a câmera ao ângulo inicial. Sem isto, o
    // corretor chega na foto nova olhando o ângulo da foto anterior — que ali
    // não quer dizer nada. Ver `resetView` no viewer.
    effect(() => {
      this.guided.passo()?.scene.id;
      this.viewer()?.resetView();
    });
  }

  /**
   * Toque na foto. Com o diagrama aberto não há passo em andamento, e marcar
   * moveria a passagem do passo 1 sem nada na tela dizer isso.
   */
  onPlaced(event: { positionX: number; positionY: number }): void {
    if (this.guided.resumo()) return;
    this.guided.marcar(event.positionX, event.positionY);
  }

  /**
   * "Continuar" no diagrama: a etapa 2 acabou, segue para o resumo do tour.
   *
   * `next()` e não `step.set(3)`: é o mesmo caminho que o botão "Próximo" da
   * barra usa, então passa pelo mesmo `canAdvance`. Com o ciclo fechado ele
   * está satisfeito de qualquer forma — mas escrever a etapa na mão criaria um
   * segundo jeito de avançar, que um dia divergiria do primeiro.
   */
  continuar(): void {
    this.draft.next();
  }
}
```

`guided-hotspots.component.html`:

```html
@if (guided.disponivel()) {
  <div class="gh">
    <div class="gh__pano">
      <app-panoramic-viewer
        #viewer
        [panoramas]="viewerPanoramas()"
        [editMode]="!guided.resumo()"
        [roomNav]="false"
        (hotspotPlaced)="onPlaced($event)" />

      @if (!guided.resumo() && guided.passo(); as passo) {
        <div class="gh__topo">
          <span class="gh__passo">
            {{
              'TOUR_WIZARD.STEP2.GUIDED.PROGRESS'
                | translate
                  : {
                      n: passo.index + 1,
                      total: passo.total,
                      ambiente: passo.scene.room.trim() || passo.scene.fileName
                    }
            }}
          </span>
        </div>

        <app-guided-banner
          class="gh__banner"
          [target]="nomeDoAlvo()"
          [cor]="corDoAlvo()"
          [ultimo]="passo.isLast" />

        <!--
          A dica some assim que a passagem existe: instrução que não some vira
          ruído permanente para quem já entendeu.
        -->
        @if (!passo.hotspot) {
          <p class="gh__dica">{{ 'TOUR_WIZARD.STEP2.GUIDED.HINT' | translate }}</p>
        }
      }
    </div>

    @if (guided.resumo()) {
      <app-guided-cycle
        [rooms]="nomes()"
        (continuar)="continuar()"
        (editar)="guided.voltarAoInicio()" />
    } @else if (guided.passo(); as passo) {
      <app-guided-sheet
        [dots]="guided.dots()"
        [target]="nomeDoAlvo()"
        [cor]="corDoAlvo()"
        [ultimo]="passo.isLast"
        [temPassagem]="!!passo.hotspot"
        (confirmar)="guided.confirmar()"
        (refazer)="guided.refazer()" />
    }
  </div>
}
```

> **O pino sobre a foto ainda não aparece nesta task.** O overlay de pinos é o
> `HotspotOverlayComponent`, e ele lê `editor.hotspots()` — todos os pontos do
> ambiente, incluindo os do editor livre. Reusá-lo aqui mostraria pontos que não
> são deste passo. Isto entra na Task 12 como verificação de navegador: se o
> assistente precisar mostrar o pino, a decisão é passar ao overlay só a
> passagem do passo, o que é um `input` novo nele — e aí sai da lista de "não
> encostar", exigindo uma decisão explícita. Deixar sem pino até ver a tela.

`guided-hotspots.component.scss`:

```scss
.gh {
  display: flex;
  flex-direction: column;
}

/* Só o painel tem altura fixa; o resto é fluido. */
.gh__pano {
  position: relative;
  height: 430px;
  overflow: hidden;
  background: #141210;

  @media (min-width: 744px) {
    height: 560px;
  }
}

.gh__topo {
  position: absolute;
  inset: 0 0 auto;
  padding: 12px 14px 28px;
  background: linear-gradient(180deg, rgb(10 8 6 / 82%), transparent);
  pointer-events: none;
}

.gh__passo {
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 1.2px;
  color: rgb(255 255 255 / 85%);
}

.gh__banner {
  position: absolute;
  inset: auto 14px 14px;
  pointer-events: none;
}

.gh__dica {
  position: absolute;
  inset: auto 0 62px;
  margin: 0;
  font-size: 12px;
  text-align: center;
  color: rgb(255 255 255 / 75%);
  pointer-events: none;
}

/* A gaveta sobe por cima do painel, como no desenho. */
app-guided-sheet,
app-guided-cycle {
  z-index: 1;
  margin-top: -20px;
}
```

- [ ] **Step 4: Converter para CRLF e rodar**

```bash
cd inner-view-client
python -c "
import sys
for p in sys.argv[1:]:
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
" src/app/tour-wizard/hotspots/guided/guided-hotspots.component.ts src/app/tour-wizard/hotspots/guided/guided-hotspots.component.html src/app/tour-wizard/hotspots/guided/guided-hotspots.component.scss src/app/tour-wizard/hotspots/guided/guided-hotspots.component.spec.ts
npm test -- --watch=false --browsers=ChromeHeadless --include='**/guided-hotspots.component.spec.ts'
```

Expected: PASS, 7 specs.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/hotspots/guided/
git commit -m "feat(client): orquestrador do assistente guiado de passagens"
```

---

### Task 10: i18n

**Files:**
- Modify: `inner-view-client/src/assets/i18n/pt.json`
- Modify: `inner-view-client/src/assets/i18n/en.json`

- [ ] **Step 1: Adicionar as chaves nos dois arquivos**

Dentro de `TOUR_WIZARD.STEP2`, adicionar o objeto `GUIDED`. Em `pt.json`:

```json
"GUIDED": {
  "PROGRESS": "Passo {{n}} de {{total}} · {{ambiente}}",
  "PROGRESS_LABEL": "Progresso do percurso",
  "INSTRUCTION": "Toque onde fica a passagem para {{ambiente}}",
  "INSTRUCTION_LAST": "Toque onde fica a passagem de volta para {{ambiente}}",
  "HINT": "arraste para girar · toque para marcar",
  "NEXT_ROOM": "Próximo ambiente",
  "REDO": "Refazer",
  "CONFIRM": "Confirmar passagem",
  "CONFIRM_LAST": "Fechar percurso",
  "DOT_CURRENT": "Ambiente {{n}}, atual",
  "DOT_DONE": "Ambiente {{n}}, concluído",
  "DOT_PENDING": "Ambiente {{n}}, pendente",
  "CYCLE_TITLE": "Percurso fechado",
  "CYCLE_TEXT": "Os {{n}} ambientes estão conectados em ciclo — dá para percorrer o imóvel inteiro e voltar ao início.",
  "CYCLE_TEXT_ONE": "O ambiente está conectado em ciclo.",
  "CYCLE_NOTE": "↩ fecha o ciclo em {{ambiente}}",
  "CONTINUE": "Continuar",
  "EDIT_LINKS": "Editar conexões",
  "ADVANCED": "Editar manualmente",
  "GUIDED_MODE": "Voltar ao assistente"
}
```

Em `en.json`, o mesmo objeto:

```json
"GUIDED": {
  "PROGRESS": "Step {{n}} of {{total}} · {{ambiente}}",
  "PROGRESS_LABEL": "Route progress",
  "INSTRUCTION": "Tap where the passage to {{ambiente}} is",
  "INSTRUCTION_LAST": "Tap where the passage back to {{ambiente}} is",
  "HINT": "drag to rotate · tap to mark",
  "NEXT_ROOM": "Next room",
  "REDO": "Redo",
  "CONFIRM": "Confirm passage",
  "CONFIRM_LAST": "Close the route",
  "DOT_CURRENT": "Room {{n}}, current",
  "DOT_DONE": "Room {{n}}, done",
  "DOT_PENDING": "Room {{n}}, pending",
  "CYCLE_TITLE": "Route closed",
  "CYCLE_TEXT": "All {{n}} rooms are connected in a loop — you can walk the whole property and come back to the start.",
  "CYCLE_TEXT_ONE": "The room is connected in a loop.",
  "CYCLE_NOTE": "↩ closes the loop at {{ambiente}}",
  "CONTINUE": "Continue",
  "EDIT_LINKS": "Edit connections",
  "ADVANCED": "Edit manually",
  "GUIDED_MODE": "Back to the assistant"
}
```

- [ ] **Step 2: Conferir que os dois arquivos têm as mesmas chaves**

Run (em `inner-view-client/`):

```bash
python -c "
import json
pt = json.load(open('src/assets/i18n/pt.json', encoding='utf-8'))['TOUR_WIZARD']['STEP2']['GUIDED']
en = json.load(open('src/assets/i18n/en.json', encoding='utf-8'))['TOUR_WIZARD']['STEP2']['GUIDED']
print('pt:', len(pt), 'en:', len(en))
print('so em pt:', sorted(set(pt) - set(en)))
print('so em en:', sorted(set(en) - set(pt)))
"
```

Expected: `pt: 19 en: 19`, e as duas listas de diferença vazias.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`

Expected: PASS. (Os testes comparam chaves, não texto — mas JSON quebrado derruba o build.)

- [ ] **Step 4: Commit**

```bash
git add inner-view-client/src/assets/i18n/
git commit -m "feat(client): textos do assistente guiado em pt e en"
```

---

### Task 11: o interruptor entre os dois modos

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/steps/step-hotspots/step-hotspots.component.{ts,html,scss}`
- Test: `inner-view-client/src/app/tour-wizard/steps/step-hotspots/step-hotspots.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `step-hotspots.component.spec.ts`, como um `describe` novo. **Não editar nenhum teste existente do arquivo.**

```ts
/**
 * A etapa 2 tem dois modos. O guiado é o padrão porque é o caminho que não tem
 * como dar errado; o livre continua inteiro, para quem tem percurso que não é
 * um ciclo.
 */
describe('StepHotspotsComponent — modos', () => {
  let draft: TourDraftStore;
  let fixture: ComponentFixture<StepHotspotsComponent>;

  function montar(cenas: WizardScene[]) {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    draft.scenes.set(cenas);
    draft.selectedSceneId.set(cenas[0]?.id ?? null);

    fixture = TestBed.createComponent(StepHotspotsComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function cena2(id: string): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready',
    };
  }

  it('abre no assistente guiado', () => {
    montar([cena2('sala'), cena2('cozinha')]);
    expect(el().querySelector('app-guided-hotspots')).not.toBeNull();
    expect(el().querySelector('app-free-hotspots')).toBeNull();
  });

  it('o link troca para o editor livre e de volta', () => {
    montar([cena2('sala'), cena2('cozinha')]);

    const link = el().querySelector('.tw-step2__modo') as HTMLButtonElement;
    link.click();
    fixture.detectChanges();
    expect(el().querySelector('app-free-hotspots')).not.toBeNull();

    (el().querySelector('.tw-step2__modo') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('app-guided-hotspots')).not.toBeNull();
  });

  // Com um ambiente só não há percurso a montar, e o assistente não teria o que
  // pedir. O editor livre continua servindo — é onde se vê a foto.
  it('com um ambiente so, abre no editor livre', () => {
    montar([cena2('sala')]);
    expect(el().querySelector('app-free-hotspots')).not.toBeNull();
    expect(el().querySelector('app-guided-hotspots')).toBeNull();
  });

  // Os avisos de ambiente ilhado são o problema que o assistente está no meio
  // de resolver. Mostrá-los durante o roteiro seria apontar o defeito para
  // quem está seguindo o passo a passo que o conserta.
  it('os avisos de grafo so aparecem no modo livre', () => {
    montar([cena2('sala'), cena2('cozinha')]);
    expect(el().querySelector('.tw-step2__bloqueio')).toBeNull();

    (el().querySelector('.tw-step2__modo') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('.tw-step2__bloqueio')).not.toBeNull();
  });
});
```

Se `provideIonicAngular` ou `WizardScene` não estiverem importados no topo, adicionar.

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/step-hotspots.component.spec.ts'`

Expected: FAIL — `app-guided-hotspots` não encontrado.

- [ ] **Step 3: Implementar o interruptor**

`step-hotspots.component.ts`:

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { FreeHotspotsComponent } from '../../hotspots/free/free-hotspots.component';
import { GuidedHotspotsComponent } from '../../hotspots/guided/guided-hotspots.component';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';

/**
 * Etapa 2 — pontos de navegação, em dois modos.
 *
 * O guiado é o padrão: um toque por foto, destino derivado da sequência, e o
 * ciclo fecha. O livre continua inteiro para quem tem percurso que não é um
 * ciclo — um corredor central com os cômodos pendurados nele, por exemplo.
 *
 * O `HotspotEditorStore` é fornecido AQUI, e não dentro de cada modo: os dois
 * compartilham a mesma instância, e trocar de modo não pode perder o estado de
 * edição no meio do caminho.
 */
@Component({
  selector: 'app-tour-step-hotspots',
  standalone: true,
  imports: [TranslatePipe, FreeHotspotsComponent, GuidedHotspotsComponent],
  providers: [HotspotEditorStore],
  templateUrl: './step-hotspots.component.html',
  styleUrls: ['./step-hotspots.component.scss'],
})
export class StepHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);

  /** O corretor pediu o editor livre. Efêmero: sair da etapa esquece. */
  private readonly pediuLivre = signal(false);

  /**
   * Com menos de dois ambientes o assistente não tem o que pedir — não há
   * próximo ambiente. O editor livre continua servindo: é onde se vê a foto.
   */
  readonly guiado = computed(
    () => !this.pediuLivre() && this.draft.readyScenes().length >= 2,
  );

  /** O link só faz sentido quando há os dois modos para alternar. */
  readonly podeAlternar = computed(() => this.draft.readyScenes().length >= 2);

  readonly ilhados = computed(() => this.nomes(this.draft.ambientesIlhados()));
  readonly becos = computed(() => this.nomes(this.draft.becosSemSaida()));

  alternarModo(): void {
    this.pediuLivre.update((v) => !v);
  }

  private nomes(cenas: readonly WizardScene[]): string {
    return cenas.map((s) => s.room.trim() || s.fileName).join(', ');
  }
}
```

`step-hotspots.component.html`:

```html
<header class="tw-step-head">
  <h2>{{ 'TOUR_WIZARD.STEP2.TITLE' | translate }}</h2>
  <p>
    {{
      (draft.etapa2Opcional()
        ? 'TOUR_WIZARD.STEP2.SUBTITLE_SOLO'
        : 'TOUR_WIZARD.STEP2.SUBTITLE'
      ) | translate
    }}
  </p>

  @if (podeAlternar()) {
    <button type="button" class="tw-step2__modo" (click)="alternarModo()">
      {{
        (guiado()
          ? 'TOUR_WIZARD.STEP2.GUIDED.ADVANCED'
          : 'TOUR_WIZARD.STEP2.GUIDED.GUIDED_MODE'
        ) | translate
      }}
    </button>
  }
</header>

@if (guiado()) {
  <app-guided-hotspots />
} @else {
  <!--
    Os avisos de grafo são o problema que o assistente está no meio de resolver:
    durante o roteiro eles apontariam o defeito para quem está seguindo o passo
    a passo que o conserta. No modo livre, ninguém mais avisa.
  -->
  @if (ilhados()) {
    <p class="tw-step2__bloqueio" role="alert">
      {{ 'TOUR_WIZARD.STEP2.UNREACHABLE' | translate: { ambientes: ilhados() } }}
    </p>
  } @else if (becos()) {
    <p class="tw-step2__aviso" role="status">
      {{ 'TOUR_WIZARD.STEP2.DEAD_END' | translate: { ambientes: becos() } }}
    </p>
  }

  <app-free-hotspots />
}
```

Adicionar ao fim de `step-hotspots.component.scss`:

```scss
/* Link discreto, mas alvo de toque cheio: quem procura o modo avançado sabe o
   que quer, e quem não procura não deve tropeçar nele. */
.tw-step2__modo {
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-color-primary);
  text-decoration: underline;
}
```

- [ ] **Step 4: Rodar a suíte da etapa e depois a inteira**

```bash
cd inner-view-client
npm test -- --watch=false --browsers=ChromeHeadless --include='**/step-hotspots.component.spec.ts'
npm test -- --watch=false --browsers=ChromeHeadless
```

Expected: PASS nas duas. Os testes antigos de `step-hotspots.component.spec.ts` montam a etapa e esperam o editor livre — **eles vão falhar agora**, porque o padrão virou o guiado. Este é o único ponto do plano em que editar testes existentes é correto: adicionar `draft` com uma cena só, ou clicar no link de modo, no `beforeEach` daqueles `describe`. Registrar no commit qual ajuste foi feito e por quê.

- [ ] **Step 5: Lint**

Run: `npm run lint`

Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/steps/step-hotspots/
git commit -m "feat(client): etapa 2 abre no assistente guiado, com o editor livre a um toque"
```

---

### Task 12: verificação em navegador e mutação

**Files:** nenhum arquivo de produção; o que sair daqui vira correção com teste.

- [ ] **Step 1: Subir o ambiente**

```bash
cd server-api && docker compose up -d && npm run start:dev
```

Em outro terminal:

```bash
cd inner-view-client && npx ng serve
```

- [ ] **Step 2: Percorrer a lista, com três ambientes de verdade**

Abrir `http://localhost:4200`, entrar, e criar um tour com **três** fotos 360°. Na etapa 2, conferir uma a uma:

1. A etapa abre no assistente, e a label diz `Passo 1 de 3 · {ambiente}`.
2. Arrastar gira o panorama e **não** cria passagem.
3. Um toque cria a passagem, e o botão primário libera.
4. **A passagem aparece na foto?** Se não aparecer nenhum pino, é a pendência registrada na Task 9 — decidir ali se o overlay ganha um `input` para receber só a passagem do passo. É mudança em `hotspot-overlay`, fora da lista de "não encostar": **parar e perguntar antes de fazer.**
5. Tocar de novo em outro ponto **move** a passagem; não aparece uma segunda.
6. "Refazer" some com a passagem e trava o botão.
7. Confirmar avança para o ambiente 2 **e a câmera volta ao ângulo inicial**.
8. No passo 3 o botão diz "Fechar percurso" e a instrução fala em voltar ao primeiro.
9. Fechar o percurso troca a gaveta pelo diagrama `A → B → C ↩`.
10. "Editar conexões" volta ao passo 1 **e o diagrama some**.
11. O link "Editar manualmente" leva ao editor livre com as três passagens já lá.
12. No editor livre, marcar um quarto ponto para outro destino; voltar ao assistente e conferir que ele **não** sumiu.
13. Publicar e abrir o `/embed`: os pinos aparecem escritos com o nome do ambiente de destino, sem ninguém ter digitado nome nenhum.

- [ ] **Step 3: Mutação — provar que os testes seguram**

Uma de cada vez, aplicar a mutação, rodar a suíte, conferir que falha, e **desfazer**:

| Mutação | Arquivo | Deve quebrar |
|---|---|---|
| `(i + 1) % total` → `i % total` | `guided-route.ts` | `passoDoRoteiro` (o passo aponta para si mesmo) |
| `h.target === alvoId` → `h.target !== null` | `guided-route.ts` | `passagemDoPasso` ignora pontos de outro destino |
| remover o `if (passo.hotspot)` de `marcar` | `guided-route.store.ts` | "marcar de novo MOVE a passagem" |
| `passo.isLast &&` → só `cicloFechado(...)` | `guided-route.store.ts` | "confirmar um passo do meio nao devolve o resumo" |
| remover o `if (this.guided.resumo()) return` | `guided-hotspots.component.ts` | "com o diagrama aberto, o toque na foto nao marca nada" |

Run a cada mutação: `npm test -- --watch=false --browsers=ChromeHeadless`

Expected: exatamente o teste da coluna direita falha. Se algum passar com a mutação aplicada, o teste não está segurando nada — escrever o que falta antes de seguir.

- [ ] **Step 4: Suíte inteira e lint limpos**

```bash
cd inner-view-client
npm test -- --watch=false --browsers=ChromeHeadless
npm run lint
```

Expected: PASS e sem erros.

- [ ] **Step 5: Conferir que os arquivos ficaram CRLF**

```bash
cd inner-view-client
python -c "
import glob
ruins = []
for f in glob.glob('src/app/tour-wizard/hotspots/**/*.*', recursive=True):
    b = open(f, 'rb').read()
    if b.replace(b'\r\n', b'').count(b'\n'):
        ruins.append(f)
print('LF solto em:', ruins or 'nenhum')
"
```

Expected: `LF solto em: nenhum`

- [ ] **Step 6: Commit do que a verificação corrigiu**

```bash
git add -A
git commit -m "fix(client): ajustes do assistente guiado vindos da verificacao em navegador"
```

(Se a verificação não achou nada, não há commit — e isso é resultado, não ausência de trabalho.)

---

## Cobertura da spec

| Seção da spec | Task |
|---|---|
| §1 Guiado é o padrão, livre continua | 5, 11 |
| §2 Passo derivado de `selectedSceneId` | 4 |
| §3 Adota o que existe, nunca apaga | 1 (`passagemDoPasso`), 4 (`marcar`, `refazer`) |
| §4 Destino derivado, nunca perguntado | 4 (`marcar`) |
| §5 Percurso de mão única | 1 (`(i+1) % N`) |
| §6 Conclusão na gaveta | 8, 9 |
| §7 Abre no primeiro passo incompleto | 1 (`primeiroPassoIncompleto`), 4 (`abrir`) |
| §8 Reset da câmera | 3, 9 (o `effect`) |
| §9 Tokens em vez de hex | 2, 6, 7, 8, 9 |
| §10 Sem segundo detector de gesto | 9 (usa `hotspotPlaced` do viewer) |
| §11 Clamp vertical do projeto | 4 (`editor.add`/`update` já aplicam `clampV`) |
| i18n | 10 |
| Acessibilidade | 6 (`role="status"`), 7 (dots com rótulo), 11 (botões de verdade) |
| Testes e mutação | 1, 4, 9, 12 |

## Pendências conhecidas, a decidir durante a execução

1. **O pino sobre a foto no modo guiado** (Task 9, Step 3; Task 12, Step 2 item 4). Reusar `HotspotOverlayComponent` mostraria todos os pontos do ambiente, não só a passagem do passo. Resolver exige um `input` novo no overlay, que está fora da lista de "não encostar" — **parar e perguntar.**
2. **Os testes antigos de `step-hotspots.component.spec.ts`** (Task 11, Step 4). São o único lugar do plano onde editar teste existente é correto, porque o padrão da etapa mudou de propósito.
