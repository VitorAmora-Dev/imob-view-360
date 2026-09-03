# 04 · Bottom sheets

Quatro sheets. Todos compartilham o mesmo shell.

## Shell comum

```
position: fixed; left:0; right:0; bottom:0;
background: #0D1622;                       /* sólido, não translúcido */
border-top: 1px solid rgba(255,255,255,.09);
border-radius: 26px 26px 0 0;
padding: 10px 18px 26px;                   /* +env(safe-area-inset-bottom) */
box-shadow: 0 -20px 50px rgba(0,0,0,.5);
```

- **Grabber:** 38×4, `radius:99px`, `rgba(255,255,255,.22)`, centralizado, `padding-bottom:12px`
- **Scrim:** `rgba(3,7,13,.6)` + `blur(3px)` cobrindo a tela; toque fecha o sheet
- **Entrada:** `translateY(100% → 0)`, 240ms `cubic-bezier(.22,1,.36,1)`; scrim em opacidade 180ms
- **Fechamento:** toque no scrim, arrasto para baixo (> 80px ou velocidade > 0.5), `Esc`
- **Foco:** trap dentro do sheet; ao fechar, devolve o foco ao botão que o abriu
- Só um sheet por vez — abrir outro substitui o atual
- A faixa de cenas some enquanto houver sheet aberto

---

## 1 · Cenas
**Ref:** `screens/02-mobile-cenas.png` · abre pela pill de cena, por "Ver todas" ou pelo item da lista

- Header: "Cenas do tour" (17px/800) à esquerda; "6 cenas" (12px/600, `text-tertiary`) à direita.
  `padding-bottom:14px`
- Grade: `grid-template-columns: 1fr 1fr; gap:10px; max-height:340px; overflow-y:auto`
- Card: altura 96px, `radius:15px`, borda 2px (accent na cena atual, `border-soft` nas demais)
- Imagem `object-fit:cover` + gradiente `0deg, rgba(4,9,16,.9) → transparente 65%`
- Nome: 12px/700 branco, `left:10px; right:10px; bottom:8px`
- Badge **ATUAL** na cena vigente: `top:8px; left:8px`, padding `3px 8px`, `radius:99px`,
  fundo `accent`, texto `accent-ink` 9.5px/800 uppercase `letter-spacing:.08em`
- Selecionar uma cena **troca a cena e fecha o sheet**

---

## 2 · Incorporar tour (Embed)
**Ref:** `screens/03-mobile-embed.png` · abre pela tab bar

1. **Título** "Incorporar tour" (17px/800)
2. **Descrição** 12.5px/1.5, `text-muted`: "Cole o código no site do imóvel ou envie apenas o link público."
3. **Seletor de formato** — segmented control
   - Container: `display:flex; gap:6px; padding:4px; background:rgba(255,255,255,.06); radius:12px`
   - Item: `flex:1`, padding `8px 4px`, `radius:9px`, 11.5px/700
   - Ativo: fundo `accent`, texto `accent-ink`. Inativo: transparente, `rgba(255,255,255,.7)`

   | Opção | width | height |
   |---|---|---|
   | Responsivo *(padrão)* | `100%` | `600` |
   | 16:9 | `960` | `540` |
   | Quadrado | `600` | `600` |

4. **Bloco de código** — `background:#080F19`, `border:1px solid rgba(255,255,255,.08)`,
   `radius:14px`, padding `12px 13px`, mono 10.5px/1.6, `word-break:break-all`.
   Tags e nomes de atributo em `#7FF3DE`, resto em `rgba(255,255,255,.72)`.
   Conteúdo (atualiza com o formato escolhido):
   ```html
   <iframe src="arpvision.app/t/{tourId}" width="{w}" height="{h}" allowfullscreen></iframe>
   ```
5. **Toggle "Mostrar controles no embed"** — rótulo 12.5px/600 à esquerda; switch 46×27,
   `radius:99px`, padding 3px, thumb 21×21 branco. Ligado: trilho `accent`.
   Desligado: `rgba(255,255,255,.18)`. Padrão: **ligado**
6. **Ações** — flex row, `gap:9px`, altura 48px
   - "Copiar código" — `flex:1.4`, fundo `accent`, texto `accent-ink` 13.5px/800, `radius:14px`
   - "Copiar link" — `flex:1`, ghost com `border-control`, texto branco 13.5px/700

Ambas escrevem no clipboard e disparam o toast. O sheet **não** fecha sozinho.

---

## 3 · Apagar tour
**Ref:** `screens/04-mobile-apagar.png` · abre pela tab bar

1. Círculo 46×46, `radius:50%`, fundo `danger-icon-bg`, lixeira 22×22 em `danger-text`
2. Título 19px/800: **Apagar "{nome do tour}"?**
3. Corpo 13px/1.55, `rgba(255,255,255,.6)`:
   "As {n} cenas, os pontos de navegação e o link público serão removidos. Quem já incorporou o tour verá um espaço vazio."
4. Caixa de aviso: padding `11px 13px`, `radius:13px`, fundo `danger-tint-soft`,
   `border:1px solid danger-border`, texto 11.5px/700 em `danger-text-strong`:
   "Esta ação não pode ser desfeita."
5. Botões empilhados, `gap:9px`, altura 50px, `radius:14px`
   - **Apagar tour** — fundo `danger`, hover `danger-hover`, texto branco 14px/800
   - **Cancelar** — ghost, `border-control`, texto branco 14px/700

Regras: o destrutivo fica **em cima** (alcance do polegar) e é o único vermelho sólido da tela.
Se o produto tiver soft delete, troque o corpo por "Você pode restaurar em até 30 dias".
Considere estado de carregamento no botão em vez de fechar o sheet imediatamente.

---

## 4 · Gerenciar tour
**Ref:** `screens/05-mobile-gerenciar.png` · abre pelo "⋯"

- Padding lateral do shell: `12px`; título "Gerenciar tour" (17px/800) com `padding:0 8px 10px`
- Item: linha inteira, `padding:15px 10px`, `border-bottom:1px solid divider-sheet`,
  hover `rgba(255,255,255,.04)`, chevron-right 16×16 em `rgba(255,255,255,.35)` à direita
- Título do item 14px/700 branco; subtítulo 11.5px/500 `text-tertiary`; `gap:3px`

| Item | Subtítulo |
|---|---|
| Publicar alterações | "{n} cenas editadas desde a última publicação" |
| Configurações do tour | "Nome, cena inicial, marca d'água" |
| Compartilhar link | "WhatsApp, e-mail ou copiar URL" |

Este menu é o **escape hatch**: tudo que não coube na tab bar mora aqui. Ao adicionar uma
função nova ao produto, ela entra nesta lista — **não** como quarto botão da tab bar.
