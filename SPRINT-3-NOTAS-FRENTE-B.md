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
