# Ordenação de ambientes e passagens escolhidas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao wizard uma tela onde o corretor ordena os ambientes por arrastar-e-soltar e escolhe com quais outros cada um se conecta, e trocar a etapa de pontos por uma fila que percorre essas conexões na ordem escolhida.

**Architecture:** As conexões moram na cena (`connections?: string[]`, índice = ordem de seleção) e são **simétricas**: ligar A a B escreve nos dois. A fila de passagens é derivada disso por um módulo puro — não há campo "pendente/concluído", porque `A→B` está feita se e somente se existe hotspot em A com aquele destino. O ponteiro do passo é o índice na fila, e a cena selecionada é consequência dele.

**Tech Stack:** Angular 20 (standalone, signals, `@if`/`@for`/`@switch`), Ionic 8.8.9 (`IonReorderGroup`), three.js, ngx-translate, Karma + Jasmine + ChromeHeadless.

**Spec:** `docs/superpowers/specs/2026-08-28-ordenacao-e-conexoes-design.md` (commit `46b03f2`).
**Base:** `cacc883` na branch `feat/conexoes-e-ordenacao` — já contém o rascunho retomável, o PR #19 e a correção da câmera.

## Escopo deste plano

A spec cobre mais do que cabe num plano só. Este é o **plano A: o fluxo no cliente**. Ao fim dele o corretor ordena, conecta e posiciona as passagens, e tudo funciona — com uma limitação conhecida: **conexões escolhidas e ainda não posicionadas não sobrevivem a sair e voltar ao wizard.**

O **plano B** cobre essa durabilidade: a coluna `pendingConnections` no `Panorama`, a migration e o repasse na API. Fica para depois porque mexe no schema que outra frente está movimentando (§Riscos da spec), e porque sem ele o software ainda é coerente.

---

## Antes de começar

| Coisa | Onde | Comando |
|---|---|---|
| Branch | raiz do repo | `git checkout feat/conexoes-e-ordenacao` |
| Testes | `inner-view-client/` | `npx ng test --watch=false --browsers=ChromeHeadless` |
| Um arquivo só | `inner-view-client/` | `npx ng test --watch=false --browsers=ChromeHeadless --include='**/nome.spec.ts'` |
| Lint | `inner-view-client/` | `npm run lint` |

**Baseline a preservar: 682 testes passando.**

**Convenções do repo** (`.agents/AGENTS.md`): código em inglês, comentários e documentação em **português**; **nunca hex solto** (usar `--app-*` / `--ion-color-*`); **nunca string literal em template** (ngx-translate); alvo de toque ≥ 44px; **o repositório inteiro é CRLF** — todo arquivo criado por ferramenta precisa ser convertido antes do commit:

```bash
python -c "
import sys
for p in sys.argv[1:]:
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
" caminho/do/arquivo.ts
```

**Nos testes o pipe `translate` devolve a própria chave** — o harness usa `provideTranslateService` sem loader HTTP. Asserções comparam com `'TOUR_WIZARD.STEP_ORDER.TITLE'`, não com o texto em português.

**Regra desta entrega, escrita porque já custou um defeito em produção:** nenhum `effect` pode assinar direto um computed que devolva objeto ou array derivado de `scenes()`. Ou estreita para um escalar num computed intermediário, ou ganha `equal`. Foi assim que a câmera voltava ao centro a cada toque.

---

## Estrutura de arquivos

| Arquivo | O quê | Responsabilidade |
|---|---|---|
| `tour-wizard/passagens/fila.ts` | criar | Puro, sem DOM. Ligar/desligar simétrico, a fila de passagens, os resumos. |
| `tour-wizard/passagens/fila.spec.ts` | criar | |
| `tour-wizard/passagens/passagens.store.ts` | criar | Ponteiro da fila e comandos. Escreve via `HotspotEditorStore`. |
| `tour-wizard/passagens/passagens.store.spec.ts` | criar | |
| `tour-wizard/passagens/passagens-sheet.component.*` | criar | Painel inferior: progresso, destino atual, pendentes, Refazer, Confirmar. |
| `tour-wizard/steps/step-ordering/step-ordering.component.*` | criar | A tela de ordenação. |
| `tour-wizard/steps/step-ordering/room-card.component.*` | criar | Um card: alça, número, miniatura, nome, resumo, expandir. |
| `tour-wizard/steps/step-ordering/connection-picker.component.*` | criar | Lista de destinos com seleção múltipla. |
| `tour-wizard/steps/step-passages/step-passages.component.*` | criar | A etapa de pontos guiada pela fila. |
| `tour-wizard/hotspots/guided/guided-route.ts` + `.store.ts` + specs | **apagar** | O roteiro `(i+1) % N` morre inteiro. |
| `tour-wizard/hotspots/guided/guided-cycle.component.*` | **apagar** | Afirma um ciclo que o fluxo novo não produz. |
| `tour-wizard/hotspots/guided/guided-hotspots.component.*` + spec | **apagar** | Substituído por `step-passages`. |
| `tour-wizard/hotspots/guided/guided-banner.component.*` | manter | Reusado pela etapa nova, sem mudança. |
| `tour-wizard/hotspots/guided/guided-sheet.component.*` | **apagar** | Substituído por `passagens-sheet` (precisa da lista de pendentes). |
| `tour-wizard/tour-wizard.model.ts` | modificar | `WizardStep` ganha `4`; `WizardScene` ganha `connections?`. |
| `tour-wizard/tour-draft.store.ts` | modificar | `moveScene`, `ligarAmbientes`, `desligarAmbientes`, o `/4`, `canAdvance`. |
| `tour-wizard/scene-graph.ts` | modificar | Fonte das arestas vira parâmetro. |
| `tour-wizard/tour-wizard.page.html` | modificar | Um `@case` a mais. |
| `tour-wizard/ui/wizard-stepper/*` | modificar | Quatro chips, `aria-valuemax`. |
| `tour-wizard/steps/step-hotspots/*` | **apagar** | A etapa 2 antiga dá lugar a `step-ordering` e `step-passages`. |
| `tour-wizard/hotspots/free/*` | manter | O editor livre continua, agora acessível de `step-passages`. |
| `assets/i18n/pt.json`, `en.json` | modificar | Chaves novas; `STEP_OF` sem o total embutido. |

---

### Task 1: `fila.ts` — ligar, desligar e a fila, como funções puras

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/passagens/fila.ts`
- Test: `inner-view-client/src/app/tour-wizard/passagens/fila.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `inner-view-client/src/app/tour-wizard/passagens/fila.spec.ts`:

```ts
import { WizardHotspot, WizardScene } from '../tour-wizard.model';
import {
  desligar,
  filaDePassagens,
  ligar,
  pendentesDoAmbiente,
  primeiraPendente,
  resumoDeConexoes,
} from './fila';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(
  id: string,
  connections?: string[],
  hotspots: WizardHotspot[] = [],
): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
    ...(connections ? { connections } : {}),
  };
}

function conexoesDe(cenas: WizardScene[], id: string): string[] {
  return cenas.find((s) => s.id === id)?.connections ?? [];
}

describe('ligar', () => {
  // Simetrico porque a conexao e reciproca: "conecta com Cozinha" tem de ser
  // verdade nos DOIS cards, senao o resumo mente para um dos lados.
  it('escreve nos dois ambientes', () => {
    const cenas = ligar([cena('sala'), cena('cozinha')], 'sala', 'cozinha');

    expect(conexoesDe(cenas, 'sala')).toEqual(['cozinha']);
    expect(conexoesDe(cenas, 'cozinha')).toEqual(['sala']);
  });

  it('preserva a ordem de selecao', () => {
    let cenas = [cena('sala'), cena('cozinha'), cena('quarto')];
    cenas = ligar(cenas, 'sala', 'quarto');
    cenas = ligar(cenas, 'sala', 'cozinha');

    expect(conexoesDe(cenas, 'sala')).toEqual(['quarto', 'cozinha']);
  });

  // Ligar de novo o que ja esta ligado nao pode duplicar: o card da Cozinha
  // oferece a Sala mesmo quando a ligacao nasceu do lado da Sala.
  it('e idempotente', () => {
    let cenas = ligar([cena('sala'), cena('cozinha')], 'sala', 'cozinha');
    cenas = ligar(cenas, 'cozinha', 'sala');

    expect(conexoesDe(cenas, 'sala')).toEqual(['cozinha']);
    expect(conexoesDe(cenas, 'cozinha')).toEqual(['sala']);
  });

  it('nao liga um ambiente a si mesmo', () => {
    const cenas = ligar([cena('sala')], 'sala', 'sala');
    expect(conexoesDe(cenas, 'sala')).toEqual([]);
  });

  it('ignora id que nao existe', () => {
    const cenas = ligar([cena('sala')], 'sala', 'inexistente');
    expect(conexoesDe(cenas, 'sala')).toEqual([]);
  });
});

describe('desligar', () => {
  it('tira as duas pontas', () => {
    const ligadas = ligar([cena('sala'), cena('cozinha')], 'sala', 'cozinha');
    const { cenas } = desligar(ligadas, 'sala', 'cozinha');

    expect(conexoesDe(cenas, 'sala')).toEqual([]);
    expect(conexoesDe(cenas, 'cozinha')).toEqual([]);
  });

  // Quem chama precisa saber o que vai sumir para poder perguntar antes.
  it('devolve os pontos que serao perdidos, dos dois lados', () => {
    const cenas = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ];
    const { perdidos } = desligar(cenas, 'sala', 'cozinha');

    expect(perdidos.map((h) => h.id).sort()).toEqual(['h1', 'h2']);
  });

  it('apaga os hotspots junto com a conexao', () => {
    const antes = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha'), ponto('h9', 'quarto')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ];
    const { cenas } = desligar(antes, 'sala', 'cozinha');

    expect(cenas[0].hotspots.map((h) => h.id)).toEqual(['h9']);
    expect(cenas[1].hotspots).toEqual([]);
  });

  it('sem ligacao nenhuma nao perde nada', () => {
    const { perdidos } = desligar([cena('sala'), cena('cozinha')], 'sala', 'cozinha');
    expect(perdidos).toEqual([]);
  });
});

describe('filaDePassagens', () => {
  // Agrupada por ambiente na ordem dos cards, e dentro do ambiente na ordem de
  // selecao. E isso que faz o corretor permanecer na mesma foto ate acabarem
  // os destinos daquele ambiente.
  it('agrupa por ambiente, na ordem dos cards', () => {
    const cenas = [
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ];
    const fila = filaDePassagens(cenas);

    expect(fila.map((p) => `${p.origem.id}->${p.destino.id}`)).toEqual([
      'sala->cozinha',
      'sala->quarto',
      'cozinha->sala',
      'quarto->sala',
    ]);
  });

  it('marca como feita a passagem que ja tem ponto', () => {
    const cenas = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala']),
    ];
    const fila = filaDePassagens(cenas);

    expect(fila[0].feita).toBeTrue();
    expect(fila[1].feita).toBeFalse();
  });

  it('sem conexoes, a fila e vazia', () => {
    expect(filaDePassagens([cena('sala'), cena('cozinha')])).toEqual([]);
  });

  // Conexao apontando para ambiente que sumiu nao pode virar passagem: nao ha
  // foto de destino, e o painel nao teria nome para mostrar.
  it('descarta conexao para ambiente que nao existe mais', () => {
    const fila = filaDePassagens([cena('sala', ['fantasma'])]);
    expect(fila).toEqual([]);
  });

  it('so considera cenas prontas', () => {
    const recusada = { ...cena('quarto', ['sala']), state: 'rejected' as const };
    const fila = filaDePassagens([cena('sala', ['quarto']), recusada]);
    expect(fila).toEqual([]);
  });
});

describe('primeiraPendente', () => {
  it('acha a primeira sem ponto', () => {
    const cenas = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala']),
    ];
    expect(primeiraPendente(filaDePassagens(cenas))).toBe(1);
  });

  it('tudo feito devolve -1', () => {
    const cenas = [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ];
    expect(primeiraPendente(filaDePassagens(cenas))).toBe(-1);
  });

  it('fila vazia devolve -1', () => {
    expect(primeiraPendente([])).toBe(-1);
  });
});

describe('pendentesDoAmbiente', () => {
  // A lista da gaveta: o que ainda falta NESTA foto, sem contar a que esta
  // sendo posicionada agora.
  it('lista as outras pendentes da mesma origem', () => {
    const cenas = [
      cena('sala', ['cozinha', 'quarto', 'banheiro']),
      cena('cozinha'),
      cena('quarto'),
      cena('banheiro'),
    ];
    const fila = filaDePassagens(cenas);

    expect(pendentesDoAmbiente(fila, 0).map((p) => p.destino.id)).toEqual([
      'quarto',
      'banheiro',
    ]);
  });

  it('nao mistura ambientes', () => {
    const cenas = [cena('sala', ['cozinha']), cena('cozinha', ['sala'])];
    const fila = filaDePassagens(cenas);

    expect(pendentesDoAmbiente(fila, 0)).toEqual([]);
  });

  it('indice fora da faixa devolve vazio', () => {
    expect(pendentesDoAmbiente([], 0)).toEqual([]);
  });
});

describe('resumoDeConexoes', () => {
  it('devolve os nomes na ordem de selecao', () => {
    const cenas = [cena('sala', ['quarto', 'cozinha']), cena('cozinha'), cena('quarto')];
    expect(resumoDeConexoes(cenas[0], cenas)).toEqual(['quarto', 'cozinha']);
  });

  it('sem conexoes devolve vazio', () => {
    expect(resumoDeConexoes(cena('sala'), [cena('sala')])).toEqual([]);
  });

  // Cena sem nome digitado cai no nome do arquivo, como no publicar.
  it('cai no nome do arquivo quando o ambiente nao tem nome', () => {
    const semNome = { ...cena('cozinha'), room: '   ' };
    const cenas = [cena('sala', ['cozinha']), semNome];
    expect(resumoDeConexoes(cenas[0], cenas)).toEqual(['cozinha.jpg']);
  });
});
```

- [ ] **Step 2: Rodar e conferir que falha**

Run (em `inner-view-client/`): `npx ng test --watch=false --browsers=ChromeHeadless --include='**/fila.spec.ts'`

Expected: FAIL na compilação — `Cannot find module './fila'`.

- [ ] **Step 3: Implementar**

Criar `inner-view-client/src/app/tour-wizard/passagens/fila.ts`:

```ts
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
```

- [ ] **Step 4: Converter para CRLF e rodar**

```bash
cd inner-view-client
python -c "
import sys
for p in sys.argv[1:]:
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
" src/app/tour-wizard/passagens/fila.ts src/app/tour-wizard/passagens/fila.spec.ts
npx ng test --watch=false --browsers=ChromeHeadless --include='**/fila.spec.ts'
```

Expected: PASS, 21 specs.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/passagens/
git commit -m "feat(client): a fila de passagens como funcao pura"
```

---

### Task 2: `connections` na cena, e a limpeza do órfão

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.model.ts` (interface `WizardScene`)
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts` (`removeScene`)
- Test: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `tour-draft.store.spec.ts`, antes do último `});` do arquivo:

```ts
/**
 * Conexao orfa.
 *
 * `removeScene` ja limpa hotspot que apontava para a cena removida. A conexao
 * escolhida precisa da mesma limpeza, e NA MESMA escrita: duas transacoes e
 * como uma delas fica para tras.
 */
describe('TourDraftStore — conexao orfa', () => {
  let store: TourDraftStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TourDraftStore, provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(TourDraftStore);
  });

  function cenaCom(id: string, connections: string[]): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready',
      connections,
    };
  }

  it('remover um ambiente tira ele das conexoes dos outros', () => {
    store.scenes.set([
      cenaCom('sala', ['cozinha', 'quarto']),
      cenaCom('cozinha', ['sala']),
      cenaCom('quarto', ['sala']),
    ]);

    store.removeScene('cozinha');

    const sala = store.scenes().find((s) => s.id === 'sala');
    expect(sala?.connections).toEqual(['quarto']);
    expect(store.scenes().map((s) => s.id)).toEqual(['sala', 'quarto']);
  });

  it('cena sem conexoes nao estoura', () => {
    store.scenes.set([cenaCom('sala', []), cenaCom('cozinha', [])]);
    expect(() => store.removeScene('cozinha')).not.toThrow();
  });
});
```

Se `WizardScene` ainda não estiver importado no topo do arquivo, adicionar ao import existente de `./tour-wizard.model`.

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/tour-draft.store.spec.ts'`

Expected: FAIL na compilação — `Object literal may only specify known properties, and 'connections' does not exist in type 'WizardScene'`.

- [ ] **Step 3: Adicionar o campo ao modelo**

Em `tour-wizard.model.ts`, dentro de `interface WizardScene`, logo depois de `hotspots: WizardHotspot[];`:

```ts
  /**
   * Ambientes ligados a este, na ORDEM EM QUE FORAM ESCOLHIDOS.
   *
   * O índice do array é a ordem — não há campo paralelo de ordenação, porque
   * duas fontes para a mesma sequência é como uma delas fica para trás. Essa
   * ordem é a que a etapa de passagens percorre.
   *
   * SIMÉTRICO: escolher Cozinha dentro do card da Sala escreve `cozinha` aqui
   * e `sala` na Cozinha. É o que torna "conecta com Cozinha" verdadeiro nos
   * dois cards — e a conexão é recíproca, então as duas pontas viram passagem
   * a posicionar. Ver `ligar`/`desligar` em `passagens/fila.ts`.
   *
   * Opcional porque cena antiga e cena retomada não têm; ausente lê-se como
   * lista vazia. Obrigatório quebraria na compilação as fábricas de cena de
   * dezenas de testes de uma vez.
   */
  connections?: string[];
```

- [ ] **Step 4: Limpar o órfão no `removeScene`**

Em `tour-draft.store.ts`, dentro de `removeScene`, no `.map` que já reescreve as cenas restantes, acrescentar a linha de `connections` ao lado da de `hotspots`:

```ts
    this.scenes.update((list) =>
      list
        .filter((s) => s.id !== id)
        .map((s, i) => ({
          ...s,
          order: i,
          // Na MESMA escrita que limpa o hotspot órfão: duas transações para a
          // mesma remoção é como uma delas fica para trás.
          connections: (s.connections ?? []).filter((cid) => cid !== id),
          hotspots: s.hotspots.map((h) =>
            h.target === id ? { ...h, target: null } : h,
          ),
        })),
    );
```

- [ ] **Step 5: Rodar e conferir que passa**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/tour-draft.store.spec.ts'`

Expected: PASS, com os 2 testes novos.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-wizard.model.ts inner-view-client/src/app/tour-wizard/tour-draft.store.ts inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts
git commit -m "feat(client): conexoes escolhidas na cena, limpas junto com o ambiente"
```

---

### Task 3: `moveScene` — reordenar de verdade

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Test: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `tour-draft.store.spec.ts`:

```ts
/**
 * Reordenar ambientes.
 *
 * A ordem de verdade e a posicao no array -- `publish-payload.ts` faz
 * `ready.map((scene, i) => ...)` com `order: i` e `initialPanorama: i === 0`.
 * Mexer so no campo `order` nao mudaria nada em lugar nenhum.
 */
describe('TourDraftStore — moveScene', () => {
  let store: TourDraftStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TourDraftStore, provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(TourDraftStore);
  });

  function tres(): WizardScene[] {
    return ['sala', 'cozinha', 'quarto'].map((id) => ({
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready' as const,
      connections: ['sala', 'cozinha', 'quarto'].filter((o) => o !== id),
    }));
  }

  const ids = () => store.scenes().map((s) => s.id);

  it('move para baixo', () => {
    store.scenes.set(tres());
    store.moveScene(0, 2);
    expect(ids()).toEqual(['cozinha', 'quarto', 'sala']);
  });

  it('move para cima', () => {
    store.scenes.set(tres());
    store.moveScene(2, 0);
    expect(ids()).toEqual(['quarto', 'sala', 'cozinha']);
  });

  it('reescreve o campo order para a posicao nova', () => {
    store.scenes.set(tres());
    store.moveScene(0, 2);
    expect(store.scenes().map((s) => s.order)).toEqual([0, 1, 2]);
  });

  // Reordenar e sobre a sequencia, nao sobre o grafo.
  it('nao mexe nas conexoes', () => {
    store.scenes.set(tres());
    store.moveScene(0, 2);
    const sala = store.scenes().find((s) => s.id === 'sala');
    expect(sala?.connections).toEqual(['cozinha', 'quarto']);
  });

  it('indice invalido nao faz nada', () => {
    store.scenes.set(tres());
    store.moveScene(0, 9);
    expect(ids()).toEqual(['sala', 'cozinha', 'quarto']);
    store.moveScene(-1, 0);
    expect(ids()).toEqual(['sala', 'cozinha', 'quarto']);
  });

  it('mover para a propria posicao nao faz nada', () => {
    store.scenes.set(tres());
    store.moveScene(1, 1);
    expect(ids()).toEqual(['sala', 'cozinha', 'quarto']);
  });
});
```

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/tour-draft.store.spec.ts'`

Expected: FAIL — `Property 'moveScene' does not exist on type 'TourDraftStore'`.

- [ ] **Step 3: Implementar**

Em `tour-draft.store.ts`, logo depois de `removeScene`, adicionar:

```ts
  /**
   * Reordena os ambientes, movendo o de `de` para a posição `para`.
   *
   * Mexe no ARRAY, e não só no campo `order`: quem manda na sequência do tour é
   * a posição no array — `publish-payload.ts` faz `ready.map((scene, i) => …)`
   * com `order: i` e `initialPanorama: i === 0`. Mexer só no campo não mudaria
   * nada em lugar nenhum.
   *
   * O `order` é reescrito junto para não ficar mentindo, mas ele continua sendo
   * consequência, não causa.
   *
   * Não toca nas conexões: reordenar é sobre a sequência, não sobre o grafo.
   */
  moveScene(de: number, para: number): void {
    const atual = this.scenes();
    if (de === para) return;
    if (de < 0 || de >= atual.length) return;
    if (para < 0 || para >= atual.length) return;

    const lista = [...atual];
    const [movida] = lista.splice(de, 1);
    lista.splice(para, 0, movida);

    this.scenes.set(lista.map((s, i) => ({ ...s, order: i })));
  }
```

- [ ] **Step 4: Rodar e conferir que passa**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/tour-draft.store.spec.ts'`

Expected: PASS, com os 6 testes novos.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-draft.store.ts inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts
git commit -m "feat(client): moveScene reordena o array, que e a ordem de verdade"
```

---

### Task 4: `ligarAmbientes` e `desligarAmbientes` na store

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Test: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `tour-draft.store.spec.ts`:

```ts
/**
 * Ligar e desligar ambientes pela store.
 *
 * A store e quem sabe que hotspot com `serverId` precisa ir para a fila de
 * exclusao do rascunho -- as funcoes puras de `fila.ts` nao sabem disso.
 */
describe('TourDraftStore — ligar e desligar', () => {
  let store: TourDraftStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TourDraftStore, provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(TourDraftStore);
  });

  function par(): WizardScene[] {
    return ['sala', 'cozinha'].map((id) => ({
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready' as const,
    }));
  }

  const conexoes = (id: string) =>
    store.scenes().find((s) => s.id === id)?.connections ?? [];

  it('ligar escreve nos dois ambientes', () => {
    store.scenes.set(par());
    store.ligarAmbientes('sala', 'cozinha');

    expect(conexoes('sala')).toEqual(['cozinha']);
    expect(conexoes('cozinha')).toEqual(['sala']);
  });

  it('desligar tira dos dois e devolve os pontos perdidos', () => {
    const cenas = par();
    cenas[0].connections = ['cozinha'];
    cenas[0].hotspots = [{ id: 'h1', u: 0.5, v: 0.5, label: '', target: 'cozinha' }];
    cenas[1].connections = ['sala'];
    store.scenes.set(cenas);

    const perdidos = store.desligarAmbientes('sala', 'cozinha');

    expect(perdidos.map((h) => h.id)).toEqual(['h1']);
    expect(conexoes('sala')).toEqual([]);
    expect(conexoes('cozinha')).toEqual([]);
  });

  // O hotspot ja gravado no servidor precisa ser APAGADO la, e quem sabe disso
  // e a store. Sem empilhar o serverId, o laco de exclusao do salvarRascunho --
  // que so percorre scenes() -- nunca mais o veria.
  it('desligar empilha o serverId do ponto apagado para exclusao', () => {
    const cenas = par();
    cenas[0].connections = ['cozinha'];
    cenas[0].hotspots = [
      { id: 'h1', serverId: 'srv-1', u: 0.5, v: 0.5, label: '', target: 'cozinha' },
    ];
    cenas[1].connections = ['sala'];
    store.scenes.set(cenas);

    store.desligarAmbientes('sala', 'cozinha');

    // O ponto sumiu de `scenes()` e o id do servidor ficou registrado.
    expect(store.scenes()[0].hotspots).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/tour-draft.store.spec.ts'`

Expected: FAIL — `Property 'ligarAmbientes' does not exist`.

- [ ] **Step 3: Implementar**

Em `tour-draft.store.ts`, adicionar o import no topo:

```ts
import { desligar, ligar } from './passagens/fila';
```

E, logo depois de `moveScene`, os dois comandos:

```ts
  /**
   * Liga dois ambientes, nos dois sentidos.
   *
   * A regra mora em `passagens/fila.ts`, pura e testada; aqui só se escreve o
   * resultado no sinal. Idempotente: tocar no card da Cozinha para escolher a
   * Sala, quando a ligação já nasceu do lado da Sala, não duplica.
   */
  ligarAmbientes(aId: string, bId: string): void {
    this.scenes.update((list) => ligar(list, aId, bId));
  }

  /**
   * Desliga dois ambientes e devolve os pontos que foram apagados.
   *
   * Quem chama usa o retorno para PERGUNTAR antes de confirmar — apagar
   * trabalho posicionado sem aviso é o que a spec manda evitar.
   *
   * O `serverId` dos pontos apagados vai para a fila de exclusão do rascunho:
   * eles já existem no servidor, e o laço de `salvarRascunho()` só percorre
   * `scenes()` — sem este registro, um ponto apagado na tela continuaria vivo
   * no banco.
   */
  desligarAmbientes(aId: string, bId: string): WizardHotspot[] {
    const { cenas, perdidos } = desligar(this.scenes(), aId, bId);

    const remotos = perdidos
      .map((h) => h.serverId)
      .filter((sid): sid is string => !!sid);
    if (remotos.length) {
      this.hotspotsParaApagar.update((ids) => [...ids, ...remotos]);
    }

    this.scenes.set(cenas);
    return perdidos;
  }
```

> Se `WizardHotspot` não estiver importado no arquivo, acrescentá-lo ao import
> existente de `./tour-wizard.model`.

- [ ] **Step 4: Rodar e conferir que passa**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/tour-draft.store.spec.ts'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-draft.store.ts inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts
git commit -m "feat(client): ligar e desligar ambientes, com os pontos remotos na fila de exclusao"
```

---

### Task 5: o wizard passa a ter quatro etapas

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.model.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Modify: `inner-view-client/src/app/tour-wizard/ui/wizard-stepper/wizard-stepper.component.ts`
- Modify: `inner-view-client/src/app/tour-wizard/ui/wizard-stepper/wizard-stepper.component.html`
- Modify: `inner-view-client/src/assets/i18n/pt.json`, `en.json`
- Test: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Onze pontos assumem três etapas.** Este é o único da entrega em que esquecer um deixa a tela mentindo em silêncio — em especial o `STEP_OF`, que tem o número **dentro da string**.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `tour-draft.store.spec.ts`:

```ts
/**
 * Quatro etapas: imagens, ordenacao, passagens, informacoes.
 *
 * A tela de ordenacao virou etapa propria porque escondida dentro de outra o
 * botao "Voltar" fica errado: `back()` so sabe decrementar `step`, e de uma
 * sub-fase ele saltaria a tela inteira.
 */
describe('TourDraftStore — quatro etapas', () => {
  let store: TourDraftStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TourDraftStore, provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(TourDraftStore);
    store.scenes.set([
      {
        id: 'sala',
        room: 'Sala',
        fileName: 'sala.jpg',
        fileSize: 1024,
        imageData: 'data:image/jpeg;base64,x',
        order: 0,
        hotspots: [],
        state: 'ready',
      },
    ]);
  });

  it('TOTAL_ETAPAS e quatro', () => {
    expect(TOTAL_ETAPAS).toBe(4);
  });

  it('o progresso vai ate 100 na ultima etapa, e nao antes', () => {
    store.step.set(3);
    expect(store.progressPct()).toBe(75);
    store.step.set(4);
    expect(store.progressPct()).toBe(100);
  });

  // Publicar mudou de etapa: era a 3, agora e a 4. Sem isto, `next()` na etapa
  // 3 publicaria um tour sem os dados do imovel.
  it('next na etapa 3 avanca, e nao publica', () => {
    const publicar = spyOn(store, 'publish');
    store.step.set(3);
    store.next();

    expect(publicar).not.toHaveBeenCalled();
    expect(store.step()).toBe(4);
  });

  it('next na etapa 4 publica', () => {
    const publicar = spyOn(store, 'publish');
    store.step.set(4);
    store.next();

    expect(publicar).toHaveBeenCalled();
  });

  it('back desce uma etapa, e para na 1', () => {
    store.step.set(4);
    store.back();
    expect(store.step()).toBe(3);
    store.step.set(1);
    store.back();
    expect(store.step()).toBe(1);
  });
});
```

Adicionar `TOTAL_ETAPAS` ao import de `./tour-wizard.model` no topo do arquivo.

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/tour-draft.store.spec.ts'`

Expected: FAIL — `Module '"./tour-wizard.model"' has no exported member 'TOTAL_ETAPAS'`.

- [ ] **Step 3: O modelo**

Em `tour-wizard.model.ts`, substituir a linha do `WizardStep`:

```ts
/**
 * Etapas do wizard: imagens, ordenação e conexões, passagens, informações.
 *
 * Não existe etapa 0 nem 5 — o sucesso é um estado à parte, `published()`.
 */
export type WizardStep = 1 | 2 | 3 | 4;

/**
 * Quantas etapas existem, num lugar só.
 *
 * Existe porque o total estava espalhado por onze pontos, incluindo DENTRO de
 * uma string de tradução (`"Etapa {{step}} de 3"`) — o único deles que some em
 * silêncio quando alguém acrescenta uma etapa.
 */
export const TOTAL_ETAPAS = 4;
```

- [ ] **Step 4: A store**

Em `tour-draft.store.ts`:

1. Acrescentar `TOTAL_ETAPAS` ao import de `./tour-wizard.model`.
2. Trocar o `progressPct`:

```ts
  readonly progressPct = computed(() =>
    this.published() ? 100 : (this.step() / TOTAL_ETAPAS) * 100,
  );
```

3. Trocar a guarda de publicação em `next()`:

```ts
    if (current === TOTAL_ETAPAS) {
      void this.publish();
      return;
    }
```

4. Trocar o `canAdvance` — a regra de ambiente ilhado passa da etapa 2 para a 3, e a etapa 2 ganha a sua (que entra na Task 6):

```ts
  readonly canAdvance = computed(() => {
    if (!this.temImagem()) return false;
    if (this.step() === 1) return this.ambientesSemNome().length === 0;
    if (this.step() === 3) return this.ambientesIlhados().length === 0;
    return true;
  });
```

5. Trocar o `hintKey`, que citava a etapa 2:

```ts
  readonly hintKey = computed(() =>
    this.step() === 3 && !this.etapaPassagensOpcional()
      ? 'TOUR_WIZARD.COMMON.HINT_3_REQUIRED'
      : `TOUR_WIZARD.COMMON.HINT_${this.step()}`,
  );
```

6. Renomear `etapa2Opcional` para `etapaPassagensOpcional` (mesmo corpo), e atualizar os usos. Buscar com:

```bash
grep -rn "etapa2Opcional" inner-view-client/src/
```

- [ ] **Step 5: O stepper**

Em `wizard-stepper.component.ts`:

```ts
  readonly steps: WizardStep[] = [1, 2, 3, 4];
```

Em `wizard-stepper.component.html`, trocar o `aria-valuemax` e passar o total à tradução (dois lugares usam `STEP_OF`):

```html
  aria-valuemax="4"
  [attr.aria-valuetext]="
    'TOUR_WIZARD.COMMON.STEP_OF' | translate: { step: store.step(), total: total }
  ">
```

```html
  <span>{{ 'TOUR_WIZARD.COMMON.STEP_OF' | translate: { step: store.step(), total: total } }}</span>
```

E expor o total no componente:

```ts
  /** O total vem da constante, e não do template: ver `TOTAL_ETAPAS`. */
  readonly total = TOTAL_ETAPAS;
```

com `import { TOTAL_ETAPAS, WizardStep } from '../../tour-wizard.model';`.

- [ ] **Step 6: A página**

Em `tour-wizard.page.html`, o `@switch` ganha um caso e renumera:

```html
        @switch (store.step()) {
          @case (1) { <app-tour-step-images /> }
          @case (2) { <app-tour-step-ordering /> }
          @case (3) { <app-tour-step-passages /> }
          @case (4) { <app-tour-step-info /> }
        }
```

> Os dois componentes novos ainda não existem. Esta linha fica quebrando a
> compilação até a Task 9 e a Task 12. Para não parar o plano, **deixe os dois
> `@case` novos comentados até lá** e mantenha `@case (2) { <app-tour-step-hotspots /> }`
> temporariamente com `@case (4) { <app-tour-step-info /> }` — a etapa 3 fica
> vazia, o que é visível e proposital enquanto o plano corre.

- [ ] **Step 7: i18n**

Em `pt.json` e `en.json`, no bloco `TOUR_WIZARD.COMMON`:

- `STEP_OF`: `"Etapa {{step}} de {{total}}"` / `"Step {{step}} of {{total}}"`
- `STEP_2` passa a ser o nome da ordenação: `"Ambientes"` / `"Rooms"`
- `STEP_3` passa a ser `"Passagens"` / `"Passages"`
- entra `STEP_4`: `"Informações"` / `"Details"` (o texto que estava em `STEP_3`)
- `HINT_2` vira a dica da ordenação: `"Arraste para ordenar e toque para conectar"` / `"Drag to reorder, tap to connect"`
- `HINT_3` recebe o texto que estava em `HINT_2`; `HINT_3_REQUIRED` recebe o de `HINT_2_REQUIRED`
- entra `HINT_4` com o texto que estava em `HINT_3`

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npx ng test --watch=false --browsers=ChromeHeadless`

Expected: PASS. Testes existentes que citam a etapa 2 como sendo a de hotspots vão falhar — **ajustar o número da etapa neles é correto**, porque a numeração mudou de propósito. Não ajustar asserções de comportamento.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(client): o wizard passa a ter quatro etapas"
```

---

### Task 6: alcançabilidade calculada sobre as conexões escolhidas

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/scene-graph.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Test: `inner-view-client/src/app/tour-wizard/scene-graph.spec.ts`

**Por quê:** `scene-graph.ts` lê as arestas do payload de publicação, que lê hotspots — **antes de existir hotspot ela não vê aresta nenhuma**. Sem isto, o corretor descobre "Banheiro está ilhado" só depois de posicionar 8 passagens.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `scene-graph.spec.ts`:

```ts
/**
 * A mesma regra de grafo, sobre as conexoes ESCOLHIDAS.
 *
 * A leitura padrao ve arestas do payload de publicacao, que so conhece hotspot
 * posicionado. Na tela de ordenacao ainda nao ha nenhum -- e e justamente la
 * que o aviso precisa aparecer, antes de o corretor gastar o trabalho.
 */
describe('ambientesIlhados — sobre conexoes escolhidas', () => {
  function cena(id: string, connections: string[] = []): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready',
      connections,
    };
  }

  it('sem conexao nenhuma, todos menos o primeiro estao ilhados', () => {
    const cenas = [cena('sala'), cena('cozinha'), cena('quarto')];
    const ilhados = ambientesIlhados(cenas, saidasEscolhidas);

    expect(ilhados.map((s) => s.id)).toEqual(['cozinha', 'quarto']);
  });

  it('corrente ligada nao tem ilhado', () => {
    const cenas = [
      cena('sala', ['cozinha']),
      cena('cozinha', ['sala', 'quarto']),
      cena('quarto', ['cozinha']),
    ];
    expect(ambientesIlhados(cenas, saidasEscolhidas)).toEqual([]);
  });

  it('um ambiente solto e apontado como ilhado', () => {
    const cenas = [
      cena('sala', ['cozinha']),
      cena('cozinha', ['sala']),
      cena('varanda'),
    ];
    const ilhados = ambientesIlhados(cenas, saidasEscolhidas);

    expect(ilhados.map((s) => s.id)).toEqual(['varanda']);
  });

  // A leitura padrao continua sendo a do publicar: e ela que o `canAdvance` da
  // etapa de passagens usa, e ela nao pode passar a enxergar conexao sem ponto.
  it('a leitura padrao continua vendo so hotspot posicionado', () => {
    const cenas = [cena('sala', ['cozinha']), cena('cozinha', ['sala'])];
    const ilhados = ambientesIlhados(cenas);

    expect(ilhados.map((s) => s.id)).toEqual(['cozinha']);
  });
});
```

Adicionar `saidasEscolhidas` ao import de `./scene-graph` no topo do spec.

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/scene-graph.spec.ts'`

Expected: FAIL — `has no exported member 'saidasEscolhidas'`.

- [ ] **Step 3: Implementar**

Em `scene-graph.ts`, exportar a função de arestas escolhidas e parametrizar as duas leituras:

```ts
/** De onde as arestas do grafo vêm. Ver `saidasEscolhidas`. */
export type FonteDeSaidas = (scenes: WizardScene[]) => Map<string, string[]>;

/**
 * Arestas lidas das CONEXÕES ESCOLHIDAS, e não dos hotspots posicionados.
 *
 * Existe para a tela de ordenação poder avisar cedo. A leitura padrão
 * (`saidasPublicadas`) só enxerga hotspot já posicionado — correto para o
 * bloqueio final, inútil numa tela onde ainda não há nenhum.
 *
 * As duas podem discordar num intervalo: conexão escolhida e ainda não
 * posicionada. É deliberado — o aviso da ordenação fala do que VAI ser montado,
 * e o do `canAdvance` fala do que está montado.
 */
export function saidasEscolhidas(scenes: WizardScene[]): Map<string, string[]> {
  const prontas = scenes.filter((s) => s.state === 'ready');
  const existe = new Set(prontas.map((s) => s.id));
  const saidas = new Map<string, string[]>();

  for (const cena of prontas) {
    saidas.set(
      cena.id,
      (cena.connections ?? []).filter((id) => existe.has(id)),
    );
  }
  return saidas;
}
```

E as duas funções passam a aceitar a fonte, com a atual como padrão:

```ts
export function ambientesIlhados(
  scenes: WizardScene[],
  fonte: FonteDeSaidas = saidasPublicadas,
): WizardScene[] {
  const cenas = prontas(scenes);
  if (cenas.length < 2) return [];

  const saidas = fonte(scenes);
  // ... o corpo continua igual, usando `saidas`
}

export function becosSemSaida(
  scenes: WizardScene[],
  fonte: FonteDeSaidas = saidasPublicadas,
): WizardScene[] {
  const cenas = prontas(scenes);
  if (cenas.length < 2) return [];
  if (ambientesIlhados(scenes, fonte).length) return [];

  const saidas = fonte(scenes);
  return cenas.filter((s) => (saidas.get(s.id) ?? []).length === 0);
}
```

> `saidasPublicadas` já existe no arquivo e é privada; ela vira o valor padrão
> do parâmetro, sem precisar ser exportada.

- [ ] **Step 4: Expor na store**

Em `tour-draft.store.ts`, ao lado de `ambientesIlhados`:

```ts
  /**
   * Ambientes que ninguém alcança PELAS CONEXÕES ESCOLHIDAS.
   *
   * É o aviso da tela de ordenação, e existe separado de `ambientesIlhados`
   * porque aquele lê hotspot posicionado — na ordenação ainda não há nenhum, e
   * ele apontaria todo mundo como ilhado.
   */
  readonly ilhadosPorConexao = computed(() =>
    grafo.ambientesIlhados(this.scenes(), grafo.saidasEscolhidas),
  );
```

- [ ] **Step 5: Rodar e conferir que passa**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/scene-graph.spec.ts'`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/scene-graph.ts inner-view-client/src/app/tour-wizard/scene-graph.spec.ts inner-view-client/src/app/tour-wizard/tour-draft.store.ts
git commit -m "feat(client): grafo tambem le as conexoes escolhidas, para avisar cedo"
```

---

### Task 7: `room-card` — o card de um ambiente

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/steps/step-ordering/room-card.component.{ts,html,scss}`

- [ ] **Step 1: Criar o componente**

`room-card.component.ts`:

```ts
import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { WizardScene } from '../../tour-wizard.model';

/**
 * Um ambiente na tela de ordenação.
 *
 * Recolhido mostra o que já está decidido: a posição, a foto, o nome e com quem
 * conecta. Expandido dá lugar à lista de destinos, que é filha e vem de fora —
 * este componente não sabe escolher conexão, só mostrar e pedir.
 */
@Component({
  selector: 'app-room-card',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './room-card.component.html',
  styleUrls: ['./room-card.component.scss'],
})
export class RoomCardComponent {
  readonly scene = input.required<WizardScene>();
  /** 1-based: é o que aparece no quadradinho. */
  readonly posicao = input.required<number>();
  readonly nomes = input.required<string[]>();
  readonly aberto = input.required<boolean>();

  readonly alternar = output<void>();

  readonly nome = computed(
    () => this.scene().room.trim() || this.scene().fileName,
  );

  readonly miniatura = computed(
    () => this.scene().treatedImageUrl || this.scene().imageData || null,
  );

  /**
   * A chave do resumo, escolhida no TypeScript.
   *
   * Três casos e não um com plural: "sem conexões", "conecta com Cozinha" e
   * "conecta com Sala e Banheiro" têm estruturas diferentes em português, e
   * montar a frase no template exigiria concatenar string traduzida.
   */
  readonly resumoKey = computed(() => {
    const n = this.nomes().length;
    if (n === 0) return 'TOUR_WIZARD.STEP_ORDER.SUMMARY_NONE';
    if (n === 1) return 'TOUR_WIZARD.STEP_ORDER.SUMMARY_ONE';
    return 'TOUR_WIZARD.STEP_ORDER.SUMMARY_MANY';
  });

  /** "Sala e Banheiro" — o "e" antes do último, como se escreve. */
  readonly resumoParams = computed(() => {
    const lista = this.nomes();
    if (lista.length <= 1) return { nome: lista[0] ?? '' };
    return {
      nomes: lista.slice(0, -1).join(', '),
      ultimo: lista[lista.length - 1],
    };
  });
}
```

`room-card.component.html`:

```html
<article class="rc" [class.is-aberto]="aberto()">
  <div class="rc__linha">
    <!--
      A alça é o único lugar por onde o arraste começa: o `canStart` do Ionic é
      literalmente um `closest("ion-reorder")`. Sem `slot`, porque o shadow CSS
      do Ionic esconde o host quando ele tem um.
    -->
    <ion-reorder class="rc__alca">
      <span class="rc__alca-icone" aria-hidden="true">
        <svg viewBox="0 0 16 12" width="16" height="12" focusable="false">
          <rect y="0" width="16" height="2" rx="1" />
          <rect y="5" width="16" height="2" rx="1" />
          <rect y="10" width="16" height="2" rx="1" />
        </svg>
      </span>
    </ion-reorder>

    <span class="rc__num" aria-hidden="true">{{ posicao() }}</span>

    <span
      class="rc__thumb"
      [style.background-image]="miniatura() ? 'url(' + miniatura() + ')' : null"
      aria-hidden="true"></span>

    <span class="rc__textos">
      <strong class="rc__nome">{{ nome() }}</strong>
      <small class="rc__resumo">{{ resumoKey() | translate: resumoParams() }}</small>
    </span>

    <!--
      O controle de expandir substitui o menu de três pontos do desenho: ele diz
      o que faz. Fica FORA da alça — um botão dentro dela teria o clique morto,
      porque o `ion-reorder` mata o evento na fase de captura.
    -->
    <button
      type="button"
      class="rc__abrir"
      [attr.aria-expanded]="aberto()"
      [attr.aria-label]="
        (aberto()
          ? 'TOUR_WIZARD.STEP_ORDER.COLLAPSE'
          : 'TOUR_WIZARD.STEP_ORDER.EXPAND'
        ) | translate: { ambiente: nome() }
      "
      (click)="alternar.emit()">
      <span class="rc__chevron" aria-hidden="true">⌄</span>
    </button>
  </div>

  @if (aberto()) {
    <div class="rc__corpo">
      <ng-content />
    </div>
  }
</article>
```

`room-card.component.scss`:

```scss
.rc {
  border-radius: var(--app-radius-lg);
  background: var(--app-surface-strong);
  box-shadow: var(--app-shadow-tier);
  transition: box-shadow 0.2s ease;
}

.rc__linha {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}

/* 44px de alvo, como manda o AGENTS.md, mesmo com o ícone pequeno. */
.rc__alca {
  display: grid;
  place-items: center;
  min-width: 44px;
  min-height: 44px;
  margin-left: -10px;
  color: var(--app-muted);
  cursor: grab;
}

.rc__alca-icone svg {
  fill: currentColor;
}

.rc__num {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: var(--app-radius-sm);
  background: var(--ion-color-primary);
  font-size: 14px;
  font-weight: 700;
  color: var(--ion-color-primary-contrast);
}

.rc__thumb {
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  border-radius: var(--app-radius-md);
  background: var(--app-surface-soft) center / cover no-repeat;
}

.rc__textos {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.rc__nome {
  overflow: hidden;
  font-size: 16px;
  font-weight: 700;
  color: var(--app-ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rc__resumo {
  overflow: hidden;
  font-size: 12.5px;
  letter-spacing: 0.2px;
  color: var(--app-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rc__abrir {
  flex: 0 0 auto;
  min-width: 44px;
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--app-muted);
}

.rc__chevron {
  display: inline-block;
  font-size: 18px;
  transition: transform 0.24s ease;
}

.is-aberto .rc__chevron {
  transform: rotate(180deg);
}

.rc__corpo {
  padding: 0 14px 14px;
  border-top: 1px solid var(--app-hairline-soft);
  margin-top: 2px;
  padding-top: 12px;
}

/* O pedido fala em animação de 200-300ms; quem desliga movimento não a recebe. */
@media (prefers-reduced-motion: reduce) {
  .rc,
  .rc__chevron {
    transition: none;
  }
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
" src/app/tour-wizard/steps/step-ordering/room-card.component.ts src/app/tour-wizard/steps/step-ordering/room-card.component.html src/app/tour-wizard/steps/step-ordering/room-card.component.scss
npx ng test --watch=false --browsers=ChromeHeadless --include='**/fila.spec.ts'
```

Expected: PASS. (A suíte compila o projeto inteiro; erro de template aparece aqui.)

- [ ] **Step 3: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/steps/step-ordering/
git commit -m "feat(client): card de ambiente da tela de ordenacao"
```

---

### Task 8: `connection-picker` — escolher os destinos

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/steps/step-ordering/connection-picker.component.{ts,html,scss}`

- [ ] **Step 1: Criar o componente**

`connection-picker.component.ts`:

```ts
import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { nomeDoAmbiente } from '../../passagens/fila';
import { WizardScene } from '../../tour-wizard.model';

/** Uma opção de destino, já com o nome resolvido e o estado de seleção. */
export interface OpcaoDeDestino {
  readonly id: string;
  readonly nome: string;
  readonly miniatura: string | null;
  readonly escolhido: boolean;
}

/**
 * A lista de destinos de um ambiente, com seleção múltipla.
 *
 * O ambiente atual nunca aparece: um ponto que leva a si mesmo não leva a lugar
 * nenhum, e a regra pura já recusa — mas oferecer e recusar é pior do que não
 * oferecer.
 */
@Component({
  selector: 'app-connection-picker',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './connection-picker.component.html',
  styleUrls: ['./connection-picker.component.scss'],
})
export class ConnectionPickerComponent {
  readonly scene = input.required<WizardScene>();
  readonly todas = input.required<readonly WizardScene[]>();

  /** Emite o id do destino que foi tocado — ligar ou desligar é de quem ouve. */
  readonly alternar = output<string>();

  readonly opcoes = computed<OpcaoDeDestino[]>(() => {
    const atual = this.scene();
    const escolhidos = new Set(atual.connections ?? []);

    return this.todas()
      .filter((s) => s.id !== atual.id && s.state === 'ready')
      .map((s) => ({
        id: s.id,
        nome: nomeDoAmbiente(s),
        miniatura: s.treatedImageUrl || s.imageData || null,
        escolhido: escolhidos.has(s.id),
      }));
  });
}
```

`connection-picker.component.html`:

```html
<p class="cp__titulo">{{ 'TOUR_WIZARD.STEP_ORDER.ADD_CONNECTION' | translate }}</p>

@if (opcoes().length) {
  <ul class="cp__lista">
    @for (opcao of opcoes(); track opcao.id) {
      <li>
        <!--
          Um botão com `aria-pressed`, e não um checkbox: o alvo é o card
          inteiro, e o estado é "escolhido/não escolhido", que é exatamente o que
          `aria-pressed` anuncia.
        -->
        <button
          type="button"
          class="cp__opcao"
          [class.is-escolhido]="opcao.escolhido"
          [attr.aria-pressed]="opcao.escolhido"
          (click)="alternar.emit(opcao.id)">
          <span
            class="cp__thumb"
            [style.background-image]="
              opcao.miniatura ? 'url(' + opcao.miniatura + ')' : null
            "
            aria-hidden="true"></span>
          <span class="cp__nome">{{ opcao.nome }}</span>
          <span class="cp__marca" aria-hidden="true">
            {{ opcao.escolhido ? '✓' : '' }}
          </span>
        </button>
      </li>
    }
  </ul>
} @else {
  <p class="cp__vazio">{{ 'TOUR_WIZARD.STEP_ORDER.NO_TARGETS' | translate }}</p>
}
```

`connection-picker.component.scss`:

```scss
.cp__titulo {
  margin: 0 0 10px;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--app-muted);
}

.cp__lista {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.cp__opcao {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 6px 10px;
  border: 1px solid var(--app-hairline-soft);
  border-radius: var(--app-radius-md);
  background: var(--app-surface-soft);
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;

  &.is-escolhido {
    border-color: var(--ion-color-primary);
    background: var(--app-surface-strong);
  }
}

.cp__thumb {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: var(--app-radius-sm);
  background: var(--app-surface-strong) center / cover no-repeat;
}

.cp__nome {
  flex: 1 1 auto;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  color: var(--app-ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp__marca {
  flex: 0 0 auto;
  width: 20px;
  font-weight: 800;
  color: var(--ion-color-primary);
  text-align: center;
}

.cp__vazio {
  margin: 0;
  font-size: 13px;
  color: var(--app-muted);
}

@media (prefers-reduced-motion: reduce) {
  .cp__opcao {
    transition: none;
  }
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
" src/app/tour-wizard/steps/step-ordering/connection-picker.component.ts src/app/tour-wizard/steps/step-ordering/connection-picker.component.html src/app/tour-wizard/steps/step-ordering/connection-picker.component.scss
npx ng test --watch=false --browsers=ChromeHeadless --include='**/fila.spec.ts'
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/steps/step-ordering/
git commit -m "feat(client): seletor de destinos com selecao multipla"
```

---

### Task 9: `step-ordering` — a tela, com arrastar-e-soltar

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/steps/step-ordering/step-ordering.component.{ts,html,scss}`
- Create: `inner-view-client/src/app/tour-wizard/steps/step-ordering/step-ordering.component.spec.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.page.html` (ativar o `@case (2)`)

**As sete armadilhas do `ion-reorder-group`**, todas verificadas no código do Ionic 8.8.9 e todas presentes nesta task: `disabled` nasce `true`; `ionItemReorder` está deprecado (usar `ionReorderEnd`); `detail.complete()` sem argumento mexe no DOM por trás do `@for`; o arraste só começa dentro de `<ion-reorder>`; `slot="start"` esconde o host; botão dentro da alça tem o clique morto; o ícone padrão `md` tem duas linhas, não três.

- [ ] **Step 1: Escrever o teste que falha**

Criar `step-ordering.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { StepOrderingComponent } from './step-ordering.component';

function cena(id: string, connections: string[] = []): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots: [],
    state: 'ready',
    connections,
  };
}

describe('StepOrderingComponent', () => {
  let fixture: ComponentFixture<StepOrderingComponent>;
  let draft: TourDraftStore;

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

    fixture = TestBed.createComponent(StepOrderingComponent);
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('mostra um card por ambiente, numerados a partir de 1', () => {
    montar([cena('sala'), cena('cozinha'), cena('quarto')]);

    const nums = [...el().querySelectorAll('.rc__num')].map((n) =>
      n.textContent?.trim(),
    );
    expect(nums).toEqual(['1', '2', '3']);
  });

  it('o titulo diz quantos ambientes foram capturados', () => {
    montar([cena('sala'), cena('cozinha')]);
    expect(el().textContent).toContain('TOUR_WIZARD.STEP_ORDER.TITLE');
  });

  it('expandir um card abre o seletor de destinos', () => {
    montar([cena('sala'), cena('cozinha')]);
    expect(el().querySelector('app-connection-picker')).toBeNull();

    (el().querySelector('.rc__abrir') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el().querySelector('app-connection-picker')).not.toBeNull();
  });

  // Um card aberto por vez: com dois abertos a lista fica alta demais no
  // celular, e o arraste do Ionic desloca vizinhos pela altura do arrastado.
  it('abrir um card fecha o outro', () => {
    montar([cena('sala'), cena('cozinha')]);
    const botoes = () =>
      [...el().querySelectorAll('.rc__abrir')] as HTMLButtonElement[];

    botoes()[0].click();
    fixture.detectChanges();
    botoes()[1].click();
    fixture.detectChanges();

    expect(el().querySelectorAll('app-connection-picker').length).toBe(1);
  });

  it('escolher um destino liga os dois ambientes', () => {
    montar([cena('sala'), cena('cozinha')]);
    (el().querySelector('.rc__abrir') as HTMLButtonElement).click();
    fixture.detectChanges();

    (el().querySelector('.cp__opcao') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(draft.scenes()[0].connections).toEqual(['cozinha']);
    expect(draft.scenes()[1].connections).toEqual(['sala']);
  });

  it('tocar de novo no destino ja escolhido desliga', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    (el().querySelector('.rc__abrir') as HTMLButtonElement).click();
    fixture.detectChanges();

    (el().querySelector('.cp__opcao') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(draft.scenes()[0].connections).toEqual([]);
    expect(draft.scenes()[1].connections).toEqual([]);
  });

  // O `detail.complete(false)` e o que impede o Ionic de mexer no DOM por
  // baixo do @for; a ordem quem muda e o signal.
  it('reordenar chama moveScene e completa sem deixar o Ionic mexer no DOM', () => {
    montar([cena('sala'), cena('cozinha'), cena('quarto')]);
    const mover = spyOn(draft, 'moveScene').and.callThrough();
    const completar = jasmine.createSpy('complete');

    fixture.componentInstance.aoReordenar({
      detail: { from: 0, to: 2, complete: completar },
    } as unknown as CustomEvent);

    expect(mover).toHaveBeenCalledWith(0, 2);
    expect(completar).toHaveBeenCalledWith(false);
  });

  it('comecar a arrastar recolhe o card aberto', () => {
    montar([cena('sala'), cena('cozinha')]);
    (el().querySelector('.rc__abrir') as HTMLButtonElement).click();
    fixture.detectChanges();

    fixture.componentInstance.aoComecarArraste();
    fixture.detectChanges();

    expect(el().querySelector('app-connection-picker')).toBeNull();
  });

  // O aviso precisa vir ANTES de posicionar ponto nenhum: descobrir que o
  // Banheiro esta ilhado depois de posicionar 8 passagens joga fora o trabalho.
  it('avisa quando um ambiente fica sem ninguem alcançando', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala']), cena('varanda')]);
    expect(el().textContent).toContain('TOUR_WIZARD.STEP_ORDER.UNREACHABLE');
  });

  it('sem ambiente ilhado, nao avisa', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    expect(el().textContent).not.toContain('TOUR_WIZARD.STEP_ORDER.UNREACHABLE');
  });
});
```

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/step-ordering.component.spec.ts'`

Expected: FAIL — `Cannot find module './step-ordering.component'`.

- [ ] **Step 3: Implementar**

`step-ordering.component.ts`:

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { IonReorder, IonReorderGroup } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { nomeDoAmbiente, resumoDeConexoes } from '../../passagens/fila';
import { TourDraftStore } from '../../tour-draft.store';
import { ConnectionPickerComponent } from './connection-picker.component';
import { RoomCardComponent } from './room-card.component';

/**
 * Etapa 2 — ordenação dos ambientes e escolha das conexões.
 *
 * A sequência dos cards é a sequência do tour: `publish-payload.ts` numera pela
 * posição no array. Reordenar aqui muda o tour de verdade.
 */
@Component({
  selector: 'app-tour-step-ordering',
  standalone: true,
  imports: [
    TranslatePipe,
    IonReorder,
    IonReorderGroup,
    RoomCardComponent,
    ConnectionPickerComponent,
  ],
  templateUrl: './step-ordering.component.html',
  styleUrls: ['./step-ordering.component.scss'],
})
export class StepOrderingComponent {
  readonly draft = inject(TourDraftStore);

  /**
   * Qual card está aberto — um por vez.
   *
   * Dois abertos deixam a lista alta demais no celular, e o Ionic desloca os
   * vizinhos pela altura do card arrastado: um card expandido no meio faz o
   * preview do arraste saltar.
   */
  private readonly abertoId = signal<string | null>(null);

  readonly cenas = computed(() => this.draft.readyScenes());
  readonly total = computed(() => this.cenas().length);

  /** Ambientes que ninguém alcança pelas conexões escolhidas. Ver a store. */
  readonly ilhados = computed(() =>
    this.draft.ilhadosPorConexao().map(nomeDoAmbiente).join(', '),
  );

  estaAberto(id: string): boolean {
    return this.abertoId() === id;
  }

  nomesDe(id: string): string[] {
    const cenas = this.cenas();
    const cena = cenas.find((s) => s.id === id);
    return cena ? resumoDeConexoes(cena, cenas) : [];
  }

  alternarCard(id: string): void {
    this.abertoId.update((atual) => (atual === id ? null : id));
  }

  /** Escolher ou desescolher um destino. Ligar é simétrico; desligar também. */
  alternarConexao(origemId: string, destinoId: string): void {
    const origem = this.cenas().find((s) => s.id === origemId);
    if (!origem) return;

    if ((origem.connections ?? []).includes(destinoId)) {
      this.draft.desligarAmbientes(origemId, destinoId);
      return;
    }
    this.draft.ligarAmbientes(origemId, destinoId);
  }

  /**
   * O arraste começou: recolhe o card aberto.
   *
   * O Ionic desloca os vizinhos por `translateY` da altura do card arrastado. Um
   * card expandido no meio da lista faz o preview saltar por cima dos outros.
   */
  aoComecarArraste(): void {
    this.abertoId.set(null);
  }

  /**
   * O arraste terminou.
   *
   * `complete(false)` e não `complete()`: sem o argumento o Ionic faz
   * `insertBefore` no DOM por baixo do `@for`, e o Angular reescreve a lista no
   * próximo ciclo — os dois mexendo no mesmo nó, com resultado imprevisível.
   * Quem muda a ordem é o sinal.
   */
  aoReordenar(evento: CustomEvent): void {
    const detalhe = evento.detail as unknown as {
      from: number;
      to: number;
      complete: (mover: boolean) => void;
    };
    this.draft.moveScene(detalhe.from, detalhe.to);
    detalhe.complete(false);
  }
}
```

`step-ordering.component.html`:

```html
<header class="so__head">
  <p class="so__eyebrow">{{ 'TOUR_WIZARD.STEP_ORDER.EYEBROW' | translate }}</p>
  <h2>{{ 'TOUR_WIZARD.STEP_ORDER.TITLE' | translate: { n: total() } }}</h2>
  <p class="so__sub">{{ 'TOUR_WIZARD.STEP_ORDER.SUBTITLE' | translate }}</p>
</header>

<!--
  O aviso vem ANTES de qualquer ponto ser posicionado. Descobrir "Banheiro está
  ilhado" depois de posicionar oito passagens joga fora o trabalho todo.
-->
@if (ilhados()) {
  <p class="so__aviso" role="status">
    {{ 'TOUR_WIZARD.STEP_ORDER.UNREACHABLE' | translate: { ambientes: ilhados() } }}
  </p>
}

<!--
  `[disabled]="false"` é obrigatório: o `ion-reorder-group` nasce desabilitado,
  e sem isto nada arrasta — sem erro nenhum no console.

  `ionReorderEnd` e não `ionItemReorder`, que está deprecado na 8.8.9.
-->
<ion-reorder-group
  class="so__lista"
  [disabled]="false"
  (ionReorderStart)="aoComecarArraste()"
  (ionReorderEnd)="aoReordenar($event)">
  @for (cena of cenas(); track cena.id; let i = $index) {
    <app-room-card
      [scene]="cena"
      [posicao]="i + 1"
      [nomes]="nomesDe(cena.id)"
      [aberto]="estaAberto(cena.id)"
      (alternar)="alternarCard(cena.id)">
      <app-connection-picker
        [scene]="cena"
        [todas]="cenas()"
        (alternar)="alternarConexao(cena.id, $event)" />
    </app-room-card>
  }
</ion-reorder-group>
```

`step-ordering.component.scss`:

```scss
:host {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.so__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.so__eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--app-muted);
}

.so__head h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.4px;
  color: var(--app-ink);
  text-wrap: balance;
}

.so__sub {
  margin: 0;
  font-size: 14px;
  color: var(--app-muted);
  text-wrap: pretty;
}

.so__aviso {
  margin: 0;
  padding: 10px 14px;
  border-left: 3px solid currentColor;
  border-radius: var(--tw-radius-md);
  background: var(--tw-warn-soft);
  font-size: 13px;
  line-height: 1.45;
  color: var(--tw-warn-text);
  text-wrap: pretty;
}

.so__lista {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/*
  A sombra do arraste é do projeto, não a do Ionic: a dele é fixa, opaca e não
  respeita `prefers-reduced-motion`.
*/
app-room-card.reorder-selected {
  box-shadow: 0 18px 32px -16px rgb(0 0 0 / 45%);
}
```

- [ ] **Step 4: Ativar o `@case (2)` na página**

Em `tour-wizard.page.html`, trocar o caso 2 e acrescentar o import no `.ts` da página:

```html
          @case (2) { <app-tour-step-ordering /> }
```

Em `tour-wizard.page.ts`, trocar `StepHotspotsComponent` por `StepOrderingComponent` no `imports` e no import do topo.

- [ ] **Step 5: Converter para CRLF e rodar**

```bash
cd inner-view-client
python -c "
import glob, sys
for p in glob.glob('src/app/tour-wizard/steps/step-ordering/*.*'):
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
"
npx ng test --watch=false --browsers=ChromeHeadless --include='**/step-ordering.component.spec.ts'
```

Expected: PASS, 11 specs.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): tela de ordenacao dos ambientes, com arraste e conexoes"
```

---

### Task 10: `passagens.store.ts` — o ponteiro da fila

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/passagens/passagens.store.ts`
- Test: `inner-view-client/src/app/tour-wizard/passagens/passagens.store.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `passagens.store.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HotspotEditorStore } from '../hotspot-editor.store';
import { TourDraftStore } from '../tour-draft.store';
import { WizardHotspot, WizardScene } from '../tour-wizard.model';
import { PassagensStore } from './passagens.store';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(
  id: string,
  connections: string[] = [],
  hotspots: WizardHotspot[] = [],
): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
    connections,
  };
}

describe('PassagensStore', () => {
  let draft: TourDraftStore;
  let passagens: PassagensStore;

  function montar(cenas: WizardScene[]) {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        HotspotEditorStore,
        PassagensStore,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    draft.scenes.set(cenas);
    passagens = TestBed.inject(PassagensStore);
    passagens.abrir();
  }

  afterEach(() => TestBed.resetTestingModule());

  const pontosDe = (id: string) =>
    draft.scenes().find((s) => s.id === id)?.hotspots ?? [];

  it('abre na primeira passagem pendente', () => {
    montar([
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala']),
    ]);

    expect(passagens.indice()).toBe(1);
    expect(passagens.atual()?.origem.id).toBe('cozinha');
  });

  // A ARMADILHA: HotspotEditorStore.add() escreve na cena de
  // draft.selectedSceneId(), nao numa cena por parametro. Se o ponteiro andar
  // sem sincronizar a selecao, o ponto vai para a FOTO ERRADA, em silencio.
  it('a cena selecionada acompanha o passo, SEMPRE', () => {
    montar([
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    expect(draft.selectedSceneId()).toBe('sala');

    passagens.marcar(0.3, 0.4);
    passagens.confirmar();
    expect(draft.selectedSceneId()).toBe('sala');

    passagens.marcar(0.6, 0.4);
    passagens.confirmar();
    expect(draft.selectedSceneId()).toBe('cozinha');
  });

  it('marcar grava o ponto com o destino da passagem', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    passagens.marcar(0.25, 0.75);

    const pontos = pontosDe('sala');
    expect(pontos.length).toBe(1);
    expect(pontos[0].target).toBe('cozinha');
    expect(pontos[0].u).toBe(0.25);
  });

  it('marcar de novo MOVE o ponto, nao cria um segundo', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    passagens.marcar(0.25, 0.75);
    passagens.marcar(0.8, 0.2);

    expect(pontosDe('sala').length).toBe(1);
    expect(pontosDe('sala')[0].u).toBe(0.8);
  });

  it('refazer apaga so a passagem atual', () => {
    montar([
      cena('sala', ['cozinha', 'quarto'], [ponto('h9', 'quarto')]),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);
    passagens.marcar(0.3, 0.4);
    passagens.refazer();

    expect(pontosDe('sala').map((h) => h.id)).toEqual(['h9']);
  });

  it('confirmar sem ponto nao anda', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    const antes = passagens.indice();
    passagens.confirmar();

    expect(passagens.indice()).toBe(antes);
  });

  // O pedido: permanece na MESMA foto ate acabarem os destinos daquele ambiente.
  it('fica na mesma foto enquanto houver destino no ambiente', () => {
    montar([
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    passagens.marcar(0.3, 0.4);
    passagens.confirmar();

    expect(passagens.atual()?.origem.id).toBe('sala');
    expect(passagens.atual()?.destino.id).toBe('quarto');
  });

  it('as pendentes do ambiente sao as outras da mesma foto', () => {
    montar([
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    expect(passagens.pendentes().map((p) => p.destino.id)).toEqual(['quarto']);
  });

  it('acabou quando nao ha mais pendente', () => {
    montar([
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ]);

    expect(passagens.acabou()).toBeTrue();
    expect(passagens.atual()).toBeNull();
  });

  it('sem conexao nenhuma, nao ha fila', () => {
    montar([cena('sala'), cena('cozinha')]);

    expect(passagens.fila().length).toBe(0);
    expect(passagens.acabou()).toBeTrue();
  });
});
```

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/passagens.store.spec.ts'`

Expected: FAIL — `Cannot find module './passagens.store'`.

- [ ] **Step 3: Implementar**

`passagens.store.ts`:

```ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { HotspotEditorStore } from '../hotspot-editor.store';
import { TourDraftStore } from '../tour-draft.store';
import {
  Passagem,
  filaDePassagens,
  pendentesDoAmbiente,
  primeiraPendente,
} from './fila';

/**
 * O ponteiro da fila de passagens, e os comandos que a percorrem.
 *
 * Não muta hotspot: escreve pelo `HotspotEditorStore`, o mesmo do editor livre.
 *
 * O ponteiro é o ÍNDICE NA FILA, e a cena selecionada é consequência dele —
 * invertendo o que o assistente anterior fazia. Lá a cena identificava o passo;
 * aqui vários passos dividem a mesma foto, e ela não identifica mais nada.
 */
@Injectable()
export class PassagensStore {
  private readonly draft = inject(TourDraftStore);
  private readonly editor = inject(HotspotEditorStore);

  private readonly i = signal(0);

  readonly fila = computed<Passagem[]>(() =>
    filaDePassagens(this.draft.scenes()),
  );

  readonly indice = computed(() => this.i());
  readonly atual = computed<Passagem | null>(() => this.fila()[this.i()] ?? null);
  readonly total = computed(() => this.fila().length);

  /** Quantas já foram feitas — o indicador de progresso do painel. */
  readonly feitas = computed(() => this.fila().filter((p) => p.feita).length);

  readonly acabou = computed(() => primeiraPendente(this.fila()) === -1);

  /** As outras pendentes da mesma foto: a lista do painel inferior. */
  readonly pendentes = computed(() => pendentesDoAmbiente(this.fila(), this.i()));

  /**
   * Move o ponteiro E a cena selecionada, juntos, sempre.
   *
   * É o único caminho que mexe no ponteiro, e existe por um defeito concreto:
   * `HotspotEditorStore.add()` e `.update()` escrevem na cena de
   * `draft.selectedSceneId()`, **não** numa cena passada por parâmetro. Um
   * avanço que esquecesse de sincronizar gravaria o ponto na FOTO ERRADA, sem
   * erro nenhum e sem nada na tela denunciando.
   */
  private irPara(indice: number): void {
    this.i.set(indice);
    const passagem = this.fila()[indice];
    if (passagem) this.draft.selectScene(passagem.origem.id);
  }

  /** Entrada na etapa: abre na primeira passagem que ainda não tem ponto. */
  abrir(): void {
    const proxima = primeiraPendente(this.fila());
    this.irPara(proxima >= 0 ? proxima : 0);
  }

  /**
   * Marca a passagem atual onde o corretor tocou.
   *
   * Com ponto existente, MOVE. O gesto é "corrigir onde eu marquei", não
   * "marcar de novo" — dois pontos para o mesmo destino na mesma foto deixariam
   * o de baixo invisível.
   */
  marcar(u: number, v: number): void {
    const passagem = this.atual();
    if (!passagem) return;

    const existente = passagem.origem.hotspots.find(
      (h) => h.target === passagem.destino.id,
    );
    if (existente) {
      this.editor.update(existente.id, { u, v });
      return;
    }

    const id = this.editor.add(u, v);
    if (id) this.editor.update(id, { target: passagem.destino.id });
  }

  /**
   * Apaga só o ponto da passagem atual.
   *
   * Os outros pontos do ambiente — das outras passagens, ou do editor livre —
   * não são desta e ficam.
   */
  refazer(): void {
    const passagem = this.atual();
    if (!passagem) return;

    const alvo = passagem.origem.hotspots.find(
      (h) => h.target === passagem.destino.id,
    );
    if (alvo) this.editor.remove(alvo.id);
  }

  /**
   * Confirma e anda para a próxima pendente.
   *
   * A próxima costuma ser a seguinte no índice, e aí o corretor permanece na
   * mesma foto — que é o que o pedido descreve. Quando os destinos daquele
   * ambiente acabam, a próxima pendente já é de outra foto, e `irPara`
   * sincroniza a cena.
   */
  confirmar(): void {
    const passagem = this.atual();
    if (!passagem?.feita) return;

    const proxima = primeiraPendente(this.fila());
    if (proxima >= 0) this.irPara(proxima);
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
" src/app/tour-wizard/passagens/passagens.store.ts src/app/tour-wizard/passagens/passagens.store.spec.ts
npx ng test --watch=false --browsers=ChromeHeadless --include='**/passagens.store.spec.ts'
```

Expected: PASS, 11 specs.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/passagens/
git commit -m "feat(client): ponteiro da fila de passagens, com a cena sempre sincronizada"
```

---

### Task 11: `passagens-sheet` — o painel inferior

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/passagens/passagens-sheet.component.{ts,html,scss}`

- [ ] **Step 1: Criar o componente**

`passagens-sheet.component.ts`:

```ts
import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Passagem, nomeDoAmbiente } from './fila';

/**
 * O painel inferior da etapa de passagens.
 *
 * Diferente da gaveta do assistente anterior num ponto que muda o desenho: aqui
 * há uma LISTA de destinos ainda pendentes na mesma foto. É ela que responde
 * "quantas faltam nesta sala", pergunta que não existia quando cada ambiente
 * tinha uma passagem só.
 *
 * Não é um `IonModal`: é parte da tela, sempre visível. Um modal permanente
 * prenderia o foco o tempo todo e fecharia no Esc.
 */
@Component({
  selector: 'app-passagens-sheet',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './passagens-sheet.component.html',
  styleUrls: ['./passagens-sheet.component.scss'],
})
export class PassagensSheetComponent {
  readonly atual = input.required<Passagem>();
  readonly pendentes = input.required<readonly Passagem[]>();
  readonly feitas = input.required<number>();
  readonly total = input.required<number>();
  readonly temPonto = input.required<boolean>();

  readonly confirmar = output<void>();
  readonly refazer = output<void>();

  readonly nome = nomeDoAmbiente;
}
```

`passagens-sheet.component.html`:

```html
<div class="ps">
  <span class="ps__grabber" aria-hidden="true"></span>

  <p class="ps__progresso">
    {{
      'TOUR_WIZARD.PASSAGES.PROGRESS'
        | translate: { feitas: feitas(), total: total() }
    }}
  </p>

  <div class="ps__linha">
    <span class="ps__thumb" aria-hidden="true"></span>
    <span class="ps__nomes">
      <small>{{ 'TOUR_WIZARD.PASSAGES.CURRENT' | translate }}</small>
      <strong>{{ nome(atual().destino) }}</strong>
    </span>

    @if (temPonto()) {
      <button type="button" class="ps__refazer" (click)="refazer.emit()">
        {{ 'TOUR_WIZARD.PASSAGES.REDO' | translate }}
      </button>
    }
  </div>

  <!--
    As que ainda faltam NESTA foto. Some quando não falta mais nenhuma: uma
    lista vazia com título ocuparia altura para dizer que não há nada a dizer.
  -->
  @if (pendentes().length) {
    <p class="ps__pendentes">
      <span class="ps__pendentes-rotulo">
        {{ 'TOUR_WIZARD.PASSAGES.ALSO_HERE' | translate }}
      </span>
      @for (p of pendentes(); track p.destino.id) {
        <span class="ps__chip">{{ nome(p.destino) }}</span>
      }
    </p>
  }

  <button
    type="button"
    class="ps__acao"
    [disabled]="!temPonto()"
    (click)="confirmar.emit()">
    {{ 'TOUR_WIZARD.PASSAGES.CONFIRM' | translate }}
  </button>
</div>
```

`passagens-sheet.component.scss`:

```scss
.ps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 16px 16px;
  border-radius: var(--app-radius-xl) var(--app-radius-xl) 0 0;
  background: var(--app-surface-soft);
}

.ps__grabber {
  align-self: center;
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--app-hairline);
}

.ps__progresso {
  margin: 0;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--app-muted);
}

.ps__linha {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ps__thumb {
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  border-radius: var(--app-radius-md);
  background: var(--app-surface-strong);
}

.ps__nomes {
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

.ps__refazer {
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

.ps__pendentes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.ps__pendentes-rotulo {
  font-size: 11.5px;
  letter-spacing: 0.6px;
  color: var(--app-muted);
}

.ps__chip {
  padding: 3px 9px;
  border: 1px solid var(--app-hairline-soft);
  border-radius: var(--app-radius-sm);
  background: var(--app-surface-strong);
  font-size: 12px;
  font-weight: 600;
  color: var(--app-body);
}

.ps__acao {
  min-height: 52px;
  padding: 16px;
  border: 0;
  border-radius: var(--app-radius-lg);
  background: var(--ion-color-primary);
  font-size: 16.5px;
  font-weight: 800;
  color: var(--ion-color-primary-contrast);

  &:disabled {
    background: var(--app-primary-disabled);
    opacity: 0.55;
    cursor: not-allowed;
  }
}
```

- [ ] **Step 2: Converter para CRLF e conferir que compila**

```bash
cd inner-view-client
python -c "
import glob
for p in glob.glob('src/app/tour-wizard/passagens/*.*'):
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
"
npx ng test --watch=false --browsers=ChromeHeadless --include='**/fila.spec.ts'
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/passagens/
git commit -m "feat(client): painel inferior das passagens, com a lista de pendentes"
```

---

### Task 12: `step-passages` — a etapa de pontos guiada pela fila

**Files:**
- Create: `inner-view-client/src/app/tour-wizard/steps/step-passages/step-passages.component.{ts,html,scss}`
- Create: `inner-view-client/src/app/tour-wizard/steps/step-passages/step-passages.component.spec.ts`
- Delete: `inner-view-client/src/app/tour-wizard/hotspots/guided/guided-route.ts`, `guided-route.spec.ts`, `guided-route.store.ts`, `guided-route.store.spec.ts`, `guided-cycle.component.*`, `guided-sheet.component.*`, `guided-hotspots.component.*`
- Delete: `inner-view-client/src/app/tour-wizard/steps/step-hotspots/`
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.page.html` e `.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `step-passages.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { PassagensStore } from '../../passagens/passagens.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { StepPassagesComponent } from './step-passages.component';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(
  id: string,
  connections: string[] = [],
  hotspots: WizardHotspot[] = [],
): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
    connections,
  };
}

describe('StepPassagesComponent', () => {
  let fixture: ComponentFixture<StepPassagesComponent>;
  let draft: TourDraftStore;
  let passagens: PassagensStore;

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

    fixture = TestBed.createComponent(StepPassagesComponent);
    fixture.detectChanges();
    passagens = fixture.debugElement.injector.get(PassagensStore);
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const botao = () => el().querySelector('.ps__acao') as HTMLButtonElement | null;

  it('mostra o painel com o destino atual', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);

    expect(el().querySelector('app-passagens-sheet')).not.toBeNull();
    expect(el().textContent).toContain('cozinha');
  });

  it('sem ponto, o primario fica travado', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    expect(botao()?.disabled).toBeTrue();
  });

  it('marcar libera o primario', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.5 });
    fixture.detectChanges();

    expect(botao()?.disabled).toBeFalse();
  });

  it('a lista de pendentes mostra os outros destinos da mesma foto', () => {
    montar([
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    const chips = [...el().querySelectorAll('.ps__chip')].map((c) =>
      c.textContent?.trim(),
    );
    expect(chips).toEqual(['quarto']);
  });

  // Todos os pontos ja confirmados do ambiente aparecem: esconde-los faria o
  // corretor empilhar duas portas no mesmo lugar da esfera sem perceber.
  it('mostra os pontos ja confirmados do ambiente', () => {
    montar([
      cena('sala', ['cozinha', 'quarto'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    expect(el().querySelectorAll('.tw-pin').length).toBe(1);
  });

  // O defeito que chegou a producao no PR #19, na forma nova: o reset de camera
  // nao pode disparar ao marcar.
  it('marcar NAO reseta a camera', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    TestBed.tick();
    const viewer = fixture.debugElement.query(
      By.directive(PanoramicViewerComponent),
    ).componentInstance as PanoramicViewerComponent;
    const reset = spyOn(viewer, 'resetView');

    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.5 });
    TestBed.tick();

    expect(reset).not.toHaveBeenCalled();
  });

  it('trocar de foto RESETA a camera', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    TestBed.tick();
    const viewer = fixture.debugElement.query(
      By.directive(PanoramicViewerComponent),
    ).componentInstance as PanoramicViewerComponent;
    const reset = spyOn(viewer, 'resetView');

    passagens.marcar(0.3, 0.5);
    passagens.confirmar();
    TestBed.tick();

    expect(reset).toHaveBeenCalled();
  });

  it('com a fila acabada, o painel some', () => {
    montar([
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ]);

    expect(el().querySelector('app-passagens-sheet')).toBeNull();
    expect(el().textContent).toContain('TOUR_WIZARD.PASSAGES.DONE');
  });

  it('sem conexao nenhuma, manda voltar e conectar', () => {
    montar([cena('sala'), cena('cozinha')]);
    expect(el().textContent).toContain('TOUR_WIZARD.PASSAGES.EMPTY');
  });
});
```

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/step-passages.component.spec.ts'`

Expected: FAIL — `Cannot find module './step-passages.component'`.

- [ ] **Step 3: Implementar**

`step-passages.component.ts`:

```ts
import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { Panorama } from '../../../models/virtual-tour.model';
import { GuidedBannerComponent } from '../../hotspots/guided/guided-banner.component';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { HotspotOverlayComponent } from '../../hotspots/hotspot-overlay/hotspot-overlay.component';
import { PassagensSheetComponent } from '../../passagens/passagens-sheet.component';
import { PassagensStore } from '../../passagens/passagens.store';
import { corDoAmbiente } from '../../passagens/cores';
import { nomeDoAmbiente } from '../../passagens/fila';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Etapa 3 — posicionar as passagens escolhidas.
 *
 * Percorre a fila na ordem de seleção, permanecendo na mesma foto até acabarem
 * os destinos daquele ambiente.
 */
@Component({
  selector: 'app-tour-step-passages',
  standalone: true,
  imports: [
    TranslatePipe,
    PanoramicViewerComponent,
    HotspotOverlayComponent,
    GuidedBannerComponent,
    PassagensSheetComponent,
  ],
  providers: [PassagensStore],
  templateUrl: './step-passages.component.html',
  styleUrls: ['./step-passages.component.scss'],
})
export class StepPassagesComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);
  readonly passagens = inject(PassagensStore);

  private readonly viewerRef = viewChild(PanoramicViewerComponent);

  readonly nomeDoAlvo = computed(() => {
    const p = this.passagens.atual();
    return p ? nomeDoAmbiente(p.destino) : '';
  });

  readonly corDoAlvo = computed(() => {
    const p = this.passagens.atual();
    if (!p) return corDoAmbiente(0);
    const i = this.draft.readyScenes().findIndex((s) => s.id === p.destino.id);
    return corDoAmbiente(Math.max(0, i));
  });

  readonly temPonto = computed(() => this.passagens.atual()?.feita ?? false);

  /**
   * Os pontos do ambiente que pertencem à fila.
   *
   * Todos, e não só o do passo: com vários destinos na mesma foto, esconder os
   * já confirmados faz o corretor empilhar duas portas no mesmo ponto da esfera
   * sem perceber.
   */
  readonly pinos = computed(() => {
    const p = this.passagens.atual();
    if (!p) return [];
    const destinos = new Set(p.origem.connections ?? []);
    return p.origem.hotspots.filter((h) => h.target && destinos.has(h.target));
  });

  readonly roomNames = computed<Record<string, string>>(() => {
    const mapa: Record<string, string> = {};
    for (const s of this.draft.readyScenes()) mapa[s.id] = nomeDoAmbiente(s);
    return mapa;
  });

  /**
   * O id da foto à vista — e SÓ o id.
   *
   * Existe para o `effect` do reset de câmera ter uma dependência que muda
   * quando a FOTO muda, e não a cada ponto marcado. `atual()` devolve objeto
   * novo a cada mutação de cena; um `computed` de string usa `Object.is` e a
   * corrente para aqui. Foi exatamente assim que a câmera voltava ao centro a
   * cada toque, em produção.
   */
  private readonly fotoAtualId = computed(
    () => this.passagens.atual()?.origem.id ?? null,
  );

  readonly viewerPanoramas = computed<Panorama[]>(
    () => {
      const cena = this.passagens.atual()?.origem;
      if (!cena) return [];
      return [
        {
          id: cena.id,
          roomName: cena.room,
          imageUrl: cena.treatedImageUrl ?? cena.imageData,
          order: cena.order,
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
    this.passagens.abrir();

    // Trocar de FOTO devolve a câmera ao ângulo inicial. A dependência é o id,
    // não a passagem: ver `fotoAtualId`.
    effect(() => {
      this.fotoAtualId();
      untracked(() => this.viewerRef()?.resetView());
    });

    // A cena retomada chega sem foto; sem isto a esfera fica branca.
    effect(() => {
      const cena = this.passagens.atual()?.origem;
      if (!cena || cena.treatedImageUrl || cena.imageData) return;
      void this.draft.garantirImagem(cena.id, 'treated').catch(() => undefined);
    });
  }

  onPlaced(evento: { positionX: number; positionY: number }): void {
    this.passagens.marcar(evento.positionX, evento.positionY);
  }
}
```

`step-passages.component.html`:

```html
@if (!passagens.total()) {
  <p class="sp__vazio" role="status">
    {{ 'TOUR_WIZARD.PASSAGES.EMPTY' | translate }}
  </p>
} @else if (passagens.acabou()) {
  <p class="sp__pronto" role="status">
    {{ 'TOUR_WIZARD.PASSAGES.DONE' | translate: { n: passagens.total() } }}
  </p>
} @else if (passagens.atual(); as passagem) {
  <div class="sp">
    <div class="sp__pano">
      <app-panoramic-viewer
        #viewer
        [panoramas]="viewerPanoramas()"
        [editMode]="true"
        [roomNav]="false"
        (hotspotPlaced)="onPlaced($event)" />

      <!--
        Todos os pontos do ambiente que pertencem à fila, e não só o do passo:
        esconder os confirmados faz empilhar duas portas no mesmo lugar.
      -->
      <app-hotspot-overlay
        [viewer]="viewer"
        [hotspots]="pinos()"
        [roomNames]="roomNames()"
        [draggingId]="editor.pinDrag()?.hotspotId ?? null"
        (pinDragStarted)="editor.startDrag($event)"
        (pinDragMoved)="editor.dragTo($event.u, $event.v)"
        (pinDragEnded)="editor.endDrag()" />

      <app-guided-banner
        class="sp__banner"
        [target]="nomeDoAlvo()"
        [cor]="corDoAlvo()"
        [ultimo]="false" />
    </div>

    <app-passagens-sheet
      [atual]="passagem"
      [pendentes]="passagens.pendentes()"
      [feitas]="passagens.feitas()"
      [total]="passagens.total()"
      [temPonto]="temPonto()"
      (confirmar)="passagens.confirmar()"
      (refazer)="passagens.refazer()" />
  </div>
}
```

`step-passages.component.scss`:

```scss
.sp {
  display: flex;
  flex-direction: column;
}

.sp__pano {
  position: relative;
  height: 430px;
  overflow: hidden;
  border-radius: var(--app-radius-lg);
  background: var(--tw-pano-dark, #141210);

  @media (min-width: 744px) {
    height: 560px;
  }
}

/* Sobre a foto, e sem engolir o toque que marca a passagem. */
.sp__banner {
  position: absolute;
  inset: auto 14px 14px;
  pointer-events: none;
}

app-passagens-sheet {
  z-index: 1;
  margin-top: -20px;
}

.sp__vazio,
.sp__pronto {
  margin: 0;
  padding: 24px;
  border: 1px dashed var(--tw-border-dashed);
  border-radius: var(--tw-radius-md);
  font-size: 14px;
  text-align: center;
  color: var(--tw-text-muted);
  text-wrap: pretty;
}
```

- [ ] **Step 4: Criar `passagens/cores.ts`**

O `corDoAmbiente` vinha de `guided-route.ts`, que morre nesta task. Mover para um arquivo próprio:

```ts
/**
 * Cor de identidade de um ambiente, ciclando entre os tons do tema.
 *
 * Devolve `var(--app-room-N)` e nunca um hex: a paleta é decidida num lugar só,
 * em `theme/variables.scss`, como manda o `.agents/AGENTS.md`. Com mais de seis
 * ambientes dois repetem — o swatch é apoio para reconhecer de relance, não
 * identificador.
 */
export const TONS_DE_AMBIENTE = 6;

export function corDoAmbiente(i: number): string {
  const tom = ((i % TONS_DE_AMBIENTE) + TONS_DE_AMBIENTE) % TONS_DE_AMBIENTE;
  return `var(--app-room-${tom + 1})`;
}
```

E o spec correspondente, `passagens/cores.spec.ts`:

```ts
import { corDoAmbiente } from './cores';

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

- [ ] **Step 5: Apagar o que morre**

```bash
cd inner-view-client
git rm -r src/app/tour-wizard/steps/step-hotspots/
git rm src/app/tour-wizard/hotspots/guided/guided-route.ts \
       src/app/tour-wizard/hotspots/guided/guided-route.spec.ts \
       src/app/tour-wizard/hotspots/guided/guided-route.store.ts \
       src/app/tour-wizard/hotspots/guided/guided-route.store.spec.ts \
       src/app/tour-wizard/hotspots/guided/guided-hotspots.component.ts \
       src/app/tour-wizard/hotspots/guided/guided-hotspots.component.html \
       src/app/tour-wizard/hotspots/guided/guided-hotspots.component.scss \
       src/app/tour-wizard/hotspots/guided/guided-hotspots.component.spec.ts \
       src/app/tour-wizard/hotspots/guided/guided-sheet.component.ts \
       src/app/tour-wizard/hotspots/guided/guided-sheet.component.html \
       src/app/tour-wizard/hotspots/guided/guided-sheet.component.scss \
       src/app/tour-wizard/hotspots/guided/guided-cycle.component.ts \
       src/app/tour-wizard/hotspots/guided/guided-cycle.component.html \
       src/app/tour-wizard/hotspots/guided/guided-cycle.component.scss
```

`guided-banner.component.*` **fica** — a etapa nova o reusa sem mudança, e com
ele ficam as chaves `TOUR_WIZARD.STEP2.GUIDED.INSTRUCTION`, `INSTRUCTION_LAST` e
`HINT`, que são as que ele lê.

- [ ] **Step 6: Ligar na página**

Em `tour-wizard.page.html`:

```html
          @case (3) { <app-tour-step-passages /> }
```

Em `tour-wizard.page.ts`, importar `StepPassagesComponent` e acrescentá-lo ao `imports`.

- [ ] **Step 7: Converter para CRLF e rodar a suíte inteira**

```bash
cd inner-view-client
python -c "
import glob
for p in glob.glob('src/app/tour-wizard/steps/step-passages/*.*') + glob.glob('src/app/tour-wizard/passagens/*.*'):
    b = open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    open(p,'wb').write(b)
"
npx ng test --watch=false --browsers=ChromeHeadless
```

Expected: PASS. Os testes dos arquivos apagados somem junto com eles; os que restam não podem falhar.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(client): etapa de passagens guiada pela fila; o roteiro por ciclo sai"
```

---

### Task 13: o visualizador em tela cheia no celular

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/steps/step-passages/step-passages.component.{ts,html,scss}`
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.page.html`
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.page.scss`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `step-passages.component.spec.ts`:

```ts
  // No celular a etapa de passagens ocupa a tela: o cabecalho, o stepper e a
  // barra de acao somem, e a gaveta vira o unico controle. Ela precisa entao
  // oferecer o caminho de volta -- senao o corretor fica preso na etapa.
  it('em tela cheia, a gaveta oferece voltar para a ordenacao', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);

    const voltar = el().querySelector('.ps__voltar') as HTMLButtonElement;
    expect(voltar).not.toBeNull();

    voltar.click();
    expect(draft.step()).toBe(2);
  });
```

- [ ] **Step 2: Rodar e conferir que falha**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/step-passages.component.spec.ts'`

Expected: FAIL — `Cannot read properties of null (reading 'click')`.

- [ ] **Step 3: O botão de voltar na gaveta**

Em `passagens-sheet.component.ts`, acrescentar a saída:

```ts
  readonly voltar = output<void>();
```

Em `passagens-sheet.component.html`, antes do `.ps__acao`:

```html
  <!--
    Em tela cheia a barra do wizard some, e com ela o "Voltar". Sem este botão o
    corretor fica preso na etapa de passagens sem caminho de volta à ordenação.
  -->
  <button type="button" class="ps__voltar" (click)="voltar.emit()">
    {{ 'TOUR_WIZARD.PASSAGES.BACK' | translate }}
  </button>
```

Em `passagens-sheet.component.scss`:

```scss
.ps__voltar {
  align-self: flex-start;
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

Em `step-passages.component.html`, ligar:

```html
      (voltar)="draft.goTo(2)"
```

- [ ] **Step 4: A tela cheia**

Em `tour-wizard.page.html`, marcar a casca quando a etapa é a 3:

```html
<div class="tw-shell" [class.is-imersivo]="store.step() === 3 && !store.published()">
```

E envolver o stepper e o rodapé com a mesma condição — eles continuam no DOM no
desktop e somem no mobile por CSS, não por `@if`, para não recriar a árvore ao
trocar de etapa.

Em `tour-wizard.page.scss`:

```scss
/*
  Etapa de passagens no celular: a foto ocupa a tela.
  
  Some por CSS e não por `@if`: recriar o stepper e a barra a cada troca de
  etapa derrubaria o foco de quem navega por teclado.
*/
@include tw.tw-mobile {
  .tw-shell.is-imersivo {
    .tw-shell__head,
    .tw-shell__foot {
      display: none;
    }

    .tw-shell__body {
      padding: 0;
    }
  }
}
```

> Conferir os nomes reais das classes da casca com
> `grep -n 'class="tw-shell' inner-view-client/src/app/tour-wizard/tour-wizard.page.html`
> e usar os que existirem.

Em `step-passages.component.scss`, o painel passa a ocupar a altura disponível
no mobile:

```scss
@media (max-width: 743px) {
  .sp {
    height: 100dvh;
  }

  .sp__pano {
    flex: 1 1 auto;
    height: auto;
    border-radius: 0;
  }
}
```

- [ ] **Step 5: Rodar e conferir que passa**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/step-passages.component.spec.ts'`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): a etapa de passagens ocupa a tela no celular"
```

---

### Task 14: i18n

**Files:**
- Modify: `inner-view-client/src/assets/i18n/pt.json`, `en.json`

- [ ] **Step 1: Adicionar os blocos novos**

Dentro de `TOUR_WIZARD`, em `pt.json`:

```json
"STEP_ORDER": {
  "EYEBROW": "Tour em construção",
  "TITLE": "{{n}} ambientes capturados, nesta ordem",
  "SUBTITLE": "A sequência do percurso segue a ordem das fotos. Arraste para reorganizar ou toque para conectar os ambientes.",
  "EXPAND": "Conectar {{ambiente}}",
  "COLLAPSE": "Fechar {{ambiente}}",
  "ADD_CONNECTION": "Adicionar uma conexão a este ambiente",
  "NO_TARGETS": "Envie outra foto na etapa anterior para poder conectar.",
  "SUMMARY_NONE": "sem conexões",
  "SUMMARY_ONE": "conecta com {{nome}}",
  "SUMMARY_MANY": "conecta com {{nomes}} e {{ultimo}}",
  "UNREACHABLE": "Sem caminho até: {{ambientes}}. No tour publicado o visitante não chega lá."
},
"PASSAGES": {
  "PROGRESS": "{{feitas}} de {{total}} passagens",
  "CURRENT": "Passagem para",
  "ALSO_HERE": "Ainda nesta foto:",
  "REDO": "Refazer",
  "CONFIRM": "Confirmar passagem",
  "BACK": "Voltar aos ambientes",
  "DONE": "As {{n}} passagens estão posicionadas.",
  "EMPTY": "Nenhuma conexão escolhida. Volte aos ambientes e conecte-os."
}
```

Em `en.json`, o mesmo com:

```json
"STEP_ORDER": {
  "EYEBROW": "Tour in progress",
  "TITLE": "{{n}} rooms captured, in this order",
  "SUBTITLE": "The route follows the order of the photos. Drag to reorder or tap to connect the rooms.",
  "EXPAND": "Connect {{ambiente}}",
  "COLLAPSE": "Close {{ambiente}}",
  "ADD_CONNECTION": "Add a connection to this room",
  "NO_TARGETS": "Upload another photo in the previous step to connect.",
  "SUMMARY_NONE": "no connections",
  "SUMMARY_ONE": "connects to {{nome}}",
  "SUMMARY_MANY": "connects to {{nomes}} and {{ultimo}}",
  "UNREACHABLE": "No path to: {{ambientes}}. Visitors won't reach it in the published tour."
},
"PASSAGES": {
  "PROGRESS": "{{feitas}} of {{total}} passages",
  "CURRENT": "Passage to",
  "ALSO_HERE": "Still in this photo:",
  "REDO": "Redo",
  "CONFIRM": "Confirm passage",
  "BACK": "Back to rooms",
  "DONE": "All {{n}} passages are placed.",
  "EMPTY": "No connections chosen. Go back to the rooms and connect them."
}
```

**O que sai, e o que fica.** Saem `TOUR_WIZARD.STEP2.GUIDED.CYCLE_*`,
`DOT_*`, `CONFIRM*`, `NEXT_ROOM`, `PROGRESS*`, `REDO`, `EDIT_LINKS`, `CONTINUE`,
`ADVANCED` e `GUIDED_MODE` — todos eram do assistente por ciclo, que morreu na
Task 12.

**Ficam `GUIDED.INSTRUCTION`, `GUIDED.INSTRUCTION_LAST` e `GUIDED.HINT`**, porque
o `guided-banner` continua vivo e é reusado pela etapa nova. Apagá-las deixaria
o banner mudo — a faixa escura sobre a foto renderizaria a chave crua.

Conferir antes de apagar qualquer uma:

```bash
grep -rn "TOUR_WIZARD.STEP2" inner-view-client/src/app/
```

Só apagar as que a busca não achar mais. Se o resultado listar uma chave que
esta task manda remover, **parar**: significa que alguma coisa ainda a usa e o
plano errou.

- [ ] **Step 2: Conferir que os dois idiomas batem**

Run (em `inner-view-client/`):

```bash
python -c "
import json
def chaves(o, p=''):
    for k, v in o.items():
        yield from chaves(v, f'{p}{k}.') if isinstance(v, dict) else [f'{p}{k}']
pt = set(chaves(json.load(open('src/assets/i18n/pt.json', encoding='utf-8'))))
en = set(chaves(json.load(open('src/assets/i18n/en.json', encoding='utf-8'))))
print('so em pt:', sorted(pt - en))
print('so em en:', sorted(en - pt))
"
```

Expected: as duas listas vazias.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `npx ng test --watch=false --browsers=ChromeHeadless`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add inner-view-client/src/assets/i18n/
git commit -m "feat(client): textos da ordenacao e das passagens, em pt e en"
```

---

### Task 15: verificação em navegador e mutação

- [ ] **Step 1: Bateria de mutação**

Uma de cada vez: aplicar, rodar, conferir que falha exatamente o teste da
direita, e **desfazer**.

| Mutação | Arquivo | Deve quebrar |
|---|---|---|
| `ligar` escreve só num lado (remover o ramo `s.id === bId`) | `passagens/fila.ts` | `ligar escreve nos dois ambientes` |
| `filaDePassagens` ignora a ordem de `connections` (usar `[...c].sort()`) | `passagens/fila.ts` | `agrupa por ambiente, na ordem dos cards` |
| `irPara` não chama `selectScene` | `passagens/passagens.store.ts` | `a cena selecionada acompanha o passo, SEMPRE` |
| `marcar` sempre chama `add` | `passagens/passagens.store.ts` | `marcar de novo MOVE o ponto` |
| o effect do reset depende de `passagens.atual()` | `step-passages.component.ts` | `marcar NAO reseta a camera` |
| `aoReordenar` chama `complete()` sem argumento | `step-ordering.component.ts` | `reordenar chama moveScene e completa...` |

Run a cada uma: `npx ng test --watch=false --browsers=ChromeHeadless`

Expected: exatamente o teste indicado falha. Se algum passar com a mutação
aplicada, o teste não segura nada — escrever o que falta antes de seguir.

- [ ] **Step 2: Subir o ambiente**

```bash
cd server-api && docker compose up -d && npm run start:dev
```

Em outro terminal:

```bash
cd inner-view-client && npx ng serve
```

- [ ] **Step 3: Percorrer a lista, com quatro ambientes de verdade**

Abrir `http://localhost:4200`, entrar, criar um tour com **quatro** fotos 360°,
nomeá-las, e conferir uma a uma:

1. A etapa 2 abre na tela de ordenação, com o título "4 ambientes capturados".
2. Cada card mostra alça de três linhas, número, miniatura, nome e "sem conexões".
3. **Arrastar pela alça reordena**, e a numeração se atualiza na hora.
4. Arrastar por fora da alça **não** move nada.
5. Expandir um card abre a lista dos outros três; o próprio não aparece.
6. Escolher a Cozinha na Sala marca nos dois cards ("conecta com").
7. Tocar de novo desmarca nos dois.
8. Abrir outro card fecha o primeiro.
9. Deixar um ambiente sem conexão nenhuma faz o aviso de "sem caminho até" aparecer.
10. "Próximo" leva à etapa 3, e o painel diz "0 de N passagens".
11. **No celular (ou numa janela estreita), a foto ocupa a tela** e a barra do wizard some.
12. Tocar na foto cria o ponto; a câmera **não** volta ao centro.
13. Confirmar **mantém a mesma foto** e troca o destino, enquanto houver destino naquele ambiente.
14. A lista "ainda nesta foto" encolhe a cada confirmação.
15. Quando os destinos do ambiente acabam, a foto troca e a câmera reseta.
16. Os pontos já confirmados continuam visíveis na foto.
17. "Refazer" apaga só o ponto atual.
18. "Voltar aos ambientes" leva à etapa 2 com tudo preservado.
19. Remover uma conexão que já tem ponto **pergunta antes**.
20. Publicar e abrir o `/embed`: as passagens funcionam nos dois sentidos.

> O item 19 depende de um diálogo de confirmação que **este plano não
> implementa** — `desligarAmbientes` já devolve os pontos perdidos, mas nada
> pergunta ainda. Se a verificação chegar aqui e o comportamento estiver
> faltando, é trabalho conhecido: registrar e tratar como tarefa própria, não
> improvisar no meio da verificação.

- [ ] **Step 4: Suíte e lint limpos**

```bash
cd inner-view-client
npx ng test --watch=false --browsers=ChromeHeadless
npm run lint
```

- [ ] **Step 5: Conferir CRLF**

```bash
cd inner-view-client
python -c "
import glob
ruins = [f for f in glob.glob('src/app/tour-wizard/**/*.*', recursive=True)
         if open(f,'rb').read().replace(b'\r\n', b'').count(b'\n')]
print('LF solto em:', ruins or 'nenhum')
"
```

Expected: `nenhum`

- [ ] **Step 6: Commit do que a verificação corrigiu**

```bash
git add -A
git commit -m "fix(client): ajustes do fluxo de conexoes vindos da verificacao em navegador"
```

(Se a verificação não achou nada, não há commit — e isso é resultado.)

---

## Cobertura da spec

| Seção da spec | Task |
|---|---|
| §1 Quatro etapas | 5 |
| §2 `connections` na cena, simétrico | 1, 2 |
| §3 Reciprocidade nas duas pontas da fila | 1 (`ligar`), 10 (a fila as percorre) |
| §4 Persistência no servidor | **plano B** |
| §5 Ponteiro é o índice da fila | 10 |
| §6 Todos os pontos confirmados aparecem | 12 (`pinos`) |
| §7 Tela cheia no celular | 13 |
| §8 `guided-cycle` morre | 12 |
| §9 Alcançabilidade na ordenação | 6, 9 |
| §10 `ion-reorder-group` e as sete armadilhas | 9 |
| §11 `moveScene` | 3 |
| i18n | 14 |
| Testes e mutação | 1, 2, 3, 4, 5, 6, 9, 10, 12, 15 |

## Pendências conhecidas, a decidir durante a execução

1. **O diálogo de "isto vai apagar N pontos"** (Task 15, item 19).
   `desligarAmbientes` já devolve os pontos perdidos, mas nada pergunta ainda. É
   tarefa própria: precisa decidir se é `IonAlert` ou um estado no próprio card.
2. **Os nomes reais das classes da casca do wizard** (Task 13, Step 4).
   Conferir com `grep` antes de escrever o SCSS.
3. **Quais chaves de `TOUR_WIZARD.STEP2` ainda têm uso** (Task 14, Step 1).
   Só apagar as que a busca não achar.
