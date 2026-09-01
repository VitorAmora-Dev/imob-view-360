# Tela de Login — Redesenho Visual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar `inner-view-client/src/app/login/` como duas colunas a partir de 744px (painel de marca em gradiente + formulário), tirar o `<app-header>` da página, e extrair todo texto para `ngx-translate`.

**Architecture:** Reescrita de um único componente standalone (`LoginPage`) — template, estilo e a única string que ainda vive no `.ts` (a mensagem de erro). Nenhuma lógica de autenticação muda; `AuthService`/`submit()` seguem exatamente como estão. Sete chaves novas de i18n em `pt.json`/`en.json` sob um bloco `AUTH` que ainda não existe.

**Tech Stack:** Angular 20 standalone components, Ionic 8 (`ion-input`/`ion-button`/`ion-toast`), `@ngx-translate/core`, SCSS com os tokens de `src/theme/variables.scss` (L1) — nunca `src/theme/_palette.scss` (L0) direto.

**Spec:** `docs/superpowers/specs/2026-09-01-tela-de-login-design.md`

---

## Antes de começar

Confirme que está na branch certa e com as dependências instaladas:

```bash
cd "inner-view-client"
git branch --show-current   # deve mostrar: atualizar-tela-login
ls node_modules/.bin > /dev/null 2>&1 || npm install
```

Todo o repo usa CRLF (`\r\n`). Depois de QUALQUER edição de arquivo, verifique
antes de commitar:

```bash
node -e "
const fs=require('fs'); const d=fs.readFileSync('CAMINHO/DO/ARQUIVO');
let lf=0,crlf=0;
for(let i=0;i<d.length;i++){ if(d[i]===10){ lf++; if(d[i-1]===13) crlf++; } }
console.log(lf===crlf ? 'ok' : 'LF SOLTO ('+(lf-crlf)+')');
"
```

Se der "LF SOLTO", reescreva o arquivo com o Write tool normalmente (ele
preserva CRLF ao editar um arquivo que já é CRLF) ou, se foi criado do zero,
regrave garantindo `\r\n`.

---

### Task 1: Chaves de i18n `AUTH.*`

**Files:**
- Modify: `inner-view-client/src/assets/i18n/pt.json`
- Modify: `inner-view-client/src/assets/i18n/en.json`

Hoje os dois arquivos começam com `{\n  "HOME": {`. O bloco `AUTH` entra ANTES
de `"HOME"`, como o primeiro bloco do arquivo.

- [ ] **Step 1: Inserir o bloco em `pt.json`**

Abra `inner-view-client/src/assets/i18n/pt.json`. A primeira linha é `{` e a
segunda é `  "HOME": {`. Insira estas linhas ENTRE as duas:

```json
  "AUTH": {
    "TAGLINE": "Tour virtual de imóveis 360°",
    "LOGIN_TITLE": "Entrar",
    "EMAIL_LABEL": "E-mail",
    "PASSWORD_LABEL": "Senha",
    "SUBMIT": "Entrar",
    "NO_ACCOUNT": "Não tem uma conta? Criar conta",
    "INVALID_CREDENTIALS": "E-mail ou senha inválidos."
  },
```

O arquivo deve começar assim depois da edição:

```json
{
  "AUTH": {
    "TAGLINE": "Tour virtual de imóveis 360°",
    "LOGIN_TITLE": "Entrar",
    "EMAIL_LABEL": "E-mail",
    "PASSWORD_LABEL": "Senha",
    "SUBMIT": "Entrar",
    "NO_ACCOUNT": "Não tem uma conta? Criar conta",
    "INVALID_CREDENTIALS": "E-mail ou senha inválidos."
  },
  "HOME": {
```

- [ ] **Step 2: Inserir o bloco equivalente em `en.json`**

Mesmo lugar (entre `{` e `"HOME": {`):

```json
  "AUTH": {
    "TAGLINE": "360° virtual property tours",
    "LOGIN_TITLE": "Log in",
    "EMAIL_LABEL": "Email",
    "PASSWORD_LABEL": "Password",
    "SUBMIT": "Log in",
    "NO_ACCOUNT": "Don't have an account? Sign up",
    "INVALID_CREDENTIALS": "Invalid email or password."
  },
```

- [ ] **Step 3: Verificar JSON válido e paridade de chaves**

Rodar a partir de `inner-view-client/`:

```bash
node -e "
const pt = JSON.parse(require('fs').readFileSync('src/assets/i18n/pt.json', 'utf-8'));
const en = JSON.parse(require('fs').readFileSync('src/assets/i18n/en.json', 'utf-8'));
console.log('pt.AUTH:', Object.keys(pt.AUTH));
console.log('en.AUTH:', Object.keys(en.AUTH));
const a = new Set(Object.keys(pt.AUTH)), b = new Set(Object.keys(en.AUTH));
console.log('so em pt:', [...a].filter(k => !b.has(k)));
console.log('so em en:', [...b].filter(k => !a.has(k)));
"
```

Expected: os dois `Object.keys` listam as mesmas 7 chaves
(`TAGLINE, LOGIN_TITLE, EMAIL_LABEL, PASSWORD_LABEL, SUBMIT, NO_ACCOUNT,
INVALID_CREDENTIALS`), e as duas linhas de diferença saem vazias (`[]`). Se o
`JSON.parse` falhar, a vírgula ou chave de fechamento foi colocada errada —
confira a inserção.

- [ ] **Step 4: Verificar CRLF nos dois arquivos**

```bash
for f in src/assets/i18n/pt.json src/assets/i18n/en.json; do
  node -e "
  const fs=require('fs'); const d=fs.readFileSync('$f');
  let lf=0,crlf=0;
  for(let i=0;i<d.length;i++){ if(d[i]===10){ lf++; if(d[i-1]===13) crlf++; } }
  console.log('$f:', lf===crlf ? 'ok' : 'LF SOLTO');
  "
done
```

Expected: `ok` nos dois. Se algum editor tiver normalizado para LF, reabra o
arquivo com o Write tool e regrave preservando `\r\n` — a forma mais simples é
usar Edit (que não mexe no line-ending do resto do arquivo) em vez de reescrever
o arquivo inteiro.

- [ ] **Step 5: Commit**

```bash
cd ..
git add inner-view-client/src/assets/i18n/pt.json inner-view-client/src/assets/i18n/en.json
git commit -m "feat(client): chaves de i18n AUTH.* para a tela de login"
```

---

### Task 2: Reescrever `LoginPage`

**Files:**
- Modify: `inner-view-client/src/app/login/login.page.spec.ts`
- Modify: `inner-view-client/src/app/login/login.page.html`
- Modify: `inner-view-client/src/app/login/login.page.scss`
- Modify: `inner-view-client/src/app/login/login.page.ts`

Depende da Task 1 para o APP FUNCIONAR de verdade — sem as chaves em
`pt.json`/`en.json`, a tela real mostraria `AUTH.LOGIN_TITLE` etc. na cara do
usuário. Os testes unitários abaixo não dependem da ordem: sem loader HTTP
configurado nos testes, `TranslatePipe` já devolve a própria chave como
string, existindo o bloco `AUTH` ou não — é por isso que os testes verificam
a CHAVE, e não o texto (próxima seção).

#### Por que os testes checam a CHAVE, não o texto

`login.page.spec.ts` usa `provideTranslateService({ lang: 'pt', fallbackLang:
'pt' })` **sem** um loader HTTP. Sem loader, `| translate` devolve a própria
chave como string. Isso já é o padrão usado em todo o resto da suíte (ex.:
`tour-wizard.page.spec.ts`, que verifica
`el().textContent).toContain('TOUR_WIZARD.PASSAGES.DONE')`). O teste desta
página segue o mesmo padrão.

- [ ] **Step 1: Substituir `login.page.spec.ts` inteiro**

```typescript
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { throwError } from 'rxjs';

import { LoginPage } from './login.page';
import { AuthService } from '../services/auth.service';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideIonicAngular(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows one page heading and a decorative ARP VISION symbol', () => {
    const heading: HTMLHeadingElement = el().querySelector('.auth-intro h1')!;
    const symbol: HTMLImageElement = el().querySelector('.auth-intro app-brand-logo img')!;
    expect(heading.textContent?.trim()).toBe('AUTH.LOGIN_TITLE');
    expect(el().querySelectorAll('h1').length).toBe(1);
    expect(symbol.getAttribute('src')).toContain('arp-vision-symbol-blue-transparent.svg');
    expect(symbol.getAttribute('alt')).toBe('');
    expect(symbol.getAttribute('aria-hidden')).toBe('true');
  });

  // O header antigo so mostrava a marca, e o link dela levava para /home --
  // rota atras do authGuard, que devolve para /login. Um botao que voltava
  // pra onde ja se estava. A marca continua presente no painel visual e no
  // auth-intro, sem o header.
  it('nao mostra mais o app-header', () => {
    expect(el().querySelector('app-header')).toBeNull();
  });

  // O painel visual so aparece a partir de 744px, mas isso e' feito por CSS
  // (mesmo padrao de .header-desktop em app-header.component.scss) -- ele
  // fica sempre no DOM, e o teste nao depende de media query nenhuma.
  it('o painel visual carrega a logo branca e a tagline', () => {
    const painel = el().querySelector('.login-visual');
    expect(painel).not.toBeNull();

    const logoBranca = painel!.querySelector('app-brand-logo img') as HTMLImageElement;
    expect(logoBranca.getAttribute('src')).toContain('arp-vision-horizontal-white.svg');

    const tagline = painel!.querySelector('.login-visual__tagline');
    expect(tagline?.textContent?.trim()).toBe('AUTH.TAGLINE');
  });

  it('os campos, o botao e o link de criar conta vem do ngx-translate', () => {
    const emailInput = el().querySelector('ion-input[name="email"]') as unknown as {
      label: string;
    };
    const senhaInput = el().querySelector('ion-input[name="password"]') as unknown as {
      label: string;
    };
    const submitBtn = el().querySelector('.login-btn') as HTMLElement;
    const registerBtn = el().querySelector('ion-button[fill="clear"]') as HTMLElement;

    expect(emailInput.label).toBe('AUTH.EMAIL_LABEL');
    expect(senhaInput.label).toBe('AUTH.PASSWORD_LABEL');
    expect(submitBtn.textContent?.trim()).toContain('AUTH.SUBMIT');
    expect(registerBtn.textContent?.trim()).toBe('AUTH.NO_ACCOUNT');
  });

  // A mensagem de erro era string fixa no .ts -- unica que sobrava fora do
  // template. Sai pela mesma razao das do HTML.
  it('erro de login usa a chave de traducao, nao string fixa', () => {
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'signin').and.returnValue(throwError(() => new Error('credenciais invalidas')));

    const component = fixture.componentInstance;
    component.email = 'a@a.com';
    component.password = 'x';
    component.submit();

    expect(component.errorMessage).toBe('AUTH.INVALID_CREDENTIALS');
    expect(component.showToast).toBeTrue();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
cd inner-view-client
npx ng test --watch=false --browsers=ChromeHeadless --include="**/login.page.spec.ts"
```

Expected: `FAILED` nos cinco — o componente atual ainda tem `<app-header>`,
não tem `.login-visual`, mostra `label`/texto literal em vez de chave de
tradução, e não injeta `TranslateService` no erro:

- `shows one page heading and a decorative ARP VISION symbol` (o `h1` mostra
  o texto literal `'Entrar'`, não a chave `'AUTH.LOGIN_TITLE'`)
- `nao mostra mais o app-header` (`<app-header>` ainda está no template)
- `o painel visual carrega a logo branca e a tagline` (`.login-visual` não
  existe ainda)
- `os campos, o botao e o link de criar conta vem do ngx-translate` (os
  `ion-input` têm `label="E-mail"`/`label="Senha"` literais)
- `erro de login usa a chave de traducao, nao string fixa`
  (`errorMessage` ainda é a string fixa `'E-mail ou senha inválidos.'`)

- [ ] **Step 3: Substituir `login.page.html` inteiro**

```html
<ion-content [fullscreen]="true">
  <div class="login-shell">
    <div class="login-visual" aria-hidden="true">
      <app-brand-logo kind="horizontal" tone="white" [decorative]="true"></app-brand-logo>
      <p class="login-visual__tagline">{{ 'AUTH.TAGLINE' | translate }}</p>
    </div>

    <div class="login-form-panel">
      <div class="auth-intro">
        <app-brand-logo kind="symbol" [decorative]="true"></app-brand-logo>
        <h1>{{ 'AUTH.LOGIN_TITLE' | translate }}</h1>
        <p class="brand-tagline">{{ 'AUTH.TAGLINE' | translate }}</p>
      </div>

      <form (ngSubmit)="submit()">
        <ion-input
          [label]="'AUTH.EMAIL_LABEL' | translate"
          labelPlacement="floating"
          fill="outline"
          type="email"
          [(ngModel)]="email"
          name="email"
          autocomplete="email"
          required>
        </ion-input>

        <ion-input
          [label]="'AUTH.PASSWORD_LABEL' | translate"
          labelPlacement="floating"
          fill="outline"
          type="password"
          [(ngModel)]="password"
          name="password"
          autocomplete="current-password"
          required>
        </ion-input>

        <ion-button
          expand="block"
          type="submit"
          class="login-btn"
          [disabled]="loading || !email || !password">
          @if (loading) {
            <ion-spinner name="crescent" slot="start"></ion-spinner>
          }
          {{ 'AUTH.SUBMIT' | translate }}
        </ion-button>
      </form>

      <ion-button fill="clear" expand="block" routerLink="/register">
        {{ 'AUTH.NO_ACCOUNT' | translate }}
      </ion-button>
    </div>
  </div>
</ion-content>

<ion-toast
  [isOpen]="showToast"
  [message]="errorMessage"
  [duration]="3000"
  color="danger"
  position="bottom"
  (didDismiss)="showToast = false">
</ion-toast>
```

Note que `class="ion-padding"` SAIU de `<ion-content>`. Ela aplicava ~16px de
respiro em todos os lados, o que impediria `.login-visual` de tocar a borda da
tela — o padding de cada painel passa a ser controlado pelo SCSS abaixo.

- [ ] **Step 4: Substituir `login.page.scss` inteiro**

```scss
// Duas colunas a partir de 744px: painel de marca a esquerda (gradiente da
// cor primaria), formulario a direita. Abaixo disso, so o formulario -- o
// painel de marca sai por CSS (mesmo padrao de .header-desktop em
// app-header.component.scss), nao por @if, entao ele continua no DOM e so
// alterna visibilidade.

.login-shell {
  display: flex;
  min-height: 100dvh;
}

.login-visual {
  display: none;
}

.login-form-panel {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  justify-content: center;
  padding: 24px;
  // O <app-header> saiu da pagina, e era ele quem absorvia o topo com
  // recorte (notch). Sem ele, o painel precisa fazer isso sozinho.
  padding-top: calc(24px + var(--ion-safe-area-top, 0px));
}

.login-form-panel form,
.login-form-panel > ion-button {
  width: 100%;
  max-width: 400px;
  margin-inline: auto;
}

.login-btn {
  margin-top: 8px;
}

@media (min-width: 744px) {
  .login-visual {
    display: flex;
    flex: 1 1 45%;
    flex-direction: column;
    justify-content: flex-end;
    max-width: 560px;
    padding: 64px;
    // --ion-color-primary/-shade sao os alias de L1 para
    // --brand-primary/--brand-primary-dark (variables.scss). Nunca o
    // primitivo de L0 direto aqui -- e' a regra do proprio _palette.scss.
    background: linear-gradient(
      135deg,
      var(--ion-color-primary),
      var(--ion-color-primary-shade)
    );
  }

  .login-visual__tagline {
    max-width: 320px;
    margin-top: 16px;
    font-size: 16px;
    line-height: 1.5;
    color: #ffffff;
  }

  .login-form-panel {
    flex: 1 1 55%;
    padding: 64px;
  }

  // A tagline ja aparece no painel visual -- repeti-la aqui tambem soaria
  // como eco. So esconde a partir daqui; a marcacao continua no DOM porque
  // no mobile o painel visual nem existe, e o auth-intro precisa dela.
  .login-form-panel .auth-intro .brand-tagline {
    display: none;
  }
}
```

- [ ] **Step 5: Substituir `login.page.ts` inteiro**

```typescript
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonContent, IonInput, IonButton, IonToast, IonSpinner
} from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BrandLogoComponent } from '../components/brand-logo/brand-logo.component';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink,
    IonContent, IonInput, IonButton, IonToast, IonSpinner,
    TranslatePipe, BrandLogoComponent,
  ],
})
export class LoginPage {
  email = '';
  password = '';
  loading = false;
  errorMessage = '';
  showToast = false;

  private authService = inject(AuthService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  submit() {
    if (!this.email || !this.password) return;
    this.loading = true;
    this.authService.signin(this.email, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/home']);
      },
      error: () => {
        this.loading = false;
        this.errorMessage = this.translate.instant('AUTH.INVALID_CREDENTIALS');
        this.showToast = true;
      },
    });
  }
}
```

Note que `AppHeaderComponent` saiu do import — o template não usa mais
`<app-header>`.

- [ ] **Step 6: Rodar os testes e confirmar que passam**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include="**/login.page.spec.ts"
```

Expected: `TOTAL: 5 SUCCESS` (os cinco `it(...)` do Step 1).

- [ ] **Step 7: Rodar a suíte inteira**

Outras specs podem importar `LoginPage` ou navegar para `/login`
indiretamente (ex.: guards, `app.routes.ts`). Confirme que nada mais quebrou:

```bash
npx ng test --watch=false --browsers=ChromeHeadless
```

Expected: `TOTAL: N SUCCESS`, sem `FAILED`. Se algo fora de
`login.page.spec.ts` falhar, leia a mensagem — não é esperado que este
redesenho afete outra tela, então investigue antes de seguir.

- [ ] **Step 8: Build e lint**

```bash
npx ng build --configuration development
npx ng lint
```

Expected: build sem erros de tipo, `All files pass linting.`

- [ ] **Step 9: Verificar CRLF nos quatro arquivos**

```bash
for f in src/app/login/login.page.spec.ts src/app/login/login.page.html src/app/login/login.page.scss src/app/login/login.page.ts; do
  node -e "
  const fs=require('fs'); const d=fs.readFileSync('$f');
  let lf=0,crlf=0;
  for(let i=0;i<d.length;i++){ if(d[i]===10){ lf++; if(d[i-1]===13) crlf++; } }
  console.log('$f:', lf===crlf ? 'ok' : 'LF SOLTO');
  "
done
```

Expected: `ok` nos quatro.

- [ ] **Step 10: Commit**

```bash
cd ..
git add inner-view-client/src/app/login/login.page.spec.ts \
        inner-view-client/src/app/login/login.page.html \
        inner-view-client/src/app/login/login.page.scss \
        inner-view-client/src/app/login/login.page.ts
git commit -m "feat(client): redesenho visual da tela de login, duas colunas a partir de 744px"
```

---

### Task 3: Verificação visual

Sem mudança de arquivo — só confirmar que a tela renderiza como desenhado,
nos dois breakpoints, com um navegador de verdade. Testes unitários provam
estrutura; não provam que o gradiente aparece ou que o painel não estoura.

**Files:** nenhum.

- [ ] **Step 1: Subir o dev server**

```bash
cd inner-view-client
npx ng serve --port 4200
```

Espere aparecer `Application bundle generation complete` e `Local:
http://localhost:4200/` antes de seguir.

- [ ] **Step 2: Abrir `/login` no navegador**

Manualmente, ou via Chrome headless + CDP (`--remote-debugging-port`,
`Page.navigate` para `http://localhost:4200/login`, `Page.captureScreenshot`)
— o mesmo mecanismo já usado neste projeto para verificar telas sem
depender de login (login em si não precisa de token, é a própria tela).

O dev server carrega as traduções via HTTP de verdade (diferente dos testes
unitários, que não têm loader) — o aviso `@ngx-translate/core: "loader"
received a bare class` no console confirma que esse loader está configurado
na raiz do app. Então as capturas mostram o TEXTO traduzido, não a chave.

Capture em dois tamanhos:
- **1440×900** (desktop) — confirme: painel esquerdo com gradiente azul
  visível, logo branca horizontal, tagline branca ("Tour virtual de imóveis
  360°"); painel direito com o formulário centralizado, símbolo azul, o
  título "Entrar"; tagline SEM repetir dentro do `.auth-intro` (a regra do
  Step 4 da Task 2 escondeu ela a partir de 744px).
- **390×844** (mobile) — confirme: painel esquerdo AUSENTE, só o formulário,
  ocupando a largura toda, símbolo + título + tagline visíveis no
  `.auth-intro`.

- [ ] **Step 3: Conferir que nada estourou horizontalmente**

Nas duas capturas, confirme que não há barra de rolagem horizontal nem
conteúdo cortado — em especial o gradiente do painel esquerdo precisa cobrir
a coluna inteira sem espaço em branco vazando pela lateral.

- [ ] **Step 4: Encerrar o dev server**

```bash
# encontre o PID na porta 4200 e finalize -- por exemplo, no Windows:
netstat -ano | grep ":4200 " | grep LISTENING
taskkill //PID <pid> //F
```

Nenhum commit neste task — é verificação, não mudança de código.
