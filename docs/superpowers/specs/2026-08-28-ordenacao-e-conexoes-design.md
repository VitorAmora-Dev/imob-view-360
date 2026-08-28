# Ordenação dos ambientes e passagens escolhidas

> Spec de desenho, validada em conversa antes de qualquer código.
> Branch: `feat/conexoes-e-ordenacao`
> Base: `cacc883` — fusão de `feat/rascunho-retomavel` + PR #19 + `fix/camera-do-assistente`.
> Data: 2026-08-28. Escopo tocado: **`inner-view-client/` e `server-api/`**.

## O pedido

Uma tela nova depois da captura, onde o corretor **ordena** os ambientes por
arrastar-e-soltar e **escolhe** com quais outros cada um se conecta. Depois, a
etapa de pontos percorre essas conexões na ordem escolhida, várias por ambiente,
sem sair da foto até acabarem as daquele ambiente.

Mais três correções pedidas junto: o reset indevido de câmera (**feito**, commit
`ba5ffeb`), o subtítulo da etapa 2 (**feito**, mesmo commit) e o visualizador em
tela cheia no celular (nesta entrega).

## Escopo — a diferença entre o pedido e o entregue

**Isto substitui a decisão central do PR #19.** Lá as conexões eram *derivadas*
de um ciclo `(i+1) % N`, sem escolha, e era isso que garantia que nenhum ambiente
ficava inalcançável. Aqui elas são **escolhidas**, e essa garantia sai de graça
para virar responsabilidade da tela (§9).

O que sobrevive do PR #19: o `hotspot-projection`, o overlay de pinos, o
`HotspotEditorStore`, o editor livre extraído, e a ideia de um roteiro com painel
inferior. O que morre está listado em "O que morre".

## O que existe hoje

Levantado na base fundida `cacc883`, não suposto.

- **O wizard tem exatamente 3 etapas, e o número está em 11 lugares.**
  `WizardStep = 1 | 2 | 3` (`tour-wizard.model.ts:21`); `step` signal
  (`tour-draft.store.ts:146`); `progressPct = (step()/3)*100` (`:243`);
  `canReach` (`:270`); `goTo` (`:274`); `irPara` (`:304`); `if (current === 3)`
  publica (`:313`); os casts de `next`/`back` (`:325`, `:331`);
  `steps: WizardStep[] = [1, 2, 3]` (`wizard-stepper.component.ts:27`);
  `aria-valuemax="3"` (`wizard-stepper.component.html:37`); e — a mais fácil de
  esquecer — **`STEP_OF = "Etapa {{step}} de 3"`, com o número dentro da
  string** (`pt.json`, bloco `TOUR_WIZARD.COMMON`).
- **A ordem dos ambientes é a posição no array, não o campo `order`.** O campo
  existe e é escrito, mas quem manda é `ready.map((scene, i) => …)` no
  `publish-payload.ts`, com `order: i` e `initialPanorama: i === 0`.
- **Não existe comando de reordenar.** A store não tem `moveScene`.
- **Não existe arrastar-e-soltar no app.** `@angular/cdk` **não** está instalado.
  O Ionic 8.8.9 traz `IonReorderGroup` no standalone.
- **O rascunho é retomável.** Salva a cada troca de etapa; `retomarRascunho()`
  reconstrói as cenas a partir dos panoramas e hotspots do servidor, com
  `imageData` vazio e a foto sob demanda (`garantirImagem`).
- **`Hotspot` no banco exige coordenadas.** `positionX Float` e
  `positionY Float`, não anuláveis (`prisma/schema.prisma`). Uma conexão
  escolhida e ainda sem ponto **não tem onde morar** hoje.
- **`canAdvance` da etapa de pontos bloqueia em ambiente ilhado**
  (`tour-draft.store.ts`, ramo do `step === 2`), lendo `ambientesIlhados()` do
  `scene-graph.ts`, que por sua vez lê as arestas **do payload de publicação** —
  ou seja, **só enxerga hotspot já posicionado**.
- **O arquivo CONGELADO já foi descongelado na prática.** O aviso manda abrir PR
  para `feature/tour-wizard`, que está **0 commits à frente da main**; e a
  `feat/rascunho-retomavel` já editou o arquivo. O ritual aponta para uma branch
  morta.

## Decisões

### 1. A ordenação vira a etapa 2; o wizard passa a ter quatro — DECIDIDO

`WizardStep = 1 | 2 | 3 | 4`: imagens, **ordenação e conexões**, pontos,
informações.

As alternativas eram esconder a tela nova dentro de uma etapa existente. Ambas
quebram o botão "Voltar": ele chama `store.back()`, que só sabe decrementar
`step`, e de uma sub-fase ele saltaria a tela inteira. Não há gancho para
interceptar sem inventar mecanismo.

Os 11 pontos são mecânicos e todos cobertos por teste. O `STEP_OF` deixa de ter
o total embutido: vira `"Etapa {{step}} de {{total}}"`, com o total vindo de uma
constante — é o único deles que some em silêncio se esquecido.

### 2. `connections` mora na cena, e é simétrico — DECIDIDO

```ts
/**
 * Ambientes ligados a este, na ORDEM EM QUE FORAM ESCOLHIDOS.
 *
 * O índice do array é a ordem — não há campo paralelo de ordenação, porque
 * duas fontes para a mesma sequência é como uma delas fica para trás.
 *
 * Opcional porque cena antiga e cena retomada não têm; ausente lê-se como
 * lista vazia. Obrigatório quebraria na compilação as fábricas de cena de
 * dezenas de testes de uma vez.
 */
connections?: string[];
```

Na cena, e não num mapa à parte no store, porque `removeScene` já reescreve
tudo numa transação só e já limpa hotspot órfão (`h.target === id → null`);
limpar a conexão órfã no mesmo `.map` é uma linha, e num mapa separado seria uma
segunda escrita que um dia alguém esquece.

**Simétrico:** escolher Cozinha dentro do card da Sala escreve `cozinha` em
`sala.connections` **e** `sala` em `cozinha.connections`. É o que torna o resumo
"conecta com Cozinha" verdadeiro nos dois cards, e é a consequência direta da
reciprocidade (§3). Remover tira as duas pontas.

**Não existe campo "pendente/concluído".** `A→B` está concluída se, e somente
se, existe hotspot em `A` com `target === B`. Um booleano paralelo seria a
segunda versão da mesma verdade — o erro que `scene-graph.ts` documenta ter
custado caro neste projeto.

### 3. A conexão é recíproca, e as duas pontas entram na fila — DECIDIDO

Escolher Cozinha na Sala cria **duas passagens**: `Sala→Cozinha` e
`Cozinha→Sala`. Ambas precisam de ponto marcado, em fotos diferentes.

Sem isso, "conecta com Cozinha" mente: qualquer pessoa lê como mão dupla, e o
grafo seria de mão única. O corretor produziria tours em que o visitante entra na
cozinha e não sai — exatamente o defeito que `becosSemSaida` foi escrito para
avisar.

Custo aceito: a fila dobra. Para 4 conexões escolhidas são 8 passagens a
posicionar. É trabalho a mais que produz um tour correto em vez de um tour que
parece correto.

### 4. As conexões pendentes persistem no servidor — DECIDIDO

Coluna nova, anulável, em `Panorama`:

```prisma
/// Destinos escolhidos na etapa de ordenação que ainda não ganharam ponto.
///
/// Array ordenado de ids de panorama. Existe porque `Hotspot` exige
/// coordenadas, e uma conexão escolhida e ainda não posicionada não tem onde
/// morar — sem isto, sair do wizard depois de organizar e antes de posicionar
/// apagaria todo o trabalho de organização, que é o momento mais provável de
/// alguém ser interrompido.
pendingConnections Json? // conexoesPendentes
```

Coluna anulável no `Panorama`, e **não** coordenadas anuláveis no `Hotspot`: um
hotspot sem posição vazaria para o `/embed`, onde o viewer tentaria desenhá-lo.
Isto fica fora do caminho de quem lê o tour publicado.

Na retomada, `connections` de cada cena é a **união** do que veio em
`pendingConnections` com os destinos dos hotspots já posicionados, preservando a
ordem gravada. Assim a tela de ordenação reabre idêntica.

### 5. O ponteiro do passo é o índice na fila; a cena é derivada — DECIDIDO

No PR #19 o passo era derivado da cena selecionada, com o argumento de que dois
estados um dia discordariam. **Esse argumento se inverte aqui**: vários passos
compartilham a mesma foto, então a cena não identifica mais o passo.

Continua sendo um estado só — troca qual. A cena selecionada passa a ser
consequência do passo.

**Armadilha, com nome e endereço:** `HotspotEditorStore.add()` e `.update()`
escrevem na cena de `draft.selectedSceneId()`, **não** numa cena passada por
parâmetro. Qualquer avanço de fila que esqueça de sincronizar `selectScene`
grava o ponto **na foto errada, em silêncio**. Isso ganha teste próprio, e o
avanço de passo passa por um único método que faz as duas coisas juntas.

### 6. Todos os pontos já confirmados do ambiente aparecem — DECIDIDO

No PR #19 aparecia um pino só, o do passo. Com vários destinos na mesma foto,
esconder os já confirmados faz o corretor empilhar duas portas no mesmo ponto da
esfera sem perceber.

Aparecem todos os do ambiente que pertencem à fila, com o do passo atual em
destaque. O overlay já sabe desenhar vários.

### 7. O visualizador ocupa a tela inteira no celular — DECIDIDO

A etapa de pontos deixa de viver dentro da moldura do wizard no mobile: o
cabeçalho da etapa, o stepper e a barra de ação somem, e o viewer ocupa a
viewport. A gaveta inferior passa a ser o único controle, e ela já tem o botão
primário.

No desktop nada muda — a moldura continua, porque lá há largura de sobra e o
stepper é orientação útil.

### 8. `guided-cycle` morre — DECIDIDO

A tela de ciclo fechado **afirma uma propriedade que o fluxo novo não produz**:
"os N ambientes estão conectados em ciclo". Com conexões escolhidas, uma estrela
ou uma corrente não fecham nada, e o diagrama desenharia um anel que não existe.

O "acabou" passa para a tela de ordenação, que já mostra o desenho inteiro do
tour por card.

### 9. A validação de alcançabilidade sobe para a tela de ordenação — DECIDIDO

Hoje `canAdvance` bloqueia a etapa de pontos com ambiente ilhado, e o assistente
do PR #19 satisfazia isso por construção. Agora não mais — e nasce um modo de
falha novo: **o corretor posiciona as 8 passagens e o "Próximo" continua
travado.**

O aviso passa a aparecer na tela de ordenação, calculado sobre as `connections`
escolhidas, antes de qualquer ponto ser posicionado.

Detalhe de implementação que não pode ser ignorado: `scene-graph.ts` lê as
arestas do payload de publicação, que lê hotspots — **antes de existir hotspot
ela não vê aresta nenhuma**. A fonte das arestas vira parâmetro, e o
`scene-graph` continua sendo o juiz final no `canAdvance`. Uma leitura do grafo,
duas fontes.

### 10. `ion-reorder-group`, com complemento de teclado — DECIDIDO

Já instalado, mouse e toque, autoscroll dentro do `ion-content` que o wizard já
tem. Não paga dependência nova nem reescreve gesto. O buraco que deixa é
teclado, e ele custa dois `keydown` de seta na alça chamando o mesmo
`moveScene`.

Armadilhas verificadas no código do Ionic, todas relevantes:

| Armadilha | Consequência se ignorada |
|---|---|
| `disabled` nasce `true` | nada arrasta, sem erro |
| `ionItemReorder` está deprecado | usar `(ionReorderEnd)` |
| `detail.complete()` sem argumento | o Ionic mexe no DOM por trás do `@for` |
| o arraste só começa dentro de `<ion-reorder>` | alça obrigatória |
| `slot="start"` no `ion-reorder` | o shadow CSS o esconde |
| botão clicável dentro da alça | o clique morre na captura |
| o ícone padrão `md` tem **duas** linhas | o pedido é três: SVG próprio |

E: **recolher todos os cards no `(ionReorderStart)`**, porque o Ionic desloca os
vizinhos pela altura do card arrastado, e um card expandido no meio faz o preview
saltar. A sombra do Ionic é fixa e sem `prefers-reduced-motion`; sobrescrever com
token no SCSS do wizard.

### 11. `moveScene(de, para)` novo na store — DECIDIDO

Não existe. Reordena o array de `scenes` — que é a ordem de verdade — e nada
mais: `order` continua sendo escrito onde já é, e a divergência que ele já tem
com o publicar não piora nem melhora nesta entrega.

## A fila de passagens

Módulo puro, no padrão de `scene-graph.ts` e `hotspot-projection.ts`.

```ts
/** Uma passagem a posicionar: de onde, para onde. */
export interface Passagem {
  readonly origem: WizardScene;
  readonly destino: WizardScene;
  /** Já tem ponto marcado? Derivado, nunca guardado. */
  readonly feita: boolean;
}

/**
 * A fila inteira, na ordem de trabalho: agrupada por ambiente na ordem dos
 * cards, e dentro de cada ambiente na ordem em que as conexões foram escolhidas.
 *
 * É isso que faz o corretor permanecer na mesma foto até acabarem os destinos
 * daquele ambiente, como o pedido descreve.
 */
export function filaDePassagens(cenas: readonly WizardScene[]): Passagem[];

/** O índice da primeira passagem sem ponto, ou -1 se acabaram. */
export function primeiraPendente(fila: readonly Passagem[]): number;

/** As que faltam no MESMO ambiente do passo atual — a lista da gaveta. */
export function pendentesDoAmbiente(fila, i): Passagem[];

/** Resumo do card recolhido: "Cozinha", "Sala e Banheiro", ou vazio. */
export function resumoDeConexoes(cena, cenas): string[];

/** Liga dois ambientes nos dois sentidos. Idempotente. */
export function ligar(cenas, aId, bId): WizardScene[];

/** Desliga nos dois sentidos. Devolve os hotspots que serão perdidos. */
export function desligar(cenas, aId, bId): { cenas: WizardScene[]; perdidos: WizardHotspot[] };
```

## As peças

| Arquivo | O quê | Responsabilidade |
|---|---|---|
| `tour-wizard/passagens/fila.ts` | criar | O módulo puro acima |
| `tour-wizard/steps/step-ordering/` | criar | A tela de ordenação: lista, arraste, expandir, conexões |
| `.../step-ordering/room-card.component.*` | criar | Um card: alça, número, miniatura, nome, resumo, expandir |
| `.../step-ordering/connection-picker.component.*` | criar | A lista de destinos com seleção múltipla |
| `tour-wizard/passagens/passagens.store.ts` | criar | O ponteiro da fila e os comandos (marcar, refazer, confirmar) |
| `tour-wizard/passagens/passagens-*.component.*` | criar | Painel inferior com lista de pendentes; substitui `guided-sheet` |
| `hotspots/guided/guided-cycle.component.*` | **apagar** | Afirma um ciclo que não existe mais (§8) |
| `hotspots/guided/guided-route.ts` e `.store.ts` | **apagar** | O roteiro `(i+1) % N` morre inteiro |
| `tour-wizard.model.ts` | modificar | `WizardStep` ganha `4`; `WizardScene` ganha `connections?` |
| `tour-draft.store.ts` | modificar | `moveScene`, `ligar`/`desligar`, o `/4`, a retomada lendo `pendingConnections` |
| `scene-graph.ts` | modificar | Fonte das arestas vira parâmetro (§9) |
| `wizard-stepper.component.*` | modificar | Quatro chips, `aria-valuemax` |
| `server-api/prisma/schema.prisma` + migration | modificar | `pendingConnections Json?` |
| `server-api/.../virtual-tours/` | modificar | DTO e service do rascunho passam o campo |
| `assets/i18n/pt.json`, `en.json` | modificar | Chaves novas; `STEP_OF` sem o total embutido |

## Estados na tela

| Situação | O que aparece |
|---|---|
| Ordenação, nenhuma conexão | Cards com "sem conexões"; o primário fica travado com o motivo colado nele |
| Ordenação, ambiente ilhado | Aviso nomeando os ambientes, antes de posicionar qualquer ponto (§9) |
| Card recolhido | "conecta com Cozinha" / "conecta com Sala e Banheiro" |
| Card expandido | "Adicionar uma conexão a este ambiente" + lista dos outros, com marcação |
| Durante o arraste | Todos os cards recolhem; elevação e sombra no arrastado |
| Pontos, passagem pendente | Faixa escura com a instrução, dica de giro, primário travado |
| Pontos, ponto marcado | Pino em destaque, "Refazer" à direita, primário liberado |
| Pontos, fim do ambiente | Troca de foto e a instrução muda, com transição curta |
| Pontos, fim da fila | Avança para a etapa de informações |

## i18n

Chaves novas sob `TOUR_WIZARD.STEP_ORDER.*` e `TOUR_WIZARD.PASSAGES.*`.
`STEP_OF` muda de `"Etapa {{step}} de 3"` para `"Etapa {{step}} de {{total}}"`.
`STEP_2`/`STEP_3` renumeram e entra `STEP_4`. Os textos de `GUIDED.CYCLE_*` saem
com o componente.

## Testes

**Puro** — `fila.spec.ts`: agrupamento por ambiente na ordem dos cards; ordem de
seleção dentro do ambiente; `feita` derivado do hotspot; `ligar` idempotente e
simétrico; `desligar` devolve os pontos perdidos; ambiente removido não deixa
conexão órfã.

**Store** — ponteiro avança dentro do ambiente antes de trocar de foto;
`selectScene` acompanha o passo **sempre** (o teste que impede gravar na foto
errada); refazer apaga só a passagem atual; `moveScene` reordena e preserva
conexões.

**Componentes** — o card recolhe/expande e mantém a seleção; reordenar não perde
conexão; a gaveta lista as pendentes do ambiente; o primário trava sem ponto.

**Backend** — o rascunho salva e devolve `pendingConnections`; retomar
reconstrói `connections` como união do pendente com os destinos dos hotspots.

**Navegador** — o percurso inteiro: capturar, ordenar arrastando, conectar,
posicionar as 8 passagens, e conferir que a foto só troca quando o ambiente
acaba.

## Fora de escopo

Reordenar conexões dentro de um card (a ordem é a de seleção). Editar o nome do
ambiente nesta tela (é da etapa 1). Aposentar o editor livre de pontos, que
continua atrás do link. Desfazer/refazer da ordenação.

## Riscos declarados

- **Uma migration numa branch de outra pessoa.** `pendingConnections` mexe no
  schema que a `feat/rascunho-retomavel` está movimentando. Precisa de combinação
  entre as frentes antes de rodar.
- **O aviso de alcançabilidade tem duas fontes de aresta.** A da tela de
  ordenação lê `connections`; a do `canAdvance` lê o payload. Elas podem
  discordar num intervalo — conexão escolhida e ainda não posicionada. É
  deliberado (avisar cedo é o ponto), mas a mensagem tem de deixar claro que
  fala do que **vai** ser montado.
- **O reset de câmera acabou de custar um defeito em produção.** O painel novo
  reage a "destino atual", "lista de pendentes" e "progresso" — os três
  derivados de `scenes()`, os três objetos ou arrays. Nenhum `effect` desta
  entrega pode assinar direto um computed assim: ou estreita para escalar, ou
  ganha `equal`.
- **Tela cheia no mobile esconde o "Voltar".** A gaveta precisa oferecer um
  caminho de volta à ordenação, senão o corretor fica preso na etapa de pontos.
