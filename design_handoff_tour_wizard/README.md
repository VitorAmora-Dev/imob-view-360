# Handoff: Criação de Tour Virtual — Wizard de 3 etapas

## Overview

Refactor da tela de criação de tour virtual (produto "Inner View"). O formulário
único e longo foi substituído por um **wizard de 3 etapas** com barra de progresso:

1. **Imagens 360°** — upload por arquivo, drag & drop ou câmera do dispositivo
2. **Hotspots** — marcação de pontos de interesse sobre a imagem, com navegação entre ambientes
3. **Informações** — dados do imóvel, com endereço colapsado como opcional

Mais um **estado de sucesso** ("Tour publicado") após a última etapa.

Princípios de UX aplicados (mantenha-os na implementação):

- A imagem vem **primeiro**: sem ela nada mais faz sentido, e ela é o insumo mais custoso de obter.
- **Progressive disclosure**: só o essencial visível; endereço em acordeão; hotspots opcional e pulável.
- **Ação primária sempre no rodapé**, em desktop e mobile — nunca junto à barra de progresso
  (progresso é indicador de estado, não comando; e a ação deve vir depois do conteúdo que confirma).
- No mobile a edição de hotspot é **contextual** (bottom sheet), não uma lista permanente que
  empurra o viewer fora da tela.

## About the Design Files

O arquivo `Novo Tour - Fluxo em 3 etapas.dc.html` neste pacote é uma **referência de design
construída em HTML** — um protótipo funcional que demonstra aparência e comportamento
pretendidos. **Não é código de produção para copiar.**

A tarefa é **recriar este design no ambiente já existente do codebase** (React, Vue, Angular,
React Native etc.), usando os padrões, biblioteca de componentes e sistema de estilos
estabelecidos no projeto. Se ainda não houver ambiente definido, escolha o framework mais
apropriado e implemente lá.

O protótipo usa estilos inline por razões da ferramenta de prototipagem. **Na implementação,
converta para o sistema de estilos do projeto** (CSS Modules, Tailwind, styled-components,
tokens do design system). Não replique estilo inline.

### O toggle Desktop/Mobile NÃO existe no produto

No topo do protótipo há um seletor "Desktop / Mobile". Ele é **apenas um artifício de
demonstração** para mostrar os dois layouts no mesmo arquivo. Na implementação real, isso é
**responsividade por media query / container query**. Não implemente o toggle nem o
`viewport` no state.

Da mesma forma, o **quadro branco com sombra** que envolve tudo é a moldura da demo. No produto,
o conteúdo ocupa a página; mantenha apenas a largura máxima do conteúdo (1120px) centralizada.

## Fidelity

**Alta fidelidade (hi-fi).** Cores, tipografia, espaçamentos, raios, estados e microinterações
são finais e estão especificados abaixo com valores exatos. Recrie fielmente, adaptando apenas
os tokens para os equivalentes do design system do projeto quando existirem.

---

## Design Tokens

### Cores

| Token | Hex | Uso |
|---|---|---|
| `brand/500` | `#E8365D` | Cor primária (marca). Botões primários, progresso, pins, badges ativos, número da etapa |
| `brand/600` | `#C31E45` | Hover do botão primário, hover de link |
| `brand/100` | `#FDE7EC` | Fundo suave da marca: chip da etapa ativa, ícone do dropzone, badge "Capa", ícone de sucesso |
| `brand/200` | `#F5C2CE` | Borda em hover de botão destrutivo |
| `brand/disabled` | `#F7C7D2` | Botão primário desabilitado |
| `text/900` | `#16181D` | Títulos, texto de ênfase, valores de input |
| `text/700` | `#3A3D45` | Labels de formulário, texto secundário forte |
| `text/500` | `#6B7079` | Corpo de texto, descrições, labels inativos |
| `text/400` | `#5B5F69` | Itens de navegação inativos no topbar |
| `text/300` | `#8A8F98` | Texto auxiliar, metadados, estados vazios, ícones |
| `text/200` | `#C9CCD2` | Chevron de lista |
| `border/default` | `#E6E7EB` | Borda padrão de cards, inputs, botões secundários |
| `border/subtle` | `#ECEDF0` | Divisórias horizontais (topbar, rodapé, acordeão) |
| `border/dashed` | `#DADCE1` | Borda do dropzone em repouso |
| `border/dashed-empty` | `#DDDFE4` | Borda de estado vazio e handle do bottom sheet |
| `surface/page` | `#F1F1F3` | Fundo da página |
| `surface/card` | `#FFFFFF` | Cards, topbar, rodapé, painéis |
| `surface/body` | `#FCFCFD` | Fundo da área de conteúdo do wizard |
| `surface/muted` | `#F4F5F7` | Chips informativos, badges neutros, caixa de dica |
| `surface/muted-2` | `#F3F4F6` | Botão circular (voltar, fechar) |
| `surface/track` | `#EDEEF1` | Trilha da barra de progresso, dot de etapa inativa, placeholder de thumb |
| `surface/hover` | `#F7F7F9` | Hover de botão secundário |
| `surface/hover-2` | `#E7E8EC` | Hover de botão circular |
| `overlay/scrim` | `rgba(12,14,18,.45)` | Scrim do bottom sheet |
| `overlay/pin` | `rgba(16,18,24,.78)` | Fundo da pílula do hotspot |
| `overlay/hint` | `rgba(14,16,20,.72)` | Fundo do balão de dica e da lixeira em repouso |
| `overlay/trash-active` | `rgba(232,54,93,.94)` | Lixeira com pin sobre ela |
| `focus/ring` | `#E8365D33` | Anel de foco (2px) de inputs e selects |

### Tipografia

Família: `system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`
(`-webkit-font-smoothing: antialiased`). Nenhuma webfont é carregada — se o projeto tiver
uma fonte de marca, use-a mantendo a escala abaixo.

| Papel | Tamanho | Peso | Extras |
|---|---|---|---|
| Título de etapa (h2) | 24px | 750 | `letter-spacing: -.02em`, cor `text/900` |
| Logo "Inner View" | 19px | 800 | `letter-spacing: -.02em`, cor `brand/500` |
| Título de bottom sheet (h3) | 17px | 700 | |
| Título do dropzone | 17px | 650 | |
| Título de painel/card (h3) | 15px | 700 | |
| Botões (todos os primários/secundários) | 15px | 600–650 | 650 nos primários |
| Corpo / descrição de etapa | 15px | 400 | cor `text/500`, `max-width: 56ch`, `text-wrap: pretty` |
| Input desktop (etapa 3) | 15px | 400 | |
| Input mobile (bottom sheet) | **16px** | 400 | obrigatório — evita zoom automático no iOS |
| Label de formulário | 13px | 600 | cor `text/700` |
| Item de nav no topbar | 14px | 400 / 650 (ativo) | |
| Nome do ambiente (input do card) | 14px | 400 | |
| Rótulo do chip de etapa | 13.5px | 550 / 700 (ativo) | `white-space: nowrap` |
| Rótulo da pílula do hotspot | 13px | 600 | |
| Texto de dica / metadados | 12.5px | 400 | cor `text/300` |
| Chips informativos do dropzone | 12px | 400 | |
| Badge "Capa" / "Ambiente N" | 11.5px | 650 | |

### Espaçamento

Escala de 4px, valores efetivamente usados: 2, 4, 6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 26, 28, 34, 36, 46.
Gaps mais frequentes: 8 (interno de controle), 10–12 (entre cards), 14 (entre campos), 18–22 (entre blocos).

### Raio de borda

| Valor | Uso |
|---|---|
| 999px | Pílulas, chips, dots, botões circulares, barra de progresso, badges |
| 22px 22px 0 0 | Bottom sheet |
| 20px | Container desktop (moldura da demo) |
| 18px | Dropzone |
| 16px | Viewer 360°, painel de hotspots, card de resumo, lixeira |
| 14px | Card de ambiente, card do acordeão de endereço, linha-resumo mobile |
| 12px | Botões (48px), inputs mobile, cards de hotspot, caixa de dica |
| 11px | Inputs desktop da etapa 3 |
| 10px | Thumbnail do card de ambiente |
| 9px | Inputs pequenos, botão de remover ambiente, pílulas de tipo (compactas) |
| 8px | Botão de remover hotspot (desktop) |
| 7px | Thumbnail do rail |

### Sombras

| Uso | Valor |
|---|---|
| Container da demo | `0 18px 50px rgba(16,18,24,.10)` |
| Bottom sheet | `0 -10px 40px rgba(0,0,0,.22)` |
| Pílula de hotspot (repouso) | `0 3px 12px rgba(0,0,0,.30)` |
| Pílula de hotspot (arrastando) | `0 8px 22px rgba(0,0,0,.45)` |

### Alturas de alvo de toque

- Botões primários e secundários de ação: **48px**
- Botão circular (voltar / fechar): **36–38px**
- Linha-resumo mobile: **min-height 56px**
- Pílulas de tipo: 34px no desktop, **48px no bottom sheet**

Nada abaixo de 44px de área tocável no mobile.

### Transições

| Elemento | Transição |
|---|---|
| Barra de progresso | `width .35s cubic-bezier(.4,0,.2,1)` |
| Dropzone (estado de drag) | `all .18s ease` |
| Pílula de hotspot (escala/sombra) | `transform .14s ease, box-shadow .14s ease` |
| Lixeira (escala/fundo) | `transform .16s ease, background .16s ease` |
| Chevron do acordeão | `transform .2s` (rotação 180°) |

### Keyframe

```css
@keyframes pulseRing {
  0%   { transform: scale(1);   opacity: .55 }
  70%  { transform: scale(2.1); opacity: 0 }
  100% { opacity: 0 }
}
```
Aplicado como `pulseRing 2.4s ease-out infinite` ao anel atrás do dot do hotspot — **somente
quando o hotspot tem destino configurado** (é o sinal de "está pronto/clicável").

---

## Layout geral (chrome do wizard)

Estrutura vertical, de cima para baixo:

```
┌─ Topbar (sticky top, z-index 5) ─────────────────────────┐
│ [←] Inner View │ Novo tour virtual   …nav…  Rascunho salvo│
├─ Stepper + progresso ────────────────────────────────────┤
│ (1)Imagens 360°  (2)Hotspots  (3)Informações             │
│ ████████████░░░░░░░░░░░░░░░░░░░░░░░░                    │
│ Etapa 1 de 3                    Envie ao menos uma foto  │
├─ Corpo (flex:1, bg #FCFCFD) ─────────────────────────────┤
│                                                          │
│                   conteúdo da etapa                      │
│                                                          │
├─ Barra de ação (sticky bottom) ──────────────────────────┤
│ [Voltar]                            [Pular]  [Próximo]   │
└──────────────────────────────────────────────────────────┘
```

Largura máxima do conteúdo: **1120px**, centralizado. Mobile: largura total.

### Topbar

- `display:flex; align-items:center; gap:14px; padding:14px 20px`
- `border-bottom: 1px solid #ECEDF0`, fundo branco, `position:sticky; top:0; z-index:5`
- Botão voltar: círculo 38px, fundo `#F3F4F6`, hover `#E7E8EC`, sem borda
- Logo: 19px/800, `#E8365D`
- Divisor: `1px × 22px`, `#E6E7EB`
- Título do documento: 15px/600, `#3A3D45`, truncado com ellipsis
- `flex:1` spacer
- **Só desktop**: breadcrumb/nav "Início · Meus imóveis · Novo tour" (gap 26px, 14px,
  `#5B5F69`; item atual `#16181D`/650)
- "Rascunho salvo": 13px, `#8A8F98`, `white-space: nowrap`. Deve refletir o autosave real
  (ver *Persistência* abaixo).

### Stepper

Container: `padding: 18px 20px 0`, fundo branco.

Chips (`display:flex; gap:10px`), um por etapa:

| Estado | Fundo do chip | Dot | Rótulo |
|---|---|---|---|
| Concluída (`step > n`) | transparente | `#E8365D`, texto branco, glifo **✓** | `#6B7079`, peso 550 |
| Atual (`step === n`) | `#FDE7EC` | `#E8365D`, texto branco, número | `#16181D`, peso 700 |
| Futura alcançável | transparente | `#EDEEF1`, texto `#8A8F98` | `#6B7079`, peso 550 |
| Futura bloqueada | transparente, `opacity: .45`, `cursor: default` | idem | idem |

- Chip: `border-radius: 999px`, sem borda, `padding: 6px 12px 6px 6px` (desktop) / `6px` (mobile)
- Dot: 26×26px, círculo, 12.5px/700
- **Mobile**: o rótulo textual é ocultado em todos os chips exceto o atual (`display:none`) —
  os chips inativos ficam só como dots numerados. Isso mantém o stepper em uma linha em 375px.
- Clicar num chip navega para aquela etapa **se ela for alcançável**: etapa ≤ atual sempre;
  etapas 2 e 3 apenas quando há ao menos uma imagem. Chips bloqueados não respondem ao clique.

### Barra de progresso

- Trilha: altura 4px, `#EDEEF1`, raio 999px, `overflow:hidden`, `margin-top: 14px`
- Preenchimento: `#E8365D`, largura = `step / 3 × 100%` (33.3% / 66.7% / 100%), 100% no estado publicado
- Abaixo: linha com `justify-content: space-between`, 12.5px, `#8A8F98`, `padding-top: 8px`
  - Esquerda: `Etapa {n} de 3`
  - Direita (dica por etapa): 1 → "Envie ao menos uma foto" · 2 → "Opcional — pule se quiser" · 3 → "Últimos detalhes"

### Barra de ação (rodapé)

- `position: sticky; bottom: 0`, `padding: 14px 20px`, `border-top: 1px solid #ECEDF0`
- Fundo `rgba(255,255,255,.92)` + `backdrop-filter: blur(8px)`
- Layout: `[Voltar]  ——spacer——  [Pular]  [Próximo]`
- **Voltar**: 48px, borda `#E6E7EB`, fundo branco, 15px/600. Na etapa 1 usa
  `visibility: hidden` (não `display:none`) — preserva o espaço e evita o botão primário "pular" de posição.
- **Pular**: só aparece na etapa 2 e só quando não há nenhum hotspot no ambiente atual.
  Botão fantasma: sem fundo, sem borda, `#6B7079`, hover `#16181D`. Executa a mesma ação de `Próximo`.
- **Próximo / Publicar tour**: 48px, `#E8365D`, branco, 15px/650, raio 12px.
  Padding `0 28px` (desktop) / `0 22px` (mobile, com `flex: 1` — ocupa a largura restante).
  Rótulo é "Publicar tour" na etapa 3.
  **Desabilitado** enquanto não houver nenhuma imagem: fundo `#F7C7D2`, `cursor: not-allowed`,
  atributos `disabled` + `aria-disabled`, e `title`/tooltip
  "Envie ao menos uma imagem 360° para continuar". O handler também retorna cedo se inválido.
- A barra desaparece por completo no estado de sucesso.
- **Melhoria opcional** (não está no protótipo): tornar a barra não-sticky quando o conteúdo
  cabe na viewport, para ela não parecer flutuante em telas curtas.

---

## Etapa 1 — Imagens 360°

**Objetivo do usuário:** trazer ao menos uma foto 360° para dentro do tour.

Coluna vertical, `gap: 20px`.

### Cabeçalho
- H2: "Comece pelas imagens 360°"
- P: "Cada imagem vira um ambiente do tour. Você pode adicionar mais depois — para continuar, uma já basta."

### Dropzone

Card clicável, coluna centralizada, `gap: 8px`, `text-align: center`:

- `padding: 46px 24px` (desktop) / `34px 18px` (mobile)
- `border: 2px dashed #DADCE1`, raio 18px, fundo branco, `cursor: pointer`
- **Estado de drag ativo**: borda `#E8365D`, fundo `#FFF5F7`, transição `all .18s ease`
- Clicar em qualquer parte da área (fora dos botões) abre o seletor de arquivos

Conteúdo, na ordem:

1. Ícone: círculo 64px, fundo `#FDE7EC`, glifo "+" 26px em `#E8365D`
2. Título 17px/650 — desktop: "Arraste suas fotos 360° aqui" · mobile: "Adicione suas fotos 360°"
3. Subtítulo 14px `#6B7079` — desktop: "ou use uma das opções abaixo" · mobile: "Envie do seu celular ou fotografe na hora"
4. **Dois botões de ação** (`display:flex; gap:10px; flex-wrap:wrap; justify-content:center`):
   - **Enviar arquivos** — primário: 48px, `#E8365D`, branco, 15px/650, raio 12px, ícone "↑" com gap 8px
   - **Tirar foto agora** — secundário: 48px, borda `#E6E7EB`, fundo branco, `#16181D`, 15px/600, ícone "◎"
   - Desktop: lado a lado (`flex: 0 0 auto`). Mobile: cada um `flex: 1 1 100%` → empilhados, largura total.
   - Ambos precisam de `stopPropagation` no clique para não disparar duas vezes o handler do card.
5. Três chips informativos (12px, `#6B7079`, fundo `#F4F5F7`, raio 999px, `padding: 5px 11px`):
   "JPG equirretangular 2:1" · "até 25 MB por foto" · "várias de uma vez"

### Inputs de arquivo (escondidos)

```html
<input type="file" accept="image/*" multiple />                      <!-- Enviar arquivos -->
<input type="file" accept="image/*" capture="environment" />          <!-- Tirar foto agora -->
```

O segundo usa `capture="environment"` para abrir direto a câmera traseira no mobile e **não**
tem `multiple` (uma captura por vez). Ambos usam o mesmo handler de recebimento de arquivos.

**Nota de implementação nativa:** em app nativo/PWA, "Tirar foto agora" deve abrir a câmera do
sistema (ou o SDK da câmera 360° pareada, se houver integração). No web, `capture` é a solução
correta e degrada para o seletor de arquivos no desktop.

### Caixa de dica

`display:flex; gap:10px; padding:12px 14px; border-radius:12px; background:#F4F5F7`.
Ícone "ⓘ" 14px `#8A8F98` + parágrafo 13px `#6B7079`, `line-height:1.5`:

> "Ao fotografar pelo celular, use o modo panorâmico da câmera ou uma câmera 360° pareada.
> Gire devagar mantendo o aparelho na altura do peito."

### Lista de ambientes (só quando há imagens)

- Cabeçalho: h3 "Ambientes" 15px/700 + contador 13px `#8A8F98` ("1 imagem" / "N imagens")
- Grid: `repeat(auto-fill, minmax(240px, 1fr))`, `gap: 12px`

Card de ambiente (`display:flex; gap:12px; padding:10px; border:1px solid #E6E7EB; border-radius:14px`):

- Thumbnail: 66×50px, raio 10px, `background-size: cover; background-position: center`, placeholder `#EDEEF1`
- Coluna central (`flex:1; min-width:0; gap:6px`):
  - Input do nome do ambiente: largura total, borda `#E6E7EB`, raio 9px, `padding: 9px 10px`, 14px.
    Placeholder "Nome do ambiente". Pré-preenchido com o nome do arquivo sem extensão, truncado em 28 caracteres.
  - Linha de metadados (`gap: 8px`): badge + tamanho do arquivo (12px `#8A8F98`, truncado)
  - Badge: 11.5px/650, `padding: 3px 8px`, raio 999px. Primeiro item → "Capa" com fundo
    `#FDE7EC` e texto `#E8365D`; demais → "Ambiente N" com fundo `#F4F5F7` e texto `#6B7079`.
- Botão remover: 36×36px, raio 9px, borda `#E6E7EB`, fundo branco, glifo "✕" `#8A8F98`.
  Hover: texto `#E8365D`, borda `#F5C2CE`.

**Limite:** o protótipo aceita no máximo 12 arquivos por seleção. Defina o limite real conforme o backend.

---

## Etapa 2 — Hotspots

**Objetivo do usuário:** marcar pontos sobre a imagem, ligando ambientes entre si.
**Etapa opcional** — o botão "Pular" existe justamente por isso.

Cabeçalho: H2 "Marque os pontos de interesse" + P "Clique sobre a imagem para criar um hotspot.
Use-os para levar o visitante a outro ambiente ou destacar um detalhe. Esta etapa é opcional."

### Layout

- **Desktop**: duas colunas em `flex-wrap: wrap; gap: 16px; align-items: flex-start` —
  viewer `flex: 1 1 380px`, painel de hotspots `flex: 0 1 320px; min-width: 280px`
- **Mobile**: uma coluna — viewer, rail de ambientes, linha-resumo. O painel lateral **não é renderizado**.

### Viewer 360°

- `position: relative; width: 100%`, raio 16px, `overflow: hidden`, borda `1px solid #E6E7EB`
- `aspect-ratio: 16/9` (desktop) / `4/3` (mobile)
- Com imagem: `background: center/cover no-repeat` sobre `#111`, `cursor: crosshair`
- Sem imagem: hachura `repeating-linear-gradient(135deg,#F1F2F4 0 10px,#E9EAEE 10px 20px)`,
  `cursor: default`, e placeholder centralizado: "panorama 360°" (12px monospace) +
  "Volte à etapa 1 para enviar uma imagem" (14px `#8A8F98`)
- **No produto real este container é o visualizador panorâmico** (Pannellum, Photo Sphere Viewer,
  Marzipano, three.js…). No protótipo é uma imagem estática. Coordenadas de hotspot devem então ser
  convertidas de percentual para o sistema do viewer — ver *Modelo de dados*.

**Balão de dica** — canto inferior esquerdo (`left:14px; bottom:14px`), `rgba(14,16,20,.72)`,
branco 12.5px, `padding:8px 12px`, raio 999px, `backdrop-filter: blur(6px)`:
- Desktop: "Clique para adicionar um ponto · arraste para girar"
- Mobile: "Toque para criar · segure um ponto para mover ou excluir"
- Sem imagem: "Sem imagem selecionada"
- Oculto enquanto um pin está sendo arrastado (dá lugar à lixeira).

**Criar hotspot:** clique/toque no viewer converte a posição do ponteiro em percentuais
relativos ao retângulo do viewer e adiciona um hotspot com `{x, y, label:"", type:"nav", target:""}`.
No mobile, abre imediatamente o bottom sheet de edição do ponto recém-criado.

### Pin do hotspot

Botão em pílula posicionado por `left: x%; top: y%; transform: translate(-50%,-50%)`:

- `display:flex; align-items:center; gap:8px; padding:5px 12px 5px 5px`, raio 999px, sem borda
- Fundo `rgba(16,18,24,.78)`, `backdrop-filter: blur(6px)`, texto branco 13px/600
- `max-width: 240px`, `white-space: nowrap`, `touch-action: none`, `user-select: none`
- Sombra `0 3px 12px rgba(0,0,0,.30)`; arrastando: `scale(1.08)` + `0 8px 22px rgba(0,0,0,.45)`
- `cursor: pointer` quando tem destino; `default` quando não

Conteúdo:
1. **Dot** 26×26px, círculo, 13px/700. Tipo navegação → fundo `#E8365D`, glifo "→" branco.
   Tipo informação → fundo branco, glifo "i" `#16181D`.
2. **Anel de pulso** absoluto atrás do dot, mesma cor, `pulseRing 2.4s ease-out infinite` —
   **só quando o hotspot tem destino válido**.
3. **Rótulo**: o **nome do hotspot** e nada mais. `max-width: 160px` com ellipsis.
   Sem nome ainda → "Sem nome" em `italic` com `opacity: .6`.
   **Importante:** não exiba o nome do arquivo nem o nome do ambiente de destino no pin — isso
   causava sobreposição com nomes longos. O destino aparece no `title`/tooltip e no painel/lista.

`title` do pin: "Abrir {ambiente}" quando há destino · "Defina um destino no painel" quando é
navegação sem destino · "Ponto de informação" quando é informativo.

**Clique no pin:**
- Com destino válido → **navega**: troca o ambiente selecionado para o de destino e fecha o sheet.
- Sem destino → abre o editor daquele ponto (no mobile, o bottom sheet). É a única saída útil.
- Nunca abre um editor quando a navegação é possível — tocar num pin é intenção de *ver*, não de editar.

### Rail de ambientes (desktop e mobile)

Faixa horizontal rolável abaixo do viewer: `display:flex; gap:10px; margin-top:12px; overflow-x:auto`.

Cada item é um botão `flex: 0 0 auto`, `padding: 6px`, raio 12px, fundo branco,
borda `1px solid` — `#E8365D` quando é o ambiente selecionado, `#E6E7EB` caso contrário.
Contém thumbnail 42×32px (raio 7px, cover) + nome 12.5px `#3A3D45` truncado em 110px.
Selecionar um ambiente fecha qualquer bottom sheet aberto.

### Painel de hotspots — SOMENTE DESKTOP

Card `border:1px solid #E6E7EB; border-radius:16px; background:#fff; padding:16px`,
coluna com `gap: 12px`.

- Cabeçalho: h3 "Hotspots" 15px/700 + contador 13px `#8A8F98` (`space-between`, `align-items: baseline`)
- **Estado vazio**: caixa `1px dashed #DDDFE4`, raio 12px, `padding: 18px`, centralizada,
  13.5px `#8A8F98`: "Nenhum ponto ainda. / Clique na imagem ao lado para criar o primeiro."

Card de hotspot (`border:1px solid #E6E7EB; border-radius:12px; padding:11px`, coluna `gap:8px`):

1. Linha superior (`gap:9px`): índice em círculo 22px `#E8365D` branco 12px/700 · input
   "Título do ponto" (`flex:1`, borda `#E6E7EB`, raio 9px, `padding:8px 10px`, 13.5px) ·
   botão remover 32×32px raio 8px (hover `#E8365D` / borda `#F5C2CE`)
2. Seletor de tipo — duas pílulas `flex:1`, altura 34px, raio 9px, 12.5px/600:
   "Ir para ambiente" e "Informação".
   Selecionada: borda `#E8365D`, fundo `#FDE7EC`, texto `#E8365D`.
   Não selecionada: borda `#E6E7EB`, fundo branco, texto `#6B7079`.
3. **Somente quando o tipo é "Ir para ambiente"**: campo "Destino" (label 12px/600 `#6B7079`)
   com `<select>` (borda `#E6E7EB`, raio 9px, `padding:9px 10px`, 13.5px).
   Primeira opção: "Selecione o ambiente…" (valor vazio).
   Demais opções: **todos os ambientes exceto o atualmente selecionado** (um hotspot não leva a si mesmo).

### Linha-resumo — SOMENTE MOBILE

Substitui o painel lateral. Botão de largura total, `min-height: 56px`, `margin-top: 12px`,
`padding: 13px 14px`, borda `#E6E7EB`, raio 14px, fundo branco, `gap: 10px`:

- Contador em círculo 26px, 12.5px/700 — com pontos: fundo `#FDE7EC`, texto `#E8365D`;
  sem pontos: fundo `#F4F5F7`, texto `#8A8F98`
- Texto (`flex:1`, 14px `#3A3D45`, truncado): nomes dos pontos unidos por " · "
  (item sem nome → "Ponto N"). Sem pontos: "Toque na imagem para criar um ponto".
- Ação à direita: "Ver todos" (13.5px/650 `#E8365D`), presente só quando há pontos
- Clicar abre o bottom sheet em modo lista.

**Racional:** a lista permanente de hotspots no mobile crescia ~160px por item e empurrava o
viewer — a ferramenta de trabalho — fora da tela. A linha-resumo mantém o viewer inteiro visível.

### Bottom sheet — SOMENTE MOBILE

Sobreposição `position: absolute; inset: 0; z-index: 40` dentro do container do wizard
(`position: relative`), `justify-content: flex-end`. Em produção pode ser `fixed` na viewport.

- Scrim: `rgba(12,14,18,.45)`, cobre toda a área, fecha ao toque
- Painel: fundo branco, raio `22px 22px 0 0`, `padding: 10px 16px 20px`,
  `max-height: 72vh`, `overflow-y: auto`, sombra `0 -10px 40px rgba(0,0,0,.22)`
- Handle: barra 40×4px, raio 999px, `#DDDFE4`, centralizada, `padding: 2px 0 12px`
- **Recomendado na implementação** (não presente no protótipo): animação de entrada
  (slide-up ~240ms `cubic-bezier(.32,.72,0,1)`), fechar por swipe-down no handle,
  trap de foco e `role="dialog"` + `aria-modal`.

**Quando abre:** ao criar um ponto novo (modo editor) · ao tocar num pin **sem destino**
(modo editor) · ao tocar num item da lista (modo editor) · ao tocar em "Ver todos" (modo lista).
**Nunca** abre ao tocar num pin que tem destino — nesse caso navega.

#### Modo *editor*

1. Header: índice em círculo 26px `#E8365D` · h3 "Ponto de interesse" 17px/700 (`flex:1`) ·
   botão fechar circular 36px, fundo `#F3F4F6`, glifo "✕"
2. Campo **Título** — label 13px/600 `#3A3D45`, input raio 11px, `padding: 13px 14px`,
   **font-size 16px**, placeholder "Ex.: Sacada"
3. **Tipo** — duas pílulas de **48px** (raio 12px, 14.5px/600), mesmas cores da versão desktop
4. **Destino** — só no tipo navegação. `<select>` raio 11px, `padding: 13px 14px`, 16px,
   mesmas opções da versão desktop
5. Ações (`gap:10px`):
   - **Excluir** — 48px, borda `#E6E7EB`, fundo branco, texto `#6B7079`, 15px/600, `padding: 0 18px`
   - **Ir para {ambiente}** — `flex:1`, 48px, `#E8365D`, branco, 15px/650, truncado.
     Sem destino: rótulo "Ver no tour", fundo `#F7C7D2`, `cursor: not-allowed`, sem ação.

#### Modo *lista*

1. Header: h3 "Hotspots deste ambiente" 17px/700 + botão fechar circular 36px
2. Estado vazio: caixa dashed `#DDDFE4`, raio 12px, `padding: 22px`, 14px `#8A8F98`:
   "Nenhum ponto ainda. / Toque na imagem para criar o primeiro."
3. Itens (`gap: 10px`): botão de largura total, `padding: 13px 12px`, borda `#E6E7EB`,
   raio 12px, `gap: 11px`, `text-align: left`:
   - índice em círculo 26px `#E8365D`
   - coluna: nome do ponto (mesmo estilo do rótulo do pin, incluindo o itálico de "Sem nome") +
     metadados 12.5px `#8A8F98`: "Leva para {ambiente}" · "Destino não definido" · "Ponto de informação"
   - chevron "›" 16px `#C9CCD2`
   - Tocar entra no modo editor daquele ponto.

### Arrastar para excluir — SOMENTE MOBILE

Gesto de long-press + drag sobre os pins, implementado com Pointer Events:

1. **`pointerdown` no pin** — chama `setPointerCapture`, e agenda um timer de **320ms**.
   Ao disparar, entra em modo arraste (o pin recebe `scale(1.08)` e a sombra elevada).
2. **`pointermove`** — se o modo arraste ainda não iniciou, **cancela o timer** (o usuário está
   rolando a página, não segurando). Se iniciou, atualiza `x`/`y` do hotspot em percentuais,
   **clampados em 2–98% no eixo X e 2–96% no eixo Y**, e recalcula se o ponteiro está sobre a lixeira.
3. **`pointerup` / `pointercancel`** — limpa o timer, sai do modo arraste. Se estava sobre a
   lixeira, **remove o hotspot**; caso contrário, mantém a nova posição.
4. **Supressão de clique** — o `pointerup` marca uma flag consumida pelo `click` seguinte, para
   que o gesto de arraste não dispare navegação nem abertura do sheet.
5. `onContextMenu` no pin faz `preventDefault` para evitar o menu de long-press do sistema.

**Zona da lixeira** (hit test em coordenadas do viewer): últimos **96px** de altura e faixa
central de **±92px** em torno do eixo horizontal.

**Alvo visual da lixeira** — aparece só durante o arraste, substituindo o balão de dica:

- `position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%)`
- Largura 150px, `padding: 12px 0`, raio 16px, coluna centralizada, `gap: 3px`
- Borda `1px solid rgba(255,255,255,.22)`, `backdrop-filter: blur(6px)`, `pointer-events: none`
- Repouso: fundo `rgba(14,16,20,.72)`, escala 1, rótulo "Arraste até aqui"
- Pin sobre ela: fundo `rgba(232,54,93,.94)`, `scale(1.12)`, rótulo "Solte para excluir"
- Conteúdo: glifo de lixeira 20px + rótulo 12.5px/650 branco

**Acessibilidade:** o gesto é um atalho, não o único caminho. Excluir também está disponível em
"Excluir" no bottom sheet (e no botão ✕ do painel desktop). Considere feedback tátil
(`navigator.vibrate(10)` ou Haptics nativo) ao entrar em modo arraste e ao cruzar a lixeira.

**Sugestão de melhoria** (não no protótipo): oferecer "Desfazer" em toast após a exclusão.

---

## Etapa 3 — Informações do imóvel

Duas colunas em `flex-wrap: wrap; gap: 20px; align-items: flex-start`:
formulário `flex: 1 1 420px` e card de resumo `flex: 0 1 300px; min-width: 270px`.
No mobile empilham naturalmente.

Cabeçalho: H2 "Informações do imóvel" + P "Só o essencial agora. O endereço é opcional e pode
ficar para depois."

### Campos visíveis (coluna `gap: 22px` entre blocos, `gap: 14px` entre campos)

Padrão de campo: `<label>` em coluna, `gap: 6px`, texto do label 13px/600 `#3A3D45`;
controle com borda `1px solid #E6E7EB`, raio 11px, `padding: 13px 14px`, 15px/400, texto `#16181D`.
Foco: `outline: 2px solid #E8365D33` + `border-color: #E8365D`.

1. **Nome do imóvel** — texto, largura total, placeholder "Ex.: Apartamento Vila Mariana, 82 m²"
2. Grid `repeat(auto-fit, minmax(200px,1fr))`, `gap: 14px`:
   - **Tipo** — select: Apartamento · Casa · Sala comercial · Terreno
   - **Finalidade** — select: Venda · Locação · Venda e locação

### Acordeão de endereço (opcional)

Card `border:1px solid #E6E7EB; border-radius:14px; background:#fff; overflow:hidden`.

- Cabeçalho: botão de largura total, `padding: 15px 16px`, `gap: 10px`, fundo branco, sem borda,
  `text-align: left` — "Endereço" 15px/650 (`flex:1`) + badge "opcional" (12px `#8A8F98`,
  fundo `#F4F5F7`, `padding: 4px 9px`, raio 999px) + chevron "⌄" 16px `#8A8F98`
  com `transform: rotate(180deg)` quando aberto, `transition: transform .2s`
- Corpo (só quando aberto): `padding: 0 16px 16px`, `border-top: 1px solid #ECEDF0`, `gap: 12px`.
  Inputs deste bloco usam `padding: 12px 14px`, raio 11px, 15px.
  - Linha 1 (`align-items: flex-end`): **CEP** (`max-width: 180px`, placeholder "00000-000") +
    texto auxiliar "preenchemos o resto pra você" (13px `#8A8F98`, `padding-bottom: 14px`)
  - Linha 2: grid `2fr 1fr` — Rua · Número
  - Linha 3: grid `1fr 1fr` — Bairro · Complemento
  - Linha 4: grid `2fr 1fr` — Cidade · UF
- **Implementar de fato o autofill por CEP** (ViaCEP ou serviço equivalente): ao completar 8
  dígitos, buscar e preencher Rua/Bairro/Cidade/UF, deixando foco em "Número". Estados de
  carregando e de CEP não encontrado precisam de tratamento (o protótipo não os mostra).
  No mobile, esses inputs também devem ter font-size 16px.

### Card "Resumo do tour"

`border:1px solid #E6E7EB; border-radius:16px; background:#fff; padding:16px`, coluna `gap: 14px`:

- h3 "Resumo do tour" 15px/700
- Thumbnail da capa: largura total, `aspect-ratio: 16/10`, raio 12px, cover da **primeira**
  imagem; sem imagem, a mesma hachura do viewer vazio
- Três linhas `space-between`, 14px, `gap: 12px` — label `#6B7079`, valor peso 650:
  - "Ambientes" → contagem de imagens ("N imagens")
  - "Hotspots" → **total somado de todos os ambientes**, não apenas o atual
  - "Capa" → nome do primeiro ambiente, truncado em 150px; "—" se não houver

---

## Estado de sucesso — "Tour publicado"

Substitui todo o conteúdo do corpo; a barra de ação do rodapé é removida; a barra de progresso vai a 100%.

Coluna centralizada, `gap: 14px`, `text-align: center`, `padding: 36px 10px`:

- Ícone: círculo 66px, fundo `#FDE7EC`, glifo "✓" 28px `#E8365D`
- H2 "Tour publicado" (24px/750, `letter-spacing: -.02em`)
- P (15px `#6B7079`, `max-width: 44ch`): "Link pronto para enviar aos clientes. Você ainda pode
  editar ambientes e hotspots quando quiser."
- Dois botões de 48px, `gap: 10px`, `flex-wrap: wrap`, `margin-top: 6px`:
  - **Copiar link** — primário `#E8365D`, hover `#C31E45`, `padding: 0 22px`
  - **Criar outro tour** — secundário, borda `#E6E7EB`, hover fundo `#F7F7F9`
- No produto, "Copiar link" deve copiar a URL real e dar feedback (toast/estado "Copiado ✓").
  Considere também: "Ver tour" e compartilhar por WhatsApp — canal principal do corretor.

---

## State Management

### Modelo de dados

```ts
type HotspotType = 'nav' | 'info';

interface Hotspot {
  id: string;
  x: number;              // 0–100, percentual da largura do viewer
  y: number;              // 0–100, percentual da altura do viewer
  label: string;
  type: HotspotType;
  target: string | null;  // id do Scene de destino; só usado quando type === 'nav'
}

interface Scene {           // "ambiente"
  id: string;
  room: string;             // nome editável, default = nome do arquivo sem extensão (28 chars)
  fileSize: number;
  url: string;              // objectURL no protótipo; URL do storage em produção
  order: number;            // o primeiro é a capa
  hotspots: Hotspot[];
}

interface TourDraft {
  id: string;
  step: 1 | 2 | 3;
  scenes: Scene[];
  selectedSceneId: string | null;
  property: {
    name: string;
    type: 'apartamento' | 'casa' | 'sala_comercial' | 'terreno';
    purpose: 'venda' | 'locacao' | 'ambos';
    address?: { zip, street, number, district, complement, city, state };
  };
  status: 'draft' | 'published';
}
```

**Sobre x/y:** o protótipo grava percentuais do retângulo do viewer. Um visualizador 360° real
usa **yaw/pitch** (ou vetor 3D). Converta na fronteira: yaw = `(x/100)*360 - 180`,
pitch = `90 - (y/100)*180` para uma projeção equirretangular simples — mas prefira a API de
"screen-to-sphere" da biblioteca escolhida, que trata o FOV corretamente. **Persista yaw/pitch,
não percentuais**, senão os pontos se deslocam quando o usuário gira a cena.

### Estado de UI (efêmero, não persistido)

| Estado | Tipo | Papel |
|---|---|---|
| `step` | 1 \| 2 \| 3 | Etapa atual |
| `selectedSceneId` | string | Ambiente exibido no viewer |
| `isDragOver` | boolean | Dropzone sob drag |
| `isAddressOpen` | boolean | Acordeão de endereço |
| `sheet` | `null \| {mode:'editor'\|'list', hotspotId}` | Bottom sheet mobile |
| `pinDrag` | `null \| {hotspotId, overTrash:boolean}` | Gesto de arraste em curso |
| `isPublished` | boolean | Tela de sucesso |
| refs internos | | timer do long-press (320ms) e flag de supressão de clique |

### Transições

| Gatilho | Efeito |
|---|---|
| Arquivos recebidos (input, câmera, drop) | Cria um `Scene` por arquivo, anexa ao fim |
| Remover ambiente | Remove o Scene, seleciona o primeiro restante |
| Clique/toque no viewer | Cria hotspot em (x,y); no mobile abre o sheet em modo editor |
| Clique no pin com destino | `selectedSceneId = target`; fecha o sheet |
| Clique no pin sem destino (mobile) | Abre o sheet em modo editor |
| Long-press 320ms no pin (mobile) | Entra em `pinDrag` |
| Soltar sobre a lixeira | Remove o hotspot |
| Soltar fora da lixeira | Confirma a nova posição |
| "Próximo" | `step + 1`; na etapa 3 → publica |
| "Pular" (só etapa 2 sem hotspots) | `step + 1` |
| "Voltar" | `step - 1` (mínimo 1) |
| Clique num chip do stepper | Vai à etapa se alcançável |
| Trocar de ambiente no rail | Fecha o sheet, troca a seleção |
| "Criar outro tour" | Reseta tudo ao estado inicial |

### Regras de validação

- **Etapa 1 → 2**: exige **≥ 1 imagem**. Sem isso, "Próximo" fica desabilitado com tooltip
  "Envie ao menos uma imagem 360° para continuar". As etapas 2 e 3 também ficam inalcançáveis
  pelo stepper. É a única regra bloqueante do protótipo.
- **Etapa 2 → 3**: sem restrição (etapa opcional).
- **Etapa 3 → publicar**: sem restrição no protótipo. **Recomendação para produção:** exigir
  "Nome do imóvel" e validar hotspots de navegação sem destino — bloquear a publicação ou
  avisar explicitamente ("2 pontos sem destino serão ignorados"), pois hoje eles ficam inertes.
- Validação deve ser exibida **inline no campo**, não só no botão. O protótipo não mostra
  estados de erro — use o padrão de erro do design system (sugestão: borda `#E8365D`,
  mensagem 12.5px abaixo do campo).

### Dados e persistência

- **Upload**: enviar cada arquivo assim que recebido, não no submit. Mostrar progresso por card
  (barra ou spinner no lugar do thumbnail) e permitir retry por item. O protótipo trata o upload
  como instantâneo — **implemente estados de carregando e de falha**.
- **Validar o arquivo** no cliente: tipo de imagem, tamanho ≤ 25 MB, e proporção próxima de 2:1
  (equirretangular). Avisar antes de subir quando a proporção estiver fora.
- **Autosave do rascunho**: o indicador "Rascunho salvo" no topbar precisa ser verdadeiro.
  Sugestão: debounce de 800ms sobre mudanças, com os três estados "Salvando…" / "Rascunho salvo" /
  "Falha ao salvar — tentar novamente".
- **Revogar objectURLs** ao desmontar (`URL.revokeObjectURL`) para não vazar memória.

---

## Comportamento responsivo

Não há toggle no produto — tudo é responsivo. Breakpoint sugerido: **`< 768px` = mobile**.

| Aspecto | Desktop (≥768px) | Mobile (<768px) |
|---|---|---|
| Largura do conteúdo | máx. 1120px, centralizado | 100% |
| Padding do corpo | `26px 28px 34px` | `20px 16px 26px` |
| Nav do topbar | visível | oculta |
| Rótulos do stepper | todos visíveis | só o da etapa atual |
| Botões do dropzone | lado a lado | empilhados, largura total |
| Proporção do viewer | 16/9 | 4/3 |
| Edição de hotspot | painel fixo à direita (320px) | bottom sheet contextual |
| Lista de hotspots | sempre visível no painel | linha-resumo + modo lista do sheet |
| Excluir hotspot | botão ✕ no card | arrastar até a lixeira ou "Excluir" no sheet |
| Mover hotspot | (não implementado) | arrastar o pin |
| Etapa 3 | duas colunas (form + resumo) | colunas empilhadas |
| Botão "Próximo" | largura pelo conteúdo | `flex: 1` |
| font-size de input | 15px | 16px (evita zoom no iOS) |

Consistência deliberada entre plataformas: a ação primária fica **sempre** no rodapé.

---

## Acessibilidade — pendências a resolver na implementação

O protótipo usa glifos de texto como ícones e não tem toda a semântica necessária. Na implementação:

- Substituir os glifos (`←`, `+`, `↑`, `◎`, `✕`, `→`, `⌄`, `›`, `ⓘ`, `🗑`) por ícones do
  design system, com `aria-hidden` e `aria-label` no elemento interativo.
- Stepper: `role="list"`, `aria-current="step"` na etapa atual, `aria-disabled` nas bloqueadas.
- Barra de progresso: `role="progressbar"` com `aria-valuenow/min/max` e `aria-valuetext`
  ("Etapa 1 de 3").
- Bottom sheet: `role="dialog"`, `aria-modal="true"`, trap de foco, fechar com Esc, devolver o
  foco ao elemento de origem.
- Dropzone: além do clique, deve ser focável e ativável por teclado — na prática, use um
  `<label>` real associado ao input.
- Hotspots: o viewer precisa de uma alternativa por teclado — lista navegável por Tab com
  Enter para entrar no ambiente (o clique na imagem não é acessível por teclado). Os pins devem
  ser `<button>` de verdade (já são no protótipo) com `aria-label` descritivo:
  "Hotspot 1, Sacada, leva para Sala".
- Respeitar `prefers-reduced-motion`: desligar `pulseRing` e as transições de escala.
- Contraste: a pílula do hotspot (branco sobre `rgba(16,18,24,.78)`) passa AA; o texto `#8A8F98`
  sobre branco fica em 3.5:1 — aceitável apenas para texto auxiliar, nunca para conteúdo essencial.

---

## Assets

Nenhum asset externo. Sem imagens, sem webfonts, sem biblioteca de ícones — os ícones do
protótipo são glifos Unicode e devem ser trocados pelos ícones do projeto. As imagens 360°
exibidas em desenvolvimento vêm de arquivos escolhidos pelo próprio usuário.

## Files

- `screenshots/` — 10 capturas em 2x das telas de desktop e mobile, incluindo os dois modos do
  bottom sheet e o gesto de arrastar-para-excluir. Ver `screenshots/README.md` para o índice.
- `Novo Tour - Fluxo em 3 etapas.dc.html` — protótipo completo e interativo. Abra em qualquer
  navegador. Use o toggle Desktop/Mobile no topo para ver os dois layouts (o toggle é da demo,
  não do produto).
- `support.js` — runtime da ferramenta de prototipagem. **Não é código de produção**;
  incluído apenas para o HTML abrir offline.

## Escopo assumido / decisões abertas

Itens não cobertos pelo protótipo e que precisam de decisão do produto:

1. **Reordenar ambientes** (definir a capa e a ordem de visita) — não existe hoje.
2. **Hotspot de informação**: o tipo existe, mas o conteúdo (texto/mídia do popup) não foi desenhado.
3. **Editar um tour existente** — o fluxo cobre apenas a criação.
4. **Limites reais**: nº máximo de ambientes e de hotspots por ambiente.
5. **Sair no meio do fluxo**: o comportamento do botão ← no topbar (confirmar? salvar e sair?).
6. **Desfazer exclusão** de ambiente e de hotspot.
