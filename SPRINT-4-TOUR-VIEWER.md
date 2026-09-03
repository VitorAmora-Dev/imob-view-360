# Sprint 4 — Refatoração da tela de visualização de tour

> Plano de divisão do handoff `design_handoff_tour_viewer/` em **três frentes
> paralelas**, para três devs assistidos por IA. Este arquivo é o contrato do
> sprint: quem implementar deve conseguir trabalhar lendo só ele + o README do
> handoff. Se algo aqui divergir do código, **o código vence** e esta nota é que
> está errada.
>
> Precedente de formato e de disciplina: `SPRINT-3-TOUR-WIZARD.md`.

Escopo tocado: `inner-view-client/` inteiro, e **um** ponto em `server-api/`
(TV-10, abrir tour publicado para edição). Nenhuma outra rota de API muda.

---

## 1. O que estamos refazendo

A tela `inner-view-page/:id` — o tour visto pelo **dono** (corretor logado), não
pelo visitante. Hoje ela é: header com quatro ícones sem rótulo, um card de
informações do imóvel sobreposto, a nav interna do próprio viewer e edição de
hotspots inline. O handoff substitui isso por duas camadas explícitas: chrome de
navegação (header, pill de cena, faixa de miniaturas) e ações do tour (tab bar
no mobile, cluster no rodapé direito no desktop).

Leia, nesta ordem: `design_handoff_tour_viewer/README.md` → `02-mobile.md` →
`06-state-behavior.md`. Os outros são consultados na hora de implementar.

---

## 2. Leitura crítica: o que o handoff assume × o que o código já resolve

O handoff foi escrito sem conhecer o codebase. Estes onze pontos mudam a
implementação e **precisam ser lidos antes de estimar qualquer coisa**.

| # | O handoff diz | O que vale aqui |
|---|---|---|
| 1 | "O panorama é uma imagem estática; em produção use Pannellum/Marzipano/three.js" | `PanoramicViewerComponent` (951 linhas) já é three.js, com OrbitControls, cache de textura, dissolvência de revelação e `onFrame()`. **Não se escolhe viewer**: consome-se este. |
| 2 | Hotspots posicionados por `left/top` %; converter para yaw/pitch | O backend já grava `positionX`/`positionY` em **UV 0–1**, e `tour-wizard/hotspots/hotspot-projection.ts` já converte UV → mundo → tela, testado sem WebGL. **Não há matemática nova.** |
| 3 | "Se o viewer já for WebGL, avalie desenhar o disco como sprite" | Não. Os sprites atuais (`addHotspots`) usam `theta = (1 - positionY) * PI` — **espelhado no equador**, bug documentado no cabeçalho de `hotspotToWorld`. O overlay em DOM do wizard já usa a conta certa. Ver D3. |
| 4 | Bottom sheet à mão (scrim + painel + grabber + focus trap) | `IonModal` com `breakpoints` entrega arrasto, foco preso, Esc, devolução de foco e animação. É o que `hotspot-sheet.component.ts` já faz. Usar isso. |
| 5 | Barra superior do desktop com voltar, marca, breadcrumb, links, idioma, conta | `AppHeaderComponent` já tem tudo menos o breadcrumb, e já tem `variant="overlay"`, feito para o viewer. Consumir como está + um slot de breadcrumb. |
| 6 | Tab bar inferior de três ações | Cuidado com o nome: já existe `TabBarComponent`, que é a **navegação global** do app. Ela não aparece nesta rota (`COM_BARRA` é lista de permissão e não inclui o viewer). A tab bar do handoff é outra coisa — ações do tour — e nasce dentro da tela. Nome: `tour-actions-bar`. |
| 7 | Accent `#2FE3C2`, fontes Manrope + JetBrains Mono | O sistema tem quatro camadas de token (`_palette.scss` L0 → `variables.scss` L1 → domínio L2 → componente L3) e a família é Airbnb Cereal/Inter. Ver D1 e D2. |
| 8 | `arpvision.app/t/{publicSlug}` | Não existe `publicSlug`. O link real é `window.location.origin + '/embed/' + tourId`, como `embed-modal.component.ts` já monta. |
| 9 | Miniatura recomendada 292×184 | `GET /panoramas/:id/image?w=292` já existe, é público, tem ETag e `Cache-Control` de um dia. **Zero trabalho de backend para as miniaturas.** |
| 10 | `pendingChanges` alimenta "N cenas editadas desde a última publicação" | Não existe no modelo nem no banco. Ver D8. |
| 11 | Strings em PT cravadas no protótipo | Tudo passa por `ngx-translate`, em `pt.json` **e** `en.json`. Nenhuma string entra no template. `yarn lint` roda `tools/checa-crases.js` antes do eslint. |

---

## 3. Decisões

As dez abaixo estão decididas. Duas delas custavam dinheiro ou contrariavam um
documento existente e foram levadas ao time: **D1 e D5 foram aprovadas em
01/09/2026**, e o que segue registra o que foi aprovado, não uma proposta.

### D1 — Accent teal no chrome do viewer  [APROVADA]

O handoff pede `#2FE3C2` na ação primária. O `tour-wizard.scss` diz, com todas
as letras, que teal é "o que já está feito" e **nunca** ação primária — porque
sobre as superfícies claras do app ele dá 2,27:1.

O viewer não é superfície clara: é chrome escuro sobre foto. Ali o teal passa
com folga, e o azul da marca é que some contra o panorama.

**Decidido:** adotar o accent do handoff **só dentro do chrome do viewer**,
nascendo como `--brand-accent-vivid` em L0 e consumido pelos `--tv-*` de L2. A
regra do wizard continua valendo onde foi escrita. Registrar a exceção no
cabeçalho de `_palette.scss` — senão vira a terceira vermelha da história do
projeto.

**Já implementada** no TV-0: `--brand-accent-vivid` em L0, consumida só por
`tour-viewer.scss`, e o `palette.contract.spec.ts` mede os 11:1 sobre o fundo
imersivo. A exceção agora falha em teste se alguém a desfizer.

### D2 — Tipografia: manter a do app

Não trazer Manrope nem JetBrains Mono. Dois webfonts a mais custam requisição e
FOUT numa tela que abre em 4G dentro de um imóvel. **Manter** a família de
`--ion-font-family`; para o bloco de código do embed, a stack mono do sistema
(`ui-monospace, monospace`). Tamanhos, pesos e `letter-spacing` do handoff ficam
**como estão** — são eles que dão a leitura.

### D3 — Hotspot é overlay em DOM, não sprite

Perspectiva CSS, halo em gradiente, anel de pulso e plaquinha são caros e feios
de desenhar em canvas-textura; e o caminho já existe pronto no wizard
(`hotspot-overlay` + `hotspot-projection` + `onFrame()`). Herda de graça o
`translate3d` fora da zona do Angular e a projeção correta — o que, de quebra,
**corrige o espelhamento** do item 3 da tabela acima.

Consequência: no viewer novo os sprites do `PanoramicViewerComponent` ficam
desligados por uma `@Input hotspots: 'sprites' | 'none'`, com default `'sprites'`
para não mexer no embed nem no wizard.

### D4 — Sheets são `IonModal` com breakpoints

Precedente: `hotspot-sheet.component.ts`. O visual do handoff (raio 26px, fundo
`#0D1622`, grabber) entra por custom properties do Ionic, não por painel próprio.
Escrever sheet à mão é reescrever focus trap, que é onde a acessibilidade morre.

### D5 — EDITAR abre o wizard em modo edição  [APROVADA]

O item de maior risco do sprint, e o que o produto exige.

`GET /virtual-tours/:id/rascunho` **recusa tour PUBLISHED de propósito**, e o
comentário do serviço explica por quê: o wizard oferece "Descartar captura", que
apaga o `Property` em cascata. Servir um tour no ar por ali põe esse botão em
cima de panoramas, hotspots, tratamento de IA já pago e o link que o corretor já
mandou para o cliente.

**Decidido:** não relaxar aquele filtro. Nasce um caminho próprio — endpoint de
edição (TV-10) + modo de edição no wizard (TV-11) — em que o descarte **não
existe** e a ação final é "Salvar alterações", não "Publicar". Enquanto TV-10 e
TV-11 não fecharem, EDITAR navega para o wizard e cai no diálogo de retomada
falha que já existe: feio, mas não destrutivo.

**O produto ainda não está em produção**, e isso muda o CRONOGRAMA, não o
desenho. Não há hoje link de tour na mão de cliente nenhum, então o estado
provisório acima custa pouco e TV-10/TV-11 podem escorregar sem travar o resto
do sprint. O que não muda é o motivo do endpoint separado: no dia em que houver
o primeiro tour publicado de verdade, o "Descartar captura" apontado para ele
apaga imóvel, fotos e tratamento de IA — e esse dia chega antes de alguém
lembrar deste parágrafo.

### D6 — O que sai da tela antiga

| Função de hoje | Destino |
|---|---|
| Upload de imagem inline (`addImage`) | **Sai.** Adicionar cômodo é trabalho do wizard, que é onde EDITAR leva. |
| Edição de hotspots inline (`toggleHotspotEdit`) | **Sai.** Mesma razão: o wizard tem etapa dedicada, com arrasto e rail. |
| Apagar panorama avulso | **Sai**, junto com a edição. |
| Baixar a cena atual (`onDownloadPanorama`) | **Fica**, movido para o sheet Gerenciar. Tem teste (`inner-view-page.download.spec.ts`) e custo zero. |
| Card de informações do imóvel | **Sai.** Título e contagem de cenas já estão no header do handoff. |

### D7 — Toggle "mostrar controles no embed"

O handoff pede o toggle mas não diz o que ele desliga. Aqui a resposta é óbvia:
a nav interna do `PanoramicViewerComponent` (`roomNav`), único controle que a
página `/embed/:id` mostra. **Decidido:** o toggle escreve `?controles=0` na URL
do iframe, e `EmbedPage` lê o parâmetro e passa `[roomNav]="false"`. Cinco
linhas, e o design fica inteiro.

### D8 — "Publicar alterações" e o contador de pendências

`pendingChanges` não existe e não vale uma coluna nova neste sprint.
**Decidido para o v1:** o item "Publicar alterações" do sheet Gerenciar e o botão
"Publicar" do cluster desktop só aparecem quando `tour.status === 'DRAFT'`, com o
rótulo "Publicar tour" e **sem** contagem no subtítulo. Com o modo edição
(TV-11) o tour editado continua PUBLISHED, então na prática o botão quase nunca
aparece — que é o comportamento correto.

### D9 — "Configurações do tour"

Não existe essa tela. **Decidido:** o item leva ao wizard em modo edição, na
etapa de informações. Marca d'água está **fora de escopo**, e some do subtítulo.

### D10 — Rota e convivência com a tela antiga

A rota `inner-view-page/:id` recebe o **id do imóvel**, não o do tour, e a tela
carrega o tour a partir dele. Isso **não muda** — mexer nisso arrasta home,
cards, guards e links já enviados.

O código novo nasce em `app/tour-viewer/`, com a rota `inner-view-page/:id`
re-apontada já no commit-zero. A página antiga vira `inner-view-legado`
(precedente: `upload-legado`) e **é apagada em TV-12**. Ninguém edita
`inner-view-page.page.*` durante o sprint.

---

## 3b. Reconciliação de 02/09 — leia antes de abrir qualquer branch

A TV-3 foi entregue a partir da `main`, e não da `feature/tour-viewer`. Sem o
commit-zero ela não enxergava `TourViewerPage`, `TourViewerStore`, os tokens
`--tv-*` nem o bloco `TOUR_VIEWER` — então reinventou os quatro. Nada disso foi
erro de quem escreveu: **o TV-0 nunca foi mesclado, e levou junto o handoff de
design**, que só existe naquela branch. Quem trabalhou da `main` não tinha como
ver nem o contrato nem a referência visual.

Já está reconciliado. As quatro regras abaixo existem para não repetir.

### R1 · A base é a ponta da pilha, nunca a `main`

Branch nova sai de **`feature/tour-wizard-edicao`**. É a única árvore que tem, ao
mesmo tempo, o contrato do TV-0, a TV-3 encaixada e o
`design_handoff_tour_viewer/`. Sair da `main` custa um dia de reencaixe.

### R2 · i18n: um bloco por TELA, com o nome da tela, chaves em inglês

Tudo desta tela em **`TOUR_VIEWER.*`**. `VIEWER.*` **não** é o bloco desta tela —
é o do `PanoramicViewerComponent`, o componente 360 compartilhado por sete
telas; ele tem uma chave (`ROOMS`) e continua com uma.

Nome de chave em inglês: das 355 do arquivo, 348 são. `SHEET_TITLE`, não
`TITULO`.

### R3 · Um sheet por vez é do `TourViewerStore`, e só dele

`store.sheet()` (tipado, `SheetKind`), `store.abrirSheet('...')`,
`store.fecharSheet()`. **Não crie um segundo coordenador.** O shell
`TourSheetComponent` e cada sheet recebem `[isOpen]`/`[aberto]` e emitem
`(fechado)` — quem sabe qual está aberto é a tela, não o sheet.

### R4 · O que se desenha sobre a foto lê `cenaNaTela()`, não `currentScene()`

`store.currentScene()` é a **intenção**: vira no instante do toque.
`page.cenaNaTela()` é a **realidade**: vira quando a textura chega, o que num 4G
leva segundos. Hotspots, badge ATUAL e qualquer coisa posicionada sobre a
equirretangular pertencem à segunda. Ligar na primeira já custou um defeito em
produção interna: os pins do destino boiando sobre a foto da origem, clicáveis.

### Extensões do contrato aprovadas em 03/09

O store diz que assinatura só muda "por PR anunciado". Este é o anúncio. Três
adições, todas porque **duas tasks diferentes precisariam da mesma coisa** — e
duas cópias divergem no primeiro ajuste:

| O quê | Quem usa | Por que subiu para o contrato |
|---|---|---|
| `podePublicar()`, `publicando()`, `publicar()` no store | TV-6 (item da lista) e TV-9 (botão do cluster) | Mesmo motivo de `apagarTour()` já morar lá |
| `VirtualTourService.recordShare(id, canal)` | TV-6 | A rota existe desde o sprint das métricas e nenhum cliente a chamava — o painel mostrava sempre zero |
| `TOAST.PUBLISHED` e `TOAST.PUBLISH_ERROR` | TV-6 e TV-9 | i18n é do commit-zero; chave inventada na task vira `VIEWER.*` de novo |

`publicar()` é o DEPOIS da decisão, como `apagarTour()`: não confirma nada e não
mostra toast. E ele **remenda só o campo `status`** em vez de aceitar a resposta
da rota — o `PATCH /virtual-tours/:id` devolve
`{ id, status, propertyId, updatedAt }` e mais nada, então um `tour.set(resposta)`
apagaria `panoramas` e esvaziaria a tela no instante em que a publicação dá
certo. Tem teste guardando, validado por injeção.

---

## 4. Mapa de propriedade de arquivos

Regra: cada task só escreve nos arquivos da sua linha. Arquivo de duas frentes é
merge conflict garantido — no sprint 3 foi assim que o CONGELADO nasceu.

| Área | Dono | Arquivos |
|---|---|---|
| Contrato | trio (TV-0) | `tour-viewer.model.ts`, `tour-viewer.store.ts` (assinaturas), `theme/tour-viewer.scss`, `theme/_tour-viewer-mixins.scss`, `app.routes.ts`, i18n (blocos abertos) |
| Chrome mobile | Frente A | `tour-viewer/chrome/**`, `tour-viewer/tour-actions-bar/**` |
| Cenas e sheets | Frente B | `tour-viewer/scenes/**`, `tour-viewer/sheets/**`, `embed/embed.page.*` (só a leitura do `?controles=0`, TV-4) |
| Viewer e hotspots | Frente C | `tour-viewer/hotspots/**`, `components/panoramic-viewer/**` |
| Desktop | Frente A | `tour-viewer/desktop/**`, `components/app-header/**` |
| Edição | Frente C | `server-api/src/modules/virtual-tours/**`, `tour-wizard/**` |
| Página | TV-0 cria; depois **só** por PR anunciado | `tour-viewer/tour-viewer.page.*` |

`tour-viewer.page.html` é o único ponto que todas as frentes tocam. Por isso ele
nasce **completo** no commit-zero, com todos os slots no lugar e stubs vazios:
cada frente preenche o seu componente, ninguém reescreve o arranjo.

---

## 5. As tasks

Treze issues. Cada uma cabe em um a dois dias de trabalho assistido por IA e
fecha em um PR próprio, com testes.

Convenção dos campos: **Dep.** = do que depende; **Est.** = dias ideais.

---

### TV-0 · Commit-zero: contrato do viewer
**Tipo:** Task · **Dep.:** — · **Est.:** 0,5 (feito pelos três juntos)

O único commit em que os três mexem nos mesmos arquivos. Sai da chamada com tudo
o que as outras doze tasks assumem existir.

**Escopo**
- Pastas de `app/tour-viewer/` criadas vazias, conforme o mapa da seção 4.
- `tour-viewer.model.ts`: `SheetKind`, `TourViewerScene`, `ViewerHotspot`
  (`kind: 'primary' | 'secondary'`), derivados de `VirtualTour`/`Panorama` — sem
  duplicar o modelo do backend.
- `tour-viewer.store.ts`: store de sinais com as **assinaturas congeladas** do
  `TourViewerState` de `06-state-behavior.md` (`currentSceneIndex`, `sheet`,
  `chromeVisible`, `toast`, `embedFormat`, `embedShowControls`, `railCollapsed`)
  mais `tour`, `property`, `loading`, `loadError`. Corpo pode ser stub; as
  assinaturas, não. Carrega imóvel → tour reaproveitando a lógica de `ngOnInit`
  da página antiga.
- `theme/tour-viewer.scss` (L2, tokens `--tv-*` de `01-design-tokens.md`, cada um
  derivado de L0/L1 — nenhum hex nasce aqui) e
  `theme/_tour-viewer-mixins.scss` (`tv-mobile` / `tv-desktop` em 767px,
  reaproveitando o corte já usado no wizard). Registrados em `angular.json`.
- `--brand-accent-vivid` em `_palette.scss`, com a nota da exceção (D1), e o par
  `-rgb` correspondente coberto por `palette.contract.spec.ts`.
- `tour-viewer.page.ts/html/scss`: shell com todos os slots e stubs vazios.
- Rota `inner-view-page/:id` → `TourViewerPage`; a antiga vira
  `inner-view-legado`.
- Blocos `TOUR_VIEWER.*` abertos em `pt.json` e `en.json` com as chaves de cada
  frente já declaradas (vazias é pior que ausentes: preencham com o texto do
  handoff).

**Aceite:** `yarn lint` e `yarn test` passam; a rota abre a tela nova, vazia, sem
erro de console; as três frentes conseguem começar sem tocar em arquivo alheio.

---

### TV-1 · Chrome mobile: header, pill de cena, modo imersivo e tab bar de ações
**Épico:** Chrome · **Dep.:** TV-0 · **Est.:** 2 · **Ref.:** `02-mobile.md`, `screens/01`, `screens/06`

O coração da refatoração. Entrega a tela mobile inteira menos cenas, sheets e
hotspots — que chegam pelos slots das outras frentes.

**Escopo**
- Estrutura de camadas: panorama → scrim topo 230px → scrim base 300px → chrome.
  Os scrims e o container do chrome com `pointer-events: none`; **cada filho**
  com `pointer-events: auto`. Errar isso mata o arrasto do panorama.
- Header: voltar 40×40 (glass + blur, sempre visível), bloco de título com nome
  do tour e "N cenas" (ellipsis em uma linha), botão "⋯" que emite abertura do
  sheet Gerenciar.
- Pill de cena atual: 36px, borda accent 1,5px, bolinha, nome, chevron; abre o
  sheet Cenas.
- Botão flutuante do olho: 44×44, `right:12px; top:210px`, `aria-pressed`, rótulo
  que alterna entre "Ocultar interface" e "Mostrar interface".
- Modo imersivo: `chromeVisible = false` esconde título, "⋯", pill, faixa de
  cenas, tab bar **e hotspots**; sobram voltar e o próprio olho. Transição de
  200ms em opacidade + `translateY(±8px)`. Não persiste entre sessões.
- `tour-actions-bar`: grid de 3 × 56px — EDITAR (accent-tint), EMBED
  (neutral-fill), APAGAR (danger-tint, **nunca** vermelho sólido aqui). Emite
  eventos; não navega nem apaga sozinha.
- `padding-bottom` somando `env(safe-area-inset-bottom)`; topo respeitando
  `env(safe-area-inset-top)`.
- Toast do handoff (2200ms, `bottom:170px`, `pointer-events:none`) como
  componente próprio, alimentado pelo sinal `toast` do store.
- Variações da barra: sem permissão de edição → só EMBED; tour sem cenas →
  EDITAR e APAGAR (esconder, nunca desabilitar).

**Aceite:** alvos de 56px reais medidos no DevTools; arrastar o panorama sob o
scrim funciona; imersivo esconde tudo menos os dois botões; teste de unidade
cobrindo a alternância e as duas variações da barra.

---

### TV-2 · Faixa de cenas (mobile) e rail (desktop)
**Épico:** Cenas · **Dep.:** TV-0 · **Est.:** 1,5 · **Ref.:** `02-mobile.md`, `05-desktop.md`

**Escopo**
- Faixa mobile: cabeçalho "CENAS" + "Ver todas"; trilho horizontal com scrollbar
  escondida nos três motores; miniaturas 104×70, raio 13px, borda 2px accent na
  cena atual, gradiente e legenda com ellipsis.
- Rail desktop: container de vidro 640px, cabeçalho "CENAS · N", "Recolher" com
  chevron; miniaturas 146×92; estado recolhido **persiste na sessão**
  (`sessionStorage`, chave por tour).
- Fonte das imagens: `imageUrl` + `&w=292` (item 9 da seção 2). Nada de baixar a
  equirretangular para desenhar 104px.
- Skeleton `#0B1420` com shimmer enquanto a miniatura não chega; erro de imagem
  cai no bloco vazio, sem ícone quebrado.
- `role="tablist"` no trilho, `role="tab"` + `aria-selected` em cada miniatura.

  **Esta linha foi contestada e depois confirmada, e vale registrar o
  caminho.** A TV-2 entregou `role="list"` + `aria-current`, com o argumento de
  que o padrão de abas promete duas coisas que ninguém tinha escrito: um
  `tabpanel` e navegação por setas com foco itinerante. A TV-12 voltou ao
  `tablist` **escrevendo as setas** — `ArrowLeft`/`ArrowRight`, `Home`/`End`,
  `tabindex` itinerante e `role="presentation"` nos `<li>`. Com a promessa
  cumprida, o escopo original é o certo: o `tablist` ainda dá "aba 3 de 6", que
  o `aria-current` não dá.

  O que falta para o padrão fechar é `aria-controls` apontando para o palco —
  ele vive fora do componente, e o comentário no template registra isso.
- Tocar troca a cena **sem fechar nada**. A faixa some no modo imersivo e
  enquanto qualquer sheet estiver aberto.

**Aceite:** rola na horizontal sem scrollbar visível e sem cortar legenda; cena
atual marcada nos dois; recolhido sobrevive a F5 na mesma aba; nenhuma requisição
de imagem sem `w`.

**Entregue em 03/09/2026** — `tour-viewer/scenes/**`, 8 testes. Um componente
para os dois layouts: o que muda entre faixa e rail é moldura e medida, e
separá-los daria duas cópias da regra de qual cena está ativa. Ele injeta o
`TourViewerStore` (a página o fornece) e recebe só `atualId` por `input`, que é
a `cenaNaTela()` — a regra R4. Verificado no navegador: rail em `left:24px
bottom:24px`, 640px, miniaturas 146×92, recolhido sobrevive a F5 de verdade, e
arrastar o panorama continua girando a foto com a faixa na tela.

---

### TV-3 · Shell de bottom sheet + sheet Cenas
**Épico:** Sheets · **Dep.:** TV-0 · **Est.:** 1,5 · **Ref.:** `04-sheets.md` §1, `screens/02`

Primeiro sheet do sprint: entrega **o shell que os outros três consomem**.

**Escopo**
- `tour-sheet` genérico sobre `IonModal` (D4): grabber, raio 26px, fundo
  `#0D1622`, scrim com blur, `role="dialog"`, `aria-modal`, `aria-labelledby`,
  foco devolvido ao gatilho, fecha por scrim/arrasto/Esc. Um por vez: abrir outro
  substitui o atual.
- Sheet Cenas: header "Cenas do tour" + "N cenas"; grade 2 colunas, cards de 96px
  com `max-height:340px` e rolagem; badge ATUAL na cena vigente; selecionar troca
  a cena **e fecha**.

**Aceite:** os três gestos de fechar funcionam; foco volta ao botão que abriu;
abrir um segundo sheet não empilha; nada quebra com 1 cena ou com 30.

---

### TV-4 · Sheet Incorporar (embed)
**Épico:** Sheets · **Dep.:** TV-3 · **Est.:** 1,5 · **Ref.:** `04-sheets.md` §2, `screens/03`

**Escopo**
- Segmented control de formato: Responsivo (padrão) · 16:9 · Quadrado, com as
  medidas da tabela do handoff.
- Bloco de código com destaque de tag/atributo, `word-break:break-all`, mono do
  sistema (D2). O código **muda com o formato**.
- Toggle "Mostrar controles no embed" (padrão ligado) → `?controles=0` quando
  desligado (D7), **incluindo** a leitura do parâmetro em `EmbedPage` e o
  repasse para `[roomNav]`.
- "Copiar código" e "Copiar link": clipboard + toast; o sheet **não** fecha.
- URL montada como `origin + '/embed/' + tourId` (item 8 da seção 2).

**Aceite:** os três formatos geram o iframe correto; `/embed/:id?controles=0`
abre sem a nav interna; copiar dispara toast e mantém o sheet aberto; teste de
unidade sobre a montagem do código nos três formatos.

**Entregue em 03/09/2026** — `tour-viewer/sheets/embed/**` mais a leitura do
parâmetro em `embed.page.ts`; 10 + 4 testes.

Duas decisões que não estavam no escopo e valem para quem for ler o código:

1. **O código que aparece e o código que se copia saem da MESMA lista.** O
   `pedacos()` fatia o `<iframe>` em trechos já com a classe que os pinta, e
   `codigo()` é a emenda desses trechos. É a única defesa contra o defeito
   clássico deste sheet — o destaque de sintaxe e a string do clipboard
   divergirem, e a pessoa colar no site um iframe diferente do que leu. O teste
   compara o `textContent` do bloco APRESENTADO com `codigo()`.
2. **O segmented control é `<input type="radio">` de verdade.** Navegação por
   setas, anúncio "1 de 3" e grupo nomeado pelo `<legend>` vêm de fábrica; com
   `<button role="radio">` seriam trinta linhas de teclado, e é sempre a seta que
   fica faltando.

Chave nova: `TOAST.COPY_ERROR`. Anunciar "Código copiado" quando a permissão de
área de transferência foi negada é pior que ficar calado — a pessoa cola o
conteúdo anterior sem saber.

---

### TV-5 · Apagar tour: sheet mobile, diálogo desktop e estados destrutivos
**Épico:** Sheets · **Dep.:** TV-3 · **Est.:** 1 · **Ref.:** `04-sheets.md` §3, `screens/04`

**Escopo**
- Sheet: círculo de 46px com lixeira, título com o nome do tour, corpo com a
  contagem de cenas, caixa de aviso "não pode ser desfeita", botões empilhados
  com o **destrutivo em cima** (único vermelho sólido da tela).
- Desktop: mesmo conteúdo em diálogo centralizado de 480px, botões em linha, com
  cancelar à esquerda.
- Estado "Apagando…": botão em loading, sheet **travado** (não fecha por scrim).
- Falha: toast de erro em `danger`, sheet segue aberto.
- Sucesso: `DELETE /virtual-tours/:id` e navegação para a listagem.

**Aceite:** APAGAR nunca executa sem confirmação (teste); durante o loading o
scrim não fecha; falha de rede não deixa a tela em estado ambíguo.

**Entregue em 03/09/2026** — `tour-viewer/sheets/delete/**`, 12 testes.

Três notas de implementação:

1. **`[travado]` do shell, e não `backdropDismiss`.** Ele alimenta o
   `canDismiss` do Ionic, o que recusa os TRÊS gestos de uma vez — scrim,
   arrasto e Esc. Travar só o scrim deixaria os outros dois vivos, e é
   exatamente no meio da requisição que fechar deixa a tela ambígua.
2. **Guarda de reentrada no `confirmar()`.** `[travado]` não impede um segundo
   toque no próprio botão; sem a guarda, dois toques disparam dois DELETE, e o
   segundo volta 404 sobre um tour que o primeiro apagou — falha anunciada para
   uma operação que deu certo.
3. **O círculo da lixeira ficou ABAIXO do título, e não acima como no handoff.**
   O título é do shell: é ele que vira o `<h2>` e o `aria-label` do nó com
   `role="dialog"` no shadow DOM do Ionic. Inverter custaria um diálogo anônimo
   ou um segundo slot no shell — e não mexer no shell é o que faz TV-4, TV-5 e
   TV-6 serem arquivos novos.

Verificado no navegador nas duas formas: bottom sheet a 390px e diálogo
centrado de 480px a 1440px, com Cancelar à esquerda e sem grabber.

---

### TV-6 · Sheet Gerenciar
**Épico:** Sheets · **Dep.:** TV-3 · **Est.:** 1 · **Ref.:** `04-sheets.md` §4, `screens/05`

O escape hatch: tudo que não coube na tab bar. Função nova do produto entra
**nesta lista**, nunca como quarto botão da barra.

**Escopo**
- Lista com divisores, chevron à direita, título 14px e subtítulo 11,5px.
- Itens do v1: **Publicar tour** (só com `status === 'DRAFT'`, D8) ·
  **Configurações do tour** → wizard em modo edição, etapa de informações (D9) ·
  **Compartilhar link** (`navigator.share` com fallback para clipboard, mesmo
  padrão de `tour-published.component.ts`) · **Baixar esta cena** (migra
  `onDownloadPanorama` e o seu spec, D6).
- Compartilhar registra em `POST /virtual-tours/:id/shares` — o endpoint existe e
  nenhum cliente o chama hoje.

**Aceite:** itens indisponíveis somem (não aparecem desabilitados); o download
mantém o teste existente passando; share cai no clipboard onde não há
`navigator.share`.

---

### TV-7 · Hotspot de piso estilo Street View
**Épico:** Viewer · **Dep.:** TV-0 · **Est.:** 2 · **Ref.:** `03-hotspots.md`

A peça mais delicada do handoff, e a que tem mais código pronto para herdar.

**Escopo**
- Overlay em DOM (D3) sobre o canvas, reaproveitando `hotspotToWorld` /
  `projectToScreen` de `tour-wizard/hotspots/hotspot-projection.ts` e o
  `onFrame()` do viewer. Escrever `transform: translate3d(...)` direto no DOM,
  **fora** da zona do Angular — nada de `@Output` por frame.
- Dois elementos aninhados: wrapper com `pin-bob`, interno com
  `perspective(190px) rotateX(62deg)`. Juntar os dois **descarta a perspectiva** e
  o disco vira círculo chapado — é a armadilha nomeada no handoff, e o QA checa.
- Camadas: halo em gradiente radial, anel de pulso (**só no hotspot primário**),
  chevron SVG e plaquinha de rótulo fora do wrapper de perspectiva.
- Hierarquia primário/secundário conforme a tabela do handoff. Enquanto o modelo
  não tiver `kind`, o primário é derivado por regra combinada no PR (sugestão: o
  hotspot cujo destino é a próxima cena na ordem) — no máximo **um** por cena.
- Escala por distância: lado do disco interpolado entre 64px e 124px pelo pitch.
- Fora do frustum → `display:none`. Nada posicionado fora da viewport.
- `<button>` com `aria-label="Ir para {cena}"`, alcançável por teclado, depois do
  chrome na ordem de tabulação, alvo efetivo ≥ 44px.
- `prefers-reduced-motion` desliga `pin-bob` e `pin-ring` (usar
  `prefersReducedMotion()` de `hotspots/media.ts`).
- Some no modo imersivo.

**Aceite:** o disco renderiza como **elipse deitada** em mobile e desktop;
os pins acompanham o giro no mesmo frame da foto, sem arrastar; só um anel de
pulso por cena; teste de projeção integrando com o viewer de verdade, no modelo
do `hotspot-overlay.component.spec.ts`.

---

### TV-8 · Integração com o `PanoramicViewerComponent`
**Épico:** Viewer · **Dep.:** TV-0 · **Est.:** 1 · **Ref.:** `06-state-behavior.md`

Ajustes no viewer compartilhado, com o cuidado de **não quebrar** embed, wizard e
captura, que também o consomem.

**Escopo**
- `@Input hotspots: 'sprites' | 'none'` (default `'sprites'`) — o viewer novo
  passa `'none'` (D3).
- `[roomNav]="false"` na tela nova: a nav interna é substituída pela pill + faixa
  de cenas. Continua ligada no embed, e ganha o `?controles=0` de TV-4.
- Troca de cena pelo store: pill, faixa, card do sheet e hotspot chegam todos em
  `currentSceneIndex`; o viewer carrega o panorama e mantém a dissolvência.
- Estados que o protótipo não cobre: skeleton `#0B1420` + spinner accent no
  carregamento do panorama (com o chrome **já visível**); estado vazio central com
  "Tentar de novo" no erro; faixa de aviso de offline de 32px sob o header.
- Um toque no panorama alterna o modo imersivo, sem engolir o toque nos hotspots
  (o viewer já distingue arrasto de clique por `DRAG_SLOP_PX`).

**Aceite:** embed, wizard e captura seguem idênticos (specs existentes verdes);
trocar de cena por qualquer um dos quatro caminhos leva ao mesmo estado; erro de
cena oferece nova tentativa que realmente recarrega.

---

### TV-9 · Layout desktop e responsividade
**Épico:** Desktop · **Dep.:** TV-1, TV-2 · **Est.:** 2 · **Ref.:** `05-desktop.md`, `screens/07`

**Escopo**
- Barra superior: `AppHeaderComponent` em `variant="overlay"` + slot de
  breadcrumb ("Meus imóveis / {tour}"). **Nenhuma** ação de gestão no topo.
- Contexto de cena: pill de 40px + "Cena N de M" em `top:86px; left:24px`.
- Cluster de visualização (`right:24px; bottom:150px`): um botão só, com texto,
  porque está sozinho.
- Cluster de ações (`right:24px; bottom:24px`): Editar tour (primário) ·
  Incorporar · Publicar (D8) · **divisor** · Apagar (só ícone, 46×46). O divisor
  é separação física contra clique acidental, não enfeite.
- Breakpoints: ≥1280 completo · 1024–1279 rail em 480px e links globais em "⋯" ·
  768–1023 rail recolhido por padrão · <768 **layout mobile inteiro** (tab bar no
  lugar do cluster, sheets no lugar dos diálogos).
- `title`/`aria-label` em todos; obrigatório no de apagar.

**Aceite:** em 767px a tab bar substitui o cluster e o diálogo vira sheet, sem
recarregar a página; nenhuma ação de tour no topo; foco visível em todos os
botões do cluster.

---

### TV-10 · Backend: abrir tour publicado para edição
**Épico:** Editar · **Dep.:** — · **Est.:** 1 · **Risco:** alto

**Escopo**
- `GET /virtual-tours/:id/edicao` (nome a combinar), autenticado e com escopo por
  agência, aceitando `PUBLISHED` **e** `DRAFT`, com o mesmo shape de
  `RascunhoCompleto` — reaproveitando o `select` de `FindDraftTourService`, sem
  colunas de imagem.
- `GET /:id/rascunho` **permanece** recusando PUBLISHED. O comentário que explica
  isso fica, e ganha um "ver também" apontando para a rota nova.
- Testes: publicado abre pela rota nova e 404 pela antiga; tour de outra agência
  404 nas duas.

**Aceite:** as duas rotas convivem com testes verdes; nenhuma mudança de schema;
Swagger atualizado.

---

### TV-11 · Wizard em modo edição + botão EDITAR do viewer
**Épico:** Editar · **Dep.:** TV-10, TV-1 · **Est.:** 2 · **Risco:** alto

Fecha o pedido do produto: EDITAR leva à tela de edição do tour que já temos.

**Escopo**
- Rota `tour/:id/editar` (ou `tour/novo?tour=<id>&modo=edicao`, à escolha de quem
  implementar) carregando pelo endpoint de TV-10.
- `TourDraftStore` ganha `modo: 'criacao' | 'edicao'`. Em edição:
  **`descartarRascunho()` não é alcançável de lugar nenhum** — some do diálogo de
  saída, que passa a oferecer só "Salvar alterações" e "Sair sem salvar".
- Ação final rotulada "Salvar alterações"; o tour **continua PUBLISHED** (não
  chamar `publicarTour` quando já publicado).
- Botão EDITAR do viewer (mobile e desktop) navega para lá, com o toast "Abrindo
  o editor…" do handoff.
- Voltar do wizard em modo edição retorna **ao viewer**, não à home.

**Aceite:** teste provando que o descarte é inalcançável em modo edição; editar e
salvar preserva `status`, `id` e link público; sair sem salvar não altera o tour;
o fluxo de criação continua idêntico (specs do wizard verdes).

---

### TV-12 · Fechamento: exceções, acessibilidade, i18n e limpeza
**Épico:** Chrome · **Dep.:** todas · **Est.:** 1,5

**Escopo**
- Varredura da tabela "Estados que o protótipo não cobre" de
  `06-state-behavior.md`: carregando, erro de cena, tour sem cenas, apagando,
  falha ao apagar, offline, sem permissão de edição.
- Checklist de QA do handoff (14 itens) rodado em aparelho real, iOS e Android.
- Auditoria de acessibilidade: contraste dos rótulos da tab bar, `aria-label` em
  todo botão só-ícone, `aria-pressed` do olho, tablist das cenas, focus trap e
  devolução de foco nos quatro sheets, `prefers-reduced-motion`.
- `en.json` completo e revisado (o sprint inteiro escreve PT primeiro).
- **Apagar** `inner-view-page/` e a rota `inner-view-legado`; conferir que nada
  mais importa `Capture360Component` a partir dali.
- Nota de encerramento em `SPRINT-4-NOTAS.md` com o que mudou de plano.

**Aceite:** `yarn lint` e `yarn test` verdes; checklist com as 14 caixas marcadas;
nenhuma referência viva à página antiga.

---

## 6. Sequenciamento e alocação

```
Dia 0    TV-0 (os três, meio dia)
         │
   ┌─────┼───────────────────┬────────────────────┐
   ▼     ▼                   ▼                    ▼
 Dev 1                     Dev 2                Dev 3
 TV-1  ██████              TV-2 ████▌           TV-7 ██████
 TV-6  ███                 TV-3 ████▌           TV-8 ███
 TV-9  ██████              TV-4 ████▌           TV-10 ███
 TV-12 ████▌               TV-5 ███             TV-11 ██████
```

| Dev | Tasks | Dias |
|---|---|---|
| 1 — chrome e desktop | TV-1, TV-6, TV-9, TV-12 | 6,5 |
| 2 — cenas e sheets | TV-2, TV-3, TV-4, TV-5 | 5,5 |
| 3 — viewer e edição | TV-7, TV-8, TV-10, TV-11 | 6,0 |

Dependências reais, e só elas: TV-4/5/6 esperam o shell de TV-3; TV-9 espera
TV-1 e TV-2; TV-11 espera TV-10; TV-12 espera todo mundo. O resto corre solto a
partir do commit-zero.

Ordem de merge sugerida: TV-0 → TV-1 → TV-3 → TV-2 → TV-7 → TV-8 → TV-4 → TV-5 →
TV-6 → TV-9 → TV-10 → TV-11 → TV-12.

### Onde estamos, em 03/09/2026

**TV-0 a TV-12 estão na `main`** (PR #51 e o PR do download de cena em
rascunho). A tela abre com a foto, os hotspots, a faixa de cenas, o chrome
mobile, o cluster do desktop e os quatro sheets — todos alcançáveis pela
interface.

---

## 6b. TV-13 · Reorganização dos menus — 03/09/2026

Pedido depois de a tela estar no ar, com o produto em mãos: a barra inferior
tinha EDITAR / EMBED / APAGAR, e havia mais três controles espalhados pela tela
(ocultar, gerenciar, selecionar cenas). Duas coisas estavam erradas ao mesmo
tempo — a barra levava a ação destrutiva no alcance do polegar, e a tela tinha
duas portas para a mesma lista de cenas.

### O que a tela passou a ter

| Antes | Agora |
|---|---|
| Barra: EDITAR · EMBED · APAGAR | Barra: **EDITAR · OCULTAR · COMPARTILHAR** |
| Olho flutuante à direita, acima da barra | Sumiu — virou o OCULTAR da barra |
| Pill de cena no topo esquerdo | Sumiu — a faixa de cenas (TV-2) já fazia isso |
| Sheet Incorporar, próprio | Aba 2 do sheet **Compartilhar** |
| "Compartilhar link" no Gerenciar | Sumiu — virou a aba 1 do Compartilhar |
| APAGAR na barra | Último item do sheet **Gerenciar** |
| "…" no topo direito | Igual: gerenciar tour |

### As três decisões que não estavam no pedido

**D11 — A barra não some inteira no modo imersivo.** O botão de ocultar era
flutuante e sobrevivia ao imersivo justamente porque era ele o caminho de volta.
Trazido para a barra, ele herdou o problema: com a barra sumindo por inteiro, o
único jeito de recuperar a interface seria um toque na foto — que não tem
afordância nenhuma e ninguém descobre. O que some no imersivo é a BARRA (placa
de vidro, borda e os outros dois botões); sobra um botão redondo de vidro, do
tamanho e no espírito do flutuante que ele substitui. **O invariante 1 do
`TourViewerStore` foi reescrito para dizer isso.**

O par de `pointer-events` que vem junto não é enfeite: sem a placa, a faixa
continua sendo um retângulo de ponta a ponta da tela, e um retângulo
transparente com `pointer-events: auto` engole o arrasto do panorama exatamente
como um opaco — transparência não conta para hit test. A regra que devolve o
toque mora em `tour-viewer.page.scss` (no slot, com a âncora `.tv-chrome >`, ou
perde na especificidade) e a que o recupera para o botão mora no SCSS do
componente. Os dois lados têm teste.

**D12 — "Compartilhar link" saiu do Gerenciar.** O critério só mandava mover
APAGAR para dentro do Gerenciar; tirar o compartilhar de lá é decisão nossa.
Com um botão dedicado na barra e um sheet com abas, o item do Gerenciar seria a
segunda porta para a mesma coisa — a duplicação que esta reorganização veio
desfazer, e a que ninguém lembraria de manter em dia. O código dele (folha
nativa + fallback de cópia + métrica) foi MOVIDO, não duplicado.

**D13 — O desktop mudou só o que era forçado.** O cluster do desktop (TV-9) é
outro desenho: ele tem Publicar no meio das ações e olho próprio, e não tem o
botão "…". O "Incorporar" dele passou a abrir o Compartilhar já na aba
Incorporar, porque o sheet antigo deixou de existir; o resto ficou. Levar a
reorganização inteira para lá exigiria dar ao desktop um ponto de entrada para o
Gerenciar, senão apagar um tour ficaria impossível na largura grande — é ticket
próprio, e está anotado em "Fora de escopo".

### Onde o código foi parar

| Arquivo | O quê |
|---|---|
| `sheets/share/tour-share-sheet.component.*` | **novo** — o sheet, as abas e o rodapé |
| `sheets/share/tour-embed-panel.component.*` | o miolo da TV-4, movido de `sheets/embed/` |
| `tour-actions-bar/*` | a barra nova, com o estado imersivo |
| `sheets/manage/*` | entrou Apagar, saiu Compartilhar |
| `chrome/tv-scene-pill.*`, `chrome/tv-immersive-toggle.*` | **apagados** |
| `tour-viewer.model.ts` | `SheetKind` `'embed'`→`'share'`, `ShareTab`, `pedacosDoIframe()` |
| `tour-viewer.store.ts` | `shareTab`, `abrirCompartilhamento()`, `pedacosDoEmbed`, `codigoDoEmbed` |
| `theme/_palette.scss`, `theme/tour-viewer.scss` | o verde do WhatsApp, L0 e L2 |

A promessa da TV-4 — "o que se lê é o que se copia" — ficou mais frágil e por
isso subiu de camada. O bloco de código e o botão "Copiar código" deixaram de
ser o mesmo componente (o rodapé é do shell, porque `[rodape]` é projeção e só
alcança filho direto), então o `<iframe>` passou a ser montado por
`pedacosDoIframe()` no modelo, com os dois lados lendo o mesmo `computed` do
store.

---

## 6c. TV-14 · "Ocultar interface" deixa os hotspots em paz — 03/09/2026

Defeito relatado com o produto em mãos: o modo imersivo escondia junto os
pontos de navegação entre cenas. Como o toque na foto é o *outro* jeito de sair
do imersivo, quem ocultava a interface para ver o cômodo inteiro ficava sem como
ANDAR até o cômodo seguinte — tinha que trazer a interface de volta primeiro. O
imersivo deixava de ser "ver a foto sem os controles" e virava "ver a foto e não
poder se mexer".

Ele nasceu no invariante 1 do commit-zero, que listava "sem hotspots" junto com
o resto do chrome. **A linha estava errada desde a TV-0**, e a distinção que
faltava é esta: o chrome é o app FALANDO da foto — título, contagem, ações,
miniaturas. O hotspot é parte da foto: mora numa coordenada da equirretangular,
aponta para uma porta que está ali, e o handoff o desenha como marca de chão
justamente para pertencer à cena e não à moldura. **Some a moldura; a porta
fica.**

O conserto é a remoção de `TourViewerStore.hotspotsVisiveis` e do `@if` que ela
alimentava. O que resta guardando os pins é `cenaNaTela()`, que é a regra de
verdade: sem foto na tela não há onde projetar posição nenhuma.

Removido, e não deixado como `computed(() => true)`: um sinal que nunca é falso
convida a próxima pessoa a "consertá-lo" de volta para `chromeVisible()`, porque
o nome pede uma condição. No lugar dele ficou um comentário com o porquê, e o
template tem um "não reponha uma guarda aqui" em cima do bloco.

Um teste do `tour-viewer.page.spec.ts` afirmava o defeito (`sem chrome, sem
camada de hotspots`) e foi substituído pelo bloco `modo imersivo`, que prova o
contrário: a moldura vai embora, os pins ficam, e clicar num pin navega **sem**
devolver a interface.

Não há beco sem saída no caminho novo: mesmo caindo numa cena sem hotspot de
volta (tour de mão única), o botão de mostrar a interface continua na tela — é a
decisão D11 da TV-13 pagando por si.

---

## 7. Fora de escopo deste sprint

- Tela cheia e mapa de conexões: **removidos do produto** pelo handoff.
- Marca d'água (D9) e `publicSlug` com domínio próprio.
- `pendingChanges` e o contador de cenas editadas (D8).
- Soft delete (`?soft=true`) — o handoff sugere, o backend não tem.
- Auto-ocultar o chrome depois de 4s de inatividade (opcional no handoff).
- Hotspots do tipo `info`, ainda cortados desde o sprint 3.
- Qualquer mudança na rota `/embed/:id` além do `?controles=0`.
- Levar a reorganização de menus (TV-13) para o cluster do desktop: exige um
  ponto de entrada para o Gerenciar na largura grande, que hoje não existe.
  Ver D13.
