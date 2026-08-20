# IM-45 — A home sugere a criação de um tour

> Spec de desenho, validada em conversa antes de qualquer código.
> Branch: `IM-45-quando-a-conta-do-usuario-nao-possui-tour-a-home-deve-sugerir-a-criacao-de-um-tour`
> Base: `be19a5e`. Data: 2026-08-20.
> Escopo tocado: **apenas `inner-view-client/`**. Nenhuma alteração em `server-api/`.

## O pedido

"Quando a conta do usuário não possui tour, a home deve sugerir a criação de um tour."

O enunciado esconde três decisões que mudam o que se constrói. Elas foram
levantadas na conversa e estão registradas abaixo com o motivo — porque cada uma
vai ser perguntada de novo daqui a alguns meses.

## O que existe hoje

Levantado no código, não suposto:

- **A home lista imóveis, não tours.** `home.page.ts` chama
  `listProperties({ limit: 100 })` e entrega o resultado a `<app-inner-view-list>`.
  O tour aparece como `Property.virtualTour?: { id, status } | null`.
- **Não existe estado vazio.** `inner-view-list.component.html` é um `*ngFor`
  seco: zero itens renderiza uma grade vazia, sobrando a busca e o FAB numa
  página em branco.
- **Não existe estado de carregando nem de erro.** O `error` do `subscribe` só
  faz `console.error`. As três causas de "lista vazia" — carregando, erro e
  genuinamente vazia — são hoje indistinguíveis.
- **`HOME` no i18n tem uma única chave**, `SEARCH_PLACEHOLDER`.
- **O card já distingue passivamente.** `inner-view-card` tem três
  `@if (item.virtualTour)`: sem tour ele mostra `photo-placeholder` com ícone de
  casa, esconde o badge `360°` e esconde o botão de compartilhar. Falta a ação.
- **O card não é compartilhado.** `inner-view-card` é usado só por
  `inner-view-list`, que é usado só pela `home`. Alterá-lo não alcança outra tela.
- **A listagem sempre devolve o campo.** `list-properties.service.ts:22` traz
  `virtualTour: { select: { id: true, status: true } }` no select, então o Prisma
  devolve objeto ou `null` — nunca `undefined`. `!p.virtualTour` é confiável
  **nesta rota**. O `undefined` só aparece na resposta do `createProperty`, que é
  o ramo morto registrado nas notas do Sprint 1.

## Decisões

### 1. Dois casos, com mensagens distintas — DECIDIDO

"Não possui tour" e "não possui imóvel" são condições diferentes, e a home mostra
imóveis. Ambas entram, com tratamentos separados:

- conta sem nenhum imóvel → onboarding;
- conta com imóveis e nenhum deles com tour → faixa informativa sobre a lista.

O segundo caso é o que provavelmente mais importa: é o corretor que cadastrou
imóveis e nunca fotografou. O próprio código chama esse estado de órfão, no
comentário do `publish()` do `TourDraftStore`.

### 2. Carregando e erro entram no escopo — DECIDIDO

Enquanto a tela em branco era o resultado das três causas, a ambiguidade passava
despercebida. No instante em que "você ainda não tem nenhum tour" ocupa esse
lugar, ela **pisca em toda abertura da home** e **mente quando a API cai** —
dizendo "crie seu primeiro tour" para quem tem trinta.

Ou seja: o ticket, entregue no escopo estrito, produziria um defeito. Os três
estados viram explícitos.

### 3. A sugestão do caso "imóveis sem tour" leva ao imóvel — DECIDIDO

**O wizard sempre cria um imóvel novo.** `publish()` chama `createProperty()`;
não existe caminho para anexar tour a imóvel existente. O guard
`publishedPropertyId` só evita duplicar entre tentativas da mesma sessão.

Levar esse caso para `/tour/novo` faria o corretor que já tem "Casa da Vila" sem
tour **cadastrar uma segunda "Casa da Vila"**.

O destino é `/inner-view-page/:id`. Aquela página já trata o caso: o
`savePanorama()` chama `createTour(this.property.id, [...])` quando `this.tour` é
nulo, anexando ao imóvel existente. E ela tem captura 360 guiada
(`captureSupported()`) e edição de hotspots — não é um fluxo degradado.

Consequência aceita: os dois casos têm destinos diferentes. Conta zerada vai ao
wizard (`/tour/novo`), que pode criar imóvel; imóvel sem tour vai à página do
imóvel, que não pode. Não é inconsistência gratuita — é que só um dos dois tem
imóvel para criar.

**O certo a longo prazo** é o wizard aceitar `propertyId` e pular a etapa 3.
Fica fora deste ticket (ver *Fora de escopo*). Quando existir, muda-se o destino
do botão e o resto do código da home fica igual.

### 4. A ação mora no card, não na faixa — DECIDIDO

"2 imóveis sem tour" é plural. Um botão único na faixa teria de escolher um
imóvel pela pessoa. O botão vai para cada card sem tour, onde o imóvel tem nome e
foto, e a faixa apenas informa.

### 5. O botão navega com intenção — DECIDIDO

`onCardClick()` já leva a `/inner-view-page/:id`. Um botão que apenas navegue
iria exatamente para onde o clique no card já vai — seria rótulo, não ação.

O botão navega com `state: { property, action: 'add-tour' }`, e o
`inner-view-page` abre o seletor de arquivo / captura ao chegar.

Router state, e não query param, por duas razões: o `onCardClick` já usa
`state: { property }`, então é o mesmo mecanismo; e um refresh não deve reabrir o
seletor — com query param, reabriria.

### 6. Qualquer `virtualTour` conta como "tem tour" — DECIDIDO

`VirtualTourStatus` tem default `DRAFT` (`schema.prisma:152`). Uma regra que
exigisse `PUBLISHED` marcaria como "sem tour" todo tour recém-criado. A regra é a
existência do vínculo, não o status dele.

Consequência conhecida: imóvel com tour `ARCHIVED` conta como "tem tour" e não
recebe o botão. É o comportamento correto — o tour existe e pode ser
desarquivado; oferecer "criar tour" ali sugeriria criar um segundo.

## Os seis estados

| # | Condição | O que a home mostra |
|---|---|---|
| 1 | requisição em curso | placeholder de carregando |
| 2 | requisição falhou | mensagem + **Tentar de novo** |
| 3 | `properties.length === 0` | onboarding + **Criar meu primeiro tour** → `/tour/novo` |
| 4 | tem imóveis, nenhum com `virtualTour` | faixa informativa + lista (cards sem tour com botão) |
| 5 | tem imóveis, algum com tour | lista (cards sem tour com botão) |
| 6 | busca ativa e nada casou | "nenhum resultado para X" |

O estado 6 é o que erra com mais facilidade: sem ele, buscar um termo inexistente
numa conta cheia mostraria "crie seu primeiro tour". Ele se distingue do 3 por
haver texto na busca — não por a lista estar vazia.

Os estados 4 e 5 diferem apenas pela faixa. O botão do card depende de
`!item.virtualTour`, e não do estado da página, então vale nos dois.

**A faixa exige que NENHUM imóvel tenha tour.** Conta com 9 imóveis sem tour e 1
com tour não vê faixa — vê os 9 botões nos cards. É o literal do ticket ("a conta
não possui tour") e evita uma faixa permanente na conta que está apenas em dia
parcial. Os cards continuam cobrindo esses imóveis, então nada fica sem saída.

### A moldura da página por estado

Hoje a busca e o FAB são renderizados incondicionalmente. Com estados explícitos
isso passa a produzir absurdos, então ambos ganham condição:

| view | busca | FAB |
|---|---|---|
| `loading` | oculta | oculto |
| `error` | oculta | oculto |
| `empty` | oculta | **oculto** |
| `no-results` | **visível** | visível |
| `list` | visível | visível |

Duas razões, não uma:

- **Busca oculta em `empty`**: campo de busca sobre acervo vazio não tem o que
  buscar. Mas ela é **obrigatória** em `no-results` — é onde o termo digitado
  vive, e escondê-la deixaria a pessoa sem como limpar a busca.
- **FAB oculto em `empty`**: o placeholder já traz "Criar meu primeiro tour", e o
  FAB é um `+` que vai para o mesmo `/tour/novo`. Dois botões para a mesma ação,
  um deles sem rótulo, competindo na mesma tela — e o sem rótulo é o mais
  chamativo. Some o `+`, fica a frase.

## Arquitetura

### `HomePage` — dona do estado, e de mais nada

```ts
type HomeView = 'loading' | 'error' | 'empty' | 'no-results' | 'list';

status     = signal<'loading' | 'error' | 'ready'>('loading');
properties = signal<Property[]>([]);
query      = signal('');

filtered      = computed(() => /* mesmo filtro que hoje vive em onSearch */);
semTour       = computed(() => this.properties().filter(p => !p.virtualTour));
mostrarFaixa  = computed(() =>
  this.view() === 'list' && this.semTour().length === this.properties().length);
```

**A precedência do `view` é parte do contrato**, porque duas condições podem
valer ao mesmo tempo:

```ts
view = computed<HomeView>(() => {
  if (this.status() === 'loading') return 'loading';
  if (this.status() === 'error')   return 'error';
  if (this.properties().length === 0) return 'empty';       // vence a busca
  if (this.filtered().length === 0)   return 'no-results';
  return 'list';
});
```

A ordem importa em um caso concreto: conta sem nenhum imóvel **com texto na
busca**. Vale `properties.length === 0` e `filtered.length === 0` ao mesmo tempo.
Ganha `empty` — quem não tem imóvel algum precisa do onboarding, não de "nenhum
resultado para xyz", que sugeriria que existe acervo e o termo é que não casou.

`filtered` como `computed` substitui o `onSearch` que hoje muta `filteredItems` à
mão — duas listas mantidas em paralelo por um handler é exatamente o tipo de
estado que sai de sincronia quando um terceiro caminho mexe em `properties`.

`view` concentra a decisão num lugar só, testável sem DOM.

**Estados 4 e 5 são o mesmo `view` (`'list'`)**, separados por `mostrarFaixa`. A
faixa não é um sexto valor do enum porque ela não substitui a lista: convive com
ela. Ela é calculada sobre `properties` inteiro, e não sobre `filtered`, para não
aparecer e sumir conforme a pessoa digita na busca.

### `app-home-placeholder` — componente novo, de apresentação

Ícone + título + texto + ação opcional. Serve aos estados 1, 2, 3 e 6 em quatro
configurações. Sem ele, quatro blocos de markup quase iguais no template da home.

É o idioma que o wizard já usa (`tw-hp__empty`, `tw-viewer__empty`) e que o
`inner-view-page` já usa (`loading-container` para carregando, erro e sem-tour).

Contrato: `@Input() icon`, `title`, `text`, `actionLabel?`; `@Output() action`.
Não injeta `Router` nem serviço — quem navega ou refaz a chamada é a `HomePage`,
para o componente continuar sendo desenho e nada mais.

**A ação do estado 2 refaz a requisição**, chamando o mesmo método do `ngOnInit`
— que por isso é extraído para `carregar()`, com `status.set('loading')` na
entrada. Não é `window.location.reload()`: recarregar a página perde o texto da
busca e pisca o app inteiro para um erro que é de uma chamada só.

### A faixa do estado 4

Componente próprio, `app-home-no-tour-banner`, entre a barra de busca e a lista —
antes do conteúdo que ela descreve, e fora do `app-inner-view-list`, que não muda.

Informativa, sem ação: a ação mora nos cards (decisão 4). Recebe a contagem por
`@Input` e renderiza `HOME.NO_TOUR_BANNER`.

Não é o `app-home-placeholder` porque não é placeholder de nada — não ocupa o
lugar de conteúdo ausente, acompanha conteúdo presente. Compartilhar o componente
faria a semântica dele virar "bloco de texto centralizado", que não é conceito.

### `inner-view-list` — não muda

Recebe itens e desenha itens. Não pode decidir o estado vazio porque não sabe
distinguir "vazio por falta de dado" de "vazio por filtro" de "vazio por erro" —
ele só recebe `items`. Dar-lhe essa responsabilidade exigiria passar o estado da
página para dentro dele, borrando o propósito.

### `inner-view-card` — ganha o botão

Renderizado quando `!item.virtualTour`. Precisa de `stopPropagation` no clique,
porque o `ion-card` inteiro é clicável (`button="true"` + `(click)="onCardClick()"`) —
sem isso o handler do card dispara junto e a navegação com intenção é substituída
pela navegação sem intenção.

É um botão dentro de um card que já é botão. O aninhamento é o que o card já faz
com o coração e a estrela (`heart-btn`, `meta-action`), então segue o padrão da
casa — mas o `aria-label` precisa nomear o imóvel (`"Criar tour para {{título}}"`),
porque num leitor de tela a lista vira uma sequência de "Criar tour" idênticos.

### `inner-view-page` — lê a intenção

Ao chegar, se `history.state.action === 'add-tour'`, dispara o mesmo caminho do
botão "Enviar primeira imagem" que já existe. Cerca de cinco linhas, no
`ngOnInit`, depois de a `property` estar resolvida.

## Acessibilidade

O `AGENTS.md` exige Lighthouse a11y ≥ 90, contraste WCAG AA e alvos ≥ 44px.
O que este ticket precisa cumprir:

- **Botão do card ≥ 44px de alvo.** O `heart-btn` e o `meta-action` do card já
  são menores que isso em área visual; o botão novo não repete o problema.
- **`aria-label` que nomeia o imóvel**, pelo motivo acima.
- **A troca de estado precisa ser anunciada.** Sair de `loading` para `error` sem
  `aria-live` deixa quem usa leitor de tela num silêncio indistinguível de
  "ainda carregando". O `app-home-placeholder` leva `role="status"`
  (`aria-live="polite"`), que cobre os quatro estados que ele renderiza.
- **Foco no retry.** "Tentar de novo" que volta ao estado de erro deixa o foco
  órfão quando o botão é destruído e recriado. O foco volta ao botão após a nova
  falha — mesmo problema que o §13 das notas da Frente B resolveu com
  `afterNextRender`.

## i18n

Todas as strings passam por `ngx-translate`, em `pt.json` **e** `en.json`.
Chaves novas em `HOME`:

`LOADING`, `ERROR_TEXT`, `ERROR_RETRY`, `EMPTY_TITLE`, `EMPTY_TEXT`, `EMPTY_CTA`,
`NO_TOUR_BANNER`, `NO_TOUR_BANNER_ONE`, `CARD_CREATE_TOUR`, `NO_RESULTS`.

`NO_TOUR_BANNER` e `NO_RESULTS` recebem parâmetro (contagem e termo buscado).

**Plural segue a convenção que o projeto já tem**, e não interpolação crua: o
sufixo `_ONE` escolhido no TypeScript, como em `SCENES_COUNT_ONE` e
`WARN_RATIO_ONE` (`step-images.component.ts:46`, `tour-summary.component.ts:31`):

```ts
chaveDaFaixa = computed(() =>
  this.semTour().length === 1 ? 'HOME.NO_TOUR_BANNER_ONE' : 'HOME.NO_TOUR_BANNER');
```

Sem isso a faixa diz "1 imóveis ainda não têm tour" na conta com um imóvel só —
que é justamente a conta mais provável de ver essa faixa.

`NO_RESULTS` não precisa de `_ONE`: ele descreve zero, que é plural nos dois
idiomas.

O vocabulário segue o de `INNER_VIEW.NO_TOUR` ("ainda não possui imagens 360°")
para as duas telas não se contradizerem: a home manda para lá, e ler duas
formulações diferentes do mesmo estado em dois cliques faz duvidar de qual é.

## Testes

`home.page.spec.ts` hoje só afirma "should create", mas o TestBed **já vem
provisionado** com `provideHttpClient`, `provideHttpClientTesting`,
`provideRouter` e `provideTranslateService`. Os testes dirigem pelo
`HttpTestingController` — respondendo, atrasando ou derrubando a chamada de
`/properties` — e não por um `PropertyService` mockado: o harness que existe já
alcança os três `status`, e trocá-lo por um dublê de serviço custaria mais e
cobriria menos.

Passa a cobrir os seis estados, incluindo os dois que a própria feature poderia
introduzir errados:

- a sugestão **não** aparece enquanto `status === 'loading'`;
- a sugestão **não** aparece quando `status === 'error'`;
- busca sem resultado mostra o estado 6, **não** o 3;
- conta vazia **com texto na busca** mostra o estado 3, **não** o 6 (a
  precedência do `view`, que é a regra mais fácil de inverter sem perceber);
- imóvel com tour `DRAFT` conta como "tem tour";
- faixa com um imóvel usa `NO_TOUR_BANNER_ONE`, e com dois usa a chave plural;
- faixa **não** aparece quando um dos imóveis tem tour;
- faixa **não** some ao digitar na busca (ela lê `properties`, não `filtered`);
- busca oculta em `empty` e **visível** em `no-results`;
- FAB oculto em `empty`;
- "Tentar de novo" refaz a chamada e volta a `loading` (verificável pelo
  `HttpTestingController` recebendo uma segunda requisição).

`inner-view-card.component.spec.ts` cobre o botão aparecendo apenas quando não há
tour, e não disparando o `onCardClick` junto.

`npm run lint` e `npm test` limpos — é o DoD que o `AGENTS.md` já exige.

## Fora de escopo

Registrado para não virar discussão no meio do caminho.

1. **Wizard aceitar `propertyId`** e pular a etapa 3. É o certo a longo prazo e o
   único caminho que dá wizard completo sobre imóvel existente. Ticket próprio:
   mexe em `TourDraftStore`, `publish()`, stepper e barra de progresso, e o
   `tour-wizard.model.ts` está marcado CONGELADO no plano do Sprint 3.
2. **Strings cravadas em `inner-view-card`** — "Aluguel", "Venda", "Curtir"
   violam a regra de i18n do `AGENTS.md`. Pré-existentes; não são deste ticket e
   não se corrigem de passagem.
3. **Paginação.** A home pede `limit: 100` e ignora `total`/`pages`. Conta com
   mais de 100 imóveis já hoje mostra uma lista truncada em silêncio.
4. **Ordenar ou destacar os imóveis sem tour** dentro da lista.
5. **Dispensar a faixa** (persistir "não mostrar de novo").

## Riscos

- **O estado 6 depende de a busca ser client-side.** Hoje `onSearch` filtra em
  memória sobre os 100 carregados. Se a busca virar server-side, o estado 6 passa
  a depender da resposta e a distinção com o estado 3 muda de lugar.
- **`action: 'add-tour'` é acoplamento fraco entre duas telas.** Uma string em
  router state não é verificada por tipo. Mitigação: exportar a constante do lado
  do `inner-view-page`, que é quem a consome, e importá-la no card.
