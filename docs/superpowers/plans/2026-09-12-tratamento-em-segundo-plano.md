# Tratamento por IA em segundo plano — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O corretor confirma um cômodo e já parte para o próximo, enquanto a montagem por IA daquele cômodo termina sozinha em segundo plano.

**Architecture:** O modal de captura para de esperar a IA e passa a mostrar o preview logo depois da costura, com selo e campo de nome. O envio ao servidor continua aguardado, porque é dele que sai o `serverPanoramaId`. A espera longa migra para um único acompanhador por tour, vivendo no `TourDraftStore`, que reusa `VirtualTourService.acompanharMontagem`. A etapa 1 ganha uma trava que segura enquanto houver cômodo em curso, e deixa passar falha e dispensa.

**Tech Stack:** Angular 20 standalone + signals, Ionic 8, Karma/Jasmine, NestJS + Prisma no servidor.

**Spec:** `docs/superpowers/specs/2026-09-12-tratamento-em-segundo-plano-design.md`

## Global Constraints

- **Branch:** `feat/tratamento-em-segundo-plano`, base `origin/main` em `a6e3d4d`. Nunca empilhar sobre outro branch de feature.
- **Arquivos são CRLF.** Script de patch em Node precisa normalizar `\r\n` → `\n`, aplicar, e devolver CRLF na escrita.
- **Nada de hex solto em componente.** Token novo nasce em `src/theme/tour-wizard.scss`. Regra declarada no cabeçalho do próprio arquivo.
- **`step-images.component.scss` está em 10,46 kB** com aviso de orçamento em 10 kB e erro em 12 kB. Qualquer CSS novo ali precisa ser medido com `npx sass --style=compressed --no-source-map <arquivo> | wc -c`.
- **Comentários em português**, no idioma e na densidade do código vizinho: explicam POR QUE, citando o defeito concreto que a linha evita.
- **Disciplina de injeção de defeito:** todo teste novo só entra depois de o defeito que ele guarda ser reintroduzido de propósito e o teste cair.
- **Suíte:** `npx ng test --configuration ci --browsers ChromeHeadless` a partir de `inner-view-client/`. Base de referência: 1141 verdes em `a6e3d4d`.
- **Lint:** `npm run lint` a partir de `inner-view-client/`. Precisa terminar em "All files pass linting".
- **i18n em par.** Toda chave nova entra em `src/assets/i18n/pt.json` **e** `en.json`.

---

### Task 1: O envio separa-se da espera da IA

Hoje `TourDraftStore.tratarCaptura` faz seis coisas em sequência e devolve só no fim. Esta task corta a sequência em duas: o que o modal aguarda, e o que vai para segundo plano.

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts` (`tratarCaptura`, `esperarPanorama`)
- Test: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  ```ts
  /** O envio. Resolve assim que o servidor tem a linha e a montagem foi pedida. */
  enviarCaptura(captura: {
    imageData: string;
    frames: CaptureFrameUpload[];
    geometry: CaptureGeometry | null;
  }): Promise<{ panoramaId: string; tratamentoPedido: boolean } | null>;
  ```
  `tratamentoPedido` é `false` quando o servidor dispensou por ter menos de `MINIMO_DE_REFERENCIAS` fotos — aí não há o que acompanhar.

- [ ] **Step 1: Escrever o teste que falha**

Em `tour-draft.store.spec.ts`, dentro do describe que já cobre a captura:

```ts
it('enviarCaptura devolve assim que a montagem foi PEDIDA, sem esperar a IA', fakeAsync(() => {
  const captura = { imageData: 'data:image/jpeg;base64,SGk=', frames: quatroFrames(), geometry: null };

  let resolvido: { panoramaId: string; tratamentoPedido: boolean } | null = null;
  void store.enviarCaptura(captura).then((r) => (resolvido = r));

  responderRascunho();
  responderAddPanorama('pano-1');
  responderUploadFrames(4);
  responderMontar();
  tick();

  // Nenhum GET de andamento foi feito: quem espera a IA é o acompanhador.
  http.expectNone((r) => r.url.includes('/montagem'));
  expect(resolvido).toEqual({ panoramaId: 'pano-1', tratamentoPedido: true });
}));

it('dispensa por poucas referências volta sem pedir montagem', fakeAsync(() => {
  const captura = { imageData: 'data:image/jpeg;base64,SGk=', frames: [umFrame()], geometry: null };

  let resolvido: { panoramaId: string; tratamentoPedido: boolean } | null = null;
  void store.enviarCaptura(captura).then((r) => (resolvido = r));

  responderRascunho();
  responderAddPanorama('pano-2');
  responderUploadFrames(1);
  tick();

  http.expectNone((r) => r.url.includes('/montar'));
  expect(resolvido).toEqual({ panoramaId: 'pano-2', tratamentoPedido: false });
}));
```

Os helpers `responderRascunho`, `responderAddPanorama`, `responderUploadFrames`, `responderMontar`, `quatroFrames` e `umFrame` já existem ou seguem o padrão dos testes vizinhos de `tratarCaptura`; se faltarem, escrever ao lado deles copiando a forma existente.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`
Expected: FAIL — `store.enviarCaptura is not a function`.

- [ ] **Step 3: Implementar**

Substituir `tratarCaptura` por `enviarCaptura`, ficando com os quatro primeiros passos:

```ts
/**
 * Sobe a captura e PEDE a montagem. Não espera a IA.
 *
 * O corte é aqui e não antes por um defeito concreto: a partir do
 * `addPanorama` existe uma linha no servidor, e a cena precisa sair daqui
 * com o `serverPanoramaId` dela. Sem ele, `salvarRascunhoAgora` — que cria
 * um panorama para toda cena que não tem um — criaria OUTRO para o mesmo
 * cômodo, e o tour sairia com a sala duplicada: uma cópia tratada com as
 * fotos, outra crua e sem elas. Aconteceu em campo em 10/09/2026.
 *
 * O que foi embora daqui é só a quinta etapa, a espera da IA, que é a
 * demora de que o pedido fala. Ela agora é do `acompanhador`.
 */
async enviarCaptura(captura: {
  imageData: string;
  frames: CaptureFrameUpload[];
  geometry: CaptureGeometry | null;
}): Promise<{ panoramaId: string; tratamentoPedido: boolean } | null> {
  let panoramaId: string | null = null;

  try {
    const tourId = await this.garantirRascunho();

    const panorama = await firstValueFrom(
      this.virtualTourService.addPanorama(tourId, {
        roomName: `Ambiente ${this.scenes().length + 1}`,
        imageData: captura.imageData,
        order: this.scenes().length,
        initialPanorama: this.scenes().length === 0,
        ...(captura.geometry ?? {}),
      }),
    );
    panoramaId = panorama.id;

    const { uploaded } = await this.virtualTourService.uploadCaptureFrames(
      panorama.id,
      captura.frames,
    );
    // Menos de quatro referências e o servidor dispensa em vez de tratar.
    // Pedir a montagem gastaria uma ida à rede para receber um SKIPPED.
    if (uploaded < MINIMO_DE_REFERENCIAS) {
      return { panoramaId: panorama.id, tratamentoPedido: false };
    }

    await firstValueFrom(this.virtualTourService.montarTour(tourId));
    return { panoramaId: panorama.id, tratamentoPedido: true };
  } catch {
    // O id só é descartado quando NÃO há o que descartar. Ver o histórico
    // no spec: devolver `null` com a linha já criada duplicava o cômodo.
    return panoramaId ? { panoramaId, tratamentoPedido: false } : null;
  }
}
```

Apagar `esperarPanorama` e a constante `LIMITE_DA_ESPERA_MS`: os dois existiam só para segurar a tela, e a Task 2 põe outro teto no lugar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`
Expected: os dois testes novos passam. Testes antigos de `tratarCaptura` vão quebrar — eles descrevem o comportamento que acabou de sair. Reescrevê-los para `enviarCaptura` ou removê-los quando o que afirmavam virou responsabilidade da Task 2. Não deixar nenhum vermelho.

- [ ] **Step 5: Injetar o defeito**

Trocar o `catch` para `return null` sempre. O teste que prende o `panoramaId` na falha precisa cair. Se não cair, ele não guarda nada — reescrever antes de seguir. Restaurar.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-draft.store.ts inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts
git commit -m "refactor(client): o envio da captura separa-se da espera da IA"
```

---

### Task 2: O acompanhador de montagem no store

Um laço por tour, reusando `acompanharMontagem`. É a peça que faltava para o estado "tratando" poder existir sem mentir.

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Test: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Interfaces:**
- Consumes: `enviarCaptura` da Task 1.
- Produces:
  ```ts
  /** Passa a acompanhar a montagem deste tour. Idempotente. */
  acompanharTratamentos(): void;
  /** As cenas que ainda esperam a IA. Fonte da trava da etapa 1. */
  readonly emTratamento: Signal<WizardScene[]>;
  /** True enquanto a tela de espera do modal está no ar. Aperta o intervalo. */
  readonly alguemOlhando: WritableSignal<boolean>;
  ```

- [ ] **Step 1: Escrever os testes que falham**

```ts
describe('acompanhador de tratamento', () => {
  it('leva a cena de treating a done e guarda a foto tratada', fakeAsync(() => {
    store.scenes.set([cena('a', { serverPanoramaId: 'pano-1', aiState: 'treating' })]);
    store.acompanharTratamentos();

    responderAndamento([{ id: 'pano-1', status: 'DONE' }], true);
    responderBaixarPreview('pano-1');
    tick();

    expect(store.scenes()[0].aiState).toBe('done');
    expect(store.scenes()[0].treatedImageUrl).toBeTruthy();
    discardPeriodicTasks();
  }));

  it('abre UM laço só, mesmo chamado três vezes', fakeAsync(() => {
    store.scenes.set([cena('a', { serverPanoramaId: 'pano-1', aiState: 'treating' })]);
    store.acompanharTratamentos();
    store.acompanharTratamentos();
    store.acompanharTratamentos();

    // Um único GET de andamento na primeira volta.
    expect(http.match((r) => r.url.includes('/montagem')).length).toBe(1);
    discardPeriodicTasks();
  }));

  it('FAILED e SKIPPED atravessam como terminais', fakeAsync(() => {
    store.scenes.set([
      cena('a', { serverPanoramaId: 'p1', aiState: 'treating' }),
      cena('b', { serverPanoramaId: 'p2', aiState: 'treating' }),
    ]);
    store.acompanharTratamentos();

    responderAndamento([
      { id: 'p1', status: 'FAILED' },
      { id: 'p2', status: 'SKIPPED' },
    ], true);
    tick();

    expect(store.scenes().map((s) => s.aiState)).toEqual(['failed', 'skipped']);
    expect(store.emTratamento().length).toBe(0);
    discardPeriodicTasks();
  }));

  /**
   * O caso que a decisão 6 do spec existe para impedir: sem isto a trava da
   * etapa 1 seria eterna, que é o mesmo defeito que ela corrige.
   */
  it('o estouro do teto derruba para failed local em vez de prender', fakeAsync(() => {
    store.scenes.set([cena('a', { serverPanoramaId: 'p1', aiState: 'treating' })]);
    store.acompanharTratamentos();

    tick(TETO_DO_ACOMPANHAMENTO_MS + 1000);

    expect(store.scenes()[0].aiState).toBe('failed');
    expect(store.emTratamento().length).toBe(0);
    discardPeriodicTasks();
  }));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`
Expected: FAIL — `store.acompanharTratamentos is not a function`.

- [ ] **Step 3: Implementar**

No topo do arquivo, ao lado das outras constantes:

```ts
/**
 * Teto do acompanhamento em segundo plano.
 *
 * Generoso porque ninguém está parado olhando: o que estoura aqui é caso
 * patológico, não espera normal. Passado o teto, a cena cai para `failed`
 * LOCAL — ver `acompanharTratamentos`. A montagem em si continua no
 * servidor, e uma retomada posterior encontra o resultado.
 */
const TETO_DO_ACOMPANHAMENTO_MS = 10 * 60 * 1000;

/** Com a tela de espera no ar, e sem ela. Ver a decisão 7 do spec. */
const INTERVALO_OLHANDO_MS = 3000;
const INTERVALO_DE_FUNDO_MS = 10_000;
```

No corpo da classe:

```ts
/**
 * A tela de espera do modal está no ar.
 *
 * Só aperta o intervalo do laço: com o corretor fotografando o cômodo
 * seguinte, um GET a cada três segundos é rede e bateria em campo para uma
 * resposta que ninguém está esperando ver.
 */
readonly alguemOlhando = signal(false);

/** As cenas que ainda esperam a IA. É a fonte da trava da etapa 1. */
readonly emTratamento = computed(() =>
  this.scenes().filter((s) => s.aiState === 'treating'),
);

/** Um laço por tour. `null` quando não há nenhum vivo. */
private acompanhamento: AbortController | null = null;

/**
 * Passa a acompanhar a montagem deste tour, se já não estiver.
 *
 * Idempotente de propósito: quem chama é cada captura confirmada, e um laço
 * por captura abriria N conexões baixando o tour INTEIRO a cada poucos
 * segundos para olhar uma linha. `acompanharMontagem` já é por tour e já
 * devolve a lista cômodo a cômodo — é a forma que este método reusa.
 */
acompanharTratamentos(): void {
  if (this.acompanhamento) return;
  const tourId = this.rascunhoTourId();
  if (!tourId) return;

  const controle = new AbortController();
  this.acompanhamento = controle;
  const encerrar = () => controle.abort();
  this.abortar.signal.addEventListener('abort', encerrar, { once: true });

  void this.virtualTourService
    .acompanharMontagem(
      tourId,
      (andamento) => this.aplicarAndamento(andamento),
      {
        sinal: controle.signal,
        limiteMs: TETO_DO_ACOMPANHAMENTO_MS,
        // FUNÇÃO, e não número: `acompanharMontagem` lê o intervalo a cada
        // volta do laço. Passar `this.alguemOlhando() ? a : b` aqui fixaria o
        // valor do INSTANTE em que o laço nasceu — e ele nasce exatamente
        // quando o corretor está saindo do preview, então ficaria travado no
        // intervalo lento para sempre, inclusive na volta dele.
        intervaloMs: () =>
          this.alguemOlhando() ? INTERVALO_OLHANDO_MS : INTERVALO_DE_FUNDO_MS,
      },
    )
    .finally(() => {
      this.abortar.signal.removeEventListener('abort', encerrar);
      this.acompanhamento = null;
      // Estourou o teto com cômodo ainda em curso: derruba para terminal
      // local. Sem isto a trava da etapa 1 seria eterna — o mesmo defeito
      // que ela existe para corrigir.
      for (const cena of this.emTratamento()) {
        this.patchScene(cena.id, { aiState: 'failed' });
      }
    });
}

/** Traduz uma volta do acompanhamento para as cenas. */
private aplicarAndamento(andamento: AndamentoDaMontagem): void {
  for (const p of andamento.panoramas) {
    const cena = this.scenes().find((s) => s.serverPanoramaId === p.id);
    if (!cena || cena.aiState !== 'treating') continue;

    // `p.status`, e não `p.treatmentStatus`: `AndamentoDoPanorama` é
    // `{ id, status }`. O nome da coluna do Prisma fica no servidor.
    const estado = ESTADO_DA_IA[p.status] ?? 'idle';
    if (estado === 'treating' || estado === 'idle') continue;

    this.patchScene(cena.id, { aiState: estado });
    if (estado === 'done') void this.baixarTratada(cena.id, p.id);
  }
}

/**
 * Troca a foto da cena pela versão tratada.
 *
 * O `objectURL` fica pendurado na cena e é revogado no descarte — ver
 * `reset()` e `removeScene`. Uma equirretangular por cômodo é grande o
 * bastante para que o vazamento apareça no aparelho.
 */
private async baixarTratada(sceneId: string, panoramaId: string): Promise<void> {
  try {
    const blob = await firstValueFrom(
      this.virtualTourService.baixarPreview(panoramaId, 'treated'),
    );
    this.patchScene(sceneId, { treatedImageUrl: URL.createObjectURL(blob) });
  } catch {
    // A montagem existe no servidor; o que falhou foi trazer a imagem. O
    // estado terminal já foi gravado, e a trava já liberou.
  }
}
```

`rascunhoTourId` é o sinal que já existe em `tour-draft.store.ts:966`.

**`VirtualTourService.acompanharMontagem` precisa aceitar o intervalo como função.** Hoje `intervaloMs` é `number` e é lido uma vez. Mudar a assinatura para `number | (() => number)` e resolver a cada volta, dentro do `while`:

```ts
const passo = typeof intervaloMs === 'function' ? intervaloMs() : intervaloMs;
await espera(passo, sinal);
```

Teste próprio para isso, em `virtual-tour.service.spec.ts`: um acompanhamento com função que devolve 3000 na primeira volta e 10000 na segunda espera tempos diferentes entre as voltas.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`
Expected: os quatro testes novos passam.

- [ ] **Step 5: Injetar dois defeitos, um de cada vez**

1. Tirar a guarda `if (this.acompanhamento) return;` — o teste do laço único precisa cair.
2. Tirar o laço do `.finally()` que derruba para `failed` — o teste do estouro precisa cair.

Restaurar depois de cada um.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-draft.store.ts inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts
git commit -m "feat(client): um acompanhador de montagem por tour, no store"
```

---

### Task 3: O estado `treating` volta a existir

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.model.ts:99-111`
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts` (`ESTADO_DA_IA`)
- Modify: `inner-view-client/src/app/tour-wizard/steps/step-images/step-images.component.html:177`
- Modify: `inner-view-client/src/app/tour-wizard/steps/step-images/step-images.component.scss`
- Modify: `inner-view-client/src/assets/i18n/pt.json`, `en.json`
- Test: `inner-view-client/src/app/tour-wizard/steps/step-images/step-images.component.spec.ts`

**Interfaces:**
- Consumes: `emTratamento` da Task 2.
- Produces: `WizardSceneAiState` passa a incluir `'treating'`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('acende o selo de tratando no card, e apaga quando a IA termina', () => {
  store.scenes.set([scene('sala', { aiState: 'treating' })]);
  render();

  expect(fixture.nativeElement.querySelector('.tw-deck__status-icon.is-treating')).not.toBeNull();

  store.scenes.update((s) => [{ ...s[0], aiState: 'done' as const }]);
  render();

  expect(fixture.nativeElement.querySelector('.tw-deck__status-icon.is-treating')).toBeNull();
  expect(fixture.nativeElement.querySelector('.tw-deck__status-icon.is-enhanced')).not.toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`
Expected: FAIL — o tipo não aceita `'treating'` (erro de compilação do TypeScript).

- [ ] **Step 3: Implementar**

Em `tour-wizard.model.ts`, o tipo e o comentário reescrito:

```ts
/**
 * O estágio da montagem por IA daquele cômodo.
 *
 * `'treating'` foi removido daqui uma vez, e o motivo está registrado porque
 * ele volta agora com a condição que faltava: *"como nenhuma tela do wizard
 * acompanha montagem, o selo acendia em foto que nunca seria tratada e não
 * saía mais. Um estado que ninguém alcança e ninguém encerra é onde a mentira
 * cabe."*
 *
 * Quem encerra agora é `TourDraftStore.acompanharTratamentos`, que tem teto e
 * derruba para `'failed'` se estourar. O estado deixou de ser uma mentira
 * possível porque passou a ter dono.
 *
 * `PENDING` continua virando `'idle'`, e não `'treating'`: é o `@default` da
 * coluna, e toda foto vinda de ARQUIVO nasce assim sem nunca ser tratada.
 */
export type WizardSceneAiState = 'idle' | 'treating' | 'done' | 'failed' | 'skipped';
```

Em `tour-draft.store.ts`:

```ts
const ESTADO_DA_IA: Record<TreatmentStatus, WizardSceneAiState> = {
  PENDING: 'idle',
  PROCESSING: 'treating',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};
```

No template, ao lado do `is-enhanced`:

```html
@if (item.scene.aiState === 'treating') {
  <span
    class="tw-deck__status-icon is-treating"
    role="img"
    [attr.aria-label]="'TOUR_WIZARD.STEP1.BADGE_TRATANDO' | translate"
    [attr.title]="'TOUR_WIZARD.STEP1.BADGE_TRATANDO' | translate">&#9881;</span>
}
```

No SCSS, respeitando `prefers-reduced-motion` como o resto do arquivo já faz:

```scss
.tw-deck__status-icon.is-treating {
  background: var(--tw-brand-soft);
  color: var(--tw-brand);
  animation: tw-treating-pulse 1.4s ease-in-out infinite;
}

@keyframes tw-treating-pulse {
  50% { opacity: 0.45; }
}
```

**Medir antes de commitar:** `npx sass --style=compressed --no-source-map src/app/tour-wizard/steps/step-images/step-images.component.scss | wc -c`. Se passar de 12288 o build QUEBRA. Em 10,46 kB há folga, mas o número tem que ser olhado.

i18n, nos dois arquivos:

```
"BADGE_TRATANDO": "Melhorando com IA…"        (pt)
"BADGE_TRATANDO": "Enhancing with AI…"        (en)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless` e depois o `sass` da medição.
Expected: teste passa; o tamanho compilado fica abaixo de 12288.

- [ ] **Step 5: Injetar o defeito**

Voltar `PROCESSING: 'idle'` no mapa. O teste do selo precisa cair. Restaurar.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-wizard.model.ts inner-view-client/src/app/tour-wizard/tour-draft.store.ts inner-view-client/src/app/tour-wizard/steps/step-images/ inner-view-client/src/assets/i18n/
git commit -m "feat(client): o estado tratando volta, agora com quem o encerre"
```

---

### Task 4: A trava da etapa 1

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts` (`canAdvance`)
- Modify: `inner-view-client/src/app/tour-wizard/ui/wizard-actions/wizard-actions.component.ts` (`motivoBloqueio`)
- Modify: `inner-view-client/src/assets/i18n/pt.json`, `en.json`
- Test: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`, `wizard-actions.component.spec.ts`

**Interfaces:**
- Consumes: `emTratamento` da Task 2, `'treating'` da Task 3.
- Produces: nenhuma assinatura nova.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('a etapa 1 segura enquanto houver cômodo em tratamento', () => {
  store.scenes.set([cena('a', { room: 'Sala', aiState: 'treating' })]);
  store.step.set(1);
  expect(store.canAdvance()).toBeFalse();
});

/**
 * O caso que o pedido original teria transformado em armadilha: os dois são
 * terminais no servidor e NUNCA viram `done`. Uma trava literal prenderia o
 * corretor na etapa 1 para sempre, já fora do imóvel.
 */
it('falha e dispensa ATRAVESSAM a trava', () => {
  store.scenes.set([
    cena('a', { room: 'Sala', aiState: 'failed' }),
    cena('b', { room: 'Cozinha', aiState: 'skipped' }),
  ]);
  store.step.set(1);
  expect(store.canAdvance()).toBeTrue();
});
```

E no spec da barra de ações:

```ts
it('explica que está esperando a IA quando é isso que segura', () => {
  store.scenes.set([cena('a', { room: 'Sala', aiState: 'treating' })]);
  store.step.set(1);
  render();
  expect(component.motivoBloqueio()).toBe('TOUR_WIZARD.COMMON.NEEDS_TREATMENT');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`
Expected: FAIL — `canAdvance()` devolve `true` com cômodo em tratamento.

- [ ] **Step 3: Implementar**

```ts
readonly canAdvance = computed(() => {
  if (!this.temImagem()) return false;
  // A etapa 1 cobra DUAS coisas: nome e nenhuma montagem em curso.
  //
  // "Em curso", e não "tratado": `failed` e `skipped` são terminais no
  // servidor e nunca virarão `done` — dispensa acontece com menos de quatro
  // fotos de referência, e falha é falha. Cobrar "tratado" prenderia o
  // corretor aqui para sempre, e ele já não está mais no imóvel para
  // refotografar. Ver a decisão 5 do spec.
  if (this.step() === 1) {
    return this.ambientesSemNome().length === 0 && this.emTratamento().length === 0;
  }
  // ... o resto como está
});
```

E em `motivoBloqueio`, ANTES da checagem de nome (a espera é a que o corretor não pode resolver sozinho, então é a que ele precisa ver primeiro):

```ts
if (this.store.step() === 1 && this.store.emTratamento().length) {
  return 'TOUR_WIZARD.COMMON.NEEDS_TREATMENT';
}
```

i18n:

```
"NEEDS_TREATMENT": "Espere a IA terminar de melhorar as fotos."      (pt)
"NEEDS_TREATMENT": "Wait for the AI to finish enhancing the photos." (en)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`

- [ ] **Step 5: Injetar o defeito**

Trocar a condição para `emTratamento().length === 0 && todasTratadas()`, ou seja, exigir `done` de todas. O teste de "falha e dispensa atravessam" precisa cair. Restaurar.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/ inner-view-client/src/assets/i18n/
git commit -m "feat(client): a etapa 1 segura enquanto a IA nao termina"
```

---

### Task 5: O preview imediato e o segundo botão

A task que o corretor enxerga.

**Files:**
- Modify: `inner-view-client/src/app/components/capture-360/capture-360.component.ts` (`tratarEEntao`, `usePanorama`)
- Modify: `inner-view-client/src/app/components/capture-360/capture-360.component.html` (bloco `@case ('preview')`)
- Modify: `inner-view-client/src/app/components/capture-360/capture-360.component.scss`
- Modify: `inner-view-client/src/app/tour-wizard/steps/step-images/step-images.component.ts` (`openCapture`)
- Modify: `inner-view-client/src/assets/i18n/pt.json`, `en.json`
- Test: `inner-view-client/src/app/components/capture-360/capture-360.component.spec.ts`, `step-images.component.spec.ts`

**Interfaces:**
- Consumes: `enviarCaptura` (Task 1), `acompanharTratamentos` e `alguemOlhando` (Task 2).
- Produces: o modal passa a devolver `continuar: boolean` junto do resto do `dismiss`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('mostra o preview logo depois da costura, sem esperar a IA', fakeAsync(() => {
  // `enviar` fica pendente de propósito: é o envio, não a IA.
  component.enviar = () => new Promise(() => undefined);
  costurar();
  tick();

  expect(component.state()).toBe('preview');
  expect(el().querySelector('.capture-selo')).not.toBeNull();
}));

it('o segundo botão confirma E pede para continuar', fakeAsync(() => {
  component.enviar = () => Promise.resolve({ panoramaId: 'p1', tratamentoPedido: true });
  costurar();
  tick();

  el().querySelector<HTMLElement>('.result-actions__continuar')!.click();
  tick();

  expect(modalCtrl.dismiss).toHaveBeenCalledWith(
    jasmine.objectContaining({ serverPanoramaId: 'p1', continuar: true }),
    'confirm',
  );
}));

/**
 * O defeito que a decisão 9 do spec existe para impedir: sair antes de o
 * envio responder deixaria a cena sem `serverPanoramaId`, e o rascunho
 * criaria um SEGUNDO panorama para o mesmo cômodo.
 */
it('o botão espera o envio antes de fechar, se ele ainda não respondeu', fakeAsync(() => {
  let resolver: (v: { panoramaId: string; tratamentoPedido: boolean }) => void;
  component.enviar = () => new Promise((r) => (resolver = r));
  costurar();
  tick();

  el().querySelector<HTMLElement>('.result-actions__continuar')!.click();
  tick();
  expect(modalCtrl.dismiss).not.toHaveBeenCalled();

  resolver!({ panoramaId: 'p9', tratamentoPedido: true });
  tick();
  expect(modalCtrl.dismiss).toHaveBeenCalledWith(
    jasmine.objectContaining({ serverPanoramaId: 'p9' }),
    'confirm',
  );
}));
```

E no spec da etapa 1:

```ts
it('reabre a câmera quando o modal pede para continuar', async () => {
  prepararModal({ role: 'confirm', data: { ...capturaValida(), continuar: true } });
  await component.openCapture();
  expect(modalController.create).toHaveBeenCalledTimes(2);
});

it('a captura confirmada acende o acompanhador', async () => {
  const espia = spyOn(store, 'acompanharTratamentos');
  prepararModal({ role: 'confirm', data: { ...capturaValida(), continuar: false } });
  await component.openCapture();
  expect(espia).toHaveBeenCalled();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`
Expected: FAIL — `component.enviar` não existe e `.capture-selo` não está no DOM.

- [ ] **Step 3: Implementar**

No modal, trocar o callback `tratar` por `enviar`, e reescrever `tratarEEntao`:

```ts
/** Quem sabe subir a captura e PEDIR a montagem. Injetado pelo wizard. */
enviar?: (captura: {
  imageData: string;
  frames: CaptureFrameUpload[];
  geometry: CaptureGeometry | null;
}) => Promise<{ panoramaId: string; tratamentoPedido: boolean } | null>;

/** O envio em curso. `usePanorama` espera por ele, e só por ele. */
private envio: Promise<{ panoramaId: string; tratamentoPedido: boolean } | null> | null = null;

/** A IA ainda está montando este cômodo. Acende o selo sobre o preview. */
readonly tratando = signal(false);

/**
 * Avisa o wizard de que há alguém de olho nesta espera.
 *
 * O modal não alcança o `TourDraftStore` — o `ModalController` cria o
 * componente fora da árvore da página, e é por isso que `enviar` também
 * chega por `componentProps` em vez de injeção.
 */
aoOlhar?: (olhando: boolean) => void;

/**
 * Entrega o preview e deixa a IA para trás.
 *
 * O que mudou: antes este método SEGURAVA a tela até a IA terminar, para que
 * o corretor visse o resultado bom no instante de maior atenção. A espera
 * chegou a um minuto e meio por cômodo, paga N vezes num tour.
 *
 * Agora o preview entra com o panorama COSTURADO e um selo dizendo que a IA
 * ainda está melhorando. Isso responde à objeção que derrubou a primeira
 * tentativa de segundo plano: o que ela entregava era o cru SEM AVISO, e ele
 * se lia como resultado final. Com o selo, ele se lê como provisório, e quem
 * espera vê a foto boa trocar sozinha embaixo.
 *
 * O envio continua aguardado — mas não aqui, e sim em `usePanorama`. Ver a
 * decisão 9 do spec: sair sem o `serverPanoramaId` duplicaria o cômodo.
 */
private tratarEEntao(costurado: string): void {
  const frames: CaptureFrameUpload[] = this.stitchedShots.map((shot, index) => ({
    index,
    blob: shot.frame.blob,
    quaternion: shot.quaternion,
  }));

  if (!this.enviar || !frames.length) {
    this.mostrarPreview(costurado);
    return;
  }

  this.zone.run(() => {
    this.tratando.set(true);
    // Alguém está olhando ESTE cômodo esperar: aperta o intervalo do laço,
    // para que a troca da foto aconteça enquanto a pessoa ainda está na tela.
    this.aoOlhar?.(true);
    this.mostrarPreview(costurado);
  });

  this.envio = this.enviar({ imageData: costurado, frames, geometry: this.geometry })
    .catch(() => null);
}
```

`usePanorama` passa a esperar o envio e a receber o destino:

```ts
async usePanorama(continuar = false): Promise<void> {
  const imageData = this.originalImageData;
  if (!imageData) {
    this.modalCtrl.dismiss(null, 'cancel');
    return;
  }

  // O envio, e NUNCA a IA. Na prática ele já terminou enquanto a pessoa
  // digitava o nome; quando não terminou, esperar aqui é o que impede a
  // cena de nascer sem `serverPanoramaId` e o rascunho de criar um segundo
  // panorama para o mesmo cômodo.
  const r = this.envio ? await this.envio : null;
  this.serverPanoramaId = r?.panoramaId ?? null;

  const frames: CaptureFrameUpload[] = this.stitchedShots.map((shot, index) => ({
    index,
    blob: shot.frame.blob,
    quaternion: shot.quaternion,
  }));

  this.modalCtrl.dismiss(
    {
      imageData,
      frames,
      geometry: this.geometry,
      room: this.roomName().trim(),
      serverPanoramaId: this.serverPanoramaId,
      emTratamento: r?.tratamentoPedido ?? false,
      continuar,
    },
    'confirm',
  );
}
```

No template, dentro de `@case ('preview')`, o selo sobre o viewer e a dupla de botões:

```html
@if (tratando()) {
  <p class="capture-selo" role="status">{{ 'CAPTURE.TRATANDO_SELO' | translate }}</p>
}
```

```html
<div class="result-actions">
  <p class="result-actions__nota">{{ 'CAPTURE.PODE_CONTINUAR' | translate }}</p>
  <ion-button fill="outline" class="on-dark" (click)="restart()">
    {{ 'CAPTURE.RETAKE' | translate }}
  </ion-button>
  <ion-button (click)="usePanorama()">{{ 'CAPTURE.USE' | translate }}</ion-button>
  <ion-button class="result-actions__continuar" (click)="usePanorama(true)">
    {{ 'CAPTURE.PROXIMO_COMODO' | translate }}
  </ion-button>
</div>
```

Em `step-images.openCapture`, trocar a injeção e reagir ao `continuar`:

```ts
componentProps: {
  enviar: (captura: Parameters<TourDraftStore['enviarCaptura']>[0]) =>
    this.store.enviarCaptura(captura),
  // A tela de espera do modal está no ar: aperta o intervalo do laço.
  aoOlhar: (olhando: boolean) => this.store.alguemOlhando.set(olhando),
},
```

e depois do `addCapturedScene`:

```ts
...(data.emTratamento ? { aiState: 'treating' as const } : {}),
```

```ts
// A cena entrou em tratamento: garante que existe alguém acompanhando.
if (data.emTratamento) this.store.acompanharTratamentos();

// "Capturar próximo cômodo": o mesmo gesto confirma e reabre a câmera.
if (data.continuar) {
  void this.openCapture();
  return;
}
```

i18n:

```
"TRATANDO_SELO": "Melhorando com IA…"                      (pt)
"PODE_CONTINUAR": "Não se preocupe, você pode continuar"    (pt)
"PROXIMO_COMODO": "Capturar próximo cômodo"                 (pt)

"TRATANDO_SELO": "Enhancing with AI…"                       (en)
"PODE_CONTINUAR": "Don't worry, you can keep going"         (en)
"PROXIMO_COMODO": "Capture next room"                       (en)
```

E em `ngOnDestroy`, junto do `teardownSources()` que já está lá:

```ts
// Ninguém mais olhando: o laço volta ao intervalo de fundo. Aqui e não no
// `dismiss` porque fechar pelo X, pelo gesto de voltar do Android e pelo
// botão são três caminhos, e só este passa por todos.
this.aoOlhar?.(false);
```

O estado `'treating'` do modal e a chave `CAPTURE.TRATANDO_TITULO` deixam de ser alcançados. Remover os dois, e o `@case ('treating')` do template, em vez de deixar código morto.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless` e `npm run lint`.

- [ ] **Step 5: Injetar o defeito**

Tirar o `await this.envio` de `usePanorama`. O teste que prende a espera do envio precisa cair. Restaurar.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/components/capture-360/ inner-view-client/src/app/tour-wizard/steps/step-images/ inner-view-client/src/assets/i18n/
git commit -m "feat(client): confirmar e ja capturar o proximo comodo"
```

---

### Task 6: A retomada de rascunho acende o acompanhador

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts` (onde o rascunho é carregado, perto de `tour-draft.store.ts:1116`)
- Test: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Interfaces:**
- Consumes: `acompanharTratamentos` (Task 2), `ESTADO_DA_IA` com `'treating'` (Task 3).
- Produces: nenhuma assinatura nova.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('um rascunho retomado com cômodo em PROCESSING acende o acompanhador', fakeAsync(() => {
  const espia = spyOn(store, 'acompanharTratamentos').and.callThrough();

  carregarRascunho([{ id: 'p1', treatmentStatus: 'PROCESSING' }]);
  tick();

  expect(store.scenes()[0].aiState).toBe('treating');
  expect(espia).toHaveBeenCalled();
  discardPeriodicTasks();
}));
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`
Expected: FAIL — `acompanharTratamentos` não foi chamado.

- [ ] **Step 3: Implementar**

Logo depois de as cenas do rascunho serem gravadas:

```ts
// Conserta uma limitação antiga: o rascunho retomado no meio de uma montagem
// mostrava o cômodo como se nada estivesse acontecendo, e o resultado só
// aparecia numa retomada POSTERIOR. Agora ele chega enquanto a tela vive.
if (this.emTratamento().length) this.acompanharTratamentos();
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`

- [ ] **Step 5: Injetar o defeito**

Comentar a chamada. O teste precisa cair. Restaurar.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-draft.store.ts inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts
git commit -m "feat(client): rascunho retomado volta a acompanhar a montagem"
```

---

### Task 7: O log de duração passa a medir a espera inteira

**Correção de premissa:** eu afirmei na primeira versão da spec que o servidor não registrava duração. Registra. `treat-panorama.service.ts:298` já loga `"montado com N fotos · volta X→Y · Zs"`. O problema é outro, e mais sutil: esse `Z` é `r.ms`, o tempo da **chamada ao modelo**. Fora dele ficam a espera na fila (`emAndamento` limita a concorrência), o download das referências e a gravação. E a linha só sai no sucesso.

Ou seja: a métrica que existe mede justamente a parte que **não** inclui a fila, que é onde a lentidão aparece quando dois corretores capturam ao mesmo tempo.

**Files:**
- Modify: `server-api/src/modules/panoramas/services/treat-panorama.service.ts` (`execute`, linha 177)

**Interfaces:**
- Consumes: nada do cliente. **Esta task é independente** e pode ser feita primeiro — é ela que começa a acumular os números.
- Produces: uma linha de log por panorama, nos três desfechos.

- [ ] **Step 1: Ler `execute` inteiro antes de tocar**

Run: `sed -n '177,246p' server-api/src/modules/panoramas/services/treat-panorama.service.ts`

Mapear os três pontos de saída: o `return` de sucesso, o `catch` que loga `"Montagem de X falhou"` (linha 223), e o caminho de `dispensar` (linha 404). Os três precisam da linha.

- [ ] **Step 2: Implementar**

No começo de `execute`, antes de qualquer `await`:

```ts
// O relógio começa na ENTRADA, e não quando o modelo é chamado.
//
// A linha que já existe em `montar` mede `r.ms`, o tempo da chamada à API.
// Entre uma coisa e outra estão a espera na fila — `emAndamento` limita a
// concorrência —, o download das referências e a gravação. É justamente a
// fila que cresce quando dois corretores capturam ao mesmo tempo, e era
// essa a parte invisível.
const entrou = Date.now();
```

E uma única função local para a saída, chamada nos três desfechos:

```ts
const registrarEspera = (desfecho: string) =>
  this.logger.log(
    `${panoramaId}: espera total ${((Date.now() - entrou) / 1000).toFixed(1)}s (${desfecho}).`,
  );
```

`registrarEspera('DONE')` antes do return de sucesso, `registrarEspera('FAILED')` no `catch` logo depois do `logger.error` existente, e `registrarEspera('SKIPPED')` onde `dispensar` é chamado a partir de `execute`.

Não mexer na linha de `montar`: as duas juntas é que respondem "quanto foi fila e quanto foi modelo".

- [ ] **Step 3: Verificar que compila**

Run: `cd server-api && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Sem teste unitário, e o motivo registrado**

Não existe spec para este serviço, e os specs do `server-api` vivem em `src/shared/imaging/`, sobre funções puras. Montar infraestrutura de teste do Nest com Prisma falso para prender o formato de uma linha de log custaria mais do que vale, e o valor da linha está no gráfico de produção, não na suíte.

A verificação é outra, e precisa ser feita de verdade depois do deploy: ler o log do Render filtrando por `"espera total"` e conferir que as três saídas aparecem. Registrar isso na descrição do PR como passo pendente, não como feito.

- [ ] **Step 5: Commit**

```bash
git add server-api/src/modules/panoramas/services/treat-panorama.service.ts
git commit -m "feat(api): mede a espera inteira do tratamento, nao so a chamada ao modelo"
```

---

### Task 8: Fechar o vazamento das fotos tratadas

`URL.createObjectURL` agora roda fora do modal, uma vez por cômodo. Uma equirretangular por cômodo é grande o bastante para aparecer no aparelho.

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts` (`reset`, `removeScene`)
- Test: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Interfaces:**
- Consumes: `baixarTratada` da Task 2.
- Produces: nenhuma assinatura nova.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('revoga a foto tratada ao remover a cena', () => {
  const revogar = spyOn(URL, 'revokeObjectURL');
  store.scenes.set([cena('a', { treatedImageUrl: 'blob:fake-1' })]);

  store.removeScene('a');

  expect(revogar).toHaveBeenCalledWith('blob:fake-1');
});

it('revoga todas as fotos tratadas no reset', () => {
  const revogar = spyOn(URL, 'revokeObjectURL');
  store.scenes.set([
    cena('a', { treatedImageUrl: 'blob:fake-1' }),
    cena('b', { treatedImageUrl: 'blob:fake-2' }),
  ]);

  store.reset();

  expect(revogar).toHaveBeenCalledWith('blob:fake-1');
  expect(revogar).toHaveBeenCalledWith('blob:fake-2');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless`
Expected: FAIL — `revokeObjectURL` nunca chamado.

- [ ] **Step 3: Implementar**

```ts
/**
 * Devolve a memória da foto tratada.
 *
 * Ela deixou de nascer dentro do modal e passou a nascer no acompanhador, uma
 * por cômodo, com a tela viva por todo o tour. Sem isto, um tour de oito
 * cômodos segura oito equirretangulares inteiras até a aba morrer.
 *
 * Só `blob:` — uma cena vinda do servidor traz URL de verdade, e revogar uma
 * dessas não faz nada mas confunde quem lê.
 */
private revogarTratada(cena: WizardScene): void {
  if (cena.treatedImageUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(cena.treatedImageUrl);
  }
}
```

Chamar em `removeScene` antes de tirar a cena da lista, e em `reset()` para todas.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx ng test --configuration ci --browsers ChromeHeadless` e `npm run lint`.

- [ ] **Step 5: Injetar o defeito**

Tirar a guarda do `blob:` e passar a revogar tudo. O teste continua verde — ele não guarda essa parte. Ou acrescentar um caso com URL de servidor, ou registrar no comentário que a guarda é defensiva e não testada. Decidir explicitamente.

- [ ] **Step 6: Commit final e PR**

```bash
git add inner-view-client/src/app/tour-wizard/
git commit -m "fix(client): devolve a memoria das fotos tratadas"
```

Antes de abrir o PR:

```bash
cd inner-view-client
npx ng test --configuration ci --browsers ChromeHeadless   # todas verdes
npm run lint                                                # All files pass linting
npx ng build --configuration=production                     # sem ERROR de orcamento
```

PR **contra `main`**, nunca contra outro branch de feature.

---

## Ordem e paralelismo

As tasks 1 → 2 → 3 → 4 → 5 são uma corrente: cada uma consome a anterior. A 6 depende da 2 e da 3. A 8 depende da 2.

A **Task 7 é independente** — toca só o servidor e pode ser feita a qualquer momento, inclusive primeiro, já que é ela que começa a acumular os números que vão dizer se o problema de fundo continua de pé.

## O que revisar na tela, que teste nenhum pega

1. O selo sobre o preview se lê como "ainda vem coisa melhor", e não como erro.
2. Três botões no rodapé do preview cabem num celular pequeno sem quebrar.
3. O selo do card pulsando não briga com o `is-enhanced` que aparece logo depois.
4. A troca da foto costurada pela tratada, com o corretor olhando, não pisca.
