# TV-3 — Shell de bottom sheet + sheet Cenas

> Spec de desenho, validada em conversa antes de qualquer código.
> Branch: `TV-3`. Base: `8e78ce9` (tip da `origin/main`).
> Data: 2026-09-02. Escopo tocado: **`inner-view-client/`, o visualizador.**

## O pedido

Entregar o **shell** de bottom sheet que TV-4, TV-5 e TV-6 vão consumir, mais o
primeiro consumidor — o sheet "Cenas do tour" — que prova o shell. O ticket é
prioridade de merge: o que trava os outros é a API do shell, não o sheet Cenas.

## Sobre a referência

O ticket cita `04-sheets.md §1` e `screens/02`. **Nenhum dos dois existe neste
repositório nem em qualquer lugar da máquina** — procurado por nome e por
padrão em todo o Desktop, OneDrive, Documentos e Downloads. Decidido em
conversa: seguir com o texto do escopo como spec integral, preenchendo o resto
pelo design system que já está no repo (`ARP-VISION-DESIGN.md`,
`_palette.scss`, `HotspotSheetComponent`).

**A pasta tem nome.** O TV-6 cita o caminho inteiro:
`design_handoff_tour_viewer/04-sheets.md §4`. É uma irmã da
`design_handoff_tour_wizard/` que já está versionada aqui — e que ninguém
commitou. Enquanto ela não entrar no repo, os quatro tickets do sprint
dependem de valores adivinhados a partir do texto dos escopos.

Consequência registrada: **valores visuais que o doc definia e o escopo não
repete foram escolhidos aqui** — ver "Breakpoints" e "Cor de fundo". Se o doc
aparecer e divergir, os dois são troca de uma linha.

## O que já existe, e que este trabalho reaproveita

- **`HotspotSheetComponent`** (`tour-wizard/hotspots/hotspot-sheet/`) é
  `IonModal` + `breakpoints [0, 0.5, 0.9]`. O JSDoc dele já argumenta a escolha
  do `IonModal` sobre um painel à mão: arrasto, trap de foco, Esc, devolução do
  foco e animação vêm prontos, e reescrever um trap de foco é onde a a11y
  costuma morrer. **Não é migrado** neste ticket (fora do escopo), mas é o
  precedente que este desenho segue.
- **`urlDoPreview(panoramaId, variante, { largura })`** em
  `VirtualTourService`. A rota aceita `w` justamente porque "miniatura" antes
  devolvia a equirretangular inteira — dezenas de MB por cômodo. É o que torna
  o critério das 30 cenas viável.
- **Família `--tour-*`** em `_palette.scss`. O arquivo abre exceção explícita
  para ela: *"Aqui eles NÃO viram um segundo tema com nomes próprios que os
  componentes consomem. Eles alimentam o fundo das páginas imersivas."* Seis
  componentes já consomem `var(--tour-*)` direto — é o padrão sancionado, não
  violação da regra de camadas.

## Arquitetura — quatro peças

### 1. `TourSheetComponent` — o shell

`inner-view-client/src/app/components/tour-sheet/`, seletor `app-tour-sheet`.

Puramente visual e sem conhecimento de quais sheets existem.

Puramente visual: não sabe quais sheets existem nem o que cada um faz.

| | |
|---|---|
| Inputs | `isOpen: boolean`, `titulo: string`, `subtitulo: string \| null = null`, `variante: 'sheet' \| 'adaptavel' = 'sheet'`, `travado: boolean = false`, `breakpoints: number[] = [0, 0.55]`, `initialBreakpoint: number = 0.55` |
| Output | `(fechado)` |
| Corpo | `<ng-content>` |
| Rodapé | `<ng-content select="[rodape]">`, opcional |

A API foi fechada contra os quatro consumidores — Cenas, TV-4, TV-5 e TV-6 —
e não só contra o Cenas; ver "A API contra os quatro consumidores".

O template é um `ion-modal` com `[breakpoints]` e `[initialBreakpoint]`
escritos **antes** de `[isOpen]`: o Ionic lê a altura inicial no momento de
apresentar, e a ordem das ligações é a ordem em que o Angular as escreve.
Invertidas, a primeira abertura sai na altura errada. (Aprendido no
`HotspotSheet`; o comentário de lá registra o sintoma.)

Um `header` com `<h2>{{ titulo }}</h2>` e, quando houver, um
`<p class="tour-sheet__sub">{{ subtitulo }}</p>`.

**Fechamento pelos três gestos** — scrim, arrasto e Esc — vem do `IonModal`. Os
três desembocam no mesmo `(didDismiss)`, que emite `(fechado)`. Não há caminho
de fechamento que não passe por ali.

**`travado`** alimenta o `canDismiss` do `IonModal`: com `true`, os três gestos
param de fechar. É `canDismiss` e não `backdropDismiss` de propósito — travar
só o scrim deixaria o Esc e o arrasto ativos, e o caso que pede isso (TV-5,
"Apagando...") é justamente aquele em que fechar no meio da requisição deixa a
tela em estado ambíguo. Um gesto que fecha é um gesto que fecha, venha de onde
vier.

**`variante`** decide a forma:

- `sheet` — bottom sheet com `breakpoints`, sempre. É o Cenas.
- `adaptavel` — bottom sheet abaixo de 768px, **modal centralizado de 480px**
  acima. Quem decide é a presença de `breakpoints`: com eles o Ionic desenha
  sheet, sem eles desenha modal centrado. É o TV-5, que pede exatamente esse
  par.

O corte de 768px espelha o `TW_MOBILE_QUERY` (`max-width: 767px`) que o wizard
já usa. O arquivo de lá está congelado e é do domínio do wizard, então o
`tour-sheet` tem o seu, com o mesmo valor e um comentário apontando para o
outro — se um dia o corte mudar, muda nos dois.

**Grabber**: o Ionic desenha o handle sozinho quando há `breakpoints`. Ou seja,
ele aparece no bottom sheet e some sozinho no modal centrado do desktop, que é
o certo — não há o que arrastar num diálogo centralizado.

**O rodapé é um slot separado, não parte do `ng-content`.** TV-5 empilha botões
no fim do sheet e TV-6 é uma lista rolável; botão dentro do corpo rola junto e
sai da tela justamente quando é preciso. O slot fica fora da área rolável.

### 2. `TourSheetStore` — o coordenador

`inner-view-client/src/app/components/tour-sheet/tour-sheet.store.ts`,
`providedIn: 'root'`.

```
aberto: Signal<string | null>
abrir(id: string): void
fechar(): void
```

Um `signal` único. `abrir('medidas')` com `'cenas'` aberto **substitui** o
valor — não existe estado em que dois sheets estejam abertos, porque não há
onde guardar o segundo. O critério "abrir um segundo sheet não empilha" fica
verdadeiro por construção, e o teste apenas confirma.

**Um `signal`, e não uma pilha**: nenhum dos quatro sheets do sprint abre
outro. Sem navegação entre sheets não há para onde "voltar", e uma pilha
inventaria um botão de volta que nenhuma tela pede. Se um ticket futuro
precisar, `abrir()` vira `push()` — mas aí "substitui o atual" muda de sentido
e é decisão de produto, não refatoração.

Consumidores ligam `[isOpen]="store.aberto() === 'cenas'"`. TV-4/5/6 são
arquivos novos que não editam nem o shell nem o store.

**Por que separado do shell** (decidido em conversa, alternativas descartadas):
um serviço imperativo tipo `ModalController` resolveria "um por vez" de graça,
mas apagaria a ligação declarativa do template e faria todo teste de consumidor
virar mock de serviço. Um store com união de tipos (`'cenas' | 'medidas'`) e um
host único tornaria o empilhamento impossível de escrever, mas faria cada
ticket novo editar o shell — e TV-4, TV-5 e TV-6 colidiriam no mesmo arquivo.

### 3. `CenasSheetComponent` — o primeiro consumidor

`inner-view-client/src/app/components/cenas-sheet/`, seletor `app-cenas-sheet`.

| | |
|---|---|
| Inputs | `cenas: Panorama[]`, `atualId: string \| null` |
| Output | `(selecionada: Panorama)` |

Envolve o `app-tour-sheet` com `titulo` = `TOUR_SHEET.CENAS.TITULO` ("Cenas do
tour") e `subtitulo` = a contagem.

**A grade**: 2 colunas, `gap` de 8px, cards de **96px** de altura,
`max-height: 340px` no contêiner rolável com `overflow-y: auto`.

**O card** é um `<button>`, não uma `<div>` com click: precisa de foco por
teclado e de papel de controle. Miniatura via
`urlDoPreview(cena.id, 'treated', { largura: 320 })` — 320 porque num telefone
de 390px cada card tem ~165px de largura, e 320 cobre DPR 2 sem desperdício.
Nome do cômodo por cima, com ellipsis.

**Badge ATUAL** no card cuja `cena.id === atualId`. É badge visual **e**
`aria-current="true"` no botão: um leitor de tela não vê a pílula.

**Selecionar** emite `(selecionada)` e então chama `store.fechar()`, nessa
ordem. Quem fecha é o `CenasSheetComponent`, não o consumidor: fechar ao
escolher é regra deste sheet, e deixá-la com quem escuta o evento faria cada
usuário futuro reimplementá-la (e um deles esqueceria).

**Ordem dos cards**: a mesma do tour — `panorama.order` crescente, igual ao que
o `panoramic-viewer` usa em `atualizarNav()`. Duas listas das mesmas cenas em
ordens diferentes seria um bug percebido como aleatoriedade.

### 4. Gatilho

Um botão em `inner-view-page.page.html`, junto dos que já existem no
`headerActions` do viewer (upload, download, hotspots, excluir). Mesmo padrão
visual: `<button class="viewer-action">` com ícone e `aria-label` traduzido.

Chama `tourSheet.abrir('cenas')`.

**A ligação com o viewer já existe e não precisa de API nova.**
`PanoramicViewerComponent` expõe `irPara(id: string)` público e o campo
`idAtual`. A página pega o componente por `@ViewChild` e:

- alimenta `[cenas]` com `tour.panoramas` e `[atualId]` com `viewer.idAtual`;
- no `(selecionada)`, chama `viewer.irPara(cena.id)`.

**Não** desenha barra inferior — isso é de outro ticket. Quando a barra
existir, é mover o clique.

**Consequência conhecida, aceita em conversa**: o `panoramic-viewer` já tem uma
navegação de ambientes própria (`roomNav`, ligada por padrão e ativa nesta
página). Com o sheet, o viewer passa a ter **duas** listas de cenas ao mesmo
tempo. Substituir o `roomNav` foi oferecido e recusado para não crescer um PR
que é prioridade de merge — mas a duplicação é real e vai precisar de um
ticket que resolva qual das duas fica.

**Aviso de colisão para o sprint**: o `roomNav` não é neutro daqui para a
frente. TV-4 pede que `?controles=0` no `EmbedPage` repasse `[roomNav]="false"`
— ou seja, TV-4 mexe nesse input. Este ticket **não** toca nele; só passa a
existir uma segunda lista ao lado. Quem for fazer TV-4 precisa saber que o
sheet Cenas não obedece a `?controles=0`, porque não é o `roomNav`.

## A API contra os quatro consumidores

Uma abstração validada por um consumidor só quebra no segundo. Os escopos de
TV-4, TV-5 e TV-6 foram lidos antes de fechar esta API, e dois deles
derrubaram suposições:

| Consumidor | O que exige | Como o shell atende |
|---|---|---|
| **Cenas** (este) | grade rolável; fecha ao escolher | `ng-content` + o próprio sheet chama `fechar()` |
| **TV-4** Incorporar | segmented control, bloco de código, toggle; **"Copiar" NÃO fecha** | `ng-content`; o shell não fecha por conta própria em nada |
| **TV-5** Apagar | sheet no mobile **e diálogo de 480px no desktop**; botões empilhados no fim; **travado durante "Apagando..."** | `variante="adaptavel"`, slot `[rodape]`, `[travado]` |
| **TV-6** Gerenciar | lista com divisores e chevron | `ng-content` |

As duas suposições derrubadas, registradas porque são o motivo de a API ter
esta forma:

**"Sheet fecha ao escolher" não é regra do shell.** Parecia óbvio no Cenas.
TV-4 diz o contrário com todas as letras — copiar código mantém o sheet
aberto. Se a regra tivesse subido para o shell, TV-4 começaria removendo-a, e
o primeiro consumidor teria ditado a API para os outros três. Fechar ao
escolher fica dentro do `CenasSheetComponent`.

**"Sheet é sempre bottom sheet" também não.** TV-5 pede diálogo centralizado
de 480px no desktop com o mesmo conteúdo. Sem `variante`, TV-5 escreveria um
segundo shell — e aí existiriam dois, divergindo.

O que **não** entrou, por nenhum dos quatro pedir: pilha de sheets, botão de
voltar, sheet em tela cheia, e formulário com teclado de celular (o único
campo do sprint é o toggle do TV-4, que não abre teclado).

## Acessibilidade

`role="dialog"` e `aria-modal="true"` vêm do `IonModal`.

**O nome acessível não sai por `aria-labelledby`, e isso é uma correção ao
escopo.** O nó do diálogo vive no shadow DOM do Ionic; o `<h2>` do título vive
na luz. IDREF não atravessa fronteira de shadow, então `aria-labelledby`
apontando para o `<h2>` não resolve nada — nem no host, que é um nó genérico e
nomeá-lo deixa o diálogo anônimo do mesmo jeito.

O que funciona, e é o que o `HotspotSheet` já faz: no `(didPresent)`, achar
`.modal-wrapper` no `shadowRoot` e escrever `aria-label` literal com o texto do
título. Escrito no próprio handler, não só por `effect`: o `effect` só corre na
próxima detecção de mudanças, e o foco entra no diálogo no instante do
`didPresent` — um frame de diálogo anônimo é justamente o frame que o leitor
lê. Um `effect` mantém o nome em dia se o título mudar com o sheet aberto.

Risco registrado: se o Ionic renomear `.modal-wrapper`, o nome some em
silêncio. Nada quebra visualmente; o teste de a11y é que denuncia.

**Devolução do foco ao gatilho** é do `IonModal` e não precisa de código — mas
precisa de teste, porque é critério de aceite e porque é comportamento de
biblioteca que uma atualização pode mudar.

## Cor de fundo: `--tour-bg`, não um token novo

O escopo pede `#0D1622`. A paleta tem `--tour-bg: #0b1220`. **O contraste entre
os dois é 1,03:1** — indistinguível a olho nu. São a mesma cor.

Criar um primitivo L0 para um hex que ninguém consegue diferenciar de um
existente é inchaço de token, exatamente o que o `_palette.scss` foi escrito
para impedir ("um piso de primitivos é o que impede a terceira [vermelha]"), e
ainda teria que passar no `palette.contract.spec.ts`.

Decidido: `--background: var(--tour-bg)` no `ion-modal`.

Contraste conferido sobre esse fundo: `--tour-text` (#e2e8f0) dá **14,75:1**,
folgado no AA de 4,5:1 para texto normal.

Se o designer quiser exatamente `#0D1622`, é adicionar um primitivo e trocar a
referência — uma linha em cada arquivo. Fica registrado que ninguém verá
diferença.

## Raio, sombra e scrim

Seguindo o `HotspotSheet`, os valores são repassados às variáveis do `IonModal`
em vez de reescritos:

- `--border-radius: 26px` (valor do escopo).
- `--backdrop-opacity: 1`, com a cor inteira vindo do `::part(backdrop)` — o
  scrim do Ionic é preto puro com opacidade, então a opacidade vai a 1 e a cor
  sai do nosso lado.
- **Blur no scrim**: `backdrop-filter: blur(8px)` no `::part(backdrop)`, com
  `background: rgba(var(--tour-bg-rgb), 0.55)` por baixo. O `--tour-bg-rgb` já
  existe na paleta exatamente para composições com alfa.

## Breakpoints

`[0, 0.55]`, inicial `0.55`.

O `0` é o que permite arrastar para baixo até fechar; sem ele o sheet trava na
menor parada e o arrasto deixa de ser um gesto de fechamento — o critério de
aceite exige que seja.

Só uma parada útil porque a grade é travada em `max-height: 340px`: uma parada
alta mostraria sheet vazio abaixo do conteúdo. O `HotspotSheet` usa
`[0, 0.5, 0.9]` porque o conteúdo dele cresce sem teto; aqui não cresce.

**Este é o valor que a `04-sheets.md` definiria e que foi escolhido aqui.**

## Testes

Contra os critérios de aceite, um a um:

| Critério | Teste |
|---|---|
| fecha por scrim | dispara o `didDismiss` do modal com `role: 'backdrop'`; `(fechado)` emitiu |
| fecha por arrasto | `didDismiss` com `role: 'gesture'`; mesma asserção |
| fecha por Esc | `keydown` de `Escape`; mesma asserção |
| foco volta ao gatilho | guarda `document.activeElement` antes de abrir, fecha, compara |
| segundo sheet não empilha | `abrir('a')` → `abrir('b')`; `aberto()` é `'b'` e só um sheet responde `isOpen` |
| 1 cena | grade com um card, sem rolagem, sem quebra |
| 30 cenas | 30 cards, contêiner com `max-height` e `scrollHeight > clientHeight` |

Mais: badge ATUAL só no card certo e com `aria-current`; selecionar emite **e**
fecha; a contagem do subtítulo bate com `cenas.length`.

E, sobre a API que existe para TV-4/5/6 e que o Cenas não exercita — sem
teste, ela chega no próximo ticket sem nunca ter rodado:

| Comportamento | Teste |
|---|---|
| `travado` bloqueia os três gestos | com `[travado]="true"`, `canDismiss` recusa; o sheet segue aberto nos três |
| `variante="adaptavel"` no mobile | abaixo de 768px o `ion-modal` recebe `breakpoints` |
| `variante="adaptavel"` no desktop | acima de 768px vai **sem** `breakpoints` e com largura de 480px |
| slot `[rodape]` | conteúdo projetado no rodapé fica fora do contêiner rolável |

Verificação visual por screenshot no viewer rodando, no padrão já usado nesta
branchada — abrindo o sheet de verdade e conferindo grade, raio e scrim.

## i18n

Bloco novo `TOUR_SHEET` em `pt.json` e `en.json`:

| Chave | pt | en |
|---|---|---|
| `TOUR_SHEET.CENAS.TITULO` | "Cenas do tour" | "Tour scenes" |
| `TOUR_SHEET.CENAS.CONTAGEM` | "{{n}} cenas" | "{{n}} scenes" |
| `TOUR_SHEET.CENAS.UMA` | "1 cena" | "1 scene" |
| `TOUR_SHEET.CENAS.ATUAL` | "ATUAL" | "CURRENT" |
| `TOUR_SHEET.CENAS.ABRIR` | "Ver cenas do tour" | "View tour scenes" |

`CONTAGEM` e `UMA` separadas porque "1 cenas" é erro visível, e o ngx-translate
não faz plural sozinho.

## Fora do escopo (registrado, não feito)

- **Barra inferior do viewer.** O gatilho fica no header do viewer; quando a
  barra existir, é mover o clique.
- **Migrar o `HotspotSheetComponent`** para o shell novo. Provaria o genérico
  com dois consumidores de verdade, mas mexe em código estável do wizard e
  engorda um PR que é prioridade de merge. Fica como ticket próprio.
- **TV-4, TV-5 e TV-6.** Este ticket entrega a API que eles consomem, não eles.
- **Substituir o `roomNav`** que o `panoramic-viewer` já tem ligado por padrão.
  Afetaria o embed e cresceria o PR.
