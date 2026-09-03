# 02 · Tela mobile

**Referência:** `screens/01-mobile-default.png` · viewport de design **390×844** (iPhone 14/15).
Layout é fluido — 390px é a base de medida, não um limite.

---

## Estrutura

Um único stacking context ocupando 100% da viewport:

```
[panorama 360º — camada 0, ocupa 100% e recebe todo o gesto de arrasto]
[scrim topo 230px]                                   pointer-events:none
[scrim base 300px]                                   pointer-events:none
[chrome — flex column, position:absolute, inset:0]
  ├─ status bar do SO                    52px
  ├─ header row                          40px de altura de conteúdo
  ├─ pill de cena atual                  36px
  ├─ spacer (flex:1)                     ← o panorama respira aqui
  ├─ botão flutuante "Ocultar interface" absolute, right:12px, top:210px
  ├─ faixa de cenas                      ~104px
  └─ tab bar                             ~85px + home indicator
```

O container do chrome tem `inset:0` mas **cada filho** deve ter `pointer-events:auto` e o
container `pointer-events:none`, senão a camada invisível engole o arrasto do panorama.

---

## Header

Padding: `4px 12px 0`. Flex row, `align-items:center`, `gap:10px`.

### Botão voltar
- 40×40, `border-radius:50%`
- `background: glass-1`, `border: 1px solid border-control`, `backdrop-filter: blur(14px)`
- Ícone chevron-left 19×19, `stroke-width:2`
- Hover/press: `background: glass-1-hover`
- **Sempre visível**, inclusive no modo imersivo
- Ação: volta para a listagem de imóveis

### Bloco de título (`flex:1; min-width:0`)
- Linha 1: nome do tour — 15px/800, branco, `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`
- Linha 2: contagem de cenas — 11.5px/600, `text-secondary` (ex.: "6 cenas")
- Gap vertical: 2px
- Oculto no modo imersivo

### Botão "⋯" (Gerenciar)
- 40×40, mesmas specs visuais do voltar
- Conteúdo: três pontos de 3.5px, `gap:3px`, brancos
- Abre o sheet **Gerenciar** — ver [`04-sheets.md`](./04-sheets.md#4-gerenciar-tour)
- Oculto no modo imersivo

---

## Pill de cena atual

Padding do container: `12px 12px 0`.

- `display:inline-flex`, altura **36px**, padding `0 12px 0 11px`, gap 9px
- `border-radius:999px`, `border: 1.5px solid accent`, `background: glass-3 (.78)`, `blur(10px)`
- Conteúdo: bolinha accent 9×9 → nome da cena (13px/700, branco) → chevron-down 14×14 (`opacity:.75`)
- Toque abre o sheet **Cenas**
- Oculto no modo imersivo

Serve como *breadcrumb de contexto*: responde "em que cômodo estou" sem abrir nada.

---

## Botão flutuante "Ocultar interface"

- `position:absolute; right:12px; top:210px`
- 44×44, circular, `glass-1` + `border-control` + `blur(14px)`
- Ícone: olho **sem** risco quando a interface está visível; olho **riscado** quando oculta
- `title` / `aria-label`: "Ocultar interface" ↔ "Mostrar interface"
- `aria-pressed` reflete o estado

É o **único** controle de visualização. Tela cheia e mapa de conexões foram removidos
deliberadamente.

---

## Faixa de cenas

Aparece acima da tab bar, sobre o scrim inferior.

**Cabeçalho da faixa:** padding `0 16px 8px`, flex row `space-between`
- "CENAS" — 10.5px/800, `letter-spacing:.14em`, uppercase, `text-muted`
- "Ver todas" — 11.5px/700, cor `accent`, abre o sheet Cenas

**Trilho:** `display:flex; gap:8px; overflow-x:auto; overflow-y:hidden; padding:0 12px 6px`
- Esconder scrollbar: `scrollbar-width:none`, `-ms-overflow-style:none`, `::-webkit-scrollbar{display:none}`
- Scroll snap opcional: `scroll-snap-type:x proximity` + `scroll-snap-align:start` nos itens

**Miniatura:** 104×70, `border-radius:13px`, `overflow:hidden`
- Borda 2px: `accent` se for a cena atual, `border-soft` caso contrário
- Imagem `object-fit:cover` em `position:absolute; inset:0`
- Gradiente por cima: `linear-gradient(0deg, rgba(4,9,16,.85) 0%, rgba(4,9,16,0) 60%)`
- Legenda: 10.5px/700, branca, `left:8px; right:8px; bottom:6px`, 1 linha com ellipsis
- Toque troca a cena **sem fechar nada**

Oculta no modo imersivo e enquanto qualquer sheet estiver aberto (o sheet já mostra a grade).

---

## Tab bar  ⟵ *o coração da refatoração*

`background: tabbar-bg` + `blur(22px)`, `border-top: 1px solid border-hairline`,
padding `8px 10px 10px`.

Grid: `grid-template-columns: repeat(3, 1fr); gap: 6px`.

Cada botão: `min-height:56px`, flex column centralizado, `gap:5px`, `border-radius:15px`,
ícone 21×21, rótulo 11px/800 uppercase `letter-spacing:.06em`.

| # | Rótulo | Ícone | Fundo | Cor | Ação |
|---|---|---|---|---|---|
| 1 | EDITAR | lápis | `accent-tint` → hover `accent-tint-hover` | `accent` | Navega para o editor do tour |
| 2 | EMBED | `< >` | `neutral-fill` → hover `neutral-fill-hover` | `rgba(255,255,255,.92)` | Abre sheet Embed |
| 3 | APAGAR | lixeira | `danger-tint` → hover `danger-tint-hover` | `danger-text` | Abre sheet de confirmação |

**Regras de hierarquia** (não negociáveis, é o que faz a barra funcionar):
- Só **Editar** recebe cor de marca — é a ação frequente.
- **Apagar** é discreto por padrão (tint + texto vermelho claro), nunca vermelho sólido na
  barra. Vermelho sólido só no botão de confirmação dentro do sheet.
- **Apagar nunca executa direto** — sempre abre o sheet de confirmação.

Abaixo da grid: home indicator de 134×5, `radius:99px`, `rgba(255,255,255,.4)`,
`padding-top:9px` (só decorativo no protótipo; no app real usar `env(safe-area-inset-bottom)`).

### Variantes disponíveis
- **Só ícone** (sem rótulo) — mantém 56px de altura. Use se o produto adicionar uma 4ª ação.
- **Apagar vermelho sólido** — testada e **não recomendada**: rouba a atenção da ação primária.

---

## Toast de confirmação

- `position:absolute; bottom:170px`, centralizado, `pointer-events:none`
- Pill: `rgba(8,15,25,.94)`, `border: 1px solid rgba(255,255,255,.12)`, padding `10px 16px`
- Check em `accent` 15×15 + texto 12.5px/700 branco
- Duração: **2200ms**
- Mensagens: "Abrindo o editor…", "Código copiado", "Link copiado"

---

## Modo imersivo

Disparado pelo botão do olho. Oculta **tudo**: título, "⋯", pill de cena, faixa de miniaturas,
tab bar e **os hotspots**. Permanecem apenas:

1. Botão voltar
2. O próprio botão do olho (agora com o ícone riscado)

Referência: `screens/06-mobile-imersivo.png`.

Recomendações para produção (não estão no protótipo):
- Um toque no panorama também alterna o modo.
- Auto-ocultar após ~4s sem interação é opcional; se implementar, deixe desligável.
- O estado **não** persiste entre sessões.

---

## Área de toque e segurança

- Alvo mínimo: **44×44** (botões circulares); tab bar usa **56px** de altura.
- `padding-bottom` da tab bar deve somar `env(safe-area-inset-bottom)`.
- O topo respeita `env(safe-area-inset-top)` (52px é a altura da status bar no mock).
- Nenhum controle na faixa central de 200px do panorama — é onde o polegar arrasta.
