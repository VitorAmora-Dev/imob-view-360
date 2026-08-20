# Filtros de pesquisa de imóveis na home

> Spec de desenho, validada em conversa antes de qualquer código.
> Branch: `Criar-filtros-de-pesquisa-de-imóveis-na-página-principal`
> Base: `b196c00` (main, já com o IM-45 mesclado). Data: 2026-08-20.
> Escopo tocado: **`inner-view-client/` e `server-api/`**.

## O pedido

Uma área de filtros na página principal, para que o usuário encontre imóveis que
correspondem ao que procura — apartamentos para alugar, num bairro, com N
quartos. Os filtros pedidos no ticket: tipo, finalidade, mínimo de quartos,
localização e limpar tudo.

## Escopo — a diferença entre o pedido e o entregue

**O filtro de quartos sai desta entrega.** Não existe campo de quartos em lugar
nenhum do sistema: `prisma/schema.prisma` não tem, e o único acerto de busca por
"room" no repositório é `Panorama.roomName`, que é o nome do ambiente de um
panorama. Entregá-lo exigiria migration, três DTOs, um campo novo no wizard — e
uma decisão sobre o acervo já cadastrado, que ficaria inteiro com `bedrooms`
nulo e portanto invisível a qualquer filtro de "mínimo de quartos". Isso é um
ticket próprio, com discussão própria. Os outros quatro filtros — tipo,
finalidade, localização e limpar — vão nesta entrega inteiros.

Os critérios de aceite que mencionam quartos vão junto com o campo.

## O que existe hoje

Levantado no código, não suposto:

- **A home filtra em memória.** `home.page.ts` pede `listProperties({ limit: 100 })`
  uma vez e filtra o resultado com um `computed` sobre título, descrição e
  cidade. Quem tem mais de cem imóveis busca dentro de cem — sem aviso.
- **A API já filtra de verdade.** `ListPropertiesSchema` aceita `type`,
  `purpose`, `status`, `city`, `state`, `district`, `priceMin`, `priceMax` e
  `search`, e `list-properties.service.ts` monta o `where` com todos eles, com
  `count` na mesma transação — `total` na resposta é a contagem real dos que
  casam, não o tamanho da página.
- **`PropertyService.listProperties` já repassa quase tudo**: `page`, `limit`,
  `search`, `status`, `type`, `purpose`, `city`, `state`. Falta `district`, e
  falta o parâmetro novo desta spec.
- **Os rótulos traduzidos dos valores já existem**: `UPLOAD.TYPE.*` (Casa,
  Apartamento, Terreno, Comercial, Rural, Escritório) e `UPLOAD.PURPOSE.*`
  (Venda, Aluguel, Venda ou Aluguel), usados hoje pelos `select` da etapa 1 do
  wizard.
- **As constantes dos valores existem em `tour-wizard/tour-wizard.model.ts`**:
  `PROPERTY_TYPES`, `PROPERTY_PURPOSES` e os tipos correspondentes.
- **A home é reusada entre navegações.** O app usa `<ion-router-outlet>` com
  `IonicRouteStrategy`. Mudar apenas os query params de `/home` não recria o
  componente, e `ngOnInit` não dispara de novo. Isto é a razão de uma decisão
  inteira mais abaixo.
- **O bottom sheet tem padrão estabelecido.** `hotspot-sheet.component` usa
  `IonModal` com `breakpoints`/`initialBreakpoint`, e `hotspots/media.ts` expõe
  `isMobileViewport()` — um sinal de `matchMedia` que solta o listener no
  destroy. O comentário de lá registra por que o sheet precisa **não existir** no
  desktop, e não apenas ficar invisível: um `IonModal` escondido por CSS continua
  prendendo o foco e respondendo ao Esc.
- **A busca não tem debounce nem `[value]`.** `ion-searchbar` dispara `ionInput`
  a cada tecla, o que era grátis enquanto o filtro era em memória.
- **O backend já tem testes de integração da listagem**, contra Postgres de
  verdade: `test/tenant-properties.spec.ts` e `test/paginacao-estavel.spec.ts`.
  Eles instanciam `ListPropertiesService` com o cliente de teste, sem subir o
  `AppModule`. O `globalSetup` cria e migra o banco; `yarn test:local` sobe o
  container antes.

## Decisões

### 1. A filtragem acontece no servidor — DECIDIDO

Filtrar em memória sobre `limit: 100` mente em silêncio: o imóvel existe, casa
com o filtro, e não aparece porque ficou fora dos cem primeiros. A API já sabe
filtrar e já devolve `total` contado no banco. O cliente passa a mandar os
critérios e a exibir o que voltar.

Consequência aceita: cada mudança de filtro é uma requisição. Isso puxa duas
outras decisões — debounce (§6) e o estado de carregando (§8).

### 2. `purpose` passa a incluir `SALE_OR_RENT` — DECIDIDO

Hoje o `where` usa igualdade exata. Filtrar "Aluguel" esconde todo imóvel
marcado como "Venda ou Aluguel", que **também** está para alugar. Do ponto de
vista de quem procura, isso é resultado faltando.

```ts
...(purpose && {
  purpose: purpose === 'SALE_OR_RENT'
    ? 'SALE_OR_RENT'
    : { in: [purpose, 'SALE_OR_RENT'] },
}),
```

Filtrar explicitamente por "Venda ou Aluguel" continua sendo igualdade — quem
escolhe esse valor está perguntando por essa marcação, não pelo conjunto todo.

Isto muda o comportamento de um endpoint que já está no ar. É uma correção, não
uma quebra: nenhum consumidor pede menos resultados do que os corretos.

### 3. Um parâmetro `location` novo, que é um OU — DECIDIDO

O ticket pede "localização", uma caixa só. A API tem `city`, `state` e
`district` — e, pior, os três aninham dentro do mesmo objeto `address`, então
combinam com **E**: mandar os três com "Centro" pede um imóvel cuja cidade,
estado e bairro sejam todos "Centro". Não existe hoje jeito de perguntar "em
algum lugar chamado Centro".

Entra `location?: string` no schema, e no `where`:

```ts
...(location && {
  OR: [
    { address: { city:     { contains: location, mode: 'insensitive' } } },
    { address: { district: { contains: location, mode: 'insensitive' } } },
    { address: { state:    { contains: location, mode: 'insensitive' } } },
  ],
}),
```

**Armadilha:** `search` já usa `OR` no mesmo nível do objeto. Espalhar os dois
faz o segundo sobrescrever o primeiro — silenciosamente, sem erro de tipo. Os
dois precisam virar `AND: [{ OR: [...] }, { OR: [...] }]`. Isso vira teste, com
os dois preenchidos ao mesmo tempo.

`city`, `state` e `district` continuam existindo e intocados; são a API pública
e podem ter consumidor.

### 4. A URL é a fonte de verdade dos critérios — DECIDIDO

Não um sinal espelhado nela: os critérios **moram** nos query params, e a página
os lê. `?type=APARTMENT&purpose=RENT&location=Centro&q=cobertura`.

O mapa param → API: `type` → `type`, `purpose` → `purpose`, `location` →
`location` (§3), `q` → `search`. `status` continua sem ser enviado — o backend
já assume `AVAILABLE`, que é o comportamento de hoje e não muda aqui.

Isso resolve de uma vez três exigências do ticket — recarregar a página
preservando a pesquisa, compartilhar o link, e voltar de um imóvel com os
filtros intactos (o histórico do navegador restaura a URL, e com ela os
critérios). Nenhuma delas precisa de código próprio.

Duas consequências obrigatórias:

- **Ler `queryParamMap` como observable, não no `ngOnInit`.** Com
  `IonicRouteStrategy`, navegar de `/home?type=HOUSE` para `/home?type=LAND` não
  recria o componente. Um `ngOnInit` que lesse o snapshot uma vez congelaria os
  filtros na primeira montagem.
- **O `ion-searchbar` ganha `[value]`.** O IM-45 zerava `query` a cada
  `carregar()` justamente porque o campo não tinha `[value]`, e voltar com texto
  mostraria "nenhum resultado para zzz" sobre uma caixa visivelmente vazia. Com
  a URL mandando, o texto pode vir preenchido no primeiro render — o campo
  precisa refletir isso. A linha `this.query.set('')` sai junto com o motivo
  dela.

### 5. Navegação com `replaceUrl: true` — DECIDIDO

Cada mudança de filtro **substitui** a entrada de histórico em vez de empilhar
uma nova. Empilhando, o botão voltar do celular desfaria um filtro por vez, e
sair da home exigiria tantos toques quantos filtros a pessoa mexeu — o
comportamento vira uma armadilha, e ainda estraga o "voltar do imóvel preserva
os filtros", que passaria a voltar para um estado intermediário.

Trade-off aceito: não dá para desfazer um filtro pelo botão voltar. Desfazer é o
que os chips e o "Limpar filtros" fazem, visivelmente.

### 6. Debounce antes de navegar, não antes de requisitar — DECIDIDO

Os campos de texto — busca e localização — usam o `debounce` nativo do Ionic
(`ion-searchbar` e `ion-input` têm a propriedade; Ionic 8.8.9), em 400 ms. Tipo
e finalidade navegam no ato: são cliques discretos, e esperar depois de um
clique parece travamento.

O debounce fica **na navegação**, não na requisição. Debouncing a requisição com
a URL atualizada na hora deixaria a URL adiantada em relação ao que está na
tela; um link copiado no meio da digitação apontaria para um resultado que a
pessoa nunca viu. Com o debounce antes, uma navegação equivale a uma requisição,
sempre.

Não escrevemos teste para o temporizador do Ionic. Os testes cobrem o mapa
handler → navegação.

### 7. Requisições concorrentes se cancelam — DECIDIDO

O fluxo é `toObservable(criterios) → switchMap(→ listProperties)`. Sem
`switchMap`, uma resposta lenta de um critério antigo chega depois da rápida do
critério novo e sobrescreve a tela com o resultado errado — um defeito que só
aparece em rede ruim e é quase impossível de reproduzir depois.

### 8. Refiltrar não faz a moldura piscar — DECIDIDO

Este é o ponto onde a §1 quase produz um defeito. Hoje `mostrarMoldura()` é
falso no estado `loading`, e a busca e o FAB somem. Passando a filtrar no
servidor, **mexer num filtro faria a barra de filtros desaparecer e voltar** — e
digitar na busca destruiria o campo em foco no meio da digitação.

Então o estado `loading` de tela cheia vale só para a **primeira** carga. Depois
que uma resposta chegou, refiltrar mantém a moldura e a lista anterior no lugar
e mostra um `ion-progress-bar` indeterminado sob a barra de filtros, com a lista
marcada `aria-busy`. É o que o ticket chama de estado de carregamento visível,
sem o custo de reconstruir a tela.

Erro durante refiltragem continua caindo no placeholder de erro. A moldura some
nesse caso — mas os critérios estão na URL, então "Tentar de novo" repete
exatamente a mesma consulta.

### 9. "Limpar filtros" não apaga o texto da busca — DECIDIDO

Limpa tipo, finalidade e localização. O texto tem caixa própria, visível, com o
botão de limpar do próprio `ion-searchbar` — apagá-lo por tabela seria apagar
algo que a pessoa não pediu para apagar e que ela está vendo. Vale igual no
botão dos chips e no botão dentro do placeholder de "nenhum resultado".

### 10. Valores inválidos na URL são descartados, não enviados — DECIDIDO

`?type=CASTELO` num link colado ou editado à mão iria para o backend, onde o
enum do zod devolve 400 — e a tela mostraria erro de servidor por causa de um
erro de digitação. O parser confere `type` e `purpose` contra `PROPERTY_TYPES` e
`PROPERTY_PURPOSES` e descarta o que não casa, silenciosamente. `location` e `q`
são texto livre: `trim`, e vazio conta como ausente.

### 11. O sheet aplica ao vivo; o botão só fecha — DECIDIDO

No mobile, mexer num controle dentro do sheet já navega e já refiltra, igual ao
desktop. O botão do rodapé é `SHEET_DONE` ("Ver resultados") e só fecha.

A alternativa — acumular no sheet e aplicar no botão — daria ao mobile um
estado de filtro que o desktop não tem, e com ele um "Cancelar" que precisa
desfazer. Dois comportamentos para a mesma tela é o começo de dois bugs.
Aplicando ao vivo, o sheet é só o lugar onde o form está nesta largura — que é
exatamente o que "um form, dois lugares" quer dizer.

## O que a filtragem no servidor quebra do IM-45

Três coisas, nenhuma delas prevista pelo ticket.

**1. A faixa de "imóveis sem tour" passaria a mentir.** `mostrarFaixa()` lê
`properties()` e diz "N imóveis ainda não possuem imagens 360°". Hoje isso é o
acervo. Com o servidor filtrando, `properties()` vira *a página filtrada*, e a
faixa falaria do resultado da busca no tom de quem fala do acervo. **A faixa
some quando há qualquer critério ativo** — ela é um empurrão sobre a conta, não
sobre uma pesquisa.

**2. "Conta vazia" e "sem resultado" trocam de mecanismo.** `resolveHomeView`
compara `total` com `filtered`, ambos contados em memória. Com o servidor
filtrando, uma resposta vazia pode ser as duas coisas. A distinção passa a ser
"havia critério?".

**3. `carregar()` não pode mais zerar a busca** — já registrado em §4.

A função vira:

```ts
export interface HomeViewInput {
  readonly status: HomeStatus;
  /** Já houve ao menos uma resposta bem-sucedida nesta visita. */
  readonly jaCarregou: boolean;
  /** A última resposta veio sem nenhum imóvel. */
  readonly vazio: boolean;
  /** Há texto de busca ou algum filtro ativo. */
  readonly comCriterios: boolean;
}

export function resolveHomeView(
  { status, jaCarregou, vazio, comCriterios }: HomeViewInput
): HomeView {
  if (status === 'loading' && !jaCarregou) return 'loading';
  if (status === 'error') return 'error';
  if (!vazio) return 'list';
  return comCriterios ? 'no-results' : 'empty';
}
```

`comCriterios` inclui o texto da busca: quem tem trinta imóveis e digita "zzz"
precisa de "nenhum resultado", não do onboarding de conta zerada. Era exatamente
o caso que fixava a ordem no IM-45, e continua fixando.

## Backend — `server-api/`

Dois arquivos:

- `dto/list-properties.dto.ts` — `location: z.string().optional()`.
- `services/list-properties.service.ts` — `purpose` com `in` (§2), `location`
  com `OR` (§3), e `search` + `location` recolhidos num `AND` para não se
  anularem.

O `where` sai de dentro do `execute()` para uma função pura
`montarWhere(query, agencyId): Prisma.PropertyWhereInput`, no mesmo arquivo.
Motivo: a montagem tem agora três ramos que interagem, e a diferença entre um
`OR` no lugar certo e no lugar errado é invisível na leitura. Isolada, ela é
testável sem banco — e o `execute()` volta a caber na tela.

## Frontend — as peças

| Arquivo | Responsabilidade |
|---|---|
| **Criar** `home/property-filters.ts` | `PropertyFilters`, `parseFilters(paramMap)`, `toQueryParams(f)`, `temCriterios(f)`, `chipsAtivos(f)`, `toListParams(f)`. Puro, sem DOM — como `home-view.ts`. |
| **Criar** `components/property-filters-form/` | Os três controles + "Limpar filtros". Entrada `filters`, saída `change`. Sem opinião de layout. |
| **Criar** `components/property-filters-bar/` | Onde os filtros ficam dado o viewport. Desktop: hospeda o form embutido. Mobile: botão "Filtros (N)" + o sheet. Dono do `isMobileViewport()`. |
| **Criar** `components/property-filters-sheet/` | `IonModal` com `breakpoints`, hospedando o mesmo form. Só existe no mobile. |
| **Criar** `components/active-filter-chips/` | Chips removíveis + "Limpar filtros". Visível nas duas larguras. |
| **Modificar** `home/home-view.ts` | Nova entrada, conforme acima. |
| **Modificar** `home/home.page.*` | Critérios vindos da URL, pipeline com `switchMap`, barra de progresso na refiltragem, `[value]` na busca. |
| **Modificar** `models/property.model.ts` | Recebe `PROPERTY_TYPES`/`PROPERTY_PURPOSES` e os tipos; ganha `location` e `district` em `ListPropertiesParams`. |
| **Modificar** `tour-wizard/tour-wizard.model.ts` | Passa a reexportar as constantes de `models/property.model`. Nenhum import do wizard muda. |
| **Modificar** `services/property.service.ts` | Repassa `location` e `district`. |

**Um form, dois lugares.** Renderizar os controles duas vezes e esconder um com
CSS duplicaria rótulos e `id` na árvore de acessibilidade, e deixaria um
`IonModal` invisível prendendo foco — o defeito que `hotspots/media.ts` já
documenta. `isMobileViewport()` decide qual dos dois existe.

## Fluxo de dados

```
queryParamMap ──parseFilters──▶ filters (computed)
                                   │
              tentativa (signal) ──┤   (o "Tentar de novo" reemite os mesmos critérios)
                                   ▼
                          toObservable → switchMap → listProperties
                                   ▼
                    properties (signal) + status (signal) + jaCarregou
                                   ▼
                             resolveHomeView → view
```

Mudar um filtro **não** chama o serviço direto: chama `router.navigate` com os
params novos e `replaceUrl: true`. A requisição é consequência de a URL ter
mudado. Um caminho só, sem estado duplicado para sair de sincronia.

## Estados na tela

| view | quando | o que aparece |
|---|---|---|
| `loading` | primeira carga | placeholder com spinner (como hoje) |
| `error` | falha em qualquer carga | placeholder + "Tentar de novo" |
| `empty` | zero resultados, nenhum critério | onboarding do IM-45, intacto |
| `no-results` | zero resultados, com critério | mensagem ciente de filtro + "Limpar filtros" quando houver filtro |
| `list` | há resultados | faixa (só sem critérios) + lista |

Refiltragem (`status === 'loading' && jaCarregou`) não é uma `view`: é uma barra
de progresso sobre a `view` anterior.

O `no-results` ganha duas variantes: com filtro ativo, mensagem e botão de
limpar; só com texto, a mensagem de hoje com `{{query}}`. A distinção existe
porque "nenhum imóvel para 'cobertura'" sobre uma tela onde há dois filtros
ligados esconde a causa mais provável do zero.

Uma região `aria-live="polite"` visualmente oculta anuncia a contagem depois de
cada filtragem — sem ela, quem usa leitor de tela não recebe nada ao mexer num
`select`.

## i18n

Novas chaves sob `HOME.FILTERS.*`, em `pt.json` e `en.json`: rótulo e
`aria-label` de cada controle, opção "Todos", `TOGGLE` ("Filtros"),
`TOGGLE_COUNT` ("Filtros ({{n}})"), `CLEAR`, `REMOVE_CHIP` ("Remover filtro
{{label}}"), `SHEET_TITLE`, `SHEET_APPLY`, `RESULT_COUNT` /
`RESULT_COUNT_ONE`, `NO_RESULTS_FILTERS`.

Os valores reusam `UPLOAD.TYPE.*` e `UPLOAD.PURPOSE.*`, que já existem
traduzidos. Nenhuma string literal em template — as chaves de plural usam o
sufixo `_ONE` escolhido no TypeScript, como `SCENES_COUNT_ONE`.

## Testes

**Puro, sem TestBed** — `property-filters.spec.ts`: parse de cada param, valor
inválido descartado, vazio tratado como ausente, ida e volta
`toQueryParams(parseFilters(x)) === x`, `temCriterios` com e sem texto,
`chipsAtivos` na ordem certa.

**`home-view.spec.ts`** — precedência reescrita: refiltragem não vira `loading`,
erro ganha de vazio, `empty` vs `no-results` decidido por `comCriterios`.

**Componentes** — o form emite `change` com o filtro certo por controle e limpa
os três; a barra monta o sheet no mobile e o embutido no desktop, e **não**
deixa `ion-modal` no DOM no desktop; os chips emitem remoção individual.

**`home.page.spec.ts`** — param na URL vira param na requisição
(`req.request.params`); mudar filtro dispara uma requisição e não duas; a
moldura sobrevive à refiltragem; a faixa some com critério ativo; `no-results`
com filtro traz o botão de limpar; "Tentar de novo" reemite.

**Backend** — `test/filtros-listagem.spec.ts`, no padrão de
`tenant-properties.spec.ts` (serviço instanciado com o cliente de teste,
fixtures, Postgres real via `yarn test:local`): finalidade "Aluguel" traz
`SALE_OR_RENT`; finalidade "Venda ou Aluguel" **não** traz `RENT`; `location`
casa por bairro, por cidade e por estado; `location` + `search` juntos não se
anulam — o teste que justifica o `AND`; filtros combinam com o isolamento por
agência.

## Critérios de aceite — onde cada um é atendido

| Do ticket | Onde |
|---|---|
| Filtros visíveis e acessíveis na página principal | barra no desktop, botão + sheet no mobile |
| Combináveis entre si | `where` acumulativo, um param por filtro |
| Atualizam a listagem | pipeline da URL |
| Filtros ativos ficam à vista | `active-filter-chips`, nas duas larguras |
| Remoção individual | botão de cada chip |
| Limpar todos | `CLEAR`, nos chips e no placeholder (§9) |
| Estado vazio informativo | `no-results` ciente de filtro |
| Carregamento visível | placeholder na 1ª carga, barra de progresso depois (§8) |
| Sem corte ou overflow no mobile | sheet em vez de barra espremida |
| Refletidos na URL | §4 |
| Preservados ao voltar de um imóvel | §4 + §5, sem código próprio |
| Navegação por teclado | controles nativos (`select`, `input`), `aria-label` em cada um, região `aria-live` |

Os critérios que citam quartos ficam com o campo, no ticket seguinte.

## Fora de escopo

Quartos (ticket próprio). Preço, área, vagas e comodidades. Ordenação. Buscas
salvas. Geolocalização e mapa. Paginação — o `limit: 100` continua como está;
filtrar reduz a exposição ao corte, mas não o elimina, e `total` na resposta já
dá o material para tratá-lo quando for a hora.

## Riscos registrados

- **A fronteira de escopo muda.** Os sprints anteriores mantinham cada ticket de
  um lado só. Este toca os dois, porque a decisão de filtrar no servidor não tem
  como ser só de um lado. Fica registrado por ser precedente, não por ser
  problema.
- **§2 muda um endpoint que já está no ar.** Correção, não quebra — mas é
  mudança de comportamento observável, e merece a linha no PR.
- **`[value]` no `ion-searchbar` com o campo em foco.** A URL passa a
  reescrever o valor do campo enquanto a pessoa digita nele. O valor escrito é
  o mesmo que ela digitou, então em tese nada acontece — mas caret pulando para
  o fim é o defeito clássico desse arranjo, e ele não aparece em teste de
  unidade. Verificar em navegador de verdade antes de fechar.
- **A contagem da faixa de "sem tour" já era da página, não do acervo**, desde o
  IM-45, por causa do `limit: 100`. Esta entrega não piora isso e não conserta;
  esconder a faixa sob filtro evita que fique pior.
