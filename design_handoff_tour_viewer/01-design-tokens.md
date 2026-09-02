# 01 · Design tokens

Todos os valores abaixo são os usados no protótipo. Onde o codebase já tiver um token
equivalente, **use o do codebase** e registre o mapeamento.

## Cores

### Marca

| Token | Valor | Uso |
|---|---|---|
| `accent` | `#2FE3C2` | Ação primária, estado ativo, borda da cena atual, hotspot ativo |
| `accent-light` | `#8DFCE6` | Topo do gradiente do hotspot; hover de link |
| `accent-ink` | `#05231E` | Texto/ícone **sobre** fundo accent (contraste ≈ 11:1) |
| `accent-tint` | `rgba(47,227,194,.14)` | Fundo do botão Editar na tab bar |
| `accent-tint-hover` | `rgba(47,227,194,.22)` | Hover do mesmo |
| `accent-glow` | `rgba(47,227,194,.28–.34)` | Halo radial do hotspot |

> A cor de marca é parametrizável no protótipo (prop `accent`). Alternativas já validadas:
> `#3DD8F5`, `#7C6BFF`, `#FFB020`. Se o produto tiver theming, exponha como variável.

### Superfícies

| Token | Valor | Uso |
|---|---|---|
| `glass-1` | `rgba(9,18,29,.55)` | Botões circulares flutuantes sobre o panorama |
| `glass-1-hover` | `rgba(9,18,29,.85)` | Hover dos mesmos |
| `glass-2` | `rgba(9,18,29,.66)` | Clusters do desktop (rail de cenas, barra de ações) |
| `glass-3` | `rgba(9,18,29,.78–.92)` | Pill de cena, plaquinha de rótulo do hotspot |
| `tabbar-bg` | `rgba(8,15,25,.86)` | Fundo da tab bar mobile |
| `sheet-bg` | `#0D1622` | Fundo dos bottom sheets (sólido, não translúcido) |
| `code-bg` | `#080F19` | Bloco de código do embed |
| `scrim` | `rgba(3,7,13,.6)` + `blur(3px)` | Overlay atrás de qualquer sheet aberto |
| `neutral-fill` | `rgba(255,255,255,.07)` | Botão secundário da tab bar (Embed) |
| `neutral-fill-hover` | `rgba(255,255,255,.13)` | Hover do mesmo |

Todas as superfícies de vidro usam `backdrop-filter: blur(...)` — ver seção Blur.

### Destrutivo

| Token | Valor | Uso |
|---|---|---|
| `danger` | `#E24A4A` | Botão sólido de confirmação "Apagar tour" |
| `danger-hover` | `#F05B5B` | Hover do mesmo |
| `danger-text` | `#FF8484` | Ícone + rótulo do botão Apagar na tab bar |
| `danger-text-strong` | `#FF9E9E` | Texto do aviso "não pode ser desfeita" |
| `danger-tint` | `rgba(226,74,74,.13)` | Fundo do botão Apagar na tab bar |
| `danger-tint-hover` | `rgba(226,74,74,.24)` | Hover do mesmo |
| `danger-tint-soft` | `rgba(226,74,74,.09)` | Caixa de aviso dentro do sheet |
| `danger-border` | `rgba(226,74,74,.22)` | Borda da caixa de aviso |
| `danger-border-strong` | `rgba(226,74,74,.3)` | Borda do botão ícone de apagar (desktop) |
| `danger-icon-bg` | `rgba(226,74,74,.15)` | Círculo de 46px com a lixeira no topo do sheet |

### Texto e bordas (sobre o panorama / sheets)

| Token | Valor | Uso |
|---|---|---|
| `text-primary` | `#FFFFFF` | Títulos, rótulos de ação |
| `text-secondary` | `rgba(255,255,255,.58)` | Subtítulo do header ("6 cenas") |
| `text-tertiary` | `rgba(255,255,255,.5)` | Descrições em sheets, contadores |
| `text-muted` | `rgba(255,255,255,.55)` | Corpo de texto em sheets, caption "CENAS" |
| `border-hairline` | `rgba(255,255,255,.10)` | Topo da tab bar, bordas de cluster |
| `border-soft` | `rgba(255,255,255,.14)` | Miniatura não selecionada, divisores |
| `border-control` | `rgba(255,255,255,.16)` | Botões circulares, botões ghost |
| `divider-sheet` | `rgba(255,255,255,.06)` | Linha entre itens da lista "Gerenciar" |

## Tipografia

**Família:** `Manrope` — fallback `system-ui, -apple-system, sans-serif`.
**Mono:** `JetBrains Mono` — fallback `ui-monospace, monospace`.

| Papel | Size | Weight | Extras |
|---|---|---|---|
| Título do tour (mobile) | 15px | 800 | `letter-spacing:-.01em`, 1 linha com ellipsis |
| Subtítulo do header | 11.5px | 600 | — |
| Rótulo da tab bar | 11px | 800 | `letter-spacing:.06em`, `text-transform:uppercase` |
| Pill de cena (mobile) | 13px | 700 | — |
| Pill de cena (desktop) | 13.5px | 700 | — |
| Caption "CENAS" | 10.5px (mob) / 11px (desk) | 800 | `letter-spacing:.14em`, uppercase |
| Legenda de miniatura | 10.5px (mob) / 11.5px (desk) | 700 | 1 linha com ellipsis |
| Título de sheet | 17px | 800 | — |
| Título do sheet de exclusão | 19px | 800 | `letter-spacing:-.01em` |
| Corpo em sheet | 12.5–13px | 400–600 | `line-height:1.5–1.55`, `text-wrap:pretty` |
| Item da lista Gerenciar | 14px título / 11.5px sub | 700 / 500 | — |
| Botão primário de sheet | 13.5–14px | 800 | — |
| Bloco de código | 10.5px | 400 | mono, `line-height:1.6`, `word-break:break-all` |
| Rótulo do hotspot | 11.5px (mob) / 13px (desk) | 800 | `letter-spacing:.06em`, uppercase |
| Ação desktop com texto | 14px | 700 (ghost) / 800 (primário) | — |
| Breadcrumb desktop | 13px | 600, item atual 700 | — |

## Espaçamento

Escala usada: **2 · 4 · 6 · 8 · 9 · 10 · 12 · 14 · 16 · 18 · 22 · 24 · 26px**.
Regra: layouts sempre com `display:flex`/`grid` + `gap`, nunca margens entre irmãos.

| Contexto | Valor |
|---|---|
| Padding lateral do conteúdo mobile | 12px |
| Padding interno da tab bar | 8px 10px 10px |
| Gap entre botões da tab bar | 6px |
| Gap entre miniaturas (mobile) | 8px |
| Gap entre miniaturas (desktop) | 10px |
| Padding do bottom sheet | 10px 18px 26px |
| Padding lateral do desktop (topo) | 24px |
| Offset dos clusters flutuantes do desktop | 24px de cada borda |

## Raios

| Elemento | Raio |
|---|---|
| Moldura do aparelho (só protótipo) | 46px |
| Bottom sheet | 26px 26px 0 0 |
| Botão da tab bar | 15px |
| Botão primário de sheet | 14px |
| Miniatura mobile / desktop | 13px / 12px |
| Cluster flutuante (desktop) | 14–18px |
| Botão de ação desktop | 11px |
| Bloco de código | 14px |
| Plaquinha do hotspot | 9–10px |
| Pills, botões circulares, chips | `999px` / `50%` |

## Sombras e blur

| Token | Valor |
|---|---|
| `shadow-sheet` | `0 -20px 50px rgba(0,0,0,.5)` |
| `shadow-float` | `0 8px 18px rgba(0,0,0,.4)` |
| `shadow-float-lg` | `0 10px 22px rgba(0,0,0,.45)` |
| `blur-control` | `backdrop-filter: blur(14px)` (botões circulares) |
| `blur-pill` | `backdrop-filter: blur(8–10px)` (pills e plaquinhas) |
| `blur-cluster` | `backdrop-filter: blur(16–18px)` (clusters desktop) |
| `blur-tabbar` | `backdrop-filter: blur(22px)` |
| `blur-scrim` | `backdrop-filter: blur(3px)` |

## Scrims sobre o panorama

Garantem contraste do chrome sem escurecer o centro da imagem.

```css
/* topo — mobile: altura 230px; desktop: 190px */
background: linear-gradient(180deg, rgba(4,9,16,.82) 0%, rgba(4,9,16,.45) 45%, rgba(4,9,16,0) 100%);

/* base — mobile: altura 300px; desktop: 260px */
background: linear-gradient(0deg, rgba(4,9,16,.88) 0%, rgba(4,9,16,.35) 55%, rgba(4,9,16,0) 100%);
```

Ambos com `pointer-events:none` — não podem bloquear o arrasto do panorama.

## Motion

| Nome | Definição | Onde |
|---|---|---|
| `pin-bob` | `3.6s ease-in-out infinite`; `translateY(0 → -4px → 0)` | Flutuação do hotspot |
| `pin-ring` | `2.6s ease-out infinite`; `scale(.6 → 1.5)`, `opacity(.5 → 0)` | Anel de pulso do hotspot ativo |
| Hover de controles | `120ms ease-out` em `background` | Todos os botões |
| Abertura de sheet | 240ms `cubic-bezier(.22,1,.36,1)`, `translateY(100% → 0)`; scrim em `opacity 0 → 1` 180ms | Bottom sheets |
| Toast | entra em 180ms, some após **2200ms** | Confirmação de cópia |
| Modo imersivo | 200ms `ease` em `opacity` + `translateY(±8px)` do chrome | Ocultar interface |

> **Importante:** `pin-bob` e a perspectiva do hotspot **não podem viver no mesmo elemento** —
> a keyframe sobrescreve o `transform` inline. Use um wrapper externo para a animação e um
> elemento interno para o `rotateX`. Ver [`03-hotspots.md`](./03-hotspots.md).

Respeite `prefers-reduced-motion: reduce`: desligue `pin-bob` e `pin-ring`, mantenha as
transições de opacidade.
