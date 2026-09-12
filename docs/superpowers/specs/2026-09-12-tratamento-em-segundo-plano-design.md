# Tratamento por IA em segundo plano (etapa 1 do wizard)

> Spec de desenho, validada em conversa antes de qualquer código.
> Branch: `feat/tratamento-em-segundo-plano`
> Base: `a6e3d4d` (origin/main). Data: 2026-09-12.
> Escopo tocado: **`inner-view-client/`** e uma linha de log em **`server-api/`**.

## O pedido

> Há uma demora grande no carregamento do tratamento da foto com IA. A
> solicitação é implementar um botão para que o usuário possa continuar
> capturando os próximos cômodos enquanto o tratamento atual fica em segundo
> plano.
>
> É extremamente importante que esse processo secundário não seja cancelado por
> nenhuma outra ação que acontecer no sistema. Ele só pode seguir pra próxima
> etapa (2) se os cômodos estiverem tratados.

## O que existe hoje

Levantado no código contra `a6e3d4d`, não suposto.

- **A espera é deliberada e já foi revertida uma vez.** O cabeçalho de
  `tratarEEntao`, em `capture-360.component.ts`, diz: *"Segura a tela enquanto a
  IA monta o cômodo, e só então mostra a foto. É esta espera que faz o corretor
  ver o resultado BOM no momento em que ele está olhando. Tratar em segundo
  plano escondia melhor a espera, mas entregava o panorama cru justamente no
  instante de maior atenção, e era por ele que o produto era julgado."*

- **O modal segura a tela.** O estado `'treating'` fica no ar entre a costura e
  o preview. `step-images.openCapture()` injeta um callback `tratar` e só recebe
  `treatedUrl` quando o servidor termina.

- **O servidor já não pode ser cancelado.** `tratarCaptura` cria a linha com
  `addPanorama` **antes** de tratar, sobe as fotos de referência e chama
  `montarTour`. O `AbortController` do store só interrompe *ficar olhando*. O
  comentário de `ESTADO_DA_IA` registra: *"Captura interrompida de verdade no
  meio da montagem não perde nada: o servidor termina sozinho, e a retomada
  SEGUINTE encontra `DONE`."* **O requisito mais duro do pedido já está
  garantido pela arquitetura.**

- **Não existe acompanhamento em segundo plano.** `WizardSceneAiState` é
  `'idle' | 'done' | 'failed' | 'skipped'` — sem `'treating'`. O mapa
  `ESTADO_DA_IA` converte `PENDING` e `PROCESSING` para `'idle'` de propósito,
  e o comentário do tipo explica por quê: *"como nenhuma tela do wizard
  acompanha montagem, o selo 'Melhorando com IA…' acendia em foto que nunca
  seria tratada e não saía mais. Um estado que ninguém alcança e ninguém
  encerra é onde a mentira cabe."* **Esta entrega é exatamente o "alguém que
  encerra" que faltava.**

- **A peça de acompanhamento existe e está ociosa.**
  `VirtualTourService.acompanharMontagem` já é **por tour**, devolve a lista
  cômodo a cômodo, tolera queda de rede sem encerrar, aceita `AbortSignal` e
  tem teto configurável (padrão de dez minutos). Hoje só é usada dentro de
  `esperarPanorama`, com teto reduzido para dois minutos porque tem alguém
  parado olhando.

- **O nome do cômodo é pedido depois da espera.** O campo vive na tela de
  preview do modal (`capture-360.component.html`, `#captura-nome`), que só
  aparece quando o tratamento termina. E `canAdvance()` na etapa 1 exige
  `ambientesSemNome().length === 0`.

- **A trava da etapa 1 hoje só olha nome.**
  `canAdvance()`: `if (this.step() === 1) return this.ambientesSemNome().length === 0;`

- **O servidor já trata falha e dispensa como terminais.**
  `MontarTourService.andamento()` calcula
  `terminado: prontos + falhas + dispensados >= panoramas.length`.
  Captura com menos de quatro fotos de referência vira `SKIPPED` sem tratar.

- **O servidor não registra duração.** O único log da montagem é
  `"N panorama(s) enfileirado(s)"`. Não há como responder "quanto demora".

## Decisões

### 1. O preview aparece imediatamente, com selo — DECIDIDO

A costura termina e o preview entra com o panorama **costurado**, marcado com um
selo de que a IA ainda está melhorando. A foto tratada substitui a de baixo
quando chega, sem trocar de tela.

Isto responde de frente à objeção que motivou a reversão original. O que foi
revertido entregava o cru **como se fosse o resultado final**. Com o selo, ele
se lê como provisório, e quem espera vê a troca acontecer.

Ganho colateral: o campo de nome volta a ser preenchido **dentro do cômodo**,
que é onde o corretor sabe qual é qual. Sem isto, pular a espera empurraria a
nomeação para o fim, por miniatura, longe do imóvel — trocaríamos uma espera por
uma tarefa pior.

### 2. Dois botões no preview — DECIDIDO

"Confirmar" (como hoje) e **"Capturar próximo cômodo"**. Os dois confirmam o
cômodo; o segundo já reabre a câmera. O texto de apoio acima deles:
"Não se preocupe, você pode continuar."

O botão fica no preview e **não** na tela da coruja, porque na coruja o cômodo
ainda não tem nome nem foto à vista.

### 3. Um acompanhador por tour, no `TourDraftStore` — DECIDIDO

Recusadas: um acompanhador por cômodo (abriria N laços baixando o tour inteiro a
cada 3s para olhar uma linha) e notificação empurrada pelo servidor (infra nova,
cara demais para o ganho de agora).

`acompanharMontagem` já é por tour e já devolve a lista cômodo a cômodo. Um laço
só, nascido na primeira captura que deixa algo em curso, morto quando
`terminado` chega ou a página some. Idempotente: capturar de novo com o laço
vivo não abre um segundo.

### 4. `WizardSceneAiState` ganha `'treating'` — DECIDIDO

`ESTADO_DA_IA` passa a mapear `PROCESSING` para `'treating'`. `PENDING`
continua `'idle'`: é o `@default` da coluna e toda foto vinda de arquivo nasce
assim sem nunca ser tratada.

O comentário do tipo que proíbe isto deve ser **reescrito, não apagado**: a
proibição valia enquanto ninguém encerrava o estado. Registrar o que mudou.

### 5. A trava da etapa 1 cobra "nada em curso", não "tudo tratado" — DECIDIDO

```
step 1 → ambientesSemNome().length === 0 && cômodosEmTratamento().length === 0
```

`failed` e `skipped` **atravessam**. Não é flexibilidade: é a única saída. Os
dois são terminais no servidor e nunca virarão `done`; uma trava literal
prenderia o corretor na etapa 1 para sempre, já fora do imóvel. O card mostra o
aviso, e `motivoBloqueio` ganha a mensagem do caso em curso.

Alinhado com o servidor, que já conta falha e dispensa como terminais em
`andamento()`.

### 6. O estouro do teto cai para terminal local — DECIDIDO

O acompanhamento tem teto de dez minutos. Se estourar com o cômodo ainda em
`PROCESSING`, o cliente marca aquela cena como `'failed'` **localmente** e
libera a trava, com aviso no card.

Sem isto, a decisão 5 teria o mesmo defeito que ela corrige: uma trava eterna. A
montagem em si continua no servidor, e uma retomada posterior encontra o
resultado.

### 7. O intervalo do laço afrouxa quando ninguém olha — DECIDIDO

Três segundos enquanto a tela de espera está no ar; dez segundos quando o
acompanhamento roda por baixo da captura seguinte. É rede e bateria em campo,
e ali a resposta não precisa ser imediata.

### 8. A retomada de rascunho também acende o acompanhador — DECIDIDO

Rascunho retomado com cômodo em `PROCESSING` inicia o laço. Conserta de lambuja
a limitação que `ESTADO_DA_IA` documenta hoje.

### 9. O servidor passa a registrar a duração — DECIDIDO

Uma linha por panorama em `treat-panorama.service.ts`, com o tempo decorrido.
É o que transforma "está demorando" em número. Sem isto continuamos consertando
a percepção de uma espera que ninguém mediu.

## As peças

| arquivo | mudança |
|---|---|
| `capture-360.component.ts` | `tratarEEntao` deixa de segurar; preview imediato, troca de imagem quando a tratada chega |
| `capture-360.component.html` | selo sobre o preview, segundo botão, texto de apoio |
| `capture-360.component.scss` | selo e a dupla de botões |
| `tour-wizard.model.ts` | `'treating'` no tipo; comentário reescrito |
| `tour-draft.store.ts` | o acompanhador, `ESTADO_DA_IA`, `cômodosEmTratamento`, trava, estouro do teto |
| `step-images.component.ts/html` | reabrir a câmera; selo "tratando" no card |
| `wizard-actions.component.ts` | `motivoBloqueio` do caso em curso |
| `pt.json` / `en.json` | as chaves novas |
| `treat-panorama.service.ts` | log de duração |

## Fluxo de dados

```
costura pronta
  └─> preview (costurado + selo + nome + 2 botões)     [modal]
        ├─ "Confirmar"            -> fecha o modal
        └─ "Capturar próximo"     -> fecha e reabre a câmera
              │
              └─> store: cena entra com aiState 'treating'
                    └─> acompanhador do tour (um só, 3s/10s)
                          ├─ DONE     -> 'done',  baixa a tratada, troca a foto
                          ├─ FAILED   -> 'failed', aviso no card
                          ├─ SKIPPED  -> 'skipped', aviso no card
                          └─ teto     -> 'failed' local, aviso no card
                                └─> trava da etapa 1 libera
```

O envio (`addPanorama` + `uploadCaptureFrames` + `montarTour`) continua onde
está, dentro de `tratarCaptura`. **Nada do que o corretor faz cancela isso.**

## Estados na tela

| estado | o que aparece |
|---|---|
| costurando | coruja, como hoje |
| preview, tratando | panorama costurado, selo "Melhorando com IA…", nome, 2 botões |
| preview, tratado | panorama tratado, sem selo, nome, 2 botões |
| preview, sem melhora | aviso existente `CAPTURE.NAO_MELHOROU` |
| card, tratando | selo pulsando, distinto do `is-enhanced` |
| card, falhou/dispensado | aviso, e a etapa 1 deixa passar |

## i18n

Chaves novas, em `pt.json` e `en.json`:

- `CAPTURE.TRATANDO_SELO` — "Melhorando com IA…"
- `CAPTURE.PODE_CONTINUAR` — "Não se preocupe, você pode continuar"
- `CAPTURE.PROXIMO_COMODO` — "Capturar próximo cômodo"
- `TOUR_WIZARD.STEP1.BADGE_TRATANDO` — selo do card
- `TOUR_WIZARD.COMMON.NEEDS_TREATMENT` — motivo do bloqueio

## Testes

Com injeção de defeito em cada um: o teste só entra depois de eu reintroduzir o
defeito que ele guarda e vê-lo cair.

1. Sair pelo "Capturar próximo cômodo" **não** cancela o envio: `montarTour`
   segue chamado, e a cena entra com `serverPanoramaId`.
2. O acompanhador leva a cena de `'treating'` a `'done'` e troca a foto.
3. `failed` e `skipped` **atravessam** a trava da etapa 1.
4. `'treating'` **segura** a trava da etapa 1.
5. O estouro do teto libera a trava em vez de prender.
6. Um acompanhador só, com três capturas seguidas.
7. Retomada de rascunho com `PROCESSING` acende o laço.
8. O preview mostra o costurado antes de a tratada chegar, com o selo.
9. O campo de nome está disponível antes dos dois botões.

## Critérios de aceite do pedido — onde cada um é atendido

| critério | onde |
|---|---|
| botão na tela de tratamento | decisão 2 (no preview, não na coruja — justificado) |
| texto "Não se preocupe, você pode continuar" | i18n `CAPTURE.PODE_CONTINUAR` |
| texto "Capturar próximo cômodo" | i18n `CAPTURE.PROXIMO_COMODO` |
| continuar capturando | decisão 2 |
| tratamento como ação secundária | decisões 1 e 3 |
| nada cancela o processo | já garantido hoje; teste 1 prende |
| só avança com os cômodos tratados | decisão 5, com a ressalva de falha e dispensa |

## Fora de escopo

- Acelerar o tratamento em si. A decisão 9 mede; acelerar é outro trabalho.
- Notificação empurrada pelo servidor.
- Acompanhar montagem fora do wizard.

## Riscos registrados

- **A reversão de 2026-08.** Estamos reabrindo uma decisão tomada com evidência
  de campo. A mitigação é o selo da decisão 1, e a espera continua sendo o
  padrão para quem não tocar no botão. Se o produto piorar, o sinal aparece
  antes no suporte do que em teste.
- **Bateria e rede em campo.** Mitigado pela decisão 7, não eliminado.
- **`URL.createObjectURL` da tratada.** Uma por cômodo, agora criada fora do
  modal. Precisa de `revokeObjectURL` no descarte da cena e no destroy do store,
  senão vaza a foto inteira por cômodo.
