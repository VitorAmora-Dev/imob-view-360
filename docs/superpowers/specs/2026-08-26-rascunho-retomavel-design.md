# Rascunho retomável: não perder a captura ao voltar, recarregar ou fechar o app

## O problema, como ele realmente é

O corretor captura um cômodo, espera a IA montar, vê o resultado — e perde tudo
se tocar em voltar, recarregar a página ou o sistema matar o app em segundo
plano.

Só que "perde tudo" não é exato, e a diferença decide o tamanho desta task.

**O que já está salvo.** `tratarCaptura()` cria o panorama no servidor *antes* de
mandar tratar, e a versão tratada é gravada em `Panorama.treatedImageData`. O
imóvel e o tour DRAFT também já existem — `garantirRascunho()` os cria na
primeira captura. As fotos e os US$ 0,19 por cômodo estão pagos e guardados.

**O que se perde.** Só o último quilômetro, que hoje vive exclusivamente na
memória do cliente:

| Dado | Onde está hoje | Quando chega ao servidor |
|---|---|---|
| Nome do cômodo | `scene.room` | Só no publicar (servidor tem `"Ambiente 1"`) |
| Hotspots | `scene.hotspots` | Só no publicar |
| Dados do imóvel (etapa 3) | `property()` | Só no publicar |
| Ordem e capa | recalculados | Só no publicar |

Não há `localStorage` nenhum no wizard. Nada sobrevive a um F5.

Então o trabalho não é "criar um sistema de rascunho" — o rascunho existe. É
**persistir o último quilômetro e construir o caminho de volta**, que hoje não
existe: a listagem de imóveis exclui DRAFT de propósito, e `GET
/virtual-tours/:id` é rota pública que filtra `PUBLISHED`.

## Por que uma pergunta não basta

O critério pede um diálogo ao voltar. Ele resolve o botão voltar e mais nada:
`beforeunload` é ignorado ou limitado nos navegadores de celular, e não dispara
quando o sistema mata o app em segundo plano — que são exatamente os dois casos
citados no chamado.

O que cobre os três é **salvar continuamente**. O diálogo passa a servir a outro
propósito, mais honesto: perguntar se ele quer **descartar**.

## Decisões tomadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Fonte da verdade | Servidor | O rascunho atravessa aparelhos: captura no celular dentro do imóvel, descrição no computador do escritório. As fotos já estão lá. |
| Quantos rascunhos | Vários | Cada um já é um `Property` + `VirtualTour` DRAFT independentes. Limitar a um exigiria código novo para bloquear ou descartar o anterior. |
| Onde ele reaparece | Faixa no topo da home | Visível quando ele abre o app, que é quando lembra. Some quando não há rascunho, e não polui o catálogo. |
| O diálogo do voltar | Continuar depois / Descartar / Cancelar | Diz a verdade: já está salvo, a decisão é se ele quer guardar. E dá saída para quem só testava. |

## A arquitetura

### O salvamento já está escrito

`publish()` hoje é duas coisas coladas:

```
publish()  =  [reconcilia nome, ordem, capa, hotspots, imóvel]  +  publicarTour()
              └──────────────── isto é o salvamento ────────────┘
```

O miolo sai para `salvarRascunho()` e passa a ser chamado de três lugares:

| Quando | Chamada |
|---|---|
| Ao publicar | `salvarRascunho()` + `publicarTour()` |
| Ao sair pelo voltar | `salvarRascunho()` |
| Ao trocar de etapa e no `visibilitychange → hidden` | `salvarRascunho()` |

Isto é o coração do desenho e a razão de ele ser barato: **zero migração, zero
rota de escrita nova.** `PATCH /panoramas/:id`, `PATCH /properties/:id` e o CRUD
de `/hotspots` já existem. A reconciliação já está escrita e testada.

O efeito colateral é que `publish()` **encolhe** em vez de crescer, e passa a
exercitar o mesmo caminho do salvamento toda vez que alguém publica — o que
impede o salvamento de apodrecer sem ninguém notar.

**Alternativa descartada:** uma coluna `draftState Json` no `VirtualTour`, com o
cliente mandando o estado inteiro. Mais simples no cliente, mas cria uma segunda
representação de dados que já têm tabela — `roomName` viraria coluna *e* campo
no JSON, hotspot viraria linha *e* objeto. Duas verdades divergem, e no publicar
alguém teria que decidir qual vence. Além da migração.

### Servidor: duas rotas, ambas de leitura

**`GET /virtual-tours?status=DRAFT`** — a lista da faixa. Autenticada, escopada
por agência. Devolve por rascunho: `id`, `propertyId`, `updatedAt`, quantidade
de cômodos e o `id` do primeiro panorama, para a miniatura.

> Usa `@Get()` sem parâmetro **de propósito**. `GET /virtual-tours/rascunhos`
> seria capturado pelo `@Get(':id')` que já existe, dependendo da ordem de
> registro dos controllers — uma armadilha que falha silenciosamente e só
> aparece em runtime.

**`GET /virtual-tours/:id/rascunho`** — o tour completo para reidratar.
Autenticada, escopada por agência, sem filtro de status. Mesmo padrão do
`/panoramas/:id/preview`: escopo por `virtualTour.property.agencyId`, e
`NotFoundException` em vez de 403, para não revelar que o id existe.

Devolve panoramas com `roomName`, `order`, `initialPanorama`, `treatmentStatus`
e hotspots — e **nenhuma coluna de imagem**, pelo mesmo motivo que
`find-virtual-tour.service.ts` já documenta: era ela que fazia o tour mais
pesado sair com 58,4 MB de JSON. As imagens vêm por URL, sob demanda.

### Retomada barata

Retomar um tour de seis cômodos baixando as equirretangulares inteiras seriam
dezenas de MB no 4G antes de mostrar qualquer coisa. A rota `/preview` já aceita
`w`, então:

| O quê | Quando | Custo |
|---|---|---|
| Miniatura `w=320` | Faixa da home e cards da etapa 1 | Alguns KB por cômodo |
| Equirect tratada, inteira | Quando o viewer abre aquele cômodo | Sob demanda, um por vez |
| Equirect original, inteira | Só se ele tocar em "ver original" | Sob demanda |

Isso pede uma unidade nova pequena e com um propósito só: um cache de imagens de
panorama, indexado por `(panoramaId, variante)`, que baixa pelo `HttpClient` —
que leva o token — e devolve `blob:`. Ele é o dono desses blobs e os revoga no
`reset`. Hoje esses `URL.createObjectURL` estão espalhados entre o store e o
modal de captura.

> A rota é autenticada, então o `TextureLoader` não consegue buscá-la sozinho:
> ele não passa por interceptor. É a mesma restrição que causou a tela branca
> corrigida em `036b4ac`, e é por isso que o caminho é sempre
> `HttpClient → blob: → viewer`.

### Cliente: o que muda

**`TourDraftStore`** ganha `salvarRascunho()` (extraído de `publish`),
`retomarRascunho(tourId)` e `descartarRascunho()`. `publish()` perde o miolo.

**`retomarRascunho(tourId)`** lê a rota nova e remonta as `WizardScene` com
`serverPanoramaId` preenchido, sem baixar imagem — só as miniaturas. Cena
retomada não tem `imageData` até alguém precisar dela; `publish()` já pula
`addPanorama` quando `serverPanoramaId` existe, então o caminho de publicar
continua valendo sem mudança.

**Faixa "Capturas em andamento"** na home, visível só quando a lista não é
vazia. Cada cartão: miniatura do primeiro cômodo, quantos ambientes, quando
parou, e um menu para descartar.

**Diálogo do voltar** no wizard, com três saídas — continuar depois, descartar,
cancelar. Só aparece quando há algo a perder: sem nenhum cômodo capturado, sai
direto.

**Descartar apaga o `Property`, não o tour.** `DELETE /properties/:id` já existe,
e `VirtualTour.property` é `onDelete: Cascade` — uma chamada derruba tour,
panoramas, hotspots e frames. Apagar só o tour deixaria para trás um imóvel
órfão chamado "Captura em andamento", e imóvel **sem tour nenhum** passa pelo
filtro da listagem: `NOT: { virtualTour: { is: { status: 'DRAFT' } } }` esconde
quem tem tour DRAFT, não quem não tem tour. O descarte pela metade apareceria no
catálogo como a linha vazia que aquele filtro existe para evitar.

**Salvamento no `visibilitychange → hidden`**, que dispara de verdade quando o
celular manda o app pro fundo.

## Dois riscos que o desenho precisa resolver

**1. `PATCH /properties/:id` rejeita corpo vazio.** O `.refine()` existe para que
um PATCH sem nenhum campo não passe como sucesso. Um rascunho com a etapa 3 em
branco não tem o que mandar. `salvarRascunho()` precisa **pular a chamada**
quando não há campo preenchido, e não engolir o 400 — engolir esconderia falha
real de rede no mesmo silêncio.

**2. Hotspots são apagados e recriados a cada salvamento.** Hoje isso roda uma
vez, no publicar, e a janela sem hotspot no banco dura milissegundos e é
invisível. Rodando a cada troca de etapa, essa janela passa a existir muitas
vezes — e se a rede cair no meio dela, o rascunho retomado volta sem os pontos
que o corretor marcou.

A correção entra nesta task: **reconciliação incremental** — criar os que são
novos, `PATCH` nos que mudaram de lugar, `DELETE` só nos que sumiram de verdade.
Isso exige que cada hotspot carregue o id do servidor, hoje guardado numa lista
solta (`hotspotsNoServidor`) que não diz qual id corresponde a qual ponto.

## Arquivo congelado

`tour-wizard.model.ts` é **CONGELADO** (SPRINT-3-TOUR-WIZARD.md §4.2): mudança
só por PR para `feature/tour-wizard`, com as duas frentes cientes. Esta task
precisa de:

- `WizardHotspot.serverHotspotId?: string` — para a reconciliação incremental.
- `WizardScene.imageData` passa a admitir string vazia numa cena `ready`, que
  hoje é contradição: cena retomada tem a foto no servidor e nada em memória até
  alguém precisar dela. Em vez de um campo booleano novo, a condição vira
  "`imageData` vazio **e** `serverPanoramaId` presente" — um estado que já é
  representável, só não era esperado. O que precisa mudar é a documentação do
  campo e os pontos que hoje assumem `imageData` sempre preenchido.

O cabeçalho do arquivo também afirma "nada aqui é o que o servidor guarda". Isso
já não era verdade desde `serverPanoramaId`; vale corrigir a frase no mesmo PR
em vez de deixá-la envelhecer mentindo.

## `limpar-rascunhos`

O script apaga DRAFT com `updatedAt` mais velho que 7 dias. Enquanto o rascunho
era invisível, isso era higiene. Com ele num menu, o mesmo script passa a apagar
o que o corretor acha que guardou.

Janela sobe para **30 dias**. Continua seco por padrão.

## Verificação

**Servidor** — Jest com Postgres de verdade, `yarn test:local`. Services
instanciados à mão, sem `Test.createTestingModule`, no padrão de
`panorama-image.spec.ts`.

- A listagem traz só DRAFT, só da agência de quem pediu, e não vaza rascunho de
  outra agência.
- `GET /virtual-tours/:id/rascunho` serve DRAFT; devolve 404 para agência errada
  e para id inexistente, sem distinguir os dois.
- A resposta **não** traz `imageData` nem `treatedImageData`.

**Cliente** — Karma + Jasmine, `npm test`. Mock por `spyOn` no serviço injetado
retornando `of(...)`, nunca `HttpTestingController`.

- `salvarRascunho()` grava nome, ordem, capa e hotspots; `publish()` chamado
  logo depois não duplica nada.
- `salvarRascunho()` **pula** o `PATCH` do imóvel quando a etapa 3 está vazia.
- Reconciliação de hotspot: mover um ponto vira `PATCH` e não
  `DELETE`+`POST`; remover um vira `DELETE` só dele; os outros ficam com o mesmo
  id do servidor.
- `retomarRascunho()` remonta as cenas sem baixar equirect nenhuma.
- Falha de rede em `salvarRascunho()` não derruba o wizard nem perde o estado em
  memória.

**Na mão** — é o único jeito de validar o que motivou o chamado:

1. Capturar um cômodo, dar nome, tocar em voltar, escolher "continuar depois".
   Voltar pela faixa da home e encontrar o nome que foi digitado.
2. Capturar dois cômodos, marcar um hotspot, **recarregar a página** sem tocar
   em nada. Retomar e achar o hotspot no lugar.
3. Retomar num aparelho diferente do que capturou.
4. Descartar pela faixa e confirmar que imóvel, tour e panoramas somem.

## Fora de escopo

**Salvamento offline.** Sem rede, `salvarRascunho()` falha e o estado continua só
em memória — recarregar ali ainda perde. Cobrir isso pede uma fila local de
escritas, que é outra task e outro risco.

**Retomar direto na etapa 2 ou 3.** O rascunho retomado abre sempre na etapa 1.
Guardar em qual etapa ele parou é fácil, mas decidir se isso ajuda ou confunde é
uma pergunta de produto que não foi feita.
