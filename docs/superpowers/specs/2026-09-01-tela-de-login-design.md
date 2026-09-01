# Tela de login — redesenho visual

> Spec de desenho, validada em conversa antes de qualquer código.
> Branch: `atualizar-tela-login`
> Base: `3695dc7` (main, PR #35 mesclado).
> Data: 2026-09-01. Escopo tocado: **`inner-view-client/`, só a tela de login.**

## O pedido

Redesenhar `inner-view-client/src/app/login/` para seguir o design system do
projeto (`DESIGN.md` + `ARP-VISION-DESIGN.md`). Escopo **só visual** — mesmos
campos e comportamento de hoje (e-mail, senha, entrar, link para criar conta),
sem funcionalidade nova.

## O que existe hoje

Conferido rodando a tela (screenshot via CDP, `?` nenhum — rota `/login`
direta), não suposto.

- **Os tokens já estão certos.** `login.page.html` usa `<app-header>`,
  `app-brand-logo`, `ion-input[fill="outline"]`, `ion-button` — todos
  estilizados globalmente em `global.scss` a partir de `--app-*`/`--ion-color-*`.
  Cor, raio, tipografia: nada disso está fora do sistema.
- **O problema é composição, não token.** No desktop (1440px) o formulário —
  uma coluna de 400px (`.login-container`) — fica sozinho no centro de uma
  página branca vazia, sem superfície própria, sem imagem, sem nada que
  preencha a largura. No mobile já funciona razoavelmente.
- **Zero i18n.** Todo texto do template é string literal em português:
  `<h1>Entrar</h1>`, `label="E-mail"`, `label="Senha"`, `Não tem uma conta?
  Criar conta`. Contra a convenção do próprio projeto (AGENTS.md — nunca
  string literal em template, sempre `ngx-translate`). Não existe bloco
  `AUTH` nem `LOGIN` em `pt.json`/`en.json` hoje.
- **`register.page.html` compartilha o mesmo padrão** (`.auth-intro`,
  `.form-shell`, mesmas strings literais) e **não está neste escopo** — vai
  ficar visualmente inconsistente com o login novo até ganhar o mesmo
  tratamento, num ticket separado.
- **Não há fotografia de imóvel utilizável no repo.** Só existe
  `assets/mock/relax_inn.jpg`, uma equiretangular 360° bruta — distorcida
  (linhas de chão curvas, teto esticado) se usada como foto plana. Ela só faz
  sentido dentro do `PanoramicViewerComponent`.
- **`app-brand-logo`** (`components/brand-logo/`) já tem o que a tela precisa:
  `kind="horizontal"` + `tone="white"` devolve
  `assets/brand/arp-vision-horizontal-white.svg` — a mesma logo que o
  `app-header` usa sobre o visualizador escuro (`variant="overlay"`). Não
  precisa de asset novo.
- **O teste existente prende a estrutura.** `login.page.spec.ts` verifica
  `.auth-intro h1` (texto `'Entrar'` literal) e `.auth-intro app-brand-logo
  img` (símbolo azul, decorativo). Esse teste **quebra** ao trocar para i18n
  — vai ser atualizado para verificar a CHAVE de tradução, não o texto, no
  mesmo padrão já usado no resto da suíte (ex.:
  `tour-wizard.page.spec.ts`, que checa `textContent).toContain('TOUR_WIZARD...')`).

## O desenho

### Estrutura: duas colunas a partir de 744px

744px é o breakpoint que o resto do app já usa (`app-header.component.scss`,
`tour-wizard.page.scss`). Abaixo dele, uma coluna só — como a tela já se
comporta hoje no mobile.

```
≥744px                                       <744px
┌───────────────┬────────────────────┐       ┌────────────────────┐
│               │                     │       │  🦉 ARP VISION      │
│  gradiente     │       Entrar        │       │                     │
│  brand-primary │  Tour virtual de    │       │       Entrar        │
│  → -dark       │  imóveis 360°       │       │  Tour virtual de    │
│               │  ┌───────────────┐  │       │  imóveis 360°       │
│  🦉 ARP VISION │  │ E-mail        │  │       │  ┌───────────────┐  │
│  (branco,      │  └───────────────┘  │       │  │ E-mail        │  │
│   horizontal)  │  ┌───────────────┐  │       │  └───────────────┘  │
│               │  │ Senha         │  │       │  ┌───────────────┐  │
│  "Tour virtual │  └───────────────┘  │       │  │ Senha         │  │
│   de imóveis   │  ┌───────────────┐  │       │  └───────────────┘  │
│   360°."       │  │    Entrar     │  │       │  ┌───────────────┐  │
│               │  └───────────────┘  │       │  │    Entrar     │  │
│               │  Criar conta →      │       │  └───────────────┘  │
└───────────────┴────────────────────┘       │  Criar conta →      │
                                              └────────────────────┘
```

### Painel visual (`.login-visual`) — só ≥744px

- **Fundo**: `linear-gradient(135deg, var(--ion-color-primary), var(--ion-color-primary-shade))`.
  **Não** `var(--brand-primary)` direto — `_palette.scss` é explícito: L0 é
  consumido só por L1/L2, nunca por componente. `--ion-color-primary` e
  `--ion-color-primary-shade` já são os alias de L1 para
  `--brand-primary`/`--brand-primary-dark` (`variables.scss`), e é por eles
  que o componente pede "a cor primária", não pela cor que ela é hoje.
- **Conteúdo**: `<app-brand-logo kind="horizontal" tone="white" [decorative]="true">`
  + a mesma frase que já é o subtítulo hoje ("Tour virtual de imóveis 360°"),
  em branco, `AUTH.TAGLINE`.
- **Sem imagem.** Decidido em conversa: sem fotografia real disponível, um
  bloco de cor plano é mais honesto que forçar a equiretangular distorcida ou
  inventar uma foto de estoque. Fica para um ticket futuro, se surgir
  fotografia de verdade.
- **Não aparece no mobile** (`display: none` abaixo de 744px) — a alternativa
  de espremer as duas colunas foi descartada: a faixa de cor competiria com o
  formulário pela pouca altura de tela.

### Painel do formulário (`.login-form-panel`)

- **`<app-header>` sai da página.** Deslogado, hoje ele só mostra a logo, que
  aponta para `/home` — rota atrás de `authGuard`, que devolve para
  `/login`. É um link que leva de volta para onde o usuário já está. A marca
  já fica presente no painel visual (≥744px); no mobile, `.auth-intro`
  carrega o símbolo sozinho, como já carrega hoje.
- **`.auth-intro` continua existindo, com o mesmo nome de classe.** É a
  classe que `login.page.spec.ts` verifica e que `register.page.html`
  também usa — não é trocada por uma nova, só passa a viver dentro da coluna
  direita em vez de sozinha na página.
- **Campos, botão e link: mesma estrutura de hoje**, só com `translate` no
  lugar de string literal:
  - `ion-input` de e-mail e senha — mesmos atributos (`fill="outline"`,
    `labelPlacement="floating"`, `autocomplete`, `required`).
  - `ion-button` de submit — mesmo `[disabled]="loading || !email || !password"`,
    mesmo spinner condicional.
  - `ion-button fill="clear"` com link para `/register`.
- **Nenhuma mudança em `login.page.ts`** — `submit()`, os campos e o
  `AuthService` continuam exatamente como estão. É troca de template e
  estilo, não de comportamento.

### i18n — bloco novo `AUTH`, em `pt.json` e `en.json`

| Chave | pt | en |
|---|---|---|
| `AUTH.TAGLINE` | "Tour virtual de imóveis 360°" | "360° virtual property tours" |
| `AUTH.LOGIN_TITLE` | "Entrar" | "Log in" |
| `AUTH.EMAIL_LABEL` | "E-mail" | "Email" |
| `AUTH.PASSWORD_LABEL` | "Senha" | "Password" |
| `AUTH.SUBMIT` | "Entrar" | "Log in" |
| `AUTH.NO_ACCOUNT` | "Não tem uma conta? Criar conta" | "Don't have an account? Sign up" |
| `AUTH.INVALID_CREDENTIALS` | "E-mail ou senha inválidos." | "Invalid email or password." |

`AUTH.INVALID_CREDENTIALS` substitui a string literal que hoje vive em
`login.page.ts` (`errorMessage = 'E-mail ou senha inválidos.'`), mostrada no
`ion-toast` — é a única string do `.ts`, e sai pela mesma razão das do
template.

### O que muda em cada arquivo

- **`login.page.html`** — reescrito: `.login-shell` com `.login-visual` +
  `.login-form-panel`; `<app-header>` removido; toda string vira
  `{{ 'AUTH.*' | translate }}`.
- **`login.page.scss`** — reescrito: layout de duas colunas, gradiente,
  breakpoint 744px. `.login-container` sai; `.auth-intro`/`.brand-tagline`
  (globais, `global.scss`) continuam sendo herdadas, não duplicadas aqui.
- **`login.page.ts`** — só a troca de `errorMessage` de string literal para
  chave de tradução (`this.translate.instant('AUTH.INVALID_CREDENTIALS')`),
  o que exige injetar `TranslateService` — mesmo padrão já usado em
  `capture-360.component.ts`.
- **`login.page.spec.ts`** — os dois `expect` de texto passam a checar a
  CHAVE (`'AUTH.LOGIN_TITLE'`) em vez do literal `'Entrar'`. Estrutura
  (`.auth-intro h1`, `.auth-intro app-brand-logo img`) não muda.
- **`src/assets/i18n/pt.json`, `en.json`** — bloco `AUTH` novo, chaves da
  tabela acima.

## Fora do escopo (registrado, não feito)

- `register.page.html` não muda. Fica visualmente inconsistente com o login
  novo até um ticket próprio.
- Nenhuma funcionalidade nova: sem "esqueci minha senha", "lembrar de mim"
  ou login social. Decidido em conversa — escopo é só visual.
- Nenhuma imagem de imóvel real no painel visual — decidido em conversa,
  sem fonte de imagem disponível hoje.
