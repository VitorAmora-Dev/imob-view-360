# IM-45 — A home sugere a criação de um tour — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A home deixa de mostrar uma página em branco quando a conta não tem tour, e passa a distinguir seis estados — carregando, erro, conta vazia, imóveis sem tour, lista e busca sem resultado — sugerindo a criação de um tour nos dois casos em que isso faz sentido.

**Architecture:** `HomePage` vira dona do estado (signals + um `computed` de precedência extraído para uma função pura e testável sem DOM). Dois componentes novos de apresentação renderizam os estados. `inner-view-card` ganha um botão "Criar tour" que navega com intenção, e `inner-view-page` lê essa intenção para abrir o seletor de imagem ao chegar. `inner-view-list` não muda.

**Tech Stack:** Angular 20 (standalone, signals, control flow `@if`/`@for`), Ionic 8, ngx-translate, SCSS com tokens `--app-*`, Karma + Jasmine.

**Spec:** `docs/superpowers/specs/2026-08-20-im-45-home-sugere-criacao-de-tour-design.md`

---

## Convenções deste repositório (leia antes de começar)

Vêm do `.agents/AGENTS.md` e valem para toda tarefa abaixo:

- **Código em inglês; comentários e documentação em português.**
- **Nunca hex solto** — usar os tokens `--app-*` / `--ion-color-*`.
- **Nunca string cravada no template** — tudo por `ngx-translate`, em `pt.json` **e** `en.json`.
- **Commits na convenção angular**: `feat(client):`, `fix(client):`, `test(client):`, `docs(client):`.
- **A árvore inteira é CRLF.** Não rode formatador que reescreva finais de linha — destrói o `git blame`.

### Comandos verificados nesta máquina

Rodar um arquivo de teste:

```bash
cd inner-view-client
npx ng test --include=src/app/home/home.page.spec.ts --watch=false --browsers=ChromeHeadless
```

Rodar a suíte inteira:

```bash
cd inner-view-client
npx ng test --watch=false --browsers=ChromeHeadless
```

Lint (roda o verificador de crases antes do eslint):

```bash
cd inner-view-client
npm run lint
```

### Como os testes leem texto traduzido

O TestBed usa `provideTranslateService` **sem loader de HTTP**, então o
`TranslatePipe` devolve a própria chave. Asserções sobre texto verificam a
**chave** (`'HOME.EMPTY_TITLE'`), não a frase em português. Isso é proposital: o
teste não quebra quando alguém reescreve a cópia.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| **Criar** `src/app/home/home-view.ts` | O tipo `HomeView` e a função pura `resolveHomeView()`. A regra de precedência, testável sem DOM. |
| **Criar** `src/app/home/home-view.spec.ts` | Testa a precedência, incluindo o caso que inverte com facilidade. |
| **Criar** `src/app/models/navigation-intent.ts` | A constante `ADD_TOUR_INTENT`, compartilhada entre o card e a página do imóvel. |
| **Criar** `src/app/components/home-placeholder/*` | Apresentação dos estados `loading`, `error`, `empty` e `no-results`. |
| **Criar** `src/app/components/home-no-tour-banner/*` | A faixa do estado 4. |
| **Modificar** `src/app/home/home.page.ts\|html\|scss\|spec.ts` | Estado da página e ramificação dos seis estados. |
| **Modificar** `src/app/components/inner-view-card/*` | O botão "Criar tour". |
| **Modificar** `src/app/inner-view-page/inner-view-page.page.ts` | Ler a intenção na chegada. |
| **Modificar** `src/assets/i18n/pt.json`, `en.json` | Chaves novas do bloco `HOME`. |

**Desvio da spec, deliberado:** a spec sugeriu exportar a constante da intenção
"do lado do `inner-view-page`". Ela mora em `src/app/models/navigation-intent.ts`
porque o card é um componente e a página é uma página — importar de uma página
para dentro de um componente inverte a direção de dependência que o resto do
código respeita (o card já importa de `../../models/`). O efeito prático é o
mesmo: uma constante só, num lugar só.

---

### Task 1: A regra de precedência, como função pura

**Files:**
- Create: `inner-view-client/src/app/home/home-view.ts`
- Test: `inner-view-client/src/app/home/home-view.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `inner-view-client/src/app/home/home-view.spec.ts`:

```ts
import { resolveHomeView } from './home-view';

describe('resolveHomeView', () => {
  it('carregando vence tudo', () => {
    expect(resolveHomeView({ status: 'loading', total: 0, filtered: 0 })).toBe('loading');
    expect(resolveHomeView({ status: 'loading', total: 5, filtered: 5 })).toBe('loading');
  });

  it('erro vence o conteudo', () => {
    expect(resolveHomeView({ status: 'error', total: 0, filtered: 0 })).toBe('error');
    expect(resolveHomeView({ status: 'error', total: 5, filtered: 5 })).toBe('error');
  });

  // Esta e' a asserção que trava a precedencia. Como `filtered <= total`
  // sempre, `total === 0` arrasta `filtered === 0` junto — entao conta vazia
  // COM busca ativa cai exatamente aqui, e o que decide que ela vê onboarding
  // em vez de "nenhum resultado" e' esta checagem vir ANTES da de `filtered`.
  it('conta sem imovel algum e onboarding', () => {
    expect(resolveHomeView({ status: 'ready', total: 0, filtered: 0 })).toBe('empty');
  });

  it('busca que nao casou nada, com acervo, e "sem resultado"', () => {
    expect(resolveHomeView({ status: 'ready', total: 5, filtered: 0 })).toBe('no-results');
  });

  it('com itens filtrados e lista', () => {
    expect(resolveHomeView({ status: 'ready', total: 5, filtered: 5 })).toBe('list');
    expect(resolveHomeView({ status: 'ready', total: 5, filtered: 1 })).toBe('list');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd inner-view-client
npx ng test --include=src/app/home/home-view.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: FALHA na compilação — `Cannot find module './home-view'`.

- [ ] **Step 3: Implementar o mínimo**

Criar `inner-view-client/src/app/home/home-view.ts`:

```ts
/** Situação da requisição que alimenta a home. */
export type HomeStatus = 'loading' | 'error' | 'ready';

/** Qual bloco a home renderiza. Os estados 4 e 5 da spec são ambos `list`. */
export type HomeView = 'loading' | 'error' | 'empty' | 'no-results' | 'list';

/**
 * Invariante: `filtered <= total`, sempre — `filtered` e' o resultado de
 * filtrar a mesma lista que `total` conta. Trocar os dois de lugar na chamada
 * nao e' erro de TypeScript e nao e' cosmetico: quem tem imoveis e busca sem
 * resultado passaria a ver o onboarding de conta vazia.
 */
export interface HomeViewInput {
  readonly status: HomeStatus;
  /** Quantos imóveis a conta tem, ignorando a busca. */
  readonly total: number;
  /** Quantos sobraram depois do filtro da busca. */
  readonly filtered: number;
}

/**
 * A ordem aqui É o contrato, porque duas condições podem valer ao mesmo tempo.
 *
 * O caso que decide a ordem: conta sem nenhum imóvel com texto na busca
 * satisfaz `total === 0` e `filtered === 0` juntos. Ganha `empty` — quem não
 * tem imóvel algum precisa do onboarding, não de "nenhum resultado para xyz",
 * que sugeriria que existe acervo e o termo é que não casou.
 */
export function resolveHomeView({ status, total, filtered }: HomeViewInput): HomeView {
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  if (total === 0) return 'empty';
  if (filtered === 0) return 'no-results';
  return 'list';
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd inner-view-client
npx ng test --include=src/app/home/home-view.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: `TOTAL: 5 SUCCESS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/home/home-view.ts inner-view-client/src/app/home/home-view.spec.ts
git commit -m "feat(client): a precedencia dos estados da home, como funcao pura

A ordem entre 'conta vazia' e 'busca sem resultado' e' contrato, nao
detalhe: as duas condicoes valem juntas na conta vazia com busca ativa.
Fora do componente, ela e' testavel sem DOM e sem TestBed."
```

---

### Task 2: As chaves de i18n

**Files:**
- Modify: `inner-view-client/src/assets/i18n/pt.json`
- Modify: `inner-view-client/src/assets/i18n/en.json`

Não há teste próprio: as chaves são exercitadas pelos testes das tarefas 3 a 7,
que asseguram que o template referencia exatamente estes nomes.

- [ ] **Step 1: Substituir o bloco `HOME` em `pt.json`**

O bloco hoje tem uma chave só. Trocar por:

```json
  "HOME": {
    "SEARCH_PLACEHOLDER": "Buscar lugares...",
    "LOADING": "Carregando seus imóveis...",
    "ERROR_TEXT": "Não foi possível carregar seus imóveis.",
    "ERROR_RETRY": "Tentar de novo",
    "EMPTY_TITLE": "Comece pelo seu primeiro tour",
    "EMPTY_TEXT": "Um tour 360° mostra o imóvel por dentro e é o que o cliente abre primeiro. Leva alguns minutos.",
    "EMPTY_CTA": "Criar meu primeiro tour",
    "NO_TOUR_BANNER": "{{n}} imóveis ainda não possuem imagens 360°.",
    "NO_TOUR_BANNER_ONE": "1 imóvel ainda não possui imagens 360°.",
    "CARD_CREATE_TOUR": "Criar tour",
    "CARD_CREATE_TOUR_LABEL": "Criar tour para {{title}}",
    "NO_RESULTS": "Nenhum imóvel encontrado para \"{{query}}\"."
  },
```

- [ ] **Step 2: Substituir o bloco `HOME` em `en.json`**

```json
  "HOME": {
    "SEARCH_PLACEHOLDER": "Search places...",
    "LOADING": "Loading your properties...",
    "ERROR_TEXT": "We could not load your properties.",
    "ERROR_RETRY": "Try again",
    "EMPTY_TITLE": "Start with your first tour",
    "EMPTY_TEXT": "A 360° tour shows the property from the inside and is what clients open first. It takes a few minutes.",
    "EMPTY_CTA": "Create my first tour",
    "NO_TOUR_BANNER": "{{n}} properties do not have 360° images yet.",
    "NO_TOUR_BANNER_ONE": "1 property does not have 360° images yet.",
    "CARD_CREATE_TOUR": "Create tour",
    "CARD_CREATE_TOUR_LABEL": "Create tour for {{title}}",
    "NO_RESULTS": "No property found for \"{{query}}\"."
  },
```

- [ ] **Step 3: Verificar que os dois JSON continuam válidos e com as mesmas chaves**

```bash
cd inner-view-client
node -e "
const pt=require('./src/assets/i18n/pt.json'), en=require('./src/assets/i18n/en.json');
const a=Object.keys(pt.HOME).sort(), b=Object.keys(en.HOME).sort();
if (JSON.stringify(a)!==JSON.stringify(b)) { console.error('DIVERGEM:', a, b); process.exit(1); }
console.log('OK, ' + a.length + ' chaves iguais nos dois idiomas');
"
```

Esperado: `OK, 12 chaves iguais nos dois idiomas`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add inner-view-client/src/assets/i18n/pt.json inner-view-client/src/assets/i18n/en.json
git commit -m "feat(client): textos dos estados da home, nos dois idiomas

O plural segue a convencao que o projeto ja usa — sufixo _ONE escolhido no
TypeScript, como em SCENES_COUNT_ONE. Sem ele a faixa diria '1 imoveis' na
conta com um imovel so, que e' a conta mais provavel de ver a faixa."
```

---

### Task 3: `HomePlaceholderComponent`

**Files:**
- Create: `inner-view-client/src/app/components/home-placeholder/home-placeholder.component.ts`
- Create: `inner-view-client/src/app/components/home-placeholder/home-placeholder.component.html`
- Create: `inner-view-client/src/app/components/home-placeholder/home-placeholder.component.scss`
- Test: `inner-view-client/src/app/components/home-placeholder/home-placeholder.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `home-placeholder.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { HomePlaceholderComponent } from './home-placeholder.component';

describe('HomePlaceholderComponent', () => {
  let fixture: ComponentFixture<HomePlaceholderComponent>;
  let component: HomePlaceholderComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePlaceholderComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePlaceholderComponent);
    component = fixture.componentInstance;
  });

  function render(inputs: Partial<HomePlaceholderComponent>) {
    Object.assign(component, inputs);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  // O live region e' o PARAGRAFO, nao o bloco. `role="status"` implica
  // `aria-atomic`, entao envolver titulo e botao faria qualquer mudanca reler
  // tudo — e o texto de `no-results` carrega o termo buscado, que muda a cada
  // tecla. Este teste existe para impedir que alguem "suba" o role de volta.
  it('anuncia so o texto, e nao o bloco inteiro', () => {
    const el = render({ text: 'HOME.LOADING' });

    const paragrafo = el.querySelector('.home-placeholder__text')!;
    expect(paragrafo.getAttribute('role')).toBe('status');
    expect(paragrafo.getAttribute('aria-live')).toBe('polite');

    const bloco = el.querySelector('.home-placeholder')!;
    expect(bloco.getAttribute('role')).toBeNull();
    expect(bloco.getAttribute('aria-live')).toBeNull();
  });

  it('nao renderiza acao quando nao ha rotulo', () => {
    const el = render({ text: 'HOME.LOADING' });
    expect(el.querySelector('.home-placeholder__action')).toBeNull();
  });

  // As duas configuracoes visuais que a Task 8 usa de verdade — sem estes, um
  // defeito no `@if (spinner) ... @else if (icon)` passaria limpo.
  it('mostra spinner no estado de carregando', () => {
    const el = render({ spinner: true, text: 'HOME.LOADING' });
    expect(el.querySelector('ion-spinner')).not.toBeNull();
    expect(el.querySelector('.home-placeholder__icon')).toBeNull();
  });

  it('mostra icone quando nao ha spinner', () => {
    const el = render({ icon: 'alert-circle-outline', text: 'HOME.ERROR_TEXT' });
    const icone = el.querySelector('.home-placeholder__icon ion-icon')!;
    expect(icone).not.toBeNull();
    expect(icone.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('ion-spinner')).toBeNull();
  });

  it('renderiza a acao e emite ao clicar', () => {
    const el = render({ text: 'HOME.ERROR_TEXT', actionLabel: 'HOME.ERROR_RETRY' });
    const botao = el.querySelector('.home-placeholder__action') as HTMLButtonElement;
    expect(botao).not.toBeNull();
    expect(botao.textContent).toContain('HOME.ERROR_RETRY');

    let emitiu = 0;
    component.action.subscribe(() => emitiu++);
    botao.click();
    expect(emitiu).toBe(1);
  });

  it('titulo e opcional', () => {
    const semTitulo = render({ text: 'HOME.LOADING' });
    expect(semTitulo.querySelector('.home-placeholder__title')).toBeNull();

    const comTitulo = render({ heading: 'HOME.EMPTY_TITLE', text: 'HOME.EMPTY_TEXT' });
    expect(comTitulo.querySelector('.home-placeholder__title')!.textContent)
      .toContain('HOME.EMPTY_TITLE');
  });
});
```

> **Esperado agora: `TOTAL: 6 SUCCESS`** — os 4 originais mais os dois de
> configuração visual.

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd inner-view-client
npx ng test --include=src/app/components/home-placeholder/home-placeholder.component.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: FALHA — `Cannot find module './home-placeholder.component'`.

- [ ] **Step 3: Implementar**

Criar `home-placeholder.component.ts`:

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Bloco que ocupa o lugar do conteúdo quando ele não existe: carregando, erro,
 * conta vazia e busca sem resultado.
 *
 * Não injeta Router nem serviço — quem navega ou refaz a chamada é a HomePage.
 * O componente é desenho, e nada mais.
 */
@Component({
  selector: 'app-home-placeholder',
  templateUrl: './home-placeholder.component.html',
  styleUrls: ['./home-placeholder.component.scss'],
  standalone: true,
  imports: [IonIcon, IonSpinner, TranslatePipe],
})
export class HomePlaceholderComponent {
  /** Nome do ionicon. Sem ícone quando ausente. */
  @Input() icon?: string;
  /** Mostra o spinner no lugar do ícone. */
  @Input() spinner = false;
  /**
   * Chama-se `heading`, e não `title`, de propósito: `title` é atributo global
   * do HTML, e um chamador que escrevesse `title="HOME.EMPTY_TITLE"` sem
   * colchetes — a forma idiomática para valor literal — deixaria a chave crua
   * como atributo no host, e o navegador mostraria um tooltip nativo escrito
   * "HOME.EMPTY_TITLE".
   */
  @Input() heading?: string;
  /** Obrigatório: os quatro estados têm texto, e um `<p>` mudo não é estado. */
  @Input({ required: true }) text!: string;
  /** Parâmetros de interpolação do `text` (ex.: `{ query: 'sala' }`). */
  @Input() textParams: Record<string, unknown> = {};
  /** Sem rótulo, nenhuma ação é renderizada. */
  @Input() actionLabel?: string;

  @Output() action = new EventEmitter<void>();
}
```

Criar `home-placeholder.component.html`:

```html
<div class="home-placeholder">
  @if (spinner) {
    <ion-spinner name="crescent" class="home-placeholder__spinner"></ion-spinner>
  } @else if (icon) {
    <div class="home-placeholder__icon">
      <ion-icon [name]="icon" aria-hidden="true"></ion-icon>
    </div>
  }

  @if (heading) {
    <h2 class="home-placeholder__title">{{ heading | translate }}</h2>
  }

  <!--
    O live region fica no parágrafo, e não no bloco inteiro. `role="status"`
    implica `aria-atomic="true"`: envolvendo o título e o botão, qualquer
    mudança relê tudo — e no estado `no-results` o texto carrega o termo
    buscado, que muda a cada tecla. É também o padrão que o projeto já segue
    em `wizard-actions`, `address-accordion` e `step-hotspots`, todos com
    `role="status"` num `<p>` nu.
  -->
  <p class="home-placeholder__text" role="status" aria-live="polite">
    {{ text | translate: textParams }}
  </p>

  @if (actionLabel) {
    <button type="button" class="home-placeholder__action" (click)="action.emit()">
      {{ actionLabel | translate }}
    </button>
  }
</div>
```

Criar `home-placeholder.component.scss`:

```scss
.home-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 56px 20px;
  text-align: center;
}

.home-placeholder__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 9999px;
  background: var(--app-surface-soft);

  ion-icon {
    font-size: 28px;
    color: var(--app-muted);
  }
}

.home-placeholder__spinner {
  width: 28px;
  height: 28px;
  color: var(--app-muted);
}

.home-placeholder__title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--app-ink);
}

.home-placeholder__text {
  margin: 0;
  max-width: 44ch;
  font-size: 15px;
  line-height: 1.5;
  color: var(--app-muted);
  text-wrap: pretty;
}

.home-placeholder__action {
  // 48px de altura: acima do piso de 44px que o AGENTS.md exige.
  min-height: 48px;
  margin-top: 4px;
  padding-inline: 22px;
  border: none;
  border-radius: var(--app-radius-sm);
  background: var(--ion-color-primary);
  color: var(--ion-color-primary-contrast);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--ion-color-primary-shade);
  }

  &:focus-visible {
    outline: 2px solid var(--ion-color-primary);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd inner-view-client
npx ng test --include=src/app/components/home-placeholder/home-placeholder.component.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: `TOTAL: 6 SUCCESS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/components/home-placeholder/
git commit -m "feat(client): bloco de estado vazio da home

Serve carregando, erro, conta vazia e busca sem resultado em quatro
configuracoes. O role=status existe porque trocar de carregando para erro
sem anuncio deixa quem usa leitor de tela num silencio indistinguivel de
'ainda carregando'."
```

---

### Task 4: `HomeNoTourBannerComponent`

**Files:**
- Create: `inner-view-client/src/app/components/home-no-tour-banner/home-no-tour-banner.component.ts`
- Create: `inner-view-client/src/app/components/home-no-tour-banner/home-no-tour-banner.component.html`
- Create: `inner-view-client/src/app/components/home-no-tour-banner/home-no-tour-banner.component.scss`
- Test: `inner-view-client/src/app/components/home-no-tour-banner/home-no-tour-banner.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `home-no-tour-banner.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { HomeNoTourBannerComponent } from './home-no-tour-banner.component';

describe('HomeNoTourBannerComponent', () => {
  let fixture: ComponentFixture<HomeNoTourBannerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeNoTourBannerComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeNoTourBannerComponent);
  });

  // `setInput` e nao atribuicao: signal input e' somente leitura de fora. E' o
  // mesmo idioma de `scene-card.component.spec.ts:38`.
  function textoCom(count: number) {
    fixture.componentRef.setInput('count', count);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  // Sem isto a conta com um imovel so — a mais provavel de ver a faixa — leria
  // "1 imoveis ainda nao possuem imagens 360".
  it('usa a chave singular com um imovel', () => {
    expect(textoCom(1)).toContain('HOME.NO_TOUR_BANNER_ONE');
  });

  it('usa a chave plural com dois ou mais', () => {
    expect(textoCom(2)).toContain('HOME.NO_TOUR_BANNER');
    expect(textoCom(2)).not.toContain('HOME.NO_TOUR_BANNER_ONE');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd inner-view-client
npx ng test --include=src/app/components/home-no-tour-banner/home-no-tour-banner.component.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: FALHA — `Cannot find module './home-no-tour-banner.component'`.

- [ ] **Step 3: Implementar**

Criar `home-no-tour-banner.component.ts`:

```ts
import { Component, computed, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { informationCircleOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Faixa que acompanha a lista quando nenhum imóvel da conta tem tour.
 *
 * Informativa, sem ação: a ação mora nos cards, porque "2 imóveis sem tour" é
 * plural e um botão único teria de escolher um imóvel pela pessoa.
 *
 * Não é o `app-home-placeholder` porque não é placeholder de nada — não ocupa o
 * lugar de conteúdo ausente, acompanha conteúdo presente.
 */
@Component({
  selector: 'app-home-no-tour-banner',
  templateUrl: './home-no-tour-banner.component.html',
  styleUrls: ['./home-no-tour-banner.component.scss'],
  standalone: true,
  imports: [IonIcon, TranslatePipe],
})
export class HomeNoTourBannerComponent {
  /**
   * `input.required` e não `@Input` com setter: derivar `computed` de um input
   * é exatamente o que o signal input resolve, e é o que `scene-card` e
   * `hotspot-card` já fazem neste repositório. A ponte setter → signal privado
   * escreve à mão o que a API já entrega.
   *
   * Quem decide SE a faixa aparece é a HomePage. Com `count` 0 este componente
   * renderiza a chave plural — correto nos dois idiomas —, mas não é papel dele
   * se esconder.
   */
  readonly count = input.required<number>();

  /**
   * O projeto resolve plural por sufixo `_ONE` escolhido no TypeScript — mesma
   * convenção de `SCENES_COUNT_ONE` e `WARN_RATIO_ONE`.
   */
  readonly messageKey = computed(() =>
    this.count() === 1 ? 'HOME.NO_TOUR_BANNER_ONE' : 'HOME.NO_TOUR_BANNER',
  );

  readonly messageParams = computed(() => ({ n: this.count() }));

  constructor() {
    addIcons({ informationCircleOutline });
  }
}
```

Criar `home-no-tour-banner.component.html`:

```html
<div class="no-tour-banner">
  <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
  <p class="no-tour-banner__text">{{ messageKey() | translate: messageParams() }}</p>
</div>
```

Criar `home-no-tour-banner.component.scss`:

```scss
.no-tour-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: 1280px;
  margin: 12px auto 0;
  padding: 12px 14px;
  border-radius: var(--app-radius-md);
  background: var(--app-surface-soft);

  ion-icon {
    flex: 0 0 auto;
    margin-top: 1px;
    font-size: 18px;
    color: var(--app-muted);
  }
}

.no-tour-banner__text {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--app-body);
  text-wrap: pretty;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd inner-view-client
npx ng test --include=src/app/components/home-no-tour-banner/home-no-tour-banner.component.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: `TOTAL: 2 SUCCESS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/components/home-no-tour-banner/
git commit -m "feat(client): faixa de imoveis sem tour na home

Informativa, sem acao: a acao mora nos cards, porque a faixa fala de varios
imoveis e um botao unico teria de escolher um pela pessoa."
```

---

### Task 5: A constante da intenção de navegação

**Files:**
- Create: `inner-view-client/src/app/models/navigation-intent.ts`

Arquivo de uma constante, sem lógica — não tem teste próprio. Ele é exercitado
pelas tarefas 6 e 7, que o importam dos dois lados da navegação.

- [ ] **Step 1: Criar o arquivo**

```ts
/**
 * Intenção carregada no router state entre a home e a página do imóvel.
 *
 * Router state, e não query param, por duas razões: `onCardClick` já usa
 * `state: { property }`, então é o mesmo mecanismo; e um refresh não deve
 * reabrir o seletor de arquivo — com query param, reabriria.
 *
 * Mora em `models/` porque é consumida por um componente e por uma página;
 * exportá-la da página faria um componente depender de uma página, invertendo
 * a direção que o resto do código respeita.
 */
export const ADD_TOUR_INTENT = 'add-tour';
```

- [ ] **Step 2: Verificar que compila**

```bash
cd inner-view-client
npx tsc --noEmit -p tsconfig.app.json
```

Esperado: nenhuma saída, exit 0.

- [ ] **Step 3: Commit**

```bash
git add inner-view-client/src/app/models/navigation-intent.ts
git commit -m "feat(client): constante da intencao de criar tour

Uma string em router state nao e' verificada por tipo; a constante ao menos
garante que os dois lados da navegacao escrevem a mesma coisa."
```

---

### Task 6: O botão "Criar tour" no card

**Files:**
- Modify: `inner-view-client/src/app/components/inner-view-card/inner-view-card.component.ts`
- Modify: `inner-view-client/src/app/components/inner-view-card/inner-view-card.component.html`
- Modify: `inner-view-client/src/app/components/inner-view-card/inner-view-card.component.scss`
- Test: `inner-view-client/src/app/components/inner-view-card/inner-view-card.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Substituir todo o conteúdo de `inner-view-card.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { InnerViewCardComponent } from './inner-view-card.component';
import { Property } from '../../models/property.model';
import { ADD_TOUR_INTENT } from '../../models/navigation-intent';

function imovel(overrides: Partial<Property> = {}): Property {
  return {
    id: 'p1',
    code: 'RLX-001',
    title: 'Casa da Vila',
    type: 'HOUSE',
    purpose: 'SALE',
    status: 'AVAILABLE',
    agencyId: 'a1',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    virtualTour: null,
    ...overrides,
  };
}

describe('InnerViewCardComponent', () => {
  let fixture: ComponentFixture<InnerViewCardComponent>;
  let component: InnerViewCardComponent;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InnerViewCardComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InnerViewCardComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
  });

  function render(item: Property) {
    component.item = item;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('should create', () => {
    render(imovel());
    expect(component).toBeTruthy();
  });

  it('mostra o botao quando o imovel nao tem tour', () => {
    const el = render(imovel({ virtualTour: null }));
    expect(el.querySelector('.create-tour-btn')).not.toBeNull();
  });

  // O status padrao de tour e' DRAFT. Exigir PUBLISHED marcaria como "sem tour"
  // todo tour recem-criado pelo wizard.
  it('esconde o botao quando ha tour, inclusive DRAFT', () => {
    const comDraft = render(imovel({ virtualTour: { id: 't1', status: 'DRAFT' } }));
    expect(comDraft.querySelector('.create-tour-btn')).toBeNull();

    const comPublicado = render(imovel({ virtualTour: { id: 't1', status: 'PUBLISHED' } }));
    expect(comPublicado.querySelector('.create-tour-btn')).toBeNull();
  });

  it('nomeia o imovel no aria-label', () => {
    const el = render(imovel({ title: 'Casa da Vila' }));
    const botao = el.querySelector('.create-tour-btn')!;
    // Sem interpolacao carregada, o pipe devolve a chave — o que importa aqui e'
    // que o atributo exista e use a chave com parametro, e nao um texto fixo.
    expect(botao.getAttribute('aria-label')).toContain('HOME.CARD_CREATE_TOUR_LABEL');
  });

  it('navega com a intencao de criar tour', () => {
    const spy = spyOn(router, 'navigate');
    const el = render(imovel({ id: 'p9' }));

    (el.querySelector('.create-tour-btn') as HTMLButtonElement).click();

    expect(spy).toHaveBeenCalledWith(
      ['/inner-view-page', 'p9'],
      { state: { property: component.item, action: ADD_TOUR_INTENT } },
    );
  });

  // O ion-card inteiro e' clicavel; sem stopPropagation o handler do card
  // dispara junto e a navegacao COM intencao e' substituida pela sem intencao.
  it('nao dispara o clique do card junto', () => {
    const spy = spyOn(router, 'navigate');
    const el = render(imovel({ id: 'p9' }));

    (el.querySelector('.create-tour-btn') as HTMLButtonElement).click();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd inner-view-client
npx ng test --include=src/app/components/inner-view-card/inner-view-card.component.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: FALHA — os testes do botão não acham `.create-tour-btn`.

- [ ] **Step 3: Implementar — TypeScript**

Em `inner-view-card.component.ts`, acrescentar os imports:

```ts
import { TranslatePipe } from '@ngx-translate/core';
import { ADD_TOUR_INTENT } from '../../models/navigation-intent';
```

Acrescentar `TranslatePipe` ao array `imports` do decorator:

```ts
  imports: [IonCard, IonButton, IonIcon, TranslatePipe]
```

E acrescentar o método, logo abaixo de `onCardClick()`:

```ts
  /**
   * Mesmo destino do clique no card, mas carregando a intenção — sem ela o
   * botão seria rótulo, não ação: a página abriria e ficaria esperando um
   * segundo clique que nada na tela pede.
   */
  onCreateTour(event: Event) {
    event.stopPropagation();
    this.router.navigate(['/inner-view-page', this.item.id], {
      state: { property: this.item, action: ADD_TOUR_INTENT },
    });
  }
```

- [ ] **Step 4: Implementar — template**

Em `inner-view-card.component.html`, dentro de `.meta-footer`, logo **antes** de
`<div class="meta-actions">`, acrescentar:

```html
      @if (!item.virtualTour) {
        <button
          type="button"
          class="create-tour-btn"
          [attr.aria-label]="'HOME.CARD_CREATE_TOUR_LABEL' | translate: { title: item.title }"
          (click)="onCreateTour($event)">
          {{ 'HOME.CARD_CREATE_TOUR' | translate }}
        </button>
      }
```

- [ ] **Step 5: Implementar — estilo**

Ao fim de `inner-view-card.component.scss`:

```scss
.create-tour-btn {
  // 44px e' o piso do AGENTS.md. O heart-btn e o meta-action deste card ficam
  // abaixo disso; o botao novo nao repete o problema.
  min-height: 44px;
  padding-inline: 14px;
  border: 1px solid var(--app-hairline);
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--ion-color-primary);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: var(--app-surface-soft);
  }

  &:focus-visible {
    outline: 2px solid var(--ion-color-primary);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 6: Rodar o teste e ver passar**

```bash
cd inner-view-client
npx ng test --include=src/app/components/inner-view-card/inner-view-card.component.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: `TOTAL: 6 SUCCESS`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add inner-view-client/src/app/components/inner-view-card/
git commit -m "feat(client): botao de criar tour no card sem tour

O card ja se distinguia passivamente — placeholder, sem badge 360, sem
compartilhar — mas nao oferecia acao nenhuma. O aria-label nomeia o imovel
porque num leitor de tela a lista viraria uma sequencia de 'Criar tour'
identicos."
```

---

### Task 7: A página do imóvel lê a intenção

**Files:**
- Modify: `inner-view-client/src/app/inner-view-page/inner-view-page.page.ts`
- Test: `inner-view-client/src/app/inner-view-page/inner-view-page.intent.spec.ts` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Criar `inner-view-page.intent.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ModalController } from '@ionic/angular/standalone';

import { InnerViewPagePage } from './inner-view-page.page';
import { ADD_TOUR_INTENT } from '../models/navigation-intent';

describe('InnerViewPagePage — intencao de criar tour', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InnerViewPagePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        { provide: ModalController, useValue: { create: () => Promise.resolve({ present: () => {}, onDidDismiss: () => Promise.resolve({}) }) } },
      ],
    }).compileComponents();
  });

  it('dispara addImage quando a intencao chega no router state', () => {
    const fixture = TestBed.createComponent(InnerViewPagePage);
    const component = fixture.componentInstance;
    const spy = spyOn(component, 'addImage');

    component.aplicarIntencao(ADD_TOUR_INTENT);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ignora estado sem intencao', () => {
    const fixture = TestBed.createComponent(InnerViewPagePage);
    const component = fixture.componentInstance;
    const spy = spyOn(component, 'addImage');

    component.aplicarIntencao(undefined);
    component.aplicarIntencao('outra-coisa');

    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd inner-view-client
npx ng test --include=src/app/inner-view-page/inner-view-page.intent.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: FALHA — `component.aplicarIntencao is not a function`.

- [ ] **Step 3: Implementar**

Em `inner-view-page.page.ts`, acrescentar o import:

```ts
import { ADD_TOUR_INTENT } from '../models/navigation-intent';
```

Acrescentar o método público, junto aos demais métodos da classe:

```ts
  /**
   * A home manda quem clicou em "Criar tour" para cá já querendo enviar a
   * primeira imagem. Sem isto a página abriria e ficaria parada, esperando um
   * segundo clique — e o botão da home teria sido só um rótulo.
   *
   * Público e separado do ngOnInit para ser testável sem simular navegação.
   */
  aplicarIntencao(action: unknown): void {
    if (action !== ADD_TOUR_INTENT) return;
    // Fire-and-forget de propósito: abrir o seletor é efeito de interface, e
    // nada no ngOnInit depende do que a pessoa vai escolher. O `void` é para o
    // eslint não acusar promessa solta.
    void this.addImage();
  }
```

No **fim** do `ngOnInit`, acrescentar a última linha. O `ngOnInit` já começa com
`const nav = this.router.getCurrentNavigation();` (verificado no código) — reuse
essa variável em vez de chamar `getCurrentNavigation()` de novo:

```ts
    // `nav` é nulo quando a página é aberta por URL direta ou recarregada; aí o
    // `history.state` é a única fonte, e ele não terá `action` — que é
    // exatamente o comportamento desejado, porque refresh não deve reabrir o
    // seletor de arquivo.
    this.aplicarIntencao(nav?.extras.state?.['action'] ?? history.state?.['action']);
```

> Verificado nesta base: `addImage()` é público (`inner-view-page.page.ts:220`),
> então o `spyOn` do teste compila; e `private router = inject(Router)` já existe
> na linha 53 — **não injete um segundo**.

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd inner-view-client
npx ng test --include=src/app/inner-view-page/inner-view-page.intent.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: `TOTAL: 2 SUCCESS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/inner-view-page/
git commit -m "feat(client): pagina do imovel abre o envio ao chegar com a intencao

Fecha o caminho que comeca no botao da home: sem isto a pagina abriria e
ficaria esperando um clique que nada na tela pede."
```

---

### Task 8: A `HomePage` com os seis estados

**Files:**
- Modify: `inner-view-client/src/app/home/home.page.ts`
- Modify: `inner-view-client/src/app/home/home.page.html`
- Test: `inner-view-client/src/app/home/home.page.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Substituir todo o conteúdo de `home.page.spec.ts`:

```ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { HomePage } from './home.page';
import { Property } from '../models/property.model';

function imovel(id: string, overrides: Partial<Property> = {}): Property {
  return {
    id,
    code: 'RLX-' + id,
    title: 'Imovel ' + id,
    type: 'HOUSE',
    purpose: 'SALE',
    status: 'AVAILABLE',
    agencyId: 'a1',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    virtualTour: null,
    ...overrides,
  };
}

describe('HomePage', () => {
  let fixture: ComponentFixture<HomePage>;
  let component: HomePage;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Responde a chamada pendente de /properties com os imoveis dados. */
  function responder(data: Property[]) {
    fixture.detectChanges(); // dispara o ngOnInit
    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ data, total: data.length, page: 1, limit: 100, pages: 1 });
    fixture.detectChanges();
  }

  function falhar() {
    fixture.detectChanges();
    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ statusCode: 500, message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
  }

  function texto() {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('should create', () => {
    responder([]);
    expect(component).toBeTruthy();
  });

  // Os dois testes que a propria feature poderia introduzir errados.
  it('nao sugere criar tour enquanto carrega', () => {
    fixture.detectChanges(); // ngOnInit dispara, resposta ainda nao veio
    expect(component.view()).toBe('loading');
    expect(texto()).not.toContain('HOME.EMPTY_TITLE');
    expect(texto()).toContain('HOME.LOADING');

    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ data: [], total: 0, page: 1, limit: 100, pages: 1 });
  });

  it('nao sugere criar tour quando a chamada falha', () => {
    falhar();
    expect(component.view()).toBe('error');
    expect(texto()).not.toContain('HOME.EMPTY_TITLE');
    expect(texto()).toContain('HOME.ERROR_TEXT');
  });

  it('conta sem imoveis mostra o onboarding', () => {
    responder([]);
    expect(component.view()).toBe('empty');
    expect(texto()).toContain('HOME.EMPTY_TITLE');
  });

  // A precedencia. Conta vazia COM busca ativa satisfaz as duas condicoes.
  it('conta vazia com busca ativa mostra onboarding, nao "sem resultado"', () => {
    responder([]);
    component.query.set('qualquer coisa');
    fixture.detectChanges();
    expect(component.view()).toBe('empty');
    expect(texto()).not.toContain('HOME.NO_RESULTS');
  });

  it('busca sem resultado, com acervo, mostra "sem resultado"', () => {
    responder([imovel('1')]);
    component.query.set('zzzz-nao-existe');
    fixture.detectChanges();
    expect(component.view()).toBe('no-results');
    expect(texto()).toContain('HOME.NO_RESULTS');
  });

  it('nenhum imovel com tour mostra a faixa', () => {
    responder([imovel('1'), imovel('2')]);
    expect(component.view()).toBe('list');
    expect(component.mostrarFaixa()).toBeTrue();
  });

  it('um imovel com tour DRAFT ja conta como "tem tour"', () => {
    responder([imovel('1', { virtualTour: { id: 't1', status: 'DRAFT' } }), imovel('2')]);
    expect(component.mostrarFaixa()).toBeFalse();
  });

  // A faixa le `properties`, nao `filtered` — senao apareceria e sumiria
  // conforme a pessoa digita.
  it('a faixa nao some ao digitar na busca', () => {
    responder([imovel('1'), imovel('2')]);
    component.query.set('Imovel 1');
    fixture.detectChanges();
    expect(component.view()).toBe('list');
    expect(component.mostrarFaixa()).toBeTrue();
  });

  it('busca oculta em empty e visivel em no-results', () => {
    responder([]);
    expect(fixture.nativeElement.querySelector('ion-searchbar')).toBeNull();

    component.properties.set([imovel('1')]);
    component.query.set('zzzz');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-searchbar')).not.toBeNull();
  });

  it('FAB oculto em empty', () => {
    responder([]);
    expect(fixture.nativeElement.querySelector('ion-fab')).toBeNull();

    component.properties.set([imovel('1')]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-fab')).not.toBeNull();
  });

  it('tentar de novo refaz a chamada', () => {
    falhar();
    component.carregar();
    expect(component.view()).toBe('loading');

    const req = http.expectOne(r => r.url.endsWith('/properties'));
    req.flush({ data: [imovel('1')], total: 1, page: 1, limit: 100, pages: 1 });
    fixture.detectChanges();

    expect(component.view()).toBe('list');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd inner-view-client
npx ng test --include=src/app/home/home.page.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: FALHA — `component.view is not a function`.

- [ ] **Step 3: Implementar — `home.page.ts`**

Substituir todo o conteúdo por:

```ts
import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { IonContent, IonSearchbar, IonIcon, IonFab, IonFabButton } from '@ionic/angular/standalone';
import { Router, RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { add, alertCircleOutline, imagesOutline, searchOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { InnerViewListComponent } from '../components/inner-view-list/inner-view-list.component';
import { HomePlaceholderComponent } from '../components/home-placeholder/home-placeholder.component';
import { HomeNoTourBannerComponent } from '../components/home-no-tour-banner/home-no-tour-banner.component';
import { PropertyService } from '../services/property.service';
import { Property } from '../models/property.model';
import { HomeStatus, resolveHomeView } from './home-view';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    IonContent, IonSearchbar, IonIcon, IonFab, IonFabButton,
    AppHeaderComponent, InnerViewListComponent, HomePlaceholderComponent,
    HomeNoTourBannerComponent, RouterLink, TranslatePipe,
  ],
})
export class HomePage implements OnInit {
  @ViewChild(AppHeaderComponent) header?: AppHeaderComponent;

  readonly status = signal<HomeStatus>('loading');
  readonly properties = signal<Property[]>([]);
  readonly query = signal('');

  /**
   * Filtro como `computed`, e não uma segunda lista mutada por handler: duas
   * listas mantidas em paralelo saem de sincronia no dia em que um terceiro
   * caminho mexe em `properties`.
   */
  readonly filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    const todos = this.properties();
    if (!q) return todos;
    return todos.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      (p.address?.city ?? '').toLowerCase().includes(q)
    );
  });

  readonly view = computed(() => resolveHomeView({
    status: this.status(),
    total: this.properties().length,
    filtered: this.filtered().length,
  }));

  private readonly semTour = computed(() =>
    this.properties().filter(p => !p.virtualTour));

  /**
   * Exige que NENHUM imóvel tenha tour, e lê `properties` — não `filtered` —
   * para não aparecer e sumir conforme a pessoa digita na busca.
   */
  readonly mostrarFaixa = computed(() =>
    this.view() === 'list' &&
    this.properties().length > 0 &&
    this.semTour().length === this.properties().length);

  readonly totalSemTour = computed(() => this.semTour().length);

  private propertyService = inject(PropertyService);
  private router = inject(Router);

  constructor() {
    addIcons({ add, alertCircleOutline, imagesOutline, searchOutline });
  }

  ngOnInit() {
    this.carregar();
  }

  /**
   * Extraído do ngOnInit para o "Tentar de novo" reusá-lo. Recarregar a página
   * inteira perderia o texto da busca e piscaria o app por causa de uma
   * chamada só.
   */
  carregar(): void {
    this.status.set('loading');
    this.propertyService.listProperties({ limit: 100 }).subscribe({
      next: (res) => {
        this.properties.set(res.data);
        this.status.set('ready');
      },
      error: (error) => {
        console.error('Error loading properties:', error);
        this.status.set('error');
      },
    });
  }

  irParaNovoTour(): void {
    this.router.navigate(['/tour/novo']);
  }

  onScroll(event: CustomEvent<{ scrollTop: number }>) {
    this.header?.onContentScroll(event.detail.scrollTop);
  }

  onSearch(event: CustomEvent<{ value?: string | null }>) {
    this.query.set(event.detail.value ?? '');
  }
}
```

- [ ] **Step 4: Implementar — `home.page.html`**

Substituir todo o conteúdo por:

```html
<ion-content [fullscreen]="true" [scrollEvents]="true" (ionScroll)="onScroll($event)">
  <app-header></app-header>

  @if (view() === 'list' || view() === 'no-results') {
    <div class="search-band">
      <ion-searchbar
        class="home-search has-search-orb"
        [placeholder]="'HOME.SEARCH_PLACEHOLDER' | translate"
        (ionInput)="onSearch($event)"
        animated="true">
      </ion-searchbar>
    </div>
  }

  @switch (view()) {
    @case ('loading') {
      <app-home-placeholder [spinner]="true" text="HOME.LOADING" />
    }
    @case ('error') {
      <app-home-placeholder
        icon="alert-circle-outline"
        text="HOME.ERROR_TEXT"
        actionLabel="HOME.ERROR_RETRY"
        (action)="carregar()" />
    }
    @case ('empty') {
      <app-home-placeholder
        icon="images-outline"
        heading="HOME.EMPTY_TITLE"
        text="HOME.EMPTY_TEXT"
        actionLabel="HOME.EMPTY_CTA"
        (action)="irParaNovoTour()" />
    }
    @case ('no-results') {
      <app-home-placeholder
        icon="search-outline"
        text="HOME.NO_RESULTS"
        [textParams]="{ query: query() }" />
    }
    @default {
      @if (mostrarFaixa()) {
        <app-home-no-tour-banner [count]="totalSemTour()" />
      }
      <app-inner-view-list [items]="filtered()"></app-inner-view-list>
    }
  }

  @if (view() !== 'loading' && view() !== 'error' && view() !== 'empty') {
    <ion-fab slot="fixed" vertical="bottom" horizontal="end">
      <ion-fab-button routerLink="/upload">
        <ion-icon name="add"></ion-icon>
      </ion-fab-button>
    </ion-fab>
  }
</ion-content>
```

- [ ] **Step 5: Rodar o teste e ver passar**

```bash
cd inner-view-client
npx ng test --include=src/app/home/home.page.spec.ts --watch=false --browsers=ChromeHeadless
```

Esperado: `TOTAL: 12 SUCCESS`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/home/
git commit -m "feat(client): a home distingue seis estados e sugere criar tour

Antes, lista vazia tinha tres causas indistinguiveis — carregando, erro e
genuinamente vazia — e as tres davam a mesma pagina em branco. Pôr a
sugestao nesse lugar sem separar os tres a faria piscar a cada abertura e
mentir quando a API cai.

A busca some na conta vazia mas fica em 'sem resultado', que e' onde o termo
digitado vive; e o FAB some na conta vazia para nao competir com o CTA do
onboarding, que vai para o mesmo lugar."
```

---

### Task 9: Verificação final

**Files:** nenhum — é conferência.

- [ ] **Step 1: Rodar a suíte inteira**

```bash
cd inner-view-client
npx ng test --watch=false --browsers=ChromeHeadless
```

Esperado: `TOTAL: N SUCCESS`, exit 0, **zero falhas**. Se algum teste alheio
quebrar, ele é regressão desta branch — conserte antes de seguir.

- [ ] **Step 2: Rodar o lint**

```bash
cd inner-view-client
npm run lint
```

Esperado: exit 0. O `checa-crases.js` roda antes do eslint.

- [ ] **Step 3: Conferir que nenhum arquivo virou LF**

```bash
cd "$(git rev-parse --show-toplevel)"
git diff --stat
python -c "
import subprocess
saida = subprocess.run(['git','diff','--name-only','be19a5e','HEAD'],capture_output=True,text=True).stdout.split()
for p in saida:
    try:
        d = open(p,'rb').read()
    except OSError:
        continue
    crlf = d.count(b'\r\n'); lf = d.count(b'\n') - crlf
    if lf:
        print('LF SOLTO em', p, '->', lf)
print('varredura concluida')
"
```

Esperado: `varredura concluida` sem nenhuma linha `LF SOLTO`.

- [ ] **Step 4: Ver funcionando de verdade**

O projeto exige verificação em runtime, não só em build. Suba o front:

```bash
cd inner-view-client
npm start
```

Sem a API no ar, a home cai no estado de **erro** — que é justamente um dos
estados novos. Confirme no navegador em `http://localhost:4200`:

1. `/home` mostra "HOME.ERROR_TEXT" e o botão de tentar de novo (com a API fora).
2. Com a API no ar e uma conta sem imóveis, mostra o onboarding, **sem** FAB e
   **sem** barra de busca.
3. Com imóveis sem tour, a faixa aparece e cada card ganha "Criar tour".
4. Clicar em "Criar tour" abre a página do imóvel **já com o seletor de imagem**.

- [ ] **Step 5: Commit final, se algo mudou**

```bash
git add -A
git commit -m "fix(client): ajustes da verificacao em runtime do IM-45"
```

Se nada mudou, pule este passo.

---

## Cobertura da spec

| Requisito da spec | Tarefa |
|---|---|
| Precedência dos seis estados | 1, 8 |
| Carregando e erro explícitos | 8 |
| Onboarding da conta vazia → `/tour/novo` | 8 |
| Faixa de imóveis sem tour | 4, 8 |
| Faixa exige que nenhum tenha tour, e lê `properties` | 8 |
| Plural por sufixo `_ONE` | 2, 4 |
| Botão "Criar tour" no card, com `stopPropagation` | 6 |
| Qualquer `virtualTour` conta (inclusive `DRAFT`) | 6, 8 |
| Navegação com intenção | 5, 6, 7 |
| `inner-view-page` lê a intenção | 7 |
| Busca e FAB condicionais | 8 |
| `role="status"` / `aria-live` | 3 |
| `aria-label` nomeando o imóvel | 6 |
| Alvo ≥ 44px | 3, 6 |
| `inner-view-list` não muda | — (nenhuma tarefa o toca, de propósito) |
| i18n nos dois idiomas | 2 |

## Fora deste plano

Está na spec como fora de escopo e continua fora:

1. Wizard aceitar `propertyId`.
2. Strings cravadas em `inner-view-card` ("Aluguel", "Venda", "Curtir").
3. Paginação da home.
4. Ordenar ou destacar imóveis sem tour.
5. Dispensar a faixa.

**Um item da spec ficou sem tarefa, de propósito:** o "foco volta ao botão após
a nova falha" da seção de Acessibilidade. Ele depende de o botão ser destruído e
recriado, o que só acontece se a implementação do `@switch` remontar o
placeholder — e com o mesmo componente nos dois estados o Angular reusa o nó, e o
foco não se perde. Confirme no passo 4 da Task 9: se o foco sobreviver ao
"Tentar de novo", não há o que corrigir; se não sobreviver, abra tarefa com
`afterNextRender`, como o §13 das notas da Frente B.
