# Arp Vision — Especificação de Cores para Implementação

> Documento de handoff. Entregue este arquivo a um assistente de código (ou dev) ao implementar a identidade visual do Arp Vision. Ele contém os tokens, o código pronto e as **regras de uso** — siga as regras, não só as cores.

**Stack alvo:** React + Vite + Tailwind CSS.
**Instrução ao implementador:** use os tokens nomeados abaixo em vez de valores hex soltos no código. Nunca escreva `#0454ED` diretamente num componente — use `var(--brand-blue)` ou `bg-brand-blue`. Isso mantém a marca consistente e fácil de ajustar.

---

## 1. Tokens de cor

### Cores da marca
| Token | Hex | Papel |
|---|---|---|
| `brand-blue-dark` | `#0347CC` | Hover/pressed do azul; texto azul sobre fundo claro |
| `brand-blue` | `#0454ED` | **Cor principal.** Identidade, logo, links, destaques de fundo |
| `brand-blue-soft` | `#E6EEFF` | Fundo suave azul: badges, seções destacadas, estados selecionados |
| `brand-teal-dark` | `#0F766E` | Teal para texto/ícone sobre branco; botão teal com texto branco |
| `brand-teal` | `#14B8A6` | **Accent.** Ações, ícones ativos, detalhes que devem chamar atenção |
| `brand-teal-soft` | `#CCFBF1` | Fundo suave teal: tags, realces leves |

### Neutros
| Token | Hex | Papel |
|---|---|---|
| `text-strong` | `#0F172A` | Texto principal, títulos |
| `text-secondary` | `#334155` | Texto de apoio, subtítulos |
| `text-muted` | `#64748B` | Legendas, placeholders, texto desabilitado |
| `border` | `#CBD5E1` | Bordas, divisores, contornos de input |
| `bg-section` | `#F1F5F9` | Fundo de seção (separa blocos sem usar linha) |
| `bg-base` | `#F8FAFC` | Fundo geral da aplicação |
| `white` | `#FFFFFF` | Cards, superfícies elevadas |

### Status — apenas feedback funcional (NUNCA como cor de marca)
| Token | Hex | Papel |
|---|---|---|
| `status-success` | `#16A34A` | Confirmações, "disponível", sucesso |
| `status-warning` | `#F59E0B` | Avisos, pendências |
| `status-error` | `#DC2626` | Erros, ações destrutivas, "indisponível" |

### Tema imersivo — escopo restrito ao visualizador de tour 360°
| Token | Hex | Papel |
|---|---|---|
| `tour-bg` | `#0B1220` | Fundo do visualizador (escuro, pra a foto brilhar) |
| `tour-surface` | `#1E293B` | Controles, painéis flutuantes sobre o fundo escuro |
| `tour-teal-glow` | `#2DD4BF` | Accent brilhante sobre o escuro: botões e ícones do tour |
| `tour-text` | `#E2E8F0` | Texto sobre o fundo escuro |

---

## 2. Código pronto

### CSS custom properties
Cole em `:root` no CSS global (ex.: `index.css`):

```css
:root {
  /* Marca */
  --brand-blue-dark: #0347CC;
  --brand-blue: #0454ED;
  --brand-blue-soft: #E6EEFF;
  --brand-teal-dark: #0F766E;
  --brand-teal: #14B8A6;
  --brand-teal-soft: #CCFBF1;

  /* Neutros */
  --text-strong: #0F172A;
  --text-secondary: #334155;
  --text-muted: #64748B;
  --border: #CBD5E1;
  --bg-section: #F1F5F9;
  --bg-base: #F8FAFC;
  --white: #FFFFFF;

  /* Status */
  --status-success: #16A34A;
  --status-warning: #F59E0B;
  --status-error: #DC2626;

  /* Tema imersivo (visualizador 360) */
  --tour-bg: #0B1220;
  --tour-surface: #1E293B;
  --tour-teal-glow: #2DD4BF;
  --tour-text: #E2E8F0;
}
```

### Tailwind config
Estenda `theme.extend.colors` em `tailwind.config.js`:

```js
export default {
  theme: {
    extend: {
      colors: {
        brand: {
          blue:      { DEFAULT: '#0454ED', dark: '#0347CC', soft: '#E6EEFF' },
          teal:      { DEFAULT: '#14B8A6', dark: '#0F766E', soft: '#CCFBF1' },
        },
        ink: {
          strong:    '#0F172A',
          secondary: '#334155',
          muted:     '#64748B',
        },
        line:        '#CBD5E1',
        surface: {
          base:      '#F8FAFC',
          section:   '#F1F5F9',
        },
        status: {
          success:   '#16A34A',
          warning:   '#F59E0B',
          error:     '#DC2626',
        },
        tour: {
          bg:        '#0B1220',
          surface:   '#1E293B',
          glow:      '#2DD4BF',
          text:      '#E2E8F0',
        },
      },
    },
  },
}
```

Uso: `className="bg-brand-blue text-white"`, `className="text-ink-strong"`, `className="border-line"`.

---

## 3. Regras de uso (as mais importantes)

### Proporção 60 / 30 / 10
- **60% neutro** (fundos claros, texto): a base que dá "respiro" e passa a sensação de facilidade.
- **30% azul**: identidade — presente mas não dominante.
- **10% teal**: tempero. O accent perde força se aparecer demais. Use com parcimônia, só onde quer puxar o olho.

### Hierarquia de ação
- **Ação primária** (ex.: "Agendar visita"): fundo `brand-blue`, texto branco. Hover: `brand-blue-dark`.
- **Ação de destaque / secundária que precisa saltar**: usar o teal (ver regra de contraste abaixo).
- **Ação terciária**: botão de contorno (`border`) ou texto azul, sem preenchimento.

### Texto
- Texto padrão sempre em `text-strong` (`#0F172A`). Apoio em `text-secondary`, legendas em `text-muted`.
- Links: `brand-blue`; ao passar o mouse, `brand-blue-dark` + sublinhado.

---

## 4. Contraste e acessibilidade (WCAG AA — mínimo 4.5:1 para texto)

**A regra mais fácil de errar:** o `brand-teal` (`#14B8A6`) é claro. Texto branco sobre ele **não passa** de contraste, e ele **não serve** como texto/ícone pequeno sobre fundo branco.

Como usar teal corretamente:
- **Botão teal com texto branco** → use `brand-teal-dark` (`#0F766E`) como fundo, não o `brand-teal`.
- **Botão/chip teal com o `brand-teal` claro** → use texto **escuro** (`text-strong`) por cima, nunca branco.
- **Texto ou ícone teal sobre branco** → use `brand-teal-dark` (`#0F766E`), nunca o `#14B8A6`.
- O `brand-teal` (`#14B8A6`) puro fica ótimo como: preenchimento de área grande, fundo de ícone, barra, realce — não como texto pequeno.

Outras verificações:
- `brand-blue` (`#0454ED`) com texto branco: 6,01:1, aprovado pela WCAG AA. Para estados pressionados, use `brand-blue-dark`.
- Cores de status: use sempre acompanhadas de ícone ou texto, nunca só a cor (usuários daltônicos não distinguem verde/vermelho isolados).

---

## 5. Tema imersivo — escopo

O tema escuro (`tour-*`) vale **exclusivamente dentro do visualizador do tour 360°**. Todo o resto — site institucional, dashboard, formulários, área do cliente — usa o tema claro. Não misture: um dashboard escuro quebraria a sensação de "claro, confiável e fácil" que a marca busca fora do tour.

Dentro do tour: fundo `tour-bg`, controles em `tour-surface`, botões/ícones em `tour-teal-glow`, texto em `tour-text`.

---

## 6. Checklist rápido (faça / não faça)

**Faça**
- Use tokens nomeados, nunca hex solto nos componentes.
- Deixe o neutro dominar; azul como identidade; teal como pontuação.
- Ponha texto escuro sobre o teal claro; use teal escuro quando precisar de texto branco.
- Restrinja o tema escuro ao visualizador 360°.

**Não faça**
- Não use verde/âmbar/vermelho como cor de marca — são só de status.
- Não use `#14B8A6` como texto pequeno sobre branco.
- Não encha a tela de teal — ele é 10%, não 30%.
- Não use texto branco sobre `#14B8A6`.

---

## 7. Como isto foi implementado neste repositório

> Seção acrescentada na implementação (branch `feature/paleta-arp-vision`).
> O documento acima foi escrito para **React + Vite + Tailwind**; este projeto é
> **Angular 20 + Ionic 8 + SCSS**. Os tokens e as regras valem inteiros. O
> "código pronto" da §2 não se aplica — não há `tailwind.config.js`.

### As quatro camadas

```
L0  src/theme/_palette.scss    --brand-*, --neutral-*, --status-*, --tour-*
L1  src/theme/variables.scss   --ion-color-*, --app-*
L2  src/theme/tour-wizard.scss --tw-*
L3  componentes                var(--tw-*), var(--app-*), var(--ion-*)
```

**A regra que substitui "use `var(--brand-blue)`":** os primitivos de L0 são
consumidos **apenas por L1 e L2**. Nenhum componente escreve `var(--brand-primary)`.
Componente pede a coisa pelo papel que ela tem — "a superfície do card", "o texto
de erro" — e não pela cor que ela é hoje. É a mesma intenção do documento
("nunca um hex direto no componente") numa stack que já tem camada semântica.

O Ionic **exige** `--ion-color-primary` e não aceita renomeação. Em vez de
escolher entre a nomenclatura do documento e a do Ionic, o Ionic é *alimentado*
por L0.

### Nomes: por papel, não por matiz

O documento nomeia por cor. No código os primitivos são `--brand-primary` /
`--brand-accent`, porque um token chamado "blue" vira mentira no dia em que a
marca não for azul — que foi exatamente o dia em que esta camada nasceu.
A tabela de correspondência está no cabeçalho do `_palette.scss`.

### Adaptações necessárias, com o motivo

| Documento | No código | Por quê |
|---|---|---|
| 3 azuis | 5 | Um app tem estados que um site institucional não tem: CTA sólido desabilitado (`--brand-primary-200`) e borda em hover (`-300`). Nomes numéricos deixam explícito que são degraus da escala, não invenções. |
| `status-*` como cor única | 3 slots: base, `-text`, `-soft` | As cores de status do documento **reprovam contraste como texto**: `#F59E0B` dá 2,15:1 sobre branco e `#16A34A` dá 3,30:1. Elas são cores de preenchimento. O slot `-text` traz a variante -700 que passa. |
| `status-error #DC2626` | `-text` é `#B91C1C` | A base sobre o próprio fundo de erro dá 3,95:1. Achado pelo teste de contrato. |
| — | `--brand-accent-glow` | O `tour-teal-glow` do documento é o mesmo acento do pin do wizard, que vive sobre foto e não sobre a superfície escura. Mora na família accent por isso. |
| `secondary`/`tertiary` | teal escuro / azul profundo | Slots do Ionic não podem ficar indefinidos: o CSS dele traz `var(--ion-color-secondary, #3dc2ff)` com fallback embutido, então apagar faria renderizar ciano fora da paleta, em silêncio. |

### Onde o teal (10%) vive aqui

Regra de atribuição: **azul é "o que eu posso fazer", teal é "o que já está feito".**

Entra em: etapa **concluída** do stepper, preenchimento da barra de progresso,
badge "Capa", e o acento dos pins de hotspot.

Fica **proibido** em: botão primário, FAB, orb de busca da home, links, anel de
foco e qualquer ação destrutiva.

A regra "teal claro nunca com branco" está codificada nos **nomes**: só existe um
foreground permitido e ele se chama `-dark`. Não há token que ofereça branco
sobre teal. Sobre as superfícies claras deste app o `#14B8A6` nunca passa — na
barra de progresso daria 2,27:1 —, então ele não tem token de wizard nenhum.

### Tema imersivo

Restrito ao **fundo** do visualizador 360 (`embed` e `inner-view`). Os controles
flutuantes continuam **brancos translúcidos**: branco lê sobre foto qualquer, e
chrome escuro sobre foto escura separa menos. Isto **não é dark mode** — não
existe `prefers-color-scheme` no projeto.

### O que trava a paleta

`src/theme/palette.contract.spec.ts` (43 testes) verifica **relações, nunca
valores**: pares hex/rgb coerentes, contraste por tabela declarada, a forma dos
três slots de status, e nenhuma cadeia `var()` quebrada. Um teste que afirmasse
`--brand-primary === '#0454ED'` engessaria a cor sem proteger nada.

### Achado em aberto

`--tw-border` sobre `--tw-surface` dá **1,48:1**. Como hairline decorativo de
card não está sob a 1.4.11 da WCAG, e não é regressão (eram 1,32:1 antes). Mas o
mesmo token desenha a **borda dos campos de texto**, onde ele é o que diz onde se
digita. Corrigir pede um token próprio de borda de campo a 3:1 — decisão de
design, não de troca de paleta.
