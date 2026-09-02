# TV-3 — Shell de bottom sheet + sheet Cenas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o `TourSheetComponent` — o shell de bottom sheet que TV-4, TV-5 e TV-6 vão consumir — junto do seu primeiro consumidor, o sheet "Cenas do tour", com gatilho funcionando no visualizador.

**Architecture:** Três peças com fronteiras nítidas. O `TourSheetComponent` é um invólucro visual sobre `IonModal`: recebe `isOpen`, `titulo`, `variante` e `travado`, projeta corpo e rodapé, e não sabe que sheets existem. O `TourSheetStore` é um `signal` único que garante um sheet por vez. O `CenasSheetComponent` é o primeiro consumidor e prova o shell. A página do visualizador liga os três.

**Tech Stack:** Angular 20 (standalone, signals, `input()`/`output()`), Ionic 8.8.9 (`IonModal` com `breakpoints` e `canDismiss`), ngx-translate, Karma/Jasmine.

**Spec:** `docs/superpowers/specs/2026-09-02-tv-3-shell-de-bottom-sheet-design.md`

---

## Convenções deste repositório

Quem for implementar precisa saber disto antes de escrever a primeira linha:

- **O repositório inteiro usa CRLF (`\r\n`).** Toda escrita de arquivo precisa
  ser conferida. Depois de criar ou editar qualquer arquivo, rode:
  ```bash
  node -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1],'utf8');const lf=(b.match(/\n/g)||[]).length,crlf=(b.match(/\r\n/g)||[]).length;console.log(crlf===lf?'CRLF ok':'MISTO — CORRIJA',lf)" <caminho>
  ```
  Se sair `MISTO`, converta:
  ```bash
  node -e "const fs=require('fs');const p=process.argv[1];fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'))" <caminho>
  ```
- **Testes:** `cd inner-view-client` e
  `npx ng test --watch=false --browsers=ChromeHeadless --include="<glob relativo à raiz do projeto>"`.
- **i18n nos testes:** `provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })`
  sem loader HTTP faz o pipe `translate` devolver **a chave**. Os testes
  asseguram a chave (`'VIEWER.CENAS.TITULO'`), nunca o texto traduzido. É a
  convenção de toda a suíte — não a mude.
- **Nunca escreva hex direto em componente.** Cores saem de tokens. A família
  `--tour-*` é a exceção documentada em `_palette.scss` e pode ser consumida
  direto por componentes do visualizador.
- **Comentários em português**, explicando *por quê*, não *o quê* — é o padrão
  de todo o código deste repositório.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `components/tour-sheet/media.ts` | Sinal de viewport mobile para o domínio do visualizador |
| `components/tour-sheet/tour-sheet.store.ts` | Qual sheet está aberto. Um por vez |
| `components/tour-sheet/tour-sheet.component.{ts,html,scss}` | O shell visual sobre `IonModal` |
| `components/cenas-sheet/cenas-sheet.component.{ts,html,scss}` | Grade de cenas. Primeiro consumidor |
| `inner-view-page/inner-view-page.page.{ts,html}` | Gatilho e ligação com o viewer |
| `assets/i18n/{pt,en}.json` | Chaves `VIEWER.CENAS.*` |

**Desvio deliberado da spec, registrado aqui:** a spec previa um bloco
`TOUR_SHEET` no topo do i18n. Ao planejar, descobriu-se que já existe um bloco
`VIEWER` (hoje com `ROOMS: "Ambientes"`, o rótulo da navegação interna). As
chaves vão para `VIEWER.CENAS.*` — mesma família, e TV-4/5/6 continuam a série
com `VIEWER.EMBED.*`, `VIEWER.APAGAR.*`, `VIEWER.GERENCIAR.*` em vez de abrir
um segundo topo para o mesmo domínio.

---

### Task 1: Chaves de i18n

**Files:**
- Modify: `inner-view-client/src/assets/i18n/pt.json`
- Modify: `inner-view-client/src/assets/i18n/en.json`

- [ ] **Step 1: Adicionar as chaves ao bloco `VIEWER` do `pt.json`**

O bloco `VIEWER` hoje é `{ "ROOMS": "Ambientes" }`. Substitua por:

```json
  "VIEWER": {
    "ROOMS": "Ambientes",
    "CENAS": {
      "TITULO": "Cenas do tour",
      "CONTAGEM": "{{n}} cenas",
      "UMA": "1 cena",
      "ATUAL": "ATUAL",
      "ABRIR": "Ver cenas do tour"
    }
  }
```

- [ ] **Step 2: Adicionar as mesmas chaves ao `en.json`**

```json
  "VIEWER": {
    "ROOMS": "Rooms",
    "CENAS": {
      "TITULO": "Tour scenes",
      "CONTAGEM": "{{n}} scenes",
      "UMA": "1 scene",
      "ATUAL": "CURRENT",
      "ABRIR": "View tour scenes"
    }
  }
```

`CONTAGEM` e `UMA` são chaves separadas porque o ngx-translate não faz plural
sozinho, e "1 cenas" é erro visível na tela.

- [ ] **Step 3: Verificar JSON válido e paridade de chaves entre os dois idiomas**

```bash
cd inner-view-client && node -e "
const pt=require('./src/assets/i18n/pt.json'), en=require('./src/assets/i18n/en.json');
const achatar=(o,p='')=>Object.entries(o).flatMap(([k,v])=>
  v&&typeof v==='object'?achatar(v,p+k+'.'):[p+k]);
const a=achatar(pt).sort(), b=achatar(en).sort();
const soPt=a.filter(k=>!b.includes(k)), soEn=b.filter(k=>!a.includes(k));
console.log('chaves pt:',a.length,' en:',b.length);
console.log('só em pt:', soPt.length?soPt.join(', '):'nenhuma');
console.log('só em en:', soEn.length?soEn.join(', '):'nenhuma');
if(soPt.length||soEn.length) process.exit(1);
console.log('paridade OK');
"
```
Expected: `paridade OK`, e `VIEWER.CENAS.*` presente nos dois.

- [ ] **Step 4: Conferir CRLF nos dois arquivos**

```bash
cd inner-view-client && for f in src/assets/i18n/pt.json src/assets/i18n/en.json; do
node -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1],'utf8');const lf=(b.match(/\n/g)||[]).length,crlf=(b.match(/\r\n/g)||[]).length;console.log(crlf===lf?'CRLF ok':'MISTO — CORRIJA',process.argv[1])" $f; done
```
Expected: `CRLF ok` nos dois.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/assets/i18n/pt.json inner-view-client/src/assets/i18n/en.json
git commit -m "feat(client): chaves VIEWER.CENAS.* para o sheet de cenas"
```

---

### Task 2: `TourSheetStore` — um sheet por vez

**Files:**
- Create: `inner-view-client/src/app/components/tour-sheet/tour-sheet.store.ts`
- Test: `inner-view-client/src/app/components/tour-sheet/tour-sheet.store.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `tour-sheet.store.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';

import { TourSheetStore } from './tour-sheet.store';

describe('TourSheetStore', () => {
  let store: TourSheetStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(TourSheetStore);
  });

  it('nasce sem nenhum sheet aberto', () => {
    expect(store.aberto()).toBeNull();
  });

  it('abrir marca qual sheet esta aberto', () => {
    store.abrir('cenas');
    expect(store.aberto()).toBe('cenas');
  });

  // O criterio de aceite "abrir um segundo sheet nao empilha". Aqui ele e'
  // verdadeiro por construcao -- nao existe onde guardar o segundo -- e este
  // teste so registra a intencao para quem for tentar transformar isto numa
  // pilha sem ler a spec.
  it('abrir outro SUBSTITUI o atual, nao empilha', () => {
    store.abrir('cenas');
    store.abrir('gerenciar');

    expect(store.aberto()).toBe('gerenciar');
  });

  it('fechar volta ao estado sem sheet', () => {
    store.abrir('cenas');
    store.fechar();
    expect(store.aberto()).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="src/app/components/tour-sheet/tour-sheet.store.spec.ts"
```
Expected: FALHA na compilação — `Cannot find module './tour-sheet.store'`.

- [ ] **Step 3: Implementar**

Crie `tour-sheet.store.ts`:

```typescript
import { Injectable, signal } from '@angular/core';

/**
 * Qual sheet do visualizador está aberto — nenhum, ou um.
 *
 * É um `signal` de um valor só, e essa é a decisão: não existe estado em que
 * dois sheets estejam abertos, porque não há onde guardar o segundo. O
 * critério "abrir um segundo sheet não empilha" fica verdadeiro por
 * construção, e não por disciplina de quem escreve o próximo sheet.
 *
 * O shell (`TourSheetComponent`) NÃO depende deste store: ele recebe `isOpen`
 * pronto. Quem liga os dois é cada consumidor, com
 * `[isOpen]="store.aberto() === 'cenas'"`. Assim TV-4, TV-5 e TV-6 são
 * arquivos novos que não editam nem o shell nem este arquivo.
 *
 * Um `signal` e não uma pilha porque nenhum sheet do sprint abre outro. Sem
 * navegação entre sheets não há para onde voltar, e uma pilha inventaria um
 * botão de volta que nenhuma tela pede.
 */
@Injectable({ providedIn: 'root' })
export class TourSheetStore {
  private readonly _aberto = signal<string | null>(null);

  /** Id do sheet aberto, ou `null`. */
  readonly aberto = this._aberto.asReadonly();

  /** Abre um sheet. Se outro estiver aberto, ele é substituído. */
  abrir(id: string): void {
    this._aberto.set(id);
  }

  fechar(): void {
    this._aberto.set(null);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="src/app/components/tour-sheet/tour-sheet.store.spec.ts"
```
Expected: `TOTAL: 4 SUCCESS`.

- [ ] **Step 5: Conferir CRLF e commitar**

```bash
cd inner-view-client && for f in src/app/components/tour-sheet/tour-sheet.store.ts src/app/components/tour-sheet/tour-sheet.store.spec.ts; do
node -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1],'utf8');const lf=(b.match(/\n/g)||[]).length,crlf=(b.match(/\r\n/g)||[]).length;console.log(crlf===lf?'CRLF ok':'MISTO — CORRIJA',process.argv[1])" $f; done
cd .. && git add inner-view-client/src/app/components/tour-sheet/
git commit -m "feat(client): TourSheetStore garante um sheet por vez"
```

---

### Task 3: `media.ts` do visualizador

**Files:**
- Create: `inner-view-client/src/app/components/tour-sheet/media.ts`

Sem teste próprio: é um invólucro de três linhas sobre `matchMedia`, exercitado
pelos testes da Task 4 através do `TourSheetComponent`. Testá-lo isolado seria
testar o `matchMedia` do navegador.

- [ ] **Step 1: Criar o arquivo**

```typescript
import { DestroyRef, Signal, inject, signal } from '@angular/core';

/**
 * Corte do responsivo do visualizador, em JS.
 *
 * É o mesmo 767px do `TW_MOBILE_QUERY` em
 * `tour-wizard/hotspots/media.ts`, repetido aqui de propósito: aquele arquivo
 * é do domínio do wizard e espelha um mixin CONGELADO, que só muda por PR para
 * a branch de integração. Importar de lá amarraria o visualizador a um corte
 * que não é dele.
 *
 * Se um dia o corte mudar, muda nos dois — daí o nome exportado, para que uma
 * busca por `TOUR_MOBILE_QUERY` ache este lado.
 */
export const TOUR_MOBILE_QUERY = '(max-width: 767px)';

/**
 * Sinal que acompanha a largura da janela.
 *
 * Chamar em contexto de injeção — o listener é solto junto com o componente.
 */
export function emViewportMobile(): Signal<boolean> {
  const media = matchMedia(TOUR_MOBILE_QUERY);
  const valor = signal(media.matches);
  const aoMudar = () => valor.set(media.matches);

  media.addEventListener('change', aoMudar);
  inject(DestroyRef).onDestroy(() => media.removeEventListener('change', aoMudar));

  return valor.asReadonly();
}
```

- [ ] **Step 2: Conferir CRLF**

```bash
cd inner-view-client && node -e "const fs=require('fs');const b=fs.readFileSync('src/app/components/tour-sheet/media.ts','utf8');const lf=(b.match(/\n/g)||[]).length,crlf=(b.match(/\r\n/g)||[]).length;console.log(crlf===lf?'CRLF ok':'MISTO — CORRIJA',lf)"
```
Expected: `CRLF ok`.

- [ ] **Step 3: Commit**

```bash
git add inner-view-client/src/app/components/tour-sheet/media.ts
git commit -m "feat(client): corte de viewport mobile para o dominio do visualizador"
```

---

### Task 4: `TourSheetComponent` — o shell

**Files:**
- Create: `inner-view-client/src/app/components/tour-sheet/tour-sheet.component.ts`
- Create: `inner-view-client/src/app/components/tour-sheet/tour-sheet.component.html`
- Create: `inner-view-client/src/app/components/tour-sheet/tour-sheet.component.scss`
- Test: `inner-view-client/src/app/components/tour-sheet/tour-sheet.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `tour-sheet.component.spec.ts`:

```typescript
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';

import { TourSheetComponent } from './tour-sheet.component';

/**
 * O que se prova aqui NÃO é o desenho do `IonModal` -- arrasto, trap de foco e
 * animação são responsabilidade do Ionic, e testá-los seria testar a
 * biblioteca. O que se prova é a LIGAÇÃO: que `travado` chega em `canDismiss`,
 * que `variante` decide haver ou não `breakpoints`, que o fechamento
 * desemboca em `(fechado)`, e que os dois slots caem em lugares diferentes.
 *
 * Mesmo critério que `hotspot-sheet.component.spec.ts` já usa.
 */
@Component({
  standalone: true,
  imports: [TourSheetComponent],
  template: `
    <app-tour-sheet
      [isOpen]="aberto()"
      [titulo]="'Cenas do tour'"
      [subtitulo]="sub()"
      [variante]="variante()"
      [travado]="travado()"
      (fechado)="fechou = fechou + 1">
      <p class="corpo-de-teste">corpo</p>
      <button rodape class="rodape-de-teste">ok</button>
    </app-tour-sheet>
  `,
})
class HospedeiroDeTeste {
  readonly aberto = signal(true);
  readonly sub = signal<string | null>('3 cenas');
  readonly variante = signal<'sheet' | 'adaptavel'>('sheet');
  readonly travado = signal(false);
  fechou = 0;
}

describe('TourSheetComponent', () => {
  let fixture: ComponentFixture<HospedeiroDeTeste>;
  let host: HospedeiroDeTeste;

  /**
   * Dublê de `MediaQueryList`. A viewport do Karma é a que for, e o teste
   * precisa poder dizer "isto é um celular" sem depender do tamanho da janela
   * de quem roda a suíte. Mesmo padrão de `hotspot-sheet.component.spec.ts`.
   */
  function mediaFalsa(matches: boolean): MediaQueryList {
    return {
      matches,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
  }

  function montar(mobile = true): void {
    spyOn(window, 'matchMedia').and.returnValue(mediaFalsa(mobile));
    fixture = TestBed.createComponent(HospedeiroDeTeste);
    host = fixture.componentInstance;
    fixture.detectChanges();
  }

  const modal = () => fixture.nativeElement.querySelector('ion-modal') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HospedeiroDeTeste],
      providers: [provideIonicAngular()],
    }).compileComponents();
  });

  it('mostra titulo e subtitulo, e projeta corpo e rodape em lugares distintos', () => {
    montar();
    const raiz = fixture.nativeElement as HTMLElement;

    expect(raiz.querySelector('.tour-sheet__titulo')?.textContent?.trim())
      .toBe('Cenas do tour');
    expect(raiz.querySelector('.tour-sheet__sub')?.textContent?.trim())
      .toBe('3 cenas');

    // O rodape fica FORA da area rolavel: com o botao dentro do corpo, ele
    // rola junto e sai da tela justamente quando e' preciso (TV-5 empilha
    // botoes no fim de um sheet rolavel).
    expect(raiz.querySelector('.tour-sheet__conteudo .corpo-de-teste')).not.toBeNull();
    expect(raiz.querySelector('.tour-sheet__conteudo .rodape-de-teste')).toBeNull();
    expect(raiz.querySelector('.tour-sheet__rodape .rodape-de-teste')).not.toBeNull();
  });

  it('sem subtitulo, nao renderiza o paragrafo vazio', () => {
    montar();
    host.sub.set(null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.tour-sheet__sub')).toBeNull();
  });

  // Os tres gestos de fechar -- scrim, arrasto e Esc -- desembocam todos no
  // mesmo didDismiss do Ionic. Provar que ele emite (fechado) prova os tres;
  // simular o gesto em si seria testar o Ionic.
  it('o fechamento do modal vira (fechado)', () => {
    montar();
    expect(host.fechou).toBe(0);

    modal().dispatchEvent(new CustomEvent('ionModalDidDismiss', { detail: { role: 'backdrop' } }));
    fixture.detectChanges();

    expect(host.fechou).toBe(1);
  });

  it('travado recusa o fechamento, e destravado permite', () => {
    montar();
    const alvo = modal() as HTMLElement & { canDismiss: boolean };

    expect(alvo.canDismiss).toBeTrue();

    host.travado.set(true);
    fixture.detectChanges();

    // canDismiss e nao backdropDismiss: travar so o scrim deixaria o Esc e o
    // arrasto fechando, e o caso que pede isto (TV-5, "Apagando...") e'
    // justamente aquele em que fechar no meio da requisicao deixa a tela em
    // estado ambiguo.
    expect(alvo.canDismiss).toBeFalse();
  });

  it('variante sheet tem breakpoints em qualquer largura', () => {
    montar(false);
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints).toEqual([0, 0.55]);
  });

  // O 0 e' o que permite arrastar para baixo ate fechar. Sem ele o sheet trava
  // na menor parada e o arrasto deixa de ser gesto de fechamento -- que e'
  // criterio de aceite.
  it('a menor parada e zero, senao o arrasto nao fecha', () => {
    montar();
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints?.[0]).toBe(0);
  });

  it('variante adaptavel: bottom sheet no mobile', () => {
    montar(true);
    host.variante.set('adaptavel');
    fixture.detectChanges();
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints).toEqual([0, 0.55]);
  });

  // TV-5 pede dialogo centralizado de 480px no desktop com o mesmo conteudo.
  // Quem decide a forma e' a PRESENCA de breakpoints: com eles o Ionic desenha
  // sheet, sem eles desenha modal centrado.
  it('variante adaptavel: modal centrado no desktop, sem breakpoints', () => {
    montar(false);
    host.variante.set('adaptavel');
    fixture.detectChanges();
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints).toBeUndefined();
    expect(alvo.classList).toContain('tour-sheet--centrado');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="src/app/components/tour-sheet/tour-sheet.component.spec.ts"
```
Expected: FALHA na compilação — `Cannot find module './tour-sheet.component'`.

- [ ] **Step 3: Criar o template**

`tour-sheet.component.html`:

```html
<!--
  `breakpoints` e `initialBreakpoint` vêm ANTES de `isOpen`: o Ionic lê a
  altura inicial no momento de apresentar, e a ordem das ligações é a ordem em
  que o Angular as escreve. Invertidas, a primeira abertura sai na altura
  errada. O mesmo tropeço já está registrado em `hotspot-sheet.component.html`.

  O nome acessível do diálogo não sai daqui: ele vive no shadow DOM do Ionic.
  Ver `nomearDialogo`.
-->
<ion-modal
  class="tour-sheet"
  [class.tour-sheet--centrado]="centrado()"
  [breakpoints]="breakpointsAtivos()"
  [initialBreakpoint]="initialBreakpointAtivo()"
  [canDismiss]="!travado()"
  [isOpen]="isOpen()"
  (didPresent)="nomearDialogo($event)"
  (didDismiss)="fechado.emit()">
  <ng-template>
    <div class="tour-sheet__caixa">
      <header class="tour-sheet__head">
        <h2 class="tour-sheet__titulo">{{ titulo() }}</h2>
        @if (subtitulo()) {
          <p class="tour-sheet__sub">{{ subtitulo() }}</p>
        }
      </header>

      <div class="tour-sheet__conteudo">
        <ng-content></ng-content>
      </div>

      <!--
        Fora da área rolável de propósito: com o botão dentro do corpo, ele
        rola junto e sai da tela justamente quando é preciso.
      -->
      <div class="tour-sheet__rodape">
        <ng-content select="[rodape]"></ng-content>
      </div>
    </div>
  </ng-template>
</ion-modal>
```

- [ ] **Step 4: Criar o componente**

`tour-sheet.component.ts`:

```typescript
import { Component, computed, effect, input, output, signal } from '@angular/core';
import { IonModal } from '@ionic/angular/standalone';

import { emViewportMobile } from './media';

/** Paradas do bottom sheet. O `0` é o que permite arrastar até fechar. */
export const TOUR_SHEET_BREAKPOINTS = [0, 0.55];
export const TOUR_SHEET_INICIAL = 0.55;

/**
 * O shell de bottom sheet do visualizador.
 *
 * Puramente visual: não sabe quais sheets existem nem o que cada um faz. Quem
 * decide qual está aberto é o `TourSheetStore`, e quem monta o conteúdo é cada
 * consumidor, por projeção. É o que faz TV-4, TV-5 e TV-6 serem arquivos novos
 * que não editam este.
 *
 * `IonModal` em vez de um painel à mão: arrastar para baixo, prender o foco,
 * fechar no Esc, devolver o foco a quem abriu e a animação de entrada vêm
 * prontos. Escrever isso de novo seria reescrever um trap de foco, que é onde
 * a a11y costuma morrer.
 *
 * A API foi fechada contra os QUATRO consumidores do sprint, não só contra o
 * primeiro — duas suposições caíram nesse exercício e estão registradas na
 * spec: "sheet fecha ao escolher" é regra do Cenas (TV-4 diz o contrário com
 * todas as letras), e "sheet é sempre bottom sheet" também não (TV-5 pede
 * diálogo centralizado no desktop).
 */
@Component({
  selector: 'app-tour-sheet',
  standalone: true,
  imports: [IonModal],
  templateUrl: './tour-sheet.component.html',
  styleUrls: ['./tour-sheet.component.scss'],
})
export class TourSheetComponent {
  readonly isOpen = input(false);
  readonly titulo = input('');
  readonly subtitulo = input<string | null>(null);

  /**
   * `sheet` — bottom sheet em qualquer largura.
   * `adaptavel` — bottom sheet no celular, modal centrado de 480px no desktop.
   */
  readonly variante = input<'sheet' | 'adaptavel'>('sheet');

  /**
   * Recusa os três gestos de fechamento. Alimenta o `canDismiss` do Ionic, e
   * não o `backdropDismiss`: travar só o scrim deixaria o Esc e o arrasto
   * ativos, e quem pede isto (TV-5, estado "Apagando...") é justamente o caso
   * em que fechar no meio da requisição deixa a tela em estado ambíguo.
   */
  readonly travado = input(false);

  readonly fechado = output<void>();

  private readonly mobile = emViewportMobile();

  /** O nó do diálogo, que vive no shadow DOM do Ionic. Ver `nomearDialogo`. */
  private readonly dialogo = signal<Element | null>(null);

  /** Verdadeiro quando o Ionic deve desenhar um modal centrado, não um sheet. */
  readonly centrado = computed(() => this.variante() === 'adaptavel' && !this.mobile());

  /**
   * `undefined` quando centrado: é a AUSÊNCIA de `breakpoints` que faz o Ionic
   * desenhar um modal centralizado em vez de um sheet. O grabber some junto,
   * sozinho — que é o certo, não há o que arrastar num diálogo centralizado.
   */
  readonly breakpointsAtivos = computed(() =>
    this.centrado() ? undefined : TOUR_SHEET_BREAKPOINTS,
  );

  readonly initialBreakpointAtivo = computed(() =>
    this.centrado() ? undefined : TOUR_SHEET_INICIAL,
  );

  constructor() {
    // Mantém o nome em dia se o título mudar com o sheet já aberto.
    effect(() => {
      const alvo = this.dialogo();
      if (alvo) alvo.setAttribute('aria-label', this.titulo());
    });
  }

  /**
   * Dá nome ao diálogo.
   *
   * `aria-labelledby` NÃO resolve, e a spec registra isso como correção ao
   * ticket: o nó do diálogo vive no shadow DOM do Ionic e o `<h2>` vive na
   * luz. IDREF não atravessa fronteira de shadow. Nomear o host também não
   * adianta — ele é um nó genérico, e o diálogo continua anônimo.
   *
   * Sobra o `aria-label` literal no wrapper. Sem ele o leitor de tela anuncia
   * "diálogo" e mais nada.
   *
   * Escrito já aqui, além do `effect` do construtor: o `effect` só corre na
   * próxima detecção de mudanças, e o foco entra no diálogo no instante do
   * `didPresent`. Um frame de diálogo anônimo é justamente o frame que o
   * leitor lê.
   *
   * Se o Ionic renomear `.modal-wrapper`, o nome some em silêncio — nada
   * quebra visualmente, e é o teste de a11y que denuncia.
   */
  nomearDialogo(event: Event): void {
    const modal = event.target as HTMLElement;
    const wrapper = modal.shadowRoot?.querySelector('.modal-wrapper') ?? null;
    wrapper?.setAttribute('aria-label', this.titulo());
    this.dialogo.set(wrapper);
  }
}
```

- [ ] **Step 5: Criar o estilo**

`tour-sheet.component.scss`:

```scss
// As cores saem da família `--tour-*`. Ela é a exceção documentada em
// `_palette.scss`: "Eles alimentam o fundo das páginas imersivas" -- é o único
// grupo de primitivos que componente consome direto, e o visualizador é
// exatamente o lugar para isso.
//
// O escopo do ticket pedia `#0D1622` de fundo. O `--tour-bg` existente é
// `#0b1220`: 1,03:1 de contraste entre os dois, ou seja, a mesma cor. Um
// primitivo novo para um hex indistinguível de um existente é o inchaço que o
// `_palette.scss` foi escrito para impedir.
ion-modal.tour-sheet {
  --border-radius: 26px;
  --background: var(--tour-bg);
  // O scrim do Ionic é preto puro com opacidade; a cor final vem inteira do
  // `::part(backdrop)` abaixo, então a opacidade daqui vai a 1.
  --backdrop-opacity: 1;
}

ion-modal.tour-sheet::part(backdrop) {
  background: rgba(var(--tour-bg-rgb), 0.55);
  backdrop-filter: blur(8px);
}

// Modal centrado do desktop (variante "adaptavel"). Sem `breakpoints` o Ionic
// já centraliza; aqui só se fixa a largura que o TV-5 pede.
ion-modal.tour-sheet--centrado {
  --width: 480px;
  --max-width: calc(100vw - 32px);
  --height: auto;
}

.tour-sheet__caixa {
  display: flex;
  // A caixa ocupa a altura toda do modal para que o rodapé encoste embaixo e
  // o conteúdo receba o resto -- é o que mantém o rodapé fora da rolagem.
  height: 100%;
  flex-direction: column;
  padding: 8px 20px 20px;
  color: var(--tour-text);
}

.tour-sheet__head {
  flex: 0 0 auto;
  padding-bottom: 12px;
}

.tour-sheet__titulo {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--tour-text);
}

.tour-sheet__sub {
  margin: 2px 0 0;
  font-size: 13px;
  opacity: 0.7;
}

.tour-sheet__conteudo {
  flex: 1 1 auto;
  // `min-height: 0` para o filho rolável poder encolher dentro do flex em vez
  // de empurrar o rodapé para fora da caixa.
  min-height: 0;
}

.tour-sheet__rodape {
  flex: 0 0 auto;
  // Sem conteúdo projetado o div fica com altura zero e não abre buraco --
  // por isso não há `@if` aqui, e Cenas pode simplesmente não usar o slot.
  &:empty {
    display: none;
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

```bash
cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="src/app/components/tour-sheet/tour-sheet.component.spec.ts"
```
Expected: `TOTAL: 8 SUCCESS`.

- [ ] **Step 7: Provar por mutação que o teste de `travado` pega regressão**

Em `tour-sheet.component.html`, troque `[canDismiss]="!travado()"` por
`[canDismiss]="true"`. Rode o mesmo comando do Step 6.
Expected: FALHA em `travado recusa o fechamento, e destravado permite`.
**Desfaça a mutação** e rode de novo. Expected: `TOTAL: 8 SUCCESS`.

- [ ] **Step 8: Conferir CRLF e commitar**

```bash
cd inner-view-client && for f in src/app/components/tour-sheet/tour-sheet.component.ts src/app/components/tour-sheet/tour-sheet.component.html src/app/components/tour-sheet/tour-sheet.component.scss src/app/components/tour-sheet/tour-sheet.component.spec.ts; do
node -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1],'utf8');const lf=(b.match(/\n/g)||[]).length,crlf=(b.match(/\r\n/g)||[]).length;console.log(crlf===lf?'CRLF ok':'MISTO — CORRIJA',process.argv[1])" $f; done
cd .. && git add inner-view-client/src/app/components/tour-sheet/
git commit -m "feat(client): TourSheetComponent, o shell de bottom sheet do visualizador"
```

---

### Task 5: `CenasSheetComponent` — o primeiro consumidor

**Files:**
- Create: `inner-view-client/src/app/components/cenas-sheet/cenas-sheet.component.ts`
- Create: `inner-view-client/src/app/components/cenas-sheet/cenas-sheet.component.html`
- Create: `inner-view-client/src/app/components/cenas-sheet/cenas-sheet.component.scss`
- Test: `inner-view-client/src/app/components/cenas-sheet/cenas-sheet.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { Panorama } from '../../models/virtual-tour.model';
import { TourSheetStore } from '../tour-sheet/tour-sheet.store';
import { CenasSheetComponent } from './cenas-sheet.component';

describe('CenasSheetComponent', () => {
  let fixture: ComponentFixture<CenasSheetComponent>;
  let store: TourSheetStore;

  // Só os campos que este sheet lê. O cast evita repetir `initialPanorama`,
  // `originHotspots` e `measurements` em cada teste sem que nenhum deles
  // participe do que se está provando.
  function cena(id: string, order: number): Panorama {
    return {
      id,
      roomName: `Ambiente ${id}`,
      imageUrl: `/panoramas/${id}/image`,
      order,
    } as unknown as Panorama;
  }

  function cenas(quantas: number): Panorama[] {
    return Array.from({ length: quantas }, (_, i) => cena(`c${i}`, quantas - i));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CenasSheetComponent],
      providers: [
        provideIonicAngular(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    store = TestBed.inject(TourSheetStore);
    fixture = TestBed.createComponent(CenasSheetComponent);
  });

  function montar(lista: Panorama[], atual: string | null = null): void {
    fixture.componentRef.setInput('cenas', lista);
    fixture.componentRef.setInput('atualId', atual);
    store.abrir('cenas');
    fixture.detectChanges();
  }

  const raiz = () => fixture.nativeElement as HTMLElement;
  const cards = () => Array.from(raiz().querySelectorAll('.cenas-sheet__card'));

  it('mostra um card por cena, na ordem do tour', () => {
    montar([cena('b', 2), cena('a', 1), cena('c', 3)]);

    // Ordenado por `order`, nao pela ordem do array: duas listas das mesmas
    // cenas em ordens diferentes seria percebido como aleatoriedade.
    expect(cards().length).toBe(3);
    expect(cards().map((c) => c.getAttribute('data-cena'))).toEqual(['a', 'b', 'c']);
  });

  it('o subtitulo usa a chave de plural certa', () => {
    montar(cenas(3));
    expect(raiz().querySelector('.tour-sheet__sub')?.textContent)
      .toContain('VIEWER.CENAS.CONTAGEM');
  });

  // "1 cenas" e' erro visivel na tela, e o ngx-translate nao faz plural
  // sozinho -- dai a chave separada.
  it('com uma cena so, usa a chave do singular', () => {
    montar(cenas(1));
    expect(raiz().querySelector('.tour-sheet__sub')?.textContent)
      .toContain('VIEWER.CENAS.UMA');
  });

  it('nada quebra com uma cena so', () => {
    montar(cenas(1));
    expect(cards().length).toBe(1);
  });

  it('nada quebra com trinta cenas', () => {
    montar(cenas(30));
    expect(cards().length).toBe(30);
  });

  it('a badge ATUAL marca so a cena vigente, e tambem para leitor de tela', () => {
    montar([cena('a', 1), cena('b', 2)], 'b');

    const marcados = cards().filter((c) => c.querySelector('.cenas-sheet__badge'));
    expect(marcados.length).toBe(1);
    expect(marcados[0].getAttribute('data-cena')).toBe('b');
    // A pilula e' visual; um leitor de tela nao a ve.
    expect(marcados[0].getAttribute('aria-current')).toBe('true');
    expect(cards()[0].getAttribute('aria-current')).toBeNull();
  });

  // <button> e nao <div (click)>: o card precisa de foco por teclado e de
  // papel de controle. Uma div com click e' invisivel para quem navega por
  // Tab e nao anuncia nada ao leitor de tela.
  it('o card e um button, para receber foco por teclado', () => {
    montar(cenas(2));
    expect(cards().map((c) => c.tagName)).toEqual(['BUTTON', 'BUTTON']);
  });

  it('selecionar emite a cena E fecha o sheet', () => {
    montar([cena('a', 1), cena('b', 2)]);
    let escolhida: Panorama | null = null;
    fixture.componentInstance.selecionada.subscribe((c: Panorama) => { escolhida = c; });

    (cards()[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(escolhida!.id).toBe('b');
    // Fechar ao escolher e' regra DESTE sheet, nao do shell: TV-4 diz
    // explicitamente que copiar codigo MANTEM o sheet aberto.
    expect(store.aberto()).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="src/app/components/cenas-sheet/cenas-sheet.component.spec.ts"
```
Expected: FALHA na compilação — `Cannot find module './cenas-sheet.component'`.

> **Desvio da spec, deliberado.** A tabela de testes da spec previa provar a
> devolução do foco ao gatilho em teste de unidade
> (`document.activeElement` antes e depois). No Karma isso não é confiável: o
> `IonModal` só devolve o foco depois da animação de saída, e a fixture não
> tem o gatilho real no documento. A verificação fica no navegador, no
> **Step 3 da Task 7** — que é onde ela prova alguma coisa. Não some do
> escopo; muda de lugar.

- [ ] **Step 3: Criar o template**

`cenas-sheet.component.html`:

```html
<app-tour-sheet
  [isOpen]="store.aberto() === 'cenas'"
  [titulo]="'VIEWER.CENAS.TITULO' | translate"
  [subtitulo]="legenda()"
  (fechado)="store.fechar()">

  <ul class="cenas-sheet__grade" role="list">
    @for (cena of ordenadas(); track cena.id) {
      <li>
        <button
          type="button"
          class="cenas-sheet__card"
          [attr.data-cena]="cena.id"
          [attr.aria-current]="cena.id === atualId() ? 'true' : null"
          (click)="escolher(cena)">
          <img class="cenas-sheet__thumb" [src]="miniatura(cena)" alt="" loading="lazy">
          <span class="cenas-sheet__nome">{{ cena.roomName }}</span>
          @if (cena.id === atualId()) {
            <span class="cenas-sheet__badge">{{ 'VIEWER.CENAS.ATUAL' | translate }}</span>
          }
        </button>
      </li>
    }
  </ul>
</app-tour-sheet>
```

- [ ] **Step 4: Criar o componente**

`cenas-sheet.component.ts`:

```typescript
import { Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { Panorama } from '../../models/virtual-tour.model';
import { VirtualTourService } from '../../services/virtual-tour.service';
import { TourSheetComponent } from '../tour-sheet/tour-sheet.component';
import { TourSheetStore } from '../tour-sheet/tour-sheet.store';

/**
 * Largura pedida ao servidor para a miniatura de cada card.
 *
 * Num telefone de 390px cada card fica com ~165px; 320 cobre DPR 2 sem
 * desperdício. Sem esse parâmetro a rota devolve a equirretangular inteira —
 * dezenas de MB por cômodo —, e é isso que tornaria trinta cenas inviáveis.
 */
const LARGURA_DA_MINIATURA = 320;

/**
 * O sheet "Cenas do tour": primeiro consumidor do `TourSheetComponent`.
 *
 * Fechar ao escolher é regra DESTE sheet e mora aqui, não no shell: TV-4 diz
 * com todas as letras que copiar código mantém o sheet aberto. Se a regra
 * subisse para o shell, o primeiro consumidor teria ditado a API para os
 * outros três.
 */
@Component({
  selector: 'app-cenas-sheet',
  standalone: true,
  imports: [TourSheetComponent, TranslatePipe],
  templateUrl: './cenas-sheet.component.html',
  styleUrls: ['./cenas-sheet.component.scss'],
})
export class CenasSheetComponent {
  readonly cenas = input<Panorama[]>([]);
  readonly atualId = input<string | null>(null);

  readonly selecionada = output<Panorama>();

  readonly store = inject(TourSheetStore);
  private readonly tours = inject(VirtualTourService);
  private readonly translate = inject(TranslateService);

  /**
   * Mesma ordem do tour — `order` crescente, igual ao que o
   * `panoramic-viewer` usa em `atualizarNav()`. Duas listas das mesmas cenas
   * em ordens diferentes seria percebido como aleatoriedade.
   */
  readonly ordenadas = computed(() =>
    [...this.cenas()].sort((a, b) => a.order - b.order),
  );

  /** "1 cena" / "N cenas". O ngx-translate não faz plural sozinho. */
  readonly legenda = computed(() => {
    const total = this.ordenadas().length;
    return total === 1
      ? this.translate.instant('VIEWER.CENAS.UMA')
      : this.translate.instant('VIEWER.CENAS.CONTAGEM', { n: total });
  });

  miniatura(cena: Panorama): string {
    return this.tours.urlDoPreview(cena.id, 'treated', { largura: LARGURA_DA_MINIATURA });
  }

  escolher(cena: Panorama): void {
    this.selecionada.emit(cena);
    this.store.fechar();
  }
}
```

- [ ] **Step 5: Criar o estilo**

`cenas-sheet.component.scss`:

```scss
.cenas-sheet__grade {
  display: grid;
  // Duas colunas, cards de 96px, rolagem depois de 340px -- os três números
  // vêm do escopo do ticket.
  grid-template-columns: repeat(2, 1fr);
  max-height: 340px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  gap: 8px;
  list-style: none;
}

.cenas-sheet__card {
  position: relative;
  display: block;
  width: 100%;
  height: 96px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: var(--tour-surface);
  overflow: hidden;
  cursor: pointer;
}

.cenas-sheet__thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cenas-sheet__nome {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 4px 8px;
  // Degradê e não cor sólida: o nome fica sobre foto, e uma faixa opaca
  // cortaria a miniatura em duas.
  background: linear-gradient(transparent, rgba(var(--tour-bg-rgb), 0.9));
  color: var(--tour-text);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cenas-sheet__badge {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--ion-color-primary);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
```

- [ ] **Step 6: Rodar e ver passar**

```bash
cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="src/app/components/cenas-sheet/cenas-sheet.component.spec.ts"
```
Expected: `TOTAL: 8 SUCCESS`.

- [ ] **Step 7: Provar por mutação que o teste de ordenação pega regressão**

Em `cenas-sheet.component.ts`, troque o corpo de `ordenadas` por
`computed(() => this.cenas())`. Rode o comando do Step 6.
Expected: FALHA em `mostra um card por cena, na ordem do tour`.
**Desfaça a mutação** e rode de novo. Expected: `TOTAL: 9 SUCCESS`.

- [ ] **Step 8: Conferir CRLF e commitar**

```bash
cd inner-view-client && for f in src/app/components/cenas-sheet/cenas-sheet.component.ts src/app/components/cenas-sheet/cenas-sheet.component.html src/app/components/cenas-sheet/cenas-sheet.component.scss src/app/components/cenas-sheet/cenas-sheet.component.spec.ts; do
node -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1],'utf8');const lf=(b.match(/\n/g)||[]).length,crlf=(b.match(/\r\n/g)||[]).length;console.log(crlf===lf?'CRLF ok':'MISTO — CORRIJA',process.argv[1])" $f; done
cd .. && git add inner-view-client/src/app/components/cenas-sheet/
git commit -m "feat(client): sheet Cenas do tour, primeiro consumidor do shell"
```

---

### Task 6: Gatilho no visualizador

**Files:**
- Modify: `inner-view-client/src/app/inner-view-page/inner-view-page.page.ts`
- Modify: `inner-view-client/src/app/inner-view-page/inner-view-page.page.html`
- Test: `inner-view-client/src/app/inner-view-page/inner-view-page.page.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao final do `describe` existente em `inner-view-page.page.spec.ts`
(não crie arquivo novo; mantenha o `beforeEach` que já existe lá):

```typescript
  describe('sheet de cenas', () => {
    it('o botao de cenas abre o sheet', () => {
      const store = TestBed.inject(TourSheetStore);
      expect(store.aberto()).toBeNull();

      component.abrirCenas();

      expect(store.aberto()).toBe('cenas');
    });

    // O viewer ja expoe `irPara(id)` publico -- nao ha API nova a inventar.
    it('escolher uma cena manda o viewer trocar', () => {
      const irPara = jasmine.createSpy('irPara');
      component.viewer = { irPara } as never;

      component.onCenaSelecionada({ id: 'c2' } as never);

      expect(irPara).toHaveBeenCalledWith('c2');
    });
  });
```

Acrescente aos imports do topo do arquivo de teste:

```typescript
import { TourSheetStore } from '../components/tour-sheet/tour-sheet.store';
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="src/app/inner-view-page/inner-view-page.page.spec.ts"
```
Expected: FALHA — `component.abrirCenas is not a function`.

- [ ] **Step 3: Ligar o componente**

Em `inner-view-page.page.ts`:

1. Acrescente aos imports do arquivo:

```typescript
import { CenasSheetComponent } from '../components/cenas-sheet/cenas-sheet.component';
import { TourSheetStore } from '../components/tour-sheet/tour-sheet.store';
```

2. Acrescente `CenasSheetComponent` ao array `imports` do decorador, e
   `albumsOutline` à lista importada de `ionicons/icons` e ao `addIcons({...})`
   já existente no construtor.

3. Acrescente ao corpo da classe, junto dos outros `inject`:

```typescript
  readonly tourSheet = inject(TourSheetStore);
```

4. Acrescente os dois métodos ao final da classe:

```typescript
  /**
   * Abre o sheet de cenas. O `TourSheetStore` garante que abrir este feche
   * qualquer outro — quando TV-4, TV-5 e TV-6 existirem, nada aqui muda.
   */
  abrirCenas(): void {
    this.tourSheet.abrir('cenas');
  }

  /**
   * O `PanoramicViewerComponent` já expõe `irPara(id)` público e o campo
   * `idAtual`; não há API nova a inventar para isto.
   */
  onCenaSelecionada(cena: Panorama): void {
    this.viewer?.irPara(cena.id);
  }
```

- [ ] **Step 4: Ligar o template**

Em `inner-view-page.page.html`, dentro do bloco
`@if (tour) { ... }` do `headerActions`, acrescente ANTES do botão de download:

```html
          <button
            type="button"
            class="viewer-action"
            [attr.aria-label]="'VIEWER.CENAS.ABRIR' | translate"
            (click)="abrirCenas()">
            <ion-icon name="albums-outline"></ion-icon>
          </button>
```

E, logo depois do `</app-panoramic-viewer>`, acrescente:

```html
    <app-cenas-sheet
      [cenas]="tour.panoramas"
      [atualId]="currentPanorama?.id ?? null"
      (selecionada)="onCenaSelecionada($event)">
    </app-cenas-sheet>
```

> **Nota sobre `atualId`.** A spec dizia "alimenta `[atualId]` com
> `viewer.idAtual`". Aqui usa-se `currentPanorama`, que é campo da própria
> página e já é mantido pelo `(panoramaChange)` que existe há tempos. Ler
> `viewer.idAtual` numa ligação de template significaria ler um campo do
> filho durante a detecção de mudanças do pai — receita de
> `ExpressionChangedAfterItHasBeenCheckedError`. Mesmo valor, sem o risco.

- [ ] **Step 5: Rodar e ver passar**

```bash
cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="src/app/inner-view-page/inner-view-page.page.spec.ts"
```
Expected: todos os testes do arquivo passando, incluindo os dois novos.

- [ ] **Step 6: Suíte inteira, lint e build**

```bash
cd inner-view-client
npx ng test --watch=false --browsers=ChromeHeadless 2>&1 | grep -E "TOTAL|FAILED"
npx ng lint
npx ng build
```
Expected: `TOTAL: <n> SUCCESS` sem `FAILED`; `All files pass linting`;
`Application bundle generation complete`.

- [ ] **Step 7: Conferir CRLF e commitar**

```bash
cd inner-view-client && for f in src/app/inner-view-page/inner-view-page.page.ts src/app/inner-view-page/inner-view-page.page.html src/app/inner-view-page/inner-view-page.page.spec.ts; do
node -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1],'utf8');const lf=(b.match(/\n/g)||[]).length,crlf=(b.match(/\r\n/g)||[]).length;console.log(crlf===lf?'CRLF ok':'MISTO — CORRIJA',process.argv[1])" $f; done
cd .. && git add inner-view-client/src/app/inner-view-page/
git commit -m "feat(client): botao de cenas abre o sheet no visualizador"
```

---

### Task 7: Verificação visual no app rodando

Os testes provam ligação, não aparência. Grade, raio de 26px, scrim com blur e
a rolagem depois de 340px só se conferem olhando.

**Files:** nenhum. É verificação.

- [ ] **Step 1: Subir o app**

```bash
cd inner-view-client && npx ng serve --port 4203 --host 127.0.0.1
```
Deixe rodando em segundo plano. Espere `Application bundle generation complete`.

- [ ] **Step 2: Abrir um tour com várias cenas e o sheet**

O `/inner-view-page/:id` está atrás do `authGuard`, que é uma checagem
puramente cliente de `AuthService.isAuthenticated()` — um
`localStorage.setItem('accessToken', '<qualquer coisa>')` antes de navegar já
passa por ele.

Tire screenshots em **390×844** (celular) e **1440×900** (desktop), com o sheet
aberto, e confira, um a um:

1. Duas colunas de cards de 96px.
2. Canto superior do sheet arredondado em 26px.
3. Scrim escurecido **e borrado** por trás.
4. Grabber visível no topo do sheet.
5. Badge ATUAL exatamente na cena que está sendo exibida.
6. Com mais de ~7 cenas, a grade rola dentro dos 340px e o resto do sheet fica
   parado.

- [ ] **Step 3: Conferir os três gestos de fechar, no navegador**

Com o sheet aberto: clicar no scrim fecha; arrastar o grabber para baixo fecha;
`Escape` fecha. Depois de cada um, conferir que o foco voltou para o botão de
cenas do header — `document.activeElement` deve ser esse `<button>`.

- [ ] **Step 4: Registrar o resultado**

Anexar os screenshots ao PR e escrever, em uma linha por item, o que foi
conferido. Se algum item falhar, corrigir e repetir o passo — não seguir com
item pendente.

---

## Fora do escopo deste plano

- **Barra inferior do visualizador.** O gatilho vive no header; quando a barra
  existir, é mover o clique.
- **Migrar o `HotspotSheetComponent`** para o shell novo.
- **TV-4, TV-5 e TV-6.** Este plano entrega a API que eles consomem.
- **Resolver a duplicação com o `roomNav`.** O visualizador fica com duas
  listas de cenas — a interna (rotulada "Ambientes") e este sheet (rotulado
  "Cenas do tour"). Aceito em conversa para não crescer um PR que é prioridade
  de merge. **Some a isso que os dois usam palavras diferentes para a mesma
  coisa**; o ticket que resolver a duplicação precisa resolver o vocabulário
  junto.
