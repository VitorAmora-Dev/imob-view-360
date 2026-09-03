# Briefing do sprint do visualizador

Cole a seção **"Antes de qualquer coisa"** mais o bloco da sua task na IA, junto
com o ticket do Jira. Foi escrito para ser lido por quem nunca abriu este
repositório.

Estado em 03/09/2026:

| Feito | Falta |
|---|---|
| TV-0, TV-2, TV-3, TV-4, TV-5, TV-7, TV-8, TV-10, TV-11 | **TV-1**, **TV-6**, **TV-9**, **TV-12** |

A tela hoje abre com a foto, os hotspots, a faixa de cenas e os sheets Cenas,
Incorporar e Apagar montados. Falta o **chrome** — header, pill de cena, tab bar
e modo imersivo —, o sheet Gerenciar, o layout desktop e o fechamento.

Enquanto a TV-1 não entra, **não há como chegar aos sheets Incorporar e Apagar
pela interface**: eles esperam a tab bar. Para ver os dois funcionando, abra o
console na tela do tour e chame:

```js
ng.getComponent(document.querySelector('app-tour-viewer')).store.abrirSheet('embed');
```

---

## Antes de qualquer coisa

**Sua branch sai de `feature/tour-wizard-edicao`.** Não da `main`.

Essa é a única árvore que tem, ao mesmo tempo, o contrato do TV-0, a TV-3
encaixada e a pasta `design_handoff_tour_viewer/`. A TV-3 saiu da `main` e custou
um dia de reencaixe — ela reinventou o store de sheets, o bloco de i18n e a
camada de tokens porque, da `main`, nenhum dos três era visível.

```bash
git fetch origin
git checkout feature/tour-wizard-edicao
git checkout -b <sua-branch>
```

**Se você acabou de trocar de branch e o `ng serve` já estava rodando, reinicie
o servidor.** O `angular.json` ganhou `src/theme/tour-viewer.scss` e o `ng serve`
não recarrega mudança de configuração. O sintoma é traiçoeiro: todos os tokens
`--tv-*` resolvem vazio e a tela fica sem cor nenhuma, sem erro no console.

### O que ler, nesta ordem

1. `SPRINT-4-TOUR-VIEWER.md` — seções **3b** (as quatro regras da
   reconciliação), **2** (decisões D1–D10) e **4** (mapa de arquivos).
2. `design_handoff_tour_viewer/` — o arquivo que a sua task cita.
3. Um componente pronto como referência de estilo, escolhido pela forma do que
   você vai escrever:
   - peça de chrome sobre a foto → `tour-viewer/scenes/` (TV-2);
   - sheet → `tour-viewer/sheets/embed/` (TV-4) ou `sheets/delete/` (TV-5);
   - coisa desenhada sobre a equirretangular → `tour-viewer/hotspots/` (TV-7).

### As quatro regras que já custaram caro

| | Regra | O que acontece se ignorar |
|---|---|---|
| **R1** | Branch sai da ponta da pilha | Um dia de reencaixe |
| **R2** | i18n em `TOUR_VIEWER.*`, chaves em **inglês** | Dois blocos para o mesmo domínio |
| **R3** | Um sheet por vez é do `TourViewerStore` | Dois lugares sabendo a mesma coisa |
| **R4** | Sobre a foto lê `cenaNaTela()` | Pins do destino sobre a foto da origem |

### Regras de código deste repositório

- **Nenhum hex em componente.** As cores desta tela vêm de `--tv-*`
  (`theme/tour-viewer.scss`). Faltou uma? Ela nasce lá, não no seu `.scss`.
  Também **nada de `--ion-color-*`** aqui: são do tema claro do app, e esta tela
  é escura.
- **Token que não é cor precisa de marcador no nome** (`dur`, `blur`, `grad`,
  `size`, `radius`, `shadow`, `family`). O `palette.contract.spec.ts` varre os
  tokens e tenta resolvê-los como cor; sem marcador, o seu token novo derruba a
  suíte.
- **Comentários e nomes de teste em português**, explicando o *porquê*, não o
  *o quê*.
- Termine com `yarn lint` e `yarn test` passando. **Injete o defeito de volta**
  para confirmar que o seu teste realmente pega o que ele diz pegar.

### As duas rotas de imagem, que NÃO são a mesma coisa

Este é o erro que já deixou a tela do tour branca uma vez (`036b4ac`), e ele
volta em toda task que mostra foto:

| Rota | Guard | Serve | Como chamar |
|---|---|---|---|
| `/panoramas/:id/preview` | **autenticada** | qualquer tour, inclusive rascunho | `PanoramaImageCache` → `blob:` |
| `/panoramas/:id/image` | pública | **só tour `PUBLISHED`** | `fetch` direto serve |

A `preview` é a que o `<img src="/api/...">` não alcança: o token está no
`localStorage` e a tag `<img>` não passa pelo interceptor. O caminho é sempre
`PanoramaImageCache.obter(id, variante, largura)`.

A `image` é pública, mas **404 em tour DRAFT** — e esta tela mostra rascunho, ao
contrário da página antiga. Ver a armadilha da TV-6.

### O que já existe e você NÃO deve reconstruir

`TourViewerStore` (fornecido pela PÁGINA, não em `root` — qualquer componente
dentro dela pode injetá-lo):

```ts
scenes()  panoramas()  currentScene()  currentSceneIndex()  tourName()  semCenas()
irParaCena(i)  irParaCenaPorId(id)
sheet()  abrirSheet('scenes'|'embed'|'delete'|'manage')  fecharSheet()
chromeVisible()  alternarChrome()  faixaVisivel()  hotspotsVisiveis()
podeEditar()
toast()  mostrarToast(chave)
embedFormat()  embedShowControls()  linkPublico()
railCollapsed()  alternarRail()
podePublicar()  publicando()  publicar()      // acrescentado em 03/09
apagando()  apagarTour()
```

`TourViewerPage`: `cenaNaTela()` — a foto que está NO AR, diferente de
`store.currentScene()`. Ver R4. E `editarTour()` e `voltar()`, já escritos.

`tour-viewer.model.ts`: `EMBED_FORMATOS`, `LARGURA_DA_MINIATURA` (292),
`comLargura(url, largura)`, `TOAST_MS`, `SheetKind`, `EmbedFormat`.

`components/tour-sheet/` (shell da TV-3): `[isOpen]`, `[titulo]`, `[subtitulo]`,
`[variante]` (`'sheet' | 'adaptavel'`), `[travado]`, `[breakpoints]`,
`[initialBreakpoint]`, `(fechado)`, corpo por `<ng-content>` e rodapé por
`<ng-content select="[rodape]">`.

`theme/_tour-viewer-mixins.scss`: `tv-mobile`, `tv-desktop`,
`tv-desktop-compacto`, `tv-trilho-sem-barra`, `tv-vidro($fundo, $blur, $borda)`,
`tv-oculto-no-imersivo`.

`VirtualTourService`: `publicarTour(id)`, `deleteTour(id)`, `recordView(id)`,
`recordShare(id, canal)` (acrescentado em 03/09), `baixarPreview(...)`.

**O bloco `TOUR_VIEWER.*` do i18n já está inteiro**, em pt e en, desde o TV-0 —
inclusive as chaves das tasks que faltam: `ACTIONS.*`, `MANAGE.*`, `SCENE_OF`,
`BACK`, `HIDE_UI`/`SHOW_UI`, `MANAGE_OPEN`, `TOAST.PUBLISHED`,
`TOAST.PUBLISH_ERROR`, `TOAST.DOWNLOAD_SUCCESS`/`_ERROR`. Confira antes de criar
chave nova.

---

## TV-1 · Chrome mobile: header, pill, modo imersivo e tab bar

**Ref.:** `02-mobile.md`, `screens/01`, `screens/06` · **Est.:** 2 · **Dep.:** TV-0 ✅

O coração da refatoração, e a task que destrava as outras duas: enquanto ela não
entra, os sheets Incorporar e Apagar não têm por onde ser abertos.

### Seus arquivos

`tour-viewer/chrome/**` e `tour-viewer/tour-actions-bar/**` — crie as duas
pastas. Mais **quatro linhas** em `tour-viewer.page.html`, nos slots já marcados
com `TV-1`, e os imports correspondentes no `.ts`. Não toque em mais nada do
arranjo.

### O que entregar

Header (voltar 40×40 sempre visível · título + "N cenas" · botão "⋯"), pill de
cena de 36px, botão flutuante do olho em `right:12px top:210px`, a tab bar de
três botões e o toast.

- **Voltar** → `page.voltar()`. **"⋯"** → `store.abrirSheet('manage')` (o sheet é
  da TV-6; até ela chegar o botão abre coisa nenhuma, e isso está certo).
- **Pill** → `store.abrirSheet('scenes')`. O sheet Cenas **já está montado**.
- **Olho** → `store.alternarChrome()`, com `aria-pressed` e o rótulo alternando
  entre `HIDE_UI` e `SHOW_UI`.
- **Tab bar:** EDITAR → `page.editarTour()` (já escrito, com o toast e a rota
  do modo edição) · EMBED → `store.abrirSheet('embed')` · APAGAR →
  `store.abrirSheet('delete')`.
- **APAGAR nunca chama `store.apagarTour()`.** Aquilo é o *depois* da
  confirmação; quem confirma é o sheet da TV-5. O docstring do método diz isso, e
  é o invariante 4 do sprint.
- **Modo imersivo:** o mixin `tv-oculto-no-imersivo` já existe e já faz o certo —
  opacidade, `translateY(8px)`, `visibility` **e** `pointer-events: none`. O
  `visibility` não é enfeite: um botão só transparente continua engolindo o
  arrasto do panorama.
- **Toast:** o `tour-viewer.page.html` já traz o slot com o texto ligado em
  `store.toast()` e `pointer-events: none`. O que falta é a pílula — fundo,
  borda, check em accent. Trocar aquele `<div>` pelo seu `<app-tv-toast />` é o
  que o comentário `TV-1` daquele slot autoriza. A duração (2200ms) é do store,
  em `TOAST_MS`; não a duplique no CSS.

### As armadilhas desta task

1. **`class="tv-slot"` no host de cada peça** — é dela que vem o
   `pointer-events: auto`, porque o `.tv-chrome` tira o ponteiro de todo mundo de
   propósito. E **nenhum host com `inset: 0`**: uma caixa transparente sobre a
   foto inteira mata o arrasto do panorama, sem erro nenhum no console. Foi o bug
   do commit `df9658c`, e o `tour-viewer.page.spec.ts` tem um teste guardando.
2. **`components/tab-bar/` não é a sua barra.** Aquela é a navegação global do
   app. A do tour é nova, e o mapa de arquivos a chama de `tour-actions-bar`.
3. **O safe area já está aplicado pela página**: `.tv-chrome` tem
   `padding-top: var(--ion-safe-area-top)` e `.tv-slot--acoes` tem
   `padding-bottom: var(--ion-safe-area-bottom)`. Repetir no seu componente soma
   duas vezes, e a barra sobe uns 30px no iPhone.
4. **`store.podeEditar()` é `true` cravado hoje.** Para a variante "sem
   permissão" ser testável, a barra deve receber `[podeEditar]` por `input` e a
   página é que lê o store. Testar mexendo no store obrigaria a fazer o sinal
   mentir.

### Aceite

Alvos de 56px medidos no DevTools; arrastar o panorama sob o scrim continua
girando a foto; imersivo esconde tudo menos voltar e olho, e devolve tudo ao
sair; teste de unidade cobrindo a alternância e as duas variações da barra (sem
permissão → só EMBED; tour sem cenas → EDITAR e APAGAR).

---

## TV-6 · Sheet Gerenciar

**Ref.:** `04-sheets.md` §4, `screens/05` · **Est.:** 1 · **Dep.:** TV-3 ✅

O escape hatch: tudo que não coube na tab bar. Função nova do produto entra
**nesta lista**, nunca como quarto botão da barra.

### Seus arquivos

`tour-viewer/sheets/manage/**` — crie. Mais a linha do slot em
`tour-viewer.page.html`. E mova para cá `inner-view-page/panorama-download.util.ts`
e `inner-view-page/inner-view-page.download.spec.ts` — ver abaixo.

### O que entregar

Sheet sobre o `TourSheetComponent`, aberto por `store.sheet() === 'manage'`.
Lista com divisores, chevron à direita, título 14px e subtítulo 11,5px.

Copie a forma de `tour-viewer/sheets/embed/`: um componente que injeta o store,
tem `aberto = computed(() => store.sheet() === 'manage')` e devolve `(fechado)`
para `store.fecharSheet()`.

**Publicar tour** — só aparece com `store.podePublicar()` (D8: `status === 'DRAFT'`,
sem contagem no subtítulo). Chama `store.publicar()`, que **já existe** e já
resolve a parte difícil. Ele devolve `boolean` e **não mostra toast** — o toast é
seu: `TOAST.PUBLISHED` ou `TOAST.PUBLISH_ERROR`, chaves já criadas.

**Configurações do tour** — leva ao wizard em modo edição, etapa de informações
(D9). Marca d'água está fora de escopo e sai do subtítulo.

**Compartilhar link** — `store.linkPublico()`, a MESMA URL que o sheet
Incorporar mostra. `navigator.share` com fallback para clipboard; copie o padrão
de `tour-wizard/published/tour-published.component.ts`, inclusive o detalhe de
que **cancelar a folha nativa não é erro** — cai para copiar. Registre em
`virtualTourService.recordShare(id, canal)`, com `'native'` ou `'clipboard'`;
assine com `error: () => undefined`, como o `recordView` — métrica não pode
impedir o link de sair.

**Baixar esta cena** — migra `onDownloadPanorama` da página antiga (D6). O
`panorama-download.util.ts` e o seu spec vêm junto: a TV-12 apaga
`inner-view-page/` inteiro, e o util morreria lá dentro. O teste tem de
continuar passando depois da mudança de lugar.

### As armadilhas desta task

1. **O download NÃO pode copiar o `fetch(urlDaImagem(...))` da página antiga.**
   Aquela rota (`/panoramas/:id/image`) é pública e por isso filtra
   `status: 'PUBLISHED'` — em tour rascunho ela devolve 404. A página antiga
   nunca viu rascunho; esta vê, e é justamente no rascunho que o item "Publicar"
   aparece. Use `PanoramaImageCache.obter(cena.id, 'original')`, que passa pela
   rota autenticada e serve os dois casos.
2. **Qual cena é "esta cena"?** A que está NA TELA: `page.cenaNaTela()`, regra
   R4 — não `store.currentScene()`, que já virou no instante do toque. Como
   `cenaNaTela()` mora na página, ela entra no seu componente por `input`, do
   mesmo jeito que a faixa de cenas recebe `atualId`.
3. **Passe `[breakpoints]`.** O default do shell (`[0, 0.55]`) foi calibrado
   para o sheet Cenas, que trava a grade em 340px. Esta lista cresce sem teto:
   `[0, 0.5, 0.9]`, como o `HotspotSheet` já usa. O `0` da primeira posição é o
   que permite arrastar para baixo até fechar; mantenha-o.
4. **`publicar()` não substitui o tour pela resposta da rota**, e o seu
   componente também não deve. O `PATCH` devolve só
   `{ id, status, propertyId, updatedAt }`; um `tour.set(resposta)` esvaziaria a
   tela inteira no instante em que a publicação dá certo. Já está resolvido no
   store, com teste.

### Aceite

Itens indisponíveis **somem**, não aparecem desabilitados; o download funciona em
tour DRAFT **e** em PUBLISHED, com o teste migrado passando; share cai no
clipboard onde não há `navigator.share`; publicar com falha mantém o sheet aberto
com o toast de erro.

---

## TV-9 · Layout desktop e responsividade

**Ref.:** `05-desktop.md`, `screens/07` · **Est.:** 2 · **Dep.:** TV-1, TV-2 ✅

### Seus arquivos

`tour-viewer/desktop/**` — crie. Mais as linhas dos slots em
`tour-viewer.page.html`.

### O que entregar

Barra superior, contexto de cena, cluster de visualização e cluster de ações do
tour — nas posições do handoff.

- **Barra superior:** `AppHeaderComponent` com `variant="overlay"` — ele já
  existe e já tem essa variante. Breadcrumb "Meus imóveis / {tour}". **Nenhuma**
  ação de gestão no topo.
- **Contexto de cena** (`top:86px; left:24px`): pill de 40px + "Cena N de M" com
  a chave `SCENE_OF`. O N é de `page.cenaNaTela()` (R4), não do índice pedido.
- **Cluster de visualização** (`right:24px; bottom:150px`): um botão só, com
  texto, porque está sozinho.
- **Cluster de ações** (`right:24px; bottom:24px`): Editar tour (primário) ·
  Incorporar · Publicar (só com `store.podePublicar()`, D8) · **divisor** ·
  Apagar (só ícone, 46×46). O divisor é separação física contra clique
  acidental, não enfeite. `title`/`aria-label` em todos; obrigatório no de
  apagar.

### O que já se posiciona sozinho — e que você NÃO deve reposicionar

- **O rail de cenas.** A TV-2 já o coloca em `left:24px bottom:24px`, com 640px
  (480px entre 768 e 1279), miniaturas 146×92 e o recolhido persistindo em
  `sessionStorage` por tour. Ele nasce recolhido entre 768 e 1023px, como o
  handoff pede.
- **O sheet Apagar.** A `variante="adaptavel"` do shell já o vira diálogo
  centrado de 480px acima de 768px. **Não escreva media query para ele** — a
  diferença entre sheet e diálogo é a PRESENÇA de `breakpoints` no
  `<ion-modal>`, e isso o CSS não alcança.

### As armadilhas desta task

1. **O corte é 767/768, e ele já existe em dois lugares que precisam concordar:**
   os mixins `tv-mobile`/`tv-desktop` (SCSS) e `TOUR_MOBILE_QUERY` em
   `components/tour-sheet/media.ts` (TS). Um terceiro corte é como uma tela passa
   a mudar de layout em dois pontos diferentes.
2. **O cluster do desktop e a tab bar da TV-1 são o MESMO conjunto de ações em
   dois desenhos.** Os handlers devem ser os mesmos — `page.editarTour()`,
   `store.abrirSheet('embed'|'delete')`, `store.publicar()`. Dois caminhos para
   "editar" é como eles passam a divergir.
3. **Esconder por CSS não desliga um `IonModal`.** Se em algum momento você
   pensar em `display:none` num sheet para a versão desktop: ele continua
   prendendo o foco, travando a rolagem e respondendo ao Esc. É o comentário que
   está em `components/tour-sheet/media.ts`.

### Aceite

Em 767px a tab bar substitui o cluster e o diálogo vira sheet, **sem recarregar a
página**; nenhuma ação de tour no topo; foco visível em todos os botões do
cluster; o rail continua onde estava.

---

## TV-12 · Fechamento: exceções, acessibilidade, i18n e limpeza

**Est.:** 1,5 · **Dep.:** todas

### O que entregar

- Varredura da tabela "Estados que o protótipo não cobre" de
  `06-state-behavior.md`: carregando, erro de cena, tour sem cenas, apagando,
  falha ao apagar, offline, sem permissão de edição.
- Checklist de QA do handoff (14 itens) em aparelho real, iOS e Android.
- Auditoria de acessibilidade.
- `en.json` completo e revisado.
- Apagar `inner-view-page/` e a rota `inner-view-legado`.
- Nota de encerramento em `SPRINT-4-NOTAS.md`.

### O que mudou desde que o escopo foi escrito

- **A faixa de cenas não usa `role="tablist"`.** Ela usa `role="list"` +
  `aria-current="true"`, e o porquê está registrado na seção 5 do plano, na
  TV-2. O item da auditoria vira "a cena atual se anuncia como `aria-current`,
  igual no rail, na faixa e no sheet".
- **Chaves de i18n acrescentadas durante o sprint**, que precisam de revisão em
  inglês: `SCENE_COUNT_ONE`, `EMBED.FORMAT_LABEL`, `TOAST.COPY_ERROR`,
  `TOAST.PUBLISHED`, `TOAST.PUBLISH_ERROR`.
- **Antes de apagar `inner-view-page/`, confirme que a TV-6 já levou embora**
  `panorama-download.util.ts` e `inner-view-page.download.spec.ts`. Confirme
  também o `CenasSheetComponent`: hoje ele tem dois consumidores, e quando a tela
  legada morrer sobra um — o que abre a chance de simplificá-lo, mas não
  obriga.

### Os quatro débitos anotados, com o motivo de cada um ter ficado

1. `TourHotspotOverlayComponent` depende da classe concreta
   `PanoramicViewerComponent`. Uma interface mínima — só `onFrame` e a câmera —
   quebraria o acoplamento.
2. `hotspot-projection.ts` mora em `tour-wizard/hotspots/` e é importado pelo
   visualizador. Mover para um lugar neutro mexe em arquivos de outra frente, e
   por isso ficou para cá.
3. `PanoramicViewerComponent` passa de mil linhas.
4. **`yarn lint` do `server-api` reescreve o repositório inteiro.** O script é
   `eslint --fix`, há 55 arquivos que nunca passaram pelo prettier e, sem
   `.gitattributes`, CRLF entra na conta. Merece um commit de normalização
   próprio, isolado, antes que contamine o diff de alguém. Já contaminou um.

E um item de faxina: `refactor-visualizacao-tour.zip` está solto na raiz do
repositório, sem rastreio. Ou entra no `.gitignore`, ou sai.

### Aceite

`yarn lint` e `yarn test` verdes; checklist com as 14 caixas marcadas; nenhuma
referência viva à página antiga.

---

## Depois de terminar

1. `yarn lint` e `yarn test` verdes no `inner-view-client`.
2. **Prove que o seu teste não é decorativo**: reintroduza o defeito de propósito
   e veja o teste cair. Se ele não cair, ele não guarda nada.
3. PR contra `feature/tour-wizard-edicao`, não contra a `main`.
4. Se precisar mexer num arquivo fora da sua linha do mapa da seção 4, **pare e
   avise** — é assim que nasce o conflito que custou o dia da TV-3.
