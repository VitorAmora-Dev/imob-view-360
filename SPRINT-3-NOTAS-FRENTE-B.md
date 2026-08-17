# Sprint 3 — Notas da Frente B (etapa 2, hotspots)

> Complemento de `SPRINT-3-TOUR-WIZARD.md`, não substituto. Arquivo novo em vez
> de edição no plano compartilhado, pela mesma razão do §7: arquivo com dono não
> dá conflito.
>
> Escrito para quem pegar a etapa 2 no meio, e para a Frente A saber o que a
> alcança. Se algo aqui divergir do código, o código vence.

Branch: `feature/tour-wizard-hotspots`.

---

## 1. O que está de pé

| Tarefa | Estado | Onde |
|---|---|---|
| B1 — host do viewer em `editMode` | feito, com hachura no estado sem foto | `steps/step-hotspots/` |
| B2 — overlay HTML de pins | feito, com acabamento | `hotspots/hotspot-overlay/` |
| B3 — `HotspotEditorStore` | veio quase pronto do commit-zero | `hotspot-editor.store.ts` |
| B4 — criar no clique, navegar no pin | feito | `step-hotspots.component.ts` |
| B5 — rail de ambientes | feito | `hotspots/scene-rail/` |
| B6 — painel do desktop | feito | `hotspots/hotspot-panel/` |
| B7 — linha-resumo do mobile | feito | `hotspots/hotspot-summary-row/` |
| B8 — bottom sheet | feito | `hotspots/hotspot-sheet/` |
| B9 — long-press e arraste | feito | `hotspot-overlay/`, `hotspot-editor.store.ts` |
| B10 — lixeira | feito | `hotspots/hotspot-trash/` |
| B12 — a11y | feito | espalhado; `media.ts` para o `prefers-reduced-motion` |

O formulário de um ponto é um componente só, o `hotspots/hotspot-card/`, usado
pelo painel do desktop e pelo sheet do mobile. Duas cópias divergiriam na
primeira mudança de regra.

Suíte em **266 passando**, zero falhando. As 3 falhas herdadas do §2.2 foram
corrigidas na branch de integração.

Arquivos tocados, todos dentro do §7: `hotspots/**`, `steps/step-hotspots/**`,
`panoramic-viewer.component.ts`, e o bloco `TOUR_WIZARD.STEP2` do i18n. Nada da
Frente A foi alterado.

---

## 2. Três decisões que não são de uma frente só

### 2.1 `addHotspots` desenhava os hotspots espelhados — CORRIGIDO em `f7803a4`

> Esta seção dizia "NÃO corrigido" e ficou desatualizada por seis commits, até um
> code review apontar que o documento contradizia o código no merge. O texto
> abaixo é o registro do que foi feito, não mais uma pendência.

`panoramic-viewer.component.ts`, em `addHotspots`, calculava:

```ts
const theta = (1 - hotspot.positionY) * Math.PI;   // errado
```

quando o certo é `positionY * Math.PI`. Ver §3 para a derivação.

O efeito era renderizar refletido no equador o mesmo ponto que o `onCanvasClick`
do próprio componente gravou. Como `hotspotPlaced` é o único produtor de
`positionX`/`positionY` no cliente, **todo hotspot do inner-view aparecia no
lugar errado**. O dado no banco sempre esteve certo; só a renderização invertia.

**O que isso muda para quem já usava o app:** os tours publicados antes desta
correção passam a mostrar os hotspots no lugar certo. Não há migração porque não
há dado a migrar — mas é uma mudança visível, e o corretor que tenha marcado um
ponto "até o sprite cair onde eu queria" vai ver aquele ponto se mover.

A pendência que esta seção registrava era o aval das duas frentes, que o Vitor
não podia dar sozinho. Ele foi dado pelo Dev A depois de assumir as duas, com a
mudança sinalizada explicitamente na mensagem do merge da Frente B.

Provado no dado publicado, não só em teste: um ponto marcado a 0,179 da altura
do canvas na etapa 2 é desenhado a 0,179 no inner-view depois de publicar. A
primeira verificação caiu no equador, onde o espelhamento dá erro zero — a
armadilha do §3 — e não provava nada.

O wizard nunca foi afetado: a etapa 2 passa `originHotspots: []` ao viewer,
porque quem desenha os pins é o overlay HTML.

### 2.2 A branch de integração está vermelha

3 testes falham em `feature/tour-wizard`, desde antes deste trabalho:

```
InnerViewPagePage — download do panorama (×3)
NG0201: No provider found for `ModalController`
```

O spec não provê `ModalController` no TestBed — provavelmente a página passou a
injetá-lo no trabalho do `Capture360` e o teste não acompanhou. **O DoD das duas
frentes exige `npm test` limpo**, então isso trava as duas. Não é arquivo de
nenhuma das frentes.

### 2.3 O laço de render roda dentro da zona do Angular

Medido, não suposto — sonda com `NgZone.isInAngularZone()` dentro do callback de
frame devolveu `true`, a ~62 frames/s. O `animate()` nasce num `setTimeout`
dentro da zona, o zone.js patcheia o `requestAnimationFrame`, e cada frame vira
tarefa de zona: **change detection 60 vezes por segundo**, já hoje, sem o
overlay.

Correção é `zone.runOutsideAngular(() => this.animate())`. Não apliquei porque o
inner-view também consome esse viewer, e se algo lá depende de CD rodar após
cada frame, quebra em silêncio.

O overlay foi desenhado para não depender dessa correção: ele escreve `transform`
direto no DOM e não passa por binding do Angular.

---

## 3. A convenção do eixo vertical — leia antes de mexer na projeção

Isto custou meio dia e um bug que passou pelos testes. A cadeia inteira:

```
1. SphereGeometry grava   uv.y = 1 - v_geom,  com v_geom = 0 no polo de CIMA
                          → o topo da esfera tem uv.y = 1

2. onCanvasClick emite    positionY = 1 - uv.y
                          → o topo vira positionY = 0
```

Portanto **`v = 0` é o TOPO**, e a volta é `theta = v * PI`, medido a partir de
`+Y`. O campo se chama `v` no `WizardHotspot`, mas **não é o V da UV do
three.js** — é o `positionY` do backend.

O erro fácil (que eu cometi) é derivar a fórmula lendo `addHotspots` em vez do
round-trip do clique. Aquela função concorda com um bug, então a conta "bate" e
o teste passa.

**O teste que manda** é `hotspot-projection.spec.ts` → `ida e volta com o clique
do viewer`: faz raycast num clone da esfera do viewer, aplica o mesmo
`1 - uv.y`, projeta de volta e exige o pixel de origem. Se você mudar a
projeção, é esse que tem de continuar verde — os outros travam convenção, e
convenção errada passa despercebida em foto simétrica (o erro é exatamente zero
no centro do canvas, que é onde cai o clique de teste típico).

---

## 4. O que mudou para a Frente A

Nada que eu tenha escrito, mas dois pontos do plano que valem repetir porque a
cópia do `SPRINT-3-TOUR-WIZARD.md` em algumas branches está defasada:

- **B11 saiu da Frente B** e virou parte de A12. `toCreateTourPayload`
  (`publish-payload.ts`) já existe desde o commit-zero e já descarta hotspot sem
  destino, devolvendo a contagem para o aviso. Falta ligar no `publish()` real.
- **A Frente B não faz nenhuma chamada de rede.** Os hotspots vivem em
  `WizardScene.hotspots` e sobem no `createTour` do publicar, que é da A.

Se a sua cópia do plano diz que a Frente B tem 47 pontos e que o B11 é dela,
está velha — a versão boa está em `origin/feature/tour-wizard`.

---

## 5. Como verificar de verdade

Os testes unitários não pegaram o eixo invertido. O que pegou foi rodar o app e
medir. Vale repetir o método a cada tarefa visual da etapa 2:

1. `npm start` no `inner-view-client`.
2. Autenticar é só `localStorage.setItem('accessToken', 'dev-token')` — o guard
   testa `!!token`, sem validar nada. As etapas 1 e 2 não tocam a rede.
3. `/tour/novo`, subir uma foto no input provisório da etapa 1 (existe
   justamente para isto), avançar.
4. Há um equirretangular 8192×4096 pronto em
   `src/assets/panoramic/relax_inn.jpg`.

A automação que usei (puppeteer-core apontando para o Chrome do sistema, fora do
`package.json` do projeto) mede o erro entre o pixel clicado e o pixel onde o
pin nasceu. Ficou em **0,93px** depois da correção; era **358px** antes. Se
alguém quiser o roteiro no repo, é só pedir — não commitei para não adicionar
dependência de dev no meio do sprint.

---

## 6. Armadilhas já mapeadas no viewer

Duas foram corrigidas neste trabalho, com o bug reproduzido em teste antes:

- **Clique no fim do arrasto.** O OrbitControls gira no arrasto e o browser
  dispara `click` ao soltar. Em `editMode` isso criava um hotspot a cada giro.
  Resolvido medindo o deslocamento no `pointerup` e engolindo o clique acima de
  6px de folga.
- **Contexto WebGL vazando.** `dispose()` não solta o contexto, e o browser só
  mantém ~16 vivos. A etapa 2 monta e desmonta o viewer a cada troca de etapa.
  Resolvido com `forceContextLoss()` antes do `dispose()`.

E uma que só aparece em teste: o OrbitControls chama `setPointerCapture` no
`pointerdown`, e o browser recusa capturar um `pointerId` sintético. Quem for
escrever teste que dispara ponteiro no canvas precisa neutralizar a chamada —
há exemplo em `panoramic-viewer.component.spec.ts`.

Uma terceira, do arraste (B9): **capturar o ponteiro no `pointerdown`**, e não
quando o arraste começa. Adiar a captura parece mais educado e não é: o pin sem
estilo tem 5×13px hoje, o mouse sai dele antes de percorrer a folga de 8px, e
sem captura o `pointermove` seguinte vai para o canvas. O arraste de mouse
simplesmente não começava, e nada no console dizia por quê. O preço da captura é
que o browser passa a disparar o `click` no pin mesmo quando a solta é longe
dele — daí a trava de clique valer para todo gesto que passou da folga, e não só
para o arraste.

Uma quarta, agora no `IonModal` (B8). O `role="dialog"` **não** fica no
`<ion-modal>`: fica num `.modal-wrapper` dentro do shadow root. Medido na árvore
de acessibilidade, `aria-label` ou `aria-labelledby` no host nomeiam o host, que
é um nó genérico — o diálogo continua anônimo. E `aria-labelledby` no wrapper
também não resolveria, porque IDREF não atravessa fronteira de shadow. O único
caminho é `aria-label` literal no wrapper, em `didPresent`; está em
`hotspot-sheet.component.ts`, com o porquê escrito. Se o Ionic renomear a classe,
o nome some em silêncio.

---

## 7. Próximos passos sugeridos

Na ordem em que eu pegaria:

1. ~~As duas pendências do §2~~ — §2.2 corrigido na integração; §2.1 corrigido em
   `f7803a4`.
2. ~~B5 e B6~~, ~~B4 completo~~, ~~B7~~, ~~B8~~ — feitos.
3. ~~B9~~ — feito. O overlay emite `pinDragStarted`/`pinDragMoved`/`pinDragEnded`,
   e o `pinDragMoved` já carrega `clientX`/`clientY` justamente para o hit test
   da lixeira.
4. ~~B10~~ — feito.
5. ~~B12~~ — feito. Fica registrado o que a passagem de teclado encontrou, em §9.
6. ~~B2 acabamento~~ — feito por último de propósito, e valeu: estilizei uma vez
   só, já sabendo de que estados o pin precisava.

**A frente B está fechada.** O que sobra são as duas anotações abaixo, que são
decisões de escopo e não trabalho pendente: a geometria da lixeira no mobile
(§1 desta seção) e o buraco de a11y de criar/mover ponto (§9).

Uma decisão do B10 que merece um segundo par de olhos: os 184×96px da lixeira
vêm do handoff e são generosos no desktop, mas no 375×760 o viewer tem 328×246 —
o alvo cobre **56% da largura e 39% da altura**, ou seja um quinto da foto vira
zona de exclusão enquanto se arrasta. Um ponto no chão, ao centro da imagem, não
dá para posicionar arrastando.

Não mexi na geometria porque ela é o que o handoff pede, e porque o caminho
natural continua aberto: a lixeira só existe DURANTE o arraste, e criar um ponto
ali é um clique, sem lixeira nenhuma na tela. Mas se o desenho mudar, é aqui que
muda.

Outra medição que vale carregar: no 375×760, a linha-resumo (B7) fica **abaixo da
dobra** quando se chega à etapa 2 — são 167px de rolagem até o fim, e aí ela
aparece inteira e clicável. É o comportamento normal de uma barra de ação
`sticky`, não um defeito, mas quem verificar isso de novo precisa usar
`elementFromPoint`, e não `getComputedStyle(...).display`: o segundo diz que a
linha está lá mesmo quando ninguém consegue tocá-la.

---

## 9. O que a passagem de teclado encontrou (B12)

Tabulei a etapa 2 inteira no navegador em vez de conferir por leitura. A ordem
de foco sai assim, e está boa: os pins visíveis (com rótulo descritivo), o rail
de ambientes, e depois cada card do painel — nome, excluir, destino.

Três coisas que só apareceram por fazer isso:

**Enter num pin não navegava.** A trava de clique do B9 é ligada no `pointerup`
do arraste e só era desligada pelo clique seguinte ou pelo `pointerdown`
seguinte — e quem usa teclado não gera nenhum dos dois. Depois de qualquer
arraste com o mouse, ela ficava pendurada até o próximo toque de ponteiro, que
podia não vir nunca. O conserto é `event.detail > 0`: o `click` de ponteiro traz
`detail` ≥ 1, o que o Enter sintetiza traz 0.

De quebra: `element.click()` também gera `detail` 0, então os testes que usavam
isso para simular a sobra de um arraste estavam exercitando o caminho errado.
Agora o spec tem `cliqueDePonteiro` e `cliqueDeTeclado` separados.

**Um pin fora de vista não é alcançável pelo teclado.** Ele fica com
`visibility: hidden`, o que o tira da ordem de foco — o que está certo —, mas
girar o panorama é só de ponteiro, então não há como trazê-lo à vista. A
alternativa existe e é o painel (desktop) ou o sheet (mobile), onde todo ponto do
ambiente aparece, e o rail leva a qualquer ambiente. É por isso que o B12 pede
essa lista.

**Criar e mover ponto seguem sendo só de ponteiro.** Criar exige clicar numa
posição da imagem; mover é o arraste do B9. Nenhum dos dois está no B12, e não
inventei um gesto de teclado por conta própria — mas fica anotado como o buraco
real de a11y da etapa, para quem for decidir o escopo do próximo sprint.

Sobre o `prefers-reduced-motion`: o `tour-wizard.scss` já zera os tokens de
transição, mas isso não desliga os valores. Faltavam dois, e ambos entraram —
o `scale` do pin em arraste, que sai do laço de frame e por isso precisa da
preferência em TypeScript (`media.ts`), e o `scale(1.12)` da lixeira ativa. Nos
dois casos o que fica é a informação sem movimento: sombra no pin, cor na
lixeira.

Medido com `emulateMedia`, com uma lição de método: ler `getComputedStyle` uma
vez só, logo depois de aplicar a classe, pega a transição no meio do caminho e
mente. Com série temporal (0, 100, 200, 400ms) dá para ver a transição sair de
`scale(1)` e assentar em `scale(1.12)` aos ~200ms no modo normal, e já nascer
`none` no modo reduzido.

## 10. O que sobrou do code review

Rodei o plugin de code review sobre a frente e verifiquei cada achado em vez de
aceitá-lo. Dos quinze, **três não sobreviveram à verificação** — o que é o
motivo de a nota existir: a lista de achados é hipótese, não laudo.

**Derrubados por medição:**

- *"`suppressNextClick` fica travado depois de uma pinça."* Não fica. O
  `onPointerUp` **atribui** em vez de acumular, então o próprio `pointerup` do
  toque limpo zera a trava antes de o `click` chegar. Simulado no navegador: o
  ponto é criado.
- *"Falta cobertura para excluir soltando na lixeira."* Existe. Provado por
  mutação: tirar o `if (drag?.overTrash)` do `endDrag` derruba um teste.
- *"Alocações por frame no laço de posicionamento."* Ver a tabela no
  `reposition` — 22,8µs por frame com 8 pins, 98,4µs com 40, dos quais o `Map`
  é 1,5% e 5,4%. O laço TODO não chega a 0,6% de um frame no pior caso.
  Junto: o `getBoundingClientRect` por `pointermove` da lixeira soma **3,3ms
  num arraste inteiro de 150 movimentos**, e cachear o retângulo custaria
  invalidação em `resize`, giro de tela e teclado virtual.

**Confirmados e consertados:** recarga da textura a cada mexida num hotspot
(era o único bloqueador de verdade), vazamento de textura e de geometria,
`setTimeout` de init sobrevivendo ao destroy, foco roubado do select, editor
fechado ao excluir OUTRO ponto, gesto preso quando um segundo dedo encosta,
ponto criado no polo por clique no teto, rótulo do pin recalculado 60×/s, e
`user-select` brigando com o long-press do iOS (este último **não verificado em
iOS real** — só o CSS confirmado).

**Sobre o nome do diálogo do sheet.** O achado dizia que escrever o `aria-label`
só no `didPresent` deixa o nome velho se o modo mudar com o sheet aberto. Fui
conferir e hoje isso é inalcançável — mas por **cinco fatos independentes**
apoiados uns nos outros, nenhum deles escrito em lugar nenhum: só há dois
chamadores de `openEditor`/`openList` em produção, os dois ficam atrás do
backdrop, no modo editor só o card do próprio ponto é renderizado, e excluí-lo
fecha o sheet. Basta alguém fazer o card da lista abrir o editor — pedido nada
estranho — e o VoiceOver passa a anunciar a lista enquanto a tela mostra um
ponto, sem nada quebrar.

Em vez de provar o negativo, o nome passou a **seguir** o título por effect.
Quatro linhas, e a prova deixa de ser necessária. O teste que segura isso falha
com a mensagem certa quando o effect sai: `SHEET_LIST` anunciado com o editor
aberto.

**Fora do escopo desta rodada:** o `addHotspots` do viewer compartilhado
reimplementa o `hotspotToWorld` linha a linha — é a mesma duplicação que
produziu o bug do eixo espelhado deste sprint, e hoje só um teste a segura.
Chamar a função compartilhada é o conserto óbvio, mas ela mora em
`tour-wizard/hotspots/`, e importá-la faria um componente compartilhado depender
de uma pasta de feature. O certo é mover o módulo para um lugar neutro, e isso é
reestruturação depois do merge das duas frentes — decisão de quem tocar o
próximo sprint, não de uma rodada de review.

## 11. O pin do inner-view no celular: dois defeitos e uma escolha

Veio de teste em aparelho de verdade: "os pins estão difíceis de enxergar e a
nitidez está baixa". A cor era o palpite; a medição achou outra coisa antes.

**Defeito 1 — o viewer renderizava 11% dos pixels da tela.** O
`WebGLRenderer` nasce com `pixelRatio` 1 e nunca chamávamos `setPixelRatio`.
Medido num DPR 3: buffer de 358×269 para uma tela de 1074×807, ou um terço da
resolução linear, ampliado pelo compositor. Não era a foto nem a costura — era
o viewer INTEIRO desenhando pequeno e sendo esticado.

Corrigido com teto de 2. DPR 3 custaria 9× os pixels de DPR 1 num GPU de
celular desenhando uma esfera de 120×80 segmentos; 2× já são 4× os pixels e é
o degrau em que a diferença ainda se vê. Reaplicado no `resize`, porque arrastar
a janela entre monitores muda o DPR.

**Defeito 2 — o sprite nunca mostrou as cores que desenhamos.** A
`CanvasTexture` não declarava `colorSpace`. Com `outputColorSpace = 'srgb'` no
renderer, uma textura que não se declara sRGB é lida como linear e convertida de
novo na saída. O desvio, calculado e conferido contra o print:

| gravado | exibido |
|---|---|
| `#ff385c` (Rausch) | `#ff81a2` — rosa claro |
| `#101218` (pílula) | `#474b56` — cinza médio |

A foto já fazia isso certo desde sempre, no `loadPanorama`. Só o sprite ficou de
fora — e é por isso que o pin parecia um borrão cinza com um ponto rosa.

**A escolha — onde entra o vermelho.** O pedido foi pintar o pin da cor da
marca. Medi as duas leituras antes de decidir: branco sobre a Rausch `#ff385c`
dá **3,5:1**, abaixo do 4,5:1 que a WCAG pede para texto normal; branco sobre a
pílula escura dá **~17:1** no pior caso (a pílula a 95% sobre uma foto branca).

Como o pedido nasceu de "enxergar melhor", pintar a pílula de vermelho andaria
para trás justamente onde mais dói. O vermelho foi para a SILHUETA — borda de
5px, dot maior — e o texto ficou onde se lê. Com halo escuro por fora, porque
borda vermelha sobre teto branco desaparece, e este pin flutua sobre uma foto
que ninguém controla.

O pin passou de ~28px para **50,4×134,7px de CSS**, acima do piso de 44 da
WCAG — que aqui vale duplo, porque o sprite é também o alvo do raycast.

O pin do wizard levou a mesma borda (2px, proporcional aos 5px do sprite: as
pílulas têm 34px e 76px de altura). Os dois continuam a mesma coisa, que foi o
pedido quando o inner-view ainda tinha pílula branca com seta.

## 12. A etapa 2 deixou de ser opcional

Pedido do produto, com uma correção de rumo no meio. A proposta era "obrigar
pelo menos um hotspot, salvo quando há um ambiente só". A investigação mostrou
que o problema era maior e que a regra proposta era pequena demais para ele.

**Por que obrigar.** A tela do visitante é o `embed`, que é
`<app-panoramic-viewer>` e mais nada — e o template do viewer é um canvas e um
spinner. Não há lista de ambientes, menu nem seta: **clicar num hotspot é o
único jeito de trocar de ambiente**. Publicar cinco ambientes sem ligação
entrega um tour em que se vê UM. Os outros quatro foram fotografados,
costurados, enviados, guardados — e são invisíveis. O wizard é o único lugar que
pode pegar isso antes de o link ir para um cliente.

**Por que "pelo menos um" não serve.** Com cinco ambientes, um ponto liga dois e
deixa três de fora: a regra passa e o tour continua quebrado. A regra que
corresponde ao defeito é **alcançabilidade** — busca em largura a partir do
ambiente inicial, que é o mesmo que o payload marca com `initialPanorama`. Está
em `scene-graph.ts`, com o nome de cada ambiente ilhado, porque "2 ambientes sem
ligação" manda procurar e "Cozinha, Quarto" manda consertar.

**Beco sem saída avisa, não bloqueia.** Alcançar não é poder voltar. Mas o aviso
some enquanto houver ambiente ilhado: as mesmas ligações que faltam produzem os
dois sintomas, e mostrar as duas listas juntas apontaria dois problemas onde há
um.

**As arestas saem do payload**, e não das cenas cruas. Quem decide se um hotspot
conta é o `toCreateTourPayload`, que descarta ponto sem destino e ponto para
cena removida. Reimplementar essa regra criaria duas verdades — e a do wizard
poderia liberar exatamente o ambiente órfão que a regra existe para impedir.
Este sprint já pagou uma vez por duplicar em vez de chamar (o eixo espelhado).

**"Opcional" virou condicional, de um lugar só.** O texto da barra de progresso,
o subtítulo da etapa e o botão "Pular" diziam a mesma coisa sem condição, em
três cópias. Agora os três leem `etapa2Opcional()` — com um ambiente a etapa
segue genuinamente opcional, porque não há destino possível.

**Criar um ponto já abre a edição dele.** Eram dois cliques: um para criar,
outro no pin para nomear. O segundo não decidia nada, e nada na tela contava que
ele existia — dava para criar cinco pontos e nunca descobrir como nomeá-los. O
`add()` já devolvia o id "para o chamador abrir o editor" e o retorno era jogado
fora: ponta solta, não decisão. O que segurava era a etapa ser opcional, e
deixou de ser. Com um ambiente só não abre — o editor só saberia dizer "precisa
de um segundo ambiente".

**De quebra:** montando o cenário de teste apareceu um sheet renderizando
"Ponto 0" sobre corpo vazio, quando o ponto aberto some por fora do `remove()`.
Não é alcançável pela interface hoje. Virou guarda no `isOpen` mesmo assim, pela
razão do §10: tela que só não quebra porque nenhum outro caminho mexe em
`scenes` não é tela sã, é tela que ainda não achou o caminho.

## 13. O foco que sumiu no desktop — e a suposição que envelheceu

Relato: "cliquei e não abriu o modal". Reproduzido e medido no navegador, com o
mesmo tour em três larguras:

| largura | sheet | foco |
|---|---|---|
| 390px | abre | (no modal) |
| 768px | não abre — correto | **BODY** |
| 900px | não abre — correto | **BODY** |

No desktop o clique na foto criava o ponto e **nada mais acontecia**. Não havia
sheet, que ali não abre de propósito, e o painel também não recebia o foco.

A causa estava escrita, em português, no comentário do próprio efeito:

> "O card já existe quando se chega aqui: o editor é aberto a partir de um pin,
> e pin só existe para hotspot que já está na lista."

Era verdade — enquanto o ÚNICO caminho para abrir o editor fosse clicar num pin
existente. O §12 criou um segundo caminho, em que o hotspot nasce e o editor
abre no mesmo tick, e aí o `querySelector` corre antes de o `@for` criar o card
e acha `null`. Conserto: `afterNextRender`. Teste conferido por mutação, e ele
falha com o sintoma certo (`activeElement` em BODY).

A lição não é sobre foco. Duas vezes nesta mesma semana a mesma coisa mordeu:
uma invariante verdadeira, escrita como comentário, que deixou de valer quando
alguém — eu — acrescentou um caminho novo. No §10 dava para fechar por
construção e foi o que se fez. Aqui não dava, então o que resta é o teste, que
é o único comentário que reclama quando envelhece.

Vale notar o que NÃO era: os breakpoints do CSS (`max-width: 767px` no
`_tour-wizard-mixins.scss`) e do TypeScript (`TW_MOBILE_QUERY`) são idênticos,
então não existe faixa de largura em que o painel some e o sheet não abre. Foi a
primeira hipótese e ela estava errada.

## 14. Seletor de destino no lugar do editor, e o motivo junto do botão

Duas correções de UX vindas da mesma conversa.

**O motivo do bloqueio agora fica colado no botão.** Ele existia em dois lugares
— um banner no topo da etapa e o `title` do "Próximo" — e nenhum dos dois
funciona no celular no instante em que se aperta: `title` é hover, e o banner
está fora da tela quando se rolou até o rodapé. Botão apagado sem motivo visível
é dos jeitos mais confiáveis de fazer alguém achar que travou.

Os dois textos continuam, e não é repetição: no topo ficam os NOMES dos
ambientes, que é onde se conserta; no rodapé fica por que não dá para seguir,
que é o que se pergunta ao ver o botão. A frase vem primeiro no DOM para o
leitor de tela achá-la antes do botão que ela explica.

**Criar um ponto abre um seletor de destino, não o editor inteiro.** No instante
da criação a única coisa obrigatória é o destino: o nome tem reserva (o número
do ponto) e a exclusão mora no painel e na lista. O editor completo, num sheet
de meia tela, cobria a foto — e, com o toque na metade de baixo, cobria o
próprio ponto recém-criado. Nomear às cegas o ponto que não se está vendo.

O seletor é ancorado no pin e posicionado pelo MESMO laço de frame dos pins,
então acompanha a foto quando o corretor gira. Detalhes que custaram cuidado:

- **A medida sai do DOM uma vez por abertura**, não por frame. `offsetWidth` é
  leitura de layout, e ali ela cairia logo depois de o laço escrever `transform`
  em todos os pins — reflow forçado 60 vezes por segundo, exatamente o padrão
  que o §10 mediu na lixeira e decidiu não pagar.
- **Não cabendo embaixo, vai para cima do pin.** Sem isso o ponto criado na
  metade de baixo da foto reproduziria o defeito que o seletor veio corrigir.
- **A lista tem teto e rola:** a foto tem ~270px de altura no celular, e oito
  ambientes fariam o seletor passar da imagem inteira.
- **Sai de cena junto com o pin.** Girar até o ponto sair de quadro deixava o
  seletor parado no último lugar em que o pin esteve, ancorado em nada. Achado
  relendo o laço, não testando.
- **Tocar na foto com ele aberto FECHA em vez de criar outro ponto.** Sem isso
  não haveria como dispensá-lo tocando fora: cada tentativa de sair renderia um
  ponto órfão.

Fica uma assimetria consciente: criar abre o seletor, tocar num pin órfão abre o
editor. São momentos diferentes — na criação falta o destino; depois, pode ser
que se queira renomear.

**Não verificado no navegador.** O dono estava usando as portas 4200 e 3000 para
testar quando isto ficou pronto, e tomá-las de volta atrapalharia o teste dele.
Unitário cobre o estado (333 testes); o que falta ver é o posicional — âncora,
clamp, transbordo em tela pequena —, que é justamente o que teste unitário não
enxerga.

## 15. A planta na parede

O §12 pôs um fiscal na saída da obra: não se publica enquanto todo ambiente não
tiver porta. Estava certo, mas era remendo — ele existia porque a tela do
visitante não tinha navegação nenhuma. O `embed` era o viewer e mais nada, e o
viewer era um canvas e um spinner: **clicar num hotspot era o único jeito de
trocar de ambiente**.

Agora o viewer tem a lista de ambientes. Pílula escura no canto superior
esquerdo dizendo onde a pessoa está; toca e abre a lista; escolhe e vai.

**Mora no viewer, não nas páginas.** Se fosse peça avulsa, a próxima tela que
mostrasse um tour esqueceria de incluí-la e o buraco voltaria calado. Sendo do
viewer, não existe tour sem ela — mesmo princípio do §10 e do §12: fechar por
construção em vez de confiar que ninguém esquece.

**O padrão é aparecer.** Quem não quiser precisa dizer (`roomNav`). Amarrei isso
ao `editMode` primeiro e estava errado: o wizard usa esse modo tendo um trilho
próprio, mas o inner-view usa o MESMO modo para marcar hotspots — e ali
desligar a lista tirava a única navegação que o dono tinha. Com opção explícita
e padrão ligado, esquecer de pensar no assunto é o caso seguro.

**Nada no template é getter nem método.** O laço de render deste componente roda
DENTRO da zona, então cada expressão é reavaliada ~60 vezes por segundo: um
getter que ordenasse a lista devolveria array novo sessenta vezes por segundo, e
o `@for` refaria o diff em cima. Tudo é campo simples, recalculado no
`ngOnChanges` e ao trocar de foto. É a mesma lição do rótulo do pin (§10),
aplicada antes de virar defeito desta vez.

A posição do topo sai de uma variável CSS porque o inner-view tem cabeçalho
sobreposto e o embed não tem nada. A conta repete os 64px do cabeçalho em vez de
ler `--header-total-height`: aquela variável é declarada no host do
`app-header`, e propriedade customizada só desce pela árvore de quem a declara —
o viewer é IRMÃO do cabeçalho, não filho, e nunca a enxergaria.

### A crase, quinta vez — e o verificador falhou

O `checa-crases.js` do §10 deixou passar. Ele olhava linha a linha e só
examinava as que TINHAM um abridor de comentário; minhas crases estavam numa
linha de continuação de um `<!-- -->` de vários parágrafos, sem marcador nenhum
na própria linha. Reescrito com estado de comentário ao longo do bloco, e
provado com o defeito injetado: aponta a linha exata.

Lição: uma ferramenta que existe para pegar um erro precisa ser testada CONTRA o
erro que ela ainda não viu, não só contra o que motivou escrevê-la.

### O fiscal continua de pé, e é de propósito

Com a lista, o bloqueio de alcançabilidade do §12 passa a ser mais rígido do que
o necessário: nenhum ambiente fica invisível, então "publico com três ligados e
termino amanhã" volta a ser legítimo. O passo natural é rebaixá-lo a aviso.

Não foi feito junto porque a lista ainda **não foi verificada no navegador** — o
dono estava usando as portas. Tirar a rede de proteção no mesmo commit que
adiciona a coisa não verificada seria trocar uma garantia por uma promessa. O
bloqueio custa uma conveniência; o buraco que ele tapa custa um tour quebrado.

## 16. Nomes de ambiente: por que NÃO virou uma quarta etapa

A proposta era uma etapa entre o upload e os hotspots, só para nomear ambientes
— porque na etapa 2 o seletor de destino oferecia nomes inúteis. O diagnóstico
estava certo; a causa era outra.

O campo de nome **já existia** na etapa 1, em cada card, ao lado da miniatura.
O defeito estava no valor padrão:

    function defaultRoomName(fileName) {
      return fileName.replace(/\.[^.]+$/, '');
    }

Nome de arquivo sem extensão. Sobe IMG_2841.jpg e o ambiente se chama
"IMG_2841" — e duas telas depois o seletor de destino oferece "IMG_2841,
IMG_2843, IMG_2847".

**Por que não a etapa nova.** O campo já está no lugar certo: ao lado da FOTO,
que é a única coisa que diz como chamar o ambiente. Uma etapa dedicada mostraria
as mesmas fotos, noutro quadro, com o mesmo campo — pagando um portão inteiro de
wizard por algo que já existe. Portão custa: mais um lugar para abandonar, mais
um voltar/avançar, mais um segmento de progresso.

O que estava quebrado eram outras duas coisas:

1. **O padrão parecia preenchido.** "IMG_2841" num campo lê como resolvido.
   Agora nasce vazio, com placeholder "Ex: Sala, Cozinha".
2. **Ninguém era cobrado.** A etapa 1 agora trava enquanto houver ambiente com
   imagem e sem nome, marcando os cards — e só DEPOIS da primeira tentativa,
   porque o card nasce sem nome de propósito e vermelho antes de erro é
   repreensão.

Juntas dão a mesma garantia da quarta etapa, sem etapa nenhuma.

**O que ficou de fora, consciente:** a captura guiada segue nomeando "Ambiente
N". É nome que o produto escolheu — ordinal, estável, casando com o badge do
card —, não artefato do sistema de arquivos vazando para o produto. E exigir
formulário logo depois de um minuto girando com o celular é o pior momento
possível para cobrar. Fica anotado que o seletor de destino de um tour capturado
ainda mostra "Ambiente 1, Ambiente 2".

**`showErrors` passou a zerar na troca de etapa.** Ele quer dizer "esta pessoa
tentou e não deu", e isso é sobre a etapa em que ela tentou; carregá-lo adiante
faria a etapa 3 abrir com campos em vermelho antes de qualquer tentativa.

### O rótulo do pin agora deriva do destino

A segunda metade da ideia, e ela tapa um defeito que estava no ar: o ponto nasce
com `label` vazio, e o `createHotspotSprite` recebia `hotspot.label ?? ''`. Sem
rótulo, o sprite desenhava **uma pílula larga com um dot e nenhum texto** — um
botão sem nome flutuando sobre a foto, no tour que o cliente recebe.

Rótulo vazio passou a significar "use o nome do ambiente de destino", resolvido
na hora de desenhar, nos dois lugares que desenham pin (o overlay HTML do wizard
e o sprite do viewer).

**Deriva, não copia.** Gravar o nome no rótulo quando o destino é escolhido
criaria duas versões da mesma verdade, e a desatualizada seria justamente a que
o visitante lê: renomear "Cozinha" para "Cozinha gourmet" na etapa 1 deixaria os
pins com o nome velho. Derivando, renomear conserta tudo sozinho.

O campo de nome do ponto deixou de ser "dê um nome" e virou "escreva outro, se
quiser" — e mostra como placeholder o nome herdado, que é o texto que o pin
exibe. Sem isso, a diferença entre vazio e preenchido exigiria uma frase de
ajuda.

## 17. Nomear a captura no preview, não num modal

Continuação do §16, e uma correção do que ficou lá. Eu tinha deixado a captura
guiada nomeando "Ambiente N", com o argumento de que cobrar formulário logo
depois de um minuto girando com o telefone é o pior momento possível. O
argumento sobre o MOMENTO estava certo; a conclusão, não.

Nomear funciona onde está a EVIDÊNCIA:

- no upload, a evidência é a miniatura na lista — por isso o card é o lugar;
- na captura, a evidência é a pessoa estar **de pé dentro do cômodo**. Isso é
  verdade naquele instante e nunca mais com a mesma força. Dez minutos depois
  são oito miniaturas de parede branca e um esforço de memória para separar o
  quarto do escritório.

Então a captura merece ser nomeada na hora — eu estava errado em tratar os dois
caminhos igual.

**No preview, não num modal depois do "Usar".** A tela de preview já é a
confirmação: mostra o panorama, tem "Confira o resultado" e os botões Refazer /
Usar. Um campo acima deles custa zero telas e zero toques; um diálogo depois do
"Usar" custaria uma tela e um fechamento pelo mesmo campo. Mesma regra do §16 —
não se cria superfície para um campo que cabe numa que a pessoa já está olhando.

Três decisões que valem mais que o campo em si:

- **Sem foco automático.** O teclado subiria cobrindo justamente o panorama que
  a pessoa veio conferir, que é o propósito declarado da tela.
- **Sem obrigar ali.** A etapa 1 já é o portão. Aqui é oportunidade — e assim a
  objeção original ("pior momento para cobrar") continua respeitada.
- **Chips de sugestão.** Digitar em pé, segurando o telefone, é a fricção real;
  um toque resolve o caso comum. Vêm de UMA chave separada por vírgula, e não de
  uma chave por item, para o tradutor trocar o conjunto inteiro pelo que faz
  sentido no idioma — a lista de cômodos de uma casa não é a mesma em toda
  parte.

O `CAPTURED_ROOM` saiu: o badge do card continua mostrando "Ambiente N", então a
identidade ordinal não se perdeu. O que se perdeu foi um nome de mentira
ocupando o campo. O contador segue existindo para o nome do ARQUIVO.

Refazer NÃO apaga o nome: quem refaz está refazendo o mesmo cômodo.

---

## §18 — A lixeira: um desenho por operação

Pedido do dono, olhando o sheet no iPhone: *"esse botão X poderia ser uma
lixeira, e a cor podia ser vermelha, para ser mais claro"*. Está certo nas duas
metades, por motivos diferentes.

**O ✕ estava ambíguo por posição.** Dentro de um bottom sheet, ✕ é o glifo de
FECHAR. O mesmo desenho servia para "tira isto da tela" e para "apaga isto de
vez, sem desfazer", a 300px de distância um do outro. Pior: a própria etapa 2 já
ensinava lixeira no arrastar-para-excluir. Duas figuras para uma operação, no
mesmo lugar, na mesma sessão.

**O vermelho é o de ERRO, não o da marca.** A regra já estava escrita no
`tour-wizard.scss` para o texto de erro: a Rausch (#E8365D) é cor de ação
primária — ela pinta o badge do número, a borda do campo em foco e o "Concluído"
do sheet. Pintar o excluir dela deixaria, no mesmo card, o botão que apaga com a
roupa do botão que confirma. Vale o `--ion-color-danger` (#c13515, 5,5:1 sobre
branco).

**Vermelho no ícone, não no fundo.** Um bloco vermelho sólido por card faria da
exclusão a coisa mais chamativa da lista, e não há confirmação depois dela. O
objetivo é que se LEIA à primeira vista, não que atraia o dedo. O hover então se
anuncia pelo fundo (`--tw-error-soft`), porque a cor já foi gasta em repouso.

**SVG e não o emoji 🗑.** Emoji ignora `color`: no iOS sai sempre no desenho do
sistema. O botão vermelho teria um ícone cinza-azulado dentro, e a pílula escura
da lixeira já tinha um ícone colorido sobre texto branco. `TrashIconComponent`
usa `stroke="currentColor"` e não tem tamanho próprio — quem chama define a
caixa, porque o botão é que sabe se está num dedo ou num mouse.

Aplicado nos três lugares (card de ponto, card de ambiente, pílula do arraste).
De carona, dois buracos que estavam ali: o botão da etapa 1 não tinha
`:focus-visible` nenhum, e não tinha a extensão de alvo para 44px que o da etapa
2 já tinha. Errar aquele botão apaga uma foto que a pessoa foi tirar no lugar.

### O teste intermitente que apareceu no caminho

Ao rodar a suíte, uma falha em ~1 de 3 execuções, em arquivo alheio:
`HotspotPanelComponent — leva o foco ao card de um ponto que ACABOU de nascer`
achava `<ion-modal>` em `document.activeElement`.

Causa: `hotspot-sheet.component.spec.ts` apresenta `IonModal` de verdade e nunca
desmontava as fixtures. A apresentação do Ionic é assíncrona — o teste acaba
antes de ela concluir, o modal sobrevive ao teardown e continua prendendo o foco
do DOCUMENTO, que é um só para a suíte. Só falhava quando o Karma sorteava essa
ordem.

Não é dano deste trabalho; o arquivo novo mudou a distribuição do sorteio e
revelou. Corrigido na origem, com `afterEach` que destrói as fixtures e remove
qualquer `ion-modal` restante. **Provado por mutação:** com a limpeza, 6 de 6
execuções limpas; neutralizando só o corpo do `afterEach`, 2 falhas em 6.
