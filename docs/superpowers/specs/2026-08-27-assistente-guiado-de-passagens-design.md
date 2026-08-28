# Assistente guiado de passagens (etapa 2 do tour)

> Spec de desenho, validada em conversa antes de qualquer código.
> Branch: `feat/assistente-guiado-de-passagens`
> Base: `2d9931f` (main, já com a espera da IA na captura). Data: 2026-08-27.
> Escopo tocado: **`inner-view-client/` apenas**. O backend não muda.
> Briefing de origem: `CLAUDE_CODE_PROMPT_Assistente_Tour.md`.

## O pedido

Conectar os ambientes de um tour 360° em telas pequenas. Editores livres de
hotspot são ruins no celular; a proposta é um assistente que leva o corretor
ambiente por ambiente e pede **um único gesto por foto** — tocar onde fica a
passagem para o próximo ambiente da sequência. O último fecha o ciclo, ligando
de volta ao primeiro.

## Escopo — a diferença entre o pedido e o entregue

O briefing foi escrito como se fosse uma feature nova em terreno vazio: pede um
componente de panorama, uma matemática de gesto, um modelo de dados e uma tela
de conclusão. **Nada disso é terreno vazio aqui.** A etapa 2 do wizard já faz
tudo isso, com three.js, com testes, com o par `u`/`v` em fração e com validação
de grafo.

O que esta entrega constrói é **só o roteiro**: a sequência, a instrução por
passo, a derivação do destino e o fechamento do ciclo. O resto é reuso, e a
maior parte do briefing é atendida por código que já está em produção.

Fica de fora, por decisão registrada abaixo: passagens de volta (§5), tela cheia
de conclusão (§6), e a paleta laranja do protótipo (§9).

## O que existe hoje

Levantado no código, não suposto. Todas as referências conferidas contra
`2d9931f`, depois de um `git pull` — os onze commits que entraram tocaram
justamente estes arquivos.

- **A etapa 2 é um editor livre completo.** `step-hotspots.component` monta
  `PanoramicViewerComponent` em `editMode`, mais overlay de pinos, lixeira,
  trilho de ambientes, painel lateral e bottom sheet do mobile. Um ambiente pode
  ter N pontos, cada um para o destino que se escolher.
- **O hotspot já é fração, e sempre foi.** `WizardHotspot` guarda `u`/`v` em
  0–1 (`tour-wizard.model.ts`), que é o mesmo par que o viewer emite em
  `hotspotPlaced` e que o servidor grava em `positionX`/`positionY`. O requisito
  "inegociável" do briefing já está atendido, sem conversão nenhuma a fazer.
- **Toque e arraste já são distinguidos.** `DRAG_SLOP_PX = 6` em
  `panoramic-viewer.component.ts:13`: o `pointerup` mede a distância e marca
  `suppressNextClick`, porque o OrbitControls gira no arraste e o browser
  dispara `click` ao soltar. Sem essa trava, girar criaria um hotspot por gesto.
- **A projeção esfera → tela é função pura e testada.** `hotspot-projection.ts`
  resolve `hotspotToWorld`, `projectToScreen` (com o corte de `z >= 0`, sem o
  qual girar 180° enche a tela de pinos fantasmas) e `isWithinCanvas`.
- **A mutação de hotspot tem dono único.** `HotspotEditorStore` é o único lugar
  que muta ponto, sempre via `TourDraftStore.patchScene`. Tem `add`, `update`,
  `remove`, arraste, lixeira e `clampV`.
- **O grafo do tour já é validado.** `scene-graph.ts` calcula `ambientesIlhados`
  e `becosSemSaida`, e `canAdvance` **bloqueia a etapa 2** enquanto houver
  ambiente inalcançável (`tour-draft.store.ts:208-211`).
- **A câmera NÃO reseta ao trocar de ambiente.** `camera.position.set(0, 0, 0.1)`
  roda dentro de `initThreeJS()`, uma vez só; `loadPanorama()` troca a textura e
  não mexe no OrbitControls. Trocar de cena hoje mantém o yaw anterior.
- **A foto exibida pode ser a tratada pela IA.** Desde `2b1efd8`, a cena tem
  `treatedImageUrl` e o viewer mostra `treatedImageUrl ?? imageData`, com um
  alternador "ver original" e dissolve. A trava por interação (`revealUrl`
  devolve `null` durante `pinDrag` ou `picker`) existe para a troca não
  acontecer no meio de um gesto.
- **Ponto sem nome já desenha certo.** `rotuloDo()` no viewer usa o rótulo do
  ponto ou, na falta dele, o nome do ambiente de destino — derivado, não
  copiado, para renomear o ambiente consertar os pins que apontam para ele
  (`panoramic-viewer.component.ts:620`).
- **A publicação não exige nome.** `publish-payload.ts` manda
  `label: h.label.trim() || undefined`, e o `create-virtual-tour.dto.ts` tem
  `label: z.string().optional()`. O que ela descarta é ponto **sem destino**.
- **A tela de sucesso já existe**, e é a de tour **publicado**:
  `tour-published.component`, com link do `/embed` e compartilhamento nativo. A
  etapa 3 é o resumo (capa, contagem de ambientes e de pontos, ressalvas) e o
  botão de publicar.
- **`isMobileViewport()` é o padrão estabelecido** para "esta peça existe nesta
  largura?" (`hotspots/media.ts`), e o comentário de lá registra por que um
  `IonModal` escondido por CSS ainda prende foco.
- **Os tokens de tema são obrigatórios.** `.agents/AGENTS.md:24`: "Nunca hex
  solto — usar design tokens". A fonte do app é `Airbnb Cereal VF`; a primária é
  azul (`--ion-color-primary`).

## Decisões

### 1. Guiado é o padrão da etapa 2; o editor livre continua — DECIDIDO

A etapa 2 passa a ter dois modos. O assistente abre por padrão; um link discreto
("editar manualmente") leva ao editor atual, inteiro e intocado.

Substituir o editor livre custaria a capacidade de montar qualquer percurso que
não seja um ciclo — e o comentário de `becosSemSaida` já registra que existe
desenho legítimo assim, com um corredor central e os cômodos pendurados nele.
Também aposentaria overlay, lixeira, painel, sheet e seletor de destino, todos
com teste.

Os dois modos **compartilham o `HotspotEditorStore`**. O assistente não ganha
caminho próprio de escrita. O `providers: [HotspotEditorStore]` continua em
`StepHotspotsComponent` — o interruptor —, e não desce para nenhum dos dois
modos: descendo, cada um ganharia a própria instância, e trocar de modo perderia
o estado de edição no meio do caminho. Duplicar a regra de mutação criaria duas versões da
mesma verdade, que é exatamente o defeito que `scene-graph.ts` documenta ter
custado caro neste projeto uma vez.

### 2. O passo atual é derivado, não é estado próprio — DECIDIDO

```ts
readonly indice = computed(() =>
  this.draft.readyScenes().findIndex((s) => s.id === this.draft.selectedSceneId()),
);
```

O briefing propõe `wizardIndex: number` no estado. Aqui isso seria um segundo
estado que precisa concordar com `selectedSceneId` — e um dia não concordaria,
mostrando a foto da Cozinha sob a instrução do Quarto. Avançar de passo **é**
`selectScene(próximo)`; o índice segue sozinho.

É a mesma lição da entrega dos filtros, em que a URL manda e a página lê.

Consequência: o `Record<índice, Hotspot>` do briefing fica de fora. Indexar por
posição faz os pontos **trocarem de dono em silêncio** quando um ambiente é
removido na etapa 1. Os hotspots continuam morando na cena, que é de onde o
publicar os lê.

### 3. O assistente adota o que já existe e nunca apaga — DECIDIDO

O caso inteiro cabe numa função pura:

```ts
/** A passagem deste passo: o ponto da cena cujo destino é o próximo ambiente. */
export function passagemDoPasso(
  cena: WizardScene,
  alvoId: string,
): WizardHotspot | null;
```

- **Achou** — o passo abre já concluído, com o pino onde ele estava. Só confirmar.
- **Tocou de novo** — `update(id, { u, v })` **move** aquele ponto. Não cria um segundo.
- **"Refazer"** — apaga só a passagem daquele passo. Os outros pontos do ambiente ficam.
- **Não achou** — `add(u, v)` seguido de `update(id, { target })`.

Quem já montou metade no editor livre atravessa o assistente confirmando, e não
perde nada. Nenhum caminho destrói trabalho anterior.

### 4. O destino é derivado, nunca perguntado — DECIDIDO

`target = readyScenes()[(i + 1) % N].id`. É isso que elimina o segundo gesto: no
editor livre, marcar um ponto abre um seletor de destino; aqui a sequência já
respondeu essa pergunta.

O ponto **precisa** gravar `target` de verdade, e não só a posição: o
`toCreateTourPayload` descarta hotspot sem destino. O briefing propõe
`Hotspot = { x, y }`, o que produziria pontos que somem no publicar.

E o assistente não precisa de campo de nome nenhum. O rótulo nasce vazio, a
publicação aceita vazio, e o viewer resolve vazio como "use o nome do ambiente
de destino". O pino que o cliente vê no tour sai escrito "Cozinha" sem ninguém
ter digitado nada — e continua certo se o ambiente for renomeado depois.

### 5. Percurso de mão única — DECIDIDO, com o custo declarado

Um toque por foto só consegue criar a passagem de **ida**. A volta é outro
ponto, em outra foto, que não se deduz do primeiro toque — a porta de volta da
Cozinha para a Sala está na foto da Cozinha, e o corretor está olhando a da Sala.

Aceito porque o ciclo garante que ninguém fica preso: sempre se avança e sempre
se chega de volta ao início. Num apartamento de 5 ambientes, rever a Sala a
partir do Quarto custa dois toques.

Marcar a volta é um ticket próprio: o roteiro roda uma segunda passada, opcional,
e nada do que está aqui muda para acomodá-la.

Efeito colateral bem-vindo: um ciclo fechado **nunca** produz ambiente ilhado
nem beco sem saída, então o assistente sempre satisfaz o `canAdvance` da etapa 2.
Deixa de ser "um jeito mais fácil" e vira "o jeito que não tem como dar errado".

### 6. A conclusão mora na gaveta, não numa tela nova — DECIDIDO

Ao fechar o ciclo, o painel de baixo troca o "próximo ambiente" pelo diagrama
`Sala → Cozinha → Quarto ↩` e por dois botões: **Continuar** (vai à etapa 3) e
**Editar conexões** (volta ao passo 1).

A Tela B do briefing não sobrevive como está por dois motivos de fato. O título
"Tour pronto!" seria mentira: nada foi publicado ainda, e a etapa 3 vem depois.
E "Visualizar tour" só existe depois de publicar — é lá que sai o link do
`/embed`, em `tour-published`.

O que se aproveita é o diagrama, que é a melhor ideia da tela: a confirmação
visual de que cinco toques viraram um percurso. Mantido, no mesmo lugar onde o
percurso foi montado, sem um degrau cheio de tela antes do publicar.

### 7. Abre no primeiro passo incompleto — DECIDIDO

Reabrir o assistente não recomeça do passo 1. Ele procura o primeiro ambiente
sem passagem para o seguinte e abre ali. Cai fora da §3 de graça: quem já tem
tudo ligado abre direto no diagrama do ciclo.

### 8. Trocar de ambiente reseta a câmera — DECIDIDO

Isto **revisa o que eu disse na conversa**: eu afirmei que não encostaria em
`panoramic-viewer.component.ts`. Encosto — e a razão foi medida, não suposta.

`camera.position.set()` roda uma vez em `initThreeJS()`. `loadPanorama()` troca
só a textura. Hoje, portanto, avançar de ambiente deixa o corretor olhando o
ângulo em que ele estava no ambiente anterior — um ângulo sem significado nenhum
na foto nova, já que equirretangulares de celular não compartilham orientação de
bússola.

Entra um método público `resetView()` no viewer, aditivo, que devolve o
OrbitControls ao azimute inicial. Nenhum comportamento existente muda: quem não
chamar não vê diferença. É o `pan = 0` do briefing, traduzido para a engine real.

### 9. O §6 do briefing vira tokens do projeto — DECIDIDO

Zero hex solto (`.agents/AGENTS.md:24`). O mapa:

| Briefing | Vira |
|---|---|
| accent `#cf7a33` | `--ion-color-primary` (o azul da marca) |
| paper `#f4f0ea` | `--app-surface-soft` |
| ink `#241f19` | `--app-ink` |
| muted `#867e72` | `--app-muted` |
| line `#e2dacd` | `--app-hairline` |
| raios 11/15/16/26 | `--app-radius-sm` … `--app-radius-xl` |
| Manrope / IBM Plex Mono | a fonte do app |
| tints dos ambientes | seis tokens novos `--app-room-1` … `--app-room-6` |

**A tela final não vai parecer o mockup laranja** — vai parecer o resto do app.
A regra 1 do próprio briefing ("adapte-se ao codebase") manda isso; fica escrito
para não ser descoberto ao ver a tela pronta.

As cores de ambiente viram tokens, e não `hsl()` calculado no componente, para
haver um lugar só onde a paleta é decidida. `corDoAmbiente(i)` só escolhe entre
os seis, ciclicamente.

### 10. A matemática de gesto do §5 é descartada inteira — DECIDIDO

`pan` em pixels, `larguraDaFaixa`, `background-repeat: repeat-x`,
`x = clamp01((pan + clientX - rectLeft) / larguraDaFaixa)` — tudo isso é do
protótipo, que simulava o 360 com uma `div` larga. O §7 do briefing já admite
que em produção some.

Aqui a fonte do par `(u, v)` é o `hotspotPlaced` do viewer, que faz raycast
contra a esfera e devolve UV de verdade. O requisito do limiar de 5px é atendido
pelo `DRAG_SLOP_PX = 6` que já existe. **Não entra um segundo detector de
gesto** — dois limiares para a mesma pergunta é como um deles fica para trás.

### 11. O clamp vertical do projeto ganha do briefing — DECIDIDO

O briefing pede `y ∈ [0.12, 0.90]`; o `clampV` do `HotspotEditorStore` usa
`[0.02, 0.96]`, valores que vieram de um handoff anterior e estão documentados
no arquivo. Fica o do projeto: mudar o limite agora moveria pontos já marcados
no editor livre, e o assistente escreve pelos mesmos comandos.

## As peças

| Arquivo | Responsabilidade |
|---|---|
| **Criar** `tour-wizard/hotspots/guided/guided-route.ts` | Puro, sem DOM. `GuidedStep`, `passoDoRoteiro`, `passagemDoPasso`, `primeiroPassoIncompleto`, `estadoDosDots`, `cicloFechado`, `corDoAmbiente`. No padrão de `scene-graph.ts` e `hotspot-projection.ts`. |
| **Criar** `.../guided/guided-route.store.ts` | Comandos do roteiro: `marcar(u,v)`, `refazer()`, `confirmar()`. Escreve **só** via `HotspotEditorStore`. |
| **Criar** `.../guided/guided-hotspots.component.*` | Orquestrador: viewer + banner + overlay do pino + gaveta. |
| **Criar** `.../guided/guided-banner.component.*` | Swatch do próximo ambiente + a instrução. `role="status"`. |
| **Criar** `.../guided/guided-sheet.component.*` | Dots de progresso, linha do próximo ambiente, "Refazer", botão primário. |
| **Criar** `.../guided/guided-cycle.component.*` | O diagrama do ciclo e os dois botões finais (§6). |
| **Modificar** `steps/step-hotspots/step-hotspots.component.*` | Vira o interruptor entre os dois modos. O corpo do editor livre sai para um componente próprio, sem mudança de comportamento. |
| **Modificar** `components/panoramic-viewer/panoramic-viewer.component.ts` | Ganha `resetView()` (§8). Aditivo. |
| **Modificar** `theme/variables.scss` | Seis tokens `--app-room-*` (§9). |
| **Modificar** `assets/i18n/pt.json`, `en.json` | Chaves novas sob `TOUR_WIZARD.STEP2.GUIDED.*`. |

**Não encosto em:** `hotspot-editor.store.ts`, `publish-payload.ts`,
`scene-graph.ts`, `tour-wizard.model.ts`, `tour-draft.store.ts`. O assistente é
uma UI nova sobre o modelo de dados que já existe — se algum deles precisar
mudar, é sinal de que o desenho errou, e vale reabrir a conversa antes.

## Fluxo de dados

```
readyScenes()  ─┐
selectedSceneId ┴──▶ indice (computed)  ──passoDoRoteiro──▶ passo
                                                             │
   { cena, próximo, isLast, passagem }  ◀─────────────────────┘
                          │
                          ├─▶ banner    "Toque onde fica a passagem para {próximo}"
                          ├─▶ overlay   pino, se a passagem existe
                          ├─▶ dots      concluído / atual / pendente
                          └─▶ botão     habilitado só com passagem

toque na foto (hotspotPlaced)
        │
        ├── passagem existe? ──▶ editor.update(id, { u, v })          [move]
        └── não existe?      ──▶ editor.add(u, v)
                                 + editor.update(id, { target })      [derivado]

Confirmar ──▶ draft.selectScene(próximo) ──▶ viewer.resetView()
                     │
                     └── o índice acompanha sozinho (§2)

era o último? ──▶ cicloFechado() ──▶ a gaveta troca para o diagrama
```

Avançar de passo **não** é um `wizardIndex++`: é uma troca de cena selecionada.
Um caminho só, sem estado duplicado para sair de sincronia.

## Estados na tela

| Situação | O que aparece |
|---|---|
| 0 ou 1 ambiente pronto | O assistente não aparece. A etapa 2 já é opcional aí (`etapa2Opcional()`), e não há percurso a montar. |
| Passo sem passagem | Banner com a instrução, dica de arraste sobre a foto, botão primário desabilitado. |
| Passo com passagem | Pino no lugar, "Refazer" à direita, botão primário habilitado. |
| Último passo | A instrução vira "passagem de volta para {primeiro}"; o botão vira "Fechar percurso". |
| Ciclo fechado | A gaveta troca para o diagrama, "Continuar" e "Editar conexões". |
| Modo avançado | O editor livre de hoje, inteiro, sem nenhuma mudança de comportamento. |

A dica de arraste some assim que a passagem do passo existe — instrução que não
some vira ruído permanente para quem já entendeu, que é a regra que o
`tw-viewer__hint` de hoje já segue.

## i18n

Chaves novas sob `TOUR_WIZARD.STEP2.GUIDED.*`, em `pt.json` e `en.json`:
`PROGRESS` ("Passo {{n}} de {{total}} · {{ambiente}}"), `INSTRUCTION`,
`INSTRUCTION_LAST`, `HINT`, `NEXT_ROOM`, `REDO`, `CONFIRM`, `CONFIRM_LAST`,
`CYCLE_TITLE`, `CYCLE_TEXT` / `CYCLE_TEXT_ONE`, `CYCLE_NOTE`, `CONTINUE`,
`EDIT_LINKS`, `ADVANCED` (o link para o modo livre), `DOT_CURRENT` /
`DOT_DONE` / `DOT_PENDING` (rótulos dos dots para leitor de tela).

Nenhuma string literal em template. O plural usa o sufixo `_ONE` escolhido no
TypeScript, como `SCENES_COUNT_ONE` e `RESULT_COUNT_ONE` já fazem.

## Acessibilidade — o que dá e o que não dá

O que dá: botão primário, "Refazer" e "Editar conexões" são botões de verdade;
o banner é `role="status"` e anuncia a instrução a cada passo; os dots têm
`aria-label` dizendo qual ambiente e em que estado.

O que **não** dá: **o gesto de tocar na foto não é acessível ao teclado.** Isso
já é verdade no editor livre de hoje, e o assistente herda — não piora nem
conserta. O caminho de teclado real continua sendo o modo avançado, onde os
pontos aparecem numa lista com campos e botões. Fica registrado por ser uma
lacuna conhecida, e não uma descoberta futura.

## Testes

**Puro, sem TestBed** — `guided-route.spec.ts`: o passo `i` aponta para
`(i+1) % N`; o último aponta para o índice 0; `passagemDoPasso` acha o ponto
existente e ignora os que apontam para outro lugar; `primeiroPassoIncompleto`
pula o que já está ligado; `estadoDosDots` marca atual/concluído/pendente;
`cicloFechado` só com todos ligados; ciclo de dois ambientes; remover um
ambiente não faz ponto trocar de dono.

**Store** — `guided-route.store.spec.ts`: marcar num passo vazio cria com
`target` derivado; marcar de novo **move** e não cria um segundo; refazer apaga
só a passagem daquele passo e preserva os outros pontos do ambiente; confirmar
troca a cena selecionada; confirmar no último fecha o ciclo.

**Componente** — `guided-hotspots.component.spec.ts`: o `hotspotPlaced` do
viewer chega ao store; o botão primário fica desabilitado sem passagem; a gaveta
troca para o diagrama ao fechar; com um ambiente só, o assistente não monta.

**Mutação** para provar que os testes seguram — o mesmo procedimento das duas
entregas anteriores, com o alvo em `passagemDoPasso` e na derivação do `target`.

## Critérios de aceite do briefing — onde cada um é atendido

| Do §8 do briefing | Onde |
|---|---|
| Abre no wizard, label `Passo 1 de N · {ambiente}` | `GUIDED.PROGRESS` (abre no primeiro incompleto, §7) |
| Arrastar gira; não dispara hotspot | `DRAG_SLOP_PX = 6`, já existente (§10) |
| Toque cria o hotspot no ponto exato | `hotspotPlaced` do viewer, raycast contra a esfera |
| Hotspot arrastável sem acionar o pan | overlay atual, `stopPropagation` já resolvido |
| Botão desabilitado até existir hotspot; "Refazer" remove | §3, gaveta |
| Confirmar avança e zera o pan | §2 + `resetView()` (§8) |
| Último passo: "Fechar percurso" → conclusão | §6 |
| Dots refletem atual/concluído/pendente | `estadoDosDots` |
| Diagrama do ciclo com `→` e `↩`; "Editar conexões" volta ao passo 1 | §6 |
| Hotspots como fração `x/y ∈ [0,1]` | já é assim desde sempre — `WizardHotspot.u/v` |
| Copy, cores, tipografia e raios conforme §6 | §9 — traduzidos para os tokens do projeto |
| Acessível ao teclado/leitor de tela | parcialmente; ver a seção de acessibilidade |

## Fora de escopo

Passagens de volta (§5 — ticket próprio, segunda passada opcional). Captura,
nomeação e ordenação de ambientes (etapa 1, já existe). O visualizador do tour
(`/embed`, já existe). Reordenar a sequência de dentro do assistente — a ordem
vem da etapa 1, e mexer nela aqui daria dois lugares para a mesma decisão.
Aposentar o editor livre.

## Riscos registrados

- **O briefing descreve um protótipo, não este código.** Boa parte do §5 e do §6
  não sobrevive ao contato com a engine real e com os tokens do projeto. As
  divergências estão todas em decisões numeradas acima, mas quem comparar a tela
  entregue com o mockup vai ver duas coisas diferentes. É esperado.
- **`resetView()` mexe num componente compartilhado.** O viewer serve também ao
  `/embed` e ao editor livre. O método é aditivo e ninguém mais o chama, mas é
  arquivo de uso comum e merece a linha no PR.
- **A extração do editor livre para um componente próprio é refatoração sem
  comportamento novo.** É o trecho da entrega com maior chance de regressão
  silenciosa, e o menor de teste novo — os testes que valem ali são os que já
  existem, e eles precisam passar sem edição. Se algum precisar mudar, é sinal
  de que a extração mudou comportamento.
- **`treatedImageUrl` entrou há onze commits.** O assistente monta o mesmo
  viewer e herda a imagem tratada, mas a trava por interação do `revealUrl`
  observa `pinDrag` e `picker`, que são estados do editor livre. Confirmar em
  navegador que a troca de imagem não dispara no meio de um toque do assistente.
- **O ciclo assume que a ordem de captura é a ordem de caminhar pela casa.**
  Numa casa em que não é, o percurso fica esquisito — e o conserto é reordenar
  na etapa 1, que não é óbvio de descobrir a partir da etapa 2. Não tratado
  nesta entrega; anotado por ser o tipo de coisa que só aparece com uso real.
