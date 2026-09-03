# 05 · Tela desktop

**Referência:** `screens/07-desktop.png` · viewport de design **1440×860**.

A tese é a mesma do mobile, com um problema diferente: no desktop não falta alcance,
falta **rótulo**. Ícones soltos no topo, misturados à navegação global, não se explicam.

---

## Duas camadas explícitas

| Camada | Onde | O que contém |
|---|---|---|
| **Navegação do produto** | Barra superior | Voltar, marca, breadcrumb, links globais, idioma, conta |
| **Ações deste tour** | Cluster no rodapé direito | Editar, Incorporar, Publicar, Apagar |

Nada de gestão do tour vive no topo; nada de navegação global vive no rodapé.

---

## Barra superior (altura 68px, padding lateral 24px, `gap:16px`)

1. **Voltar** — 38×38 circular, `glass-1` + `border-control` + `blur(14px)`, chevron 18×18
2. **Marca** — chip `height:38px`, padding `0 15px`, `radius:10px`, `rgba(9,18,29,.72)`,
   `border:1px solid rgba(255,255,255,.1)`. Losango accent 12×12 (`rotate(45deg)`) +
   "ARP VISION" (14px, "ARP" 800 / "VISION" 500 com `opacity:.7`)
3. **Breadcrumb** — 13px/600 `rgba(255,255,255,.55)`: "Meus imóveis" / separador `/` `opacity:.4`
   / nome do tour em branco 700
4. `flex:1` (espaçador)
5. **Links globais** — 13.5px/600 `rgba(255,255,255,.75)`, `gap:22px`: Início · Meus imóveis · Novo tour
6. Divisor vertical 1×24 `rgba(255,255,255,.16)`
7. **Idioma** ("PT") e **conta** — dois círculos de 36px, `rgba(9,18,29,.5)` + `border` `.14`

---

## Contexto de cena (`top:86px; left:24px`, `gap:10px`)

- Pill de cena: altura 40px, padding `0 14px 0 13px`, `border:1.5px solid accent`,
  `background: glass-3 (.78)`, bolinha accent 9×9, nome 13.5px/700, chevron 15×15
- Ao lado, em 12.5px/600 `text-tertiary`: "Cena 2 de 6"

---

## Controle de visualização (`right:24px; bottom:150px`)

Cluster de vidro: padding 6px, `radius:14px`, `glass-2` + `blur(16px)` + `border-hairline`.

Contém **um único botão**, com texto porque estava sozinho:
- Altura 40px, padding `0 14px`, `gap:9px`, `radius:10px`, transparente,
  hover `rgba(255,255,255,.1)`
- Ícone de olho 19×19 + rótulo "Ocultar interface" 13px/700

Tela cheia e mapa de conexões foram **removidos** do escopo.

---

## Rail de cenas (`left:24px; bottom:24px`, largura 640px)

- Container: padding `14px 16px 16px`, `radius:18px`, `glass-2` + `blur(18px)` + `border-hairline`
- Cabeçalho: "CENAS · 6" (11px/800, `letter-spacing:.14em`, uppercase, `rgba(255,255,255,.6)`)
  à esquerda; "Recolher" + chevron-up (11.5px/700, `rgba(255,255,255,.55)`) à direita
- Miniaturas: **146×92**, `radius:12px`, `gap:10px`, borda 2px accent na cena atual
- Gradiente e legenda iguais ao mobile (legenda 11.5px/700)
- "Recolher" reduz o container a só o cabeçalho — estado deve persistir por sessão

---

## Cluster de ações do tour (`right:24px; bottom:24px`)

Container: padding 8px, `radius:16px`, `glass-2` + `blur(18px)` + `border-hairline`, `gap:8px`.

| Ordem | Botão | Estilo | Altura | Ícone |
|---|---|---|---|---|
| 1 | **Editar tour** | Primário: fundo `accent`, texto `accent-ink` 14px/800, padding `0 18px`, `radius:11px` | 46px | lápis 18×18 |
| 2 | **Incorporar** | Ghost: `border-control`, texto branco 14px/700, padding `0 16px` | 46px | `< >` 18×18 |
| 3 | **Publicar** | Ghost, idem | 46px | seta para cima com base 18×18 |
| — | *divisor* | 1×28 `rgba(255,255,255,.14)` | — | — |
| 4 | **Apagar** | Só ícone: 46×46, `radius:11px`, fundo `danger-tint` (`.1`), `border:1px solid danger-border-strong`, ícone `danger-text` 19×19, hover `rgba(226,74,74,.22)` | 46px | lixeira |

O divisor não é decorativo: é **separação física** contra clique acidental no destrutivo.
`Apagar` abre o mesmo sheet de confirmação (no desktop, como diálogo centralizado de 480px
de largura, mesmo conteúdo e mesma hierarquia de botões — mas em linha, cancelar à esquerda).

Todos os botões precisam de `title`/`aria-label`; o de apagar, obrigatoriamente.

---

## Responsividade

| Faixa | Comportamento |
|---|---|
| ≥ 1280px | Layout completo descrito acima |
| 1024–1279px | Rail de cenas encolhe para 480px; links globais viram menu "⋯" |
| 768–1023px (tablet) | Rail de cenas recolhido por padrão; cluster de ações mantém texto, some o ícone |
| < 768px | **Muda para o layout mobile inteiro** — tab bar inferior, sheets, pill de cena |

O corte para o layout mobile é de layout, não só de tamanho: abaixo de 768px a tab bar
substitui o cluster de ações e os diálogos viram bottom sheets.
