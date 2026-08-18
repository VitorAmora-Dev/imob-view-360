# Sprint 3 — Wizard de criação de tour (3 etapas)

> Plano de divisão do handoff `design_handoff_tour_wizard/` em **duas frentes
> paralelas**, para dois devs. Este arquivo é o contrato do sprint: quem for
> implementar deve conseguir trabalhar lendo só ele + o README do handoff.
> Se algo aqui divergir do código, o código vence e esta nota é que está errada.

Escopo tocado: **apenas `inner-view-client/`**. Nenhuma alteração em
`server-api/` — a API já tem tudo de que este fluxo precisa (§2.2), o que mantém
o mapa de fronteiras acordado no Sprint 2.

Numeração do sprint assumida a partir de `SPRINT-2-NOTES.md` (encerrado).

---

## 1. Leitura crítica: o que o handoff assume e o código já resolve

O handoff foi escrito sem conhecer o codebase. Sete pontos mudam a implementação
e **precisam ser lidos antes de estimar qualquer coisa**.

| # | O handoff diz | O que vale aqui |
|---|---|---|
| 1 | Viewer é "uma imagem estática"; converter % → yaw/pitch | `PanoramicViewerComponent` já é three.js, já tem `editMode` e já emite `hotspotPlaced` em **UV (0–1)**. O backend já grava `positionX`/`positionY` nesse formato. **Não há conversão a fazer** — o que falta é desenhar os pins como HTML sobre o canvas. |
| 2 | "Tirar foto agora" = `<input capture="environment">` | Existe `Capture360Component`: captura 360 guiada, com stitching. É muito melhor que o `capture`. Abrir o modal quando `captureSupported()`; cair no seletor de arquivos quando não. É exatamente o que a tela antiga já faz. |
| 3 | Implementar autofill de CEP | `CepService` já existe e trata `CepNotFoundError`. É plugar, não construir. |
| 4 | Topbar bespoke com voltar + logo + título + nav | `AppHeaderComponent` já entrega tudo isso (`backHref`, `pageTitle`, links, sticky, colapso em scroll). Consumir como está — o único item que faltava era o slot "Rascunho salvo", e ele saiu do escopo (ver 2.3). |
| 5 | Bottom sheet à mão (scrim + painel + handle + trap de foco) | `IonModal` com `breakpoints`/`initialBreakpoint` entrega sheet nativo, swipe-down, foco preso, Esc e animação de entrada de graça. Usar isso. |
| 6 | Cor primária `#E8365D` | O design system do projeto usa Rausch `#ff385c` (`--ion-color-primary`, ver `DESIGN.md`). O próprio README manda adaptar aos tokens existentes. **Usar o token do projeto** e confirmar com design. |
| 7 | Feedback tátil "considere `navigator.vibrate`" | `@capacitor/haptics` já está instalado. Usar `Haptics.impact()`. |
| 8 | Hotspots são criados um a um, por requisição | `POST /virtual-tours` **já aceita os hotspots inline**, dentro de cada panorama, com `targetTempId` resolvido no servidor na mesma transação. Quem está incompleto é o cliente: `PanoramaUpload` não expõe o campo `hotspots`. Ver 2.2. |

Além disso: **tudo passa por `ngx-translate`**. O handoff traz as strings em PT
cravadas; nenhuma delas entra no template direto.

---

## 2. Decisões tomadas

As três primeiras eram bloqueios de verdade e estão **decididas**. Ficam
registradas com o motivo, porque cada uma corta escopo e a razão vai ser
perguntada de novo daqui a alguns meses.

### 2.1 O modelo de Hotspot não comportava o design — DECIDIDO

`virtual-tour.model.ts` hoje:

```ts
export interface Hotspot {
  id: string; label?: string;
  positionX: number; positionY: number;
  targetId: string;          // obrigatório
}                            // e não existe `type`
```

O design pede `type: 'nav' | 'info'` e `target: string | null` (ponto sem destino
é um estado válido e frequente — é o estado logo após criar). Nenhum dos dois
persiste hoje.

**Decidido:** `'info'` está **cortado deste sprint**. O próprio README admite que
"o conteúdo do popup não foi desenhado" (seção *Escopo assumido*, item 2) — é
uma feature sem spec. A pílula "Informação" não é renderizada; o seletor de tipo
do painel e do sheet some junto, já que sobra um tipo só. Entra num sprint
posterior, junto com o desenho do popup.

**Sobre `target: null` — não exige backend.** Uma versão anterior desta nota
pedia uma migration para tornar `targetId` opcional. Estava errada, por confundir
dois momentos diferentes:

- **Durante a edição**, o hotspot sem destino existe só na memória do cliente.
  Nenhum servidor é consultado. `target: string | null` é um campo do
  `WizardHotspot` (4.2), não do banco. Funciona sem tocar em nada.
- **No publicar**, o servidor de fato exige destino (`targetTempId` obrigatório
  no DTO, `targetId` non-null no Prisma). Mas um hotspot sem destino é **inerte**
  — não leva a lugar nenhum, não faz nada no viewer. Gravá-lo não compra nada
  hoje; só faria sentido para o usuário voltar depois e completar, e "editar um
  tour existente" está fora de escopo (§9, item 3).

**Decidido:** no publicar, avisar e descartar — "2 pontos sem destino não serão
salvos". É a saída que o próprio README sugere (seção *Regras de validação*).
Custo de backend: zero.

### 2.2 Persistência dos hotspots — DECIDIDO (e mais simples do que parecia)

Uma versão anterior desta nota dizia que só existiam `createHotspot` e
`deleteHotspot`, e que editar viraria delete+create. Isso vinha de ler o
**cliente** (`virtual-tour.service.ts`, que só embrulha esses dois) e supor que
o servidor fosse igual. Não é. O servidor tem:

- `PATCH /hotspots/:id`, com `label`, `positionX`, `positionY` e `targetId`
  todos opcionais;
- e, o que realmente importa aqui, **`POST /virtual-tours` já aceita os hotspots
  inline**, dentro de cada panorama:

```ts
PanoramaInputSchema = { tempId, roomName, imageData, order,
                        initialPanorama, measurements, hotspots: [...] }
HotspotInputSchema  = { label?, positionX, positionY, targetTempId }
```

O servidor cria os panoramas, guarda um `Map<tempId, uuid>` e resolve cada
`targetTempId` **na mesma transação** (`create-virtual-tour.service.ts`). É
exatamente o formato de que o wizard precisa: ids locais entram, o servidor
devolve o tour montado.

**Decidido:** a Frente B trabalha 100% em memória e o tour inteiro — ambientes e
hotspots — sobe em **uma única chamada** no publicar. Não é uma escolha de
conveniência: durante o wizard não existe `panoramaId` nenhum no servidor (os
panoramas nascem no `createTour`), então não haveria nem o que atualizar.

Consequência prática: **B11 saiu da Frente B.** Escrevendo o contrato ficou
claro que os hotspots moram dentro de `WizardScene`, que é estado do
`TourDraftStore` — ou seja, da Frente A. Mapear cenas para o payload não lê nada
do `HotspotEditorStore`: é transformação pura sobre o estado da A, dentro do
`publish()` da A. Virou `publish-payload.ts`, já pronto no commit-zero.

A Frente B fica sendo **só a experiência de edição** — sem nenhuma
responsabilidade sobre persistência. Menos uma costura entre as duas frentes.

A alteração de cliente que faltava também já entrou: `PanoramaUpload` (em
`virtual-tour.service.ts`) ganhou `tempId` e `hotspots`.

### 2.3 Rascunho — CORTADO DO PRODUTO

O README pede um indicador "Rascunho salvo" no topbar e insiste que ele seja
verdadeiro. Não há endpoint de draft, e a decisão de produto foi **não ter
rascunho nenhum** — nem local, nem no servidor. O fluxo é: preencher e publicar.

Consequências, todas deliberadas:

- O indicador "Rascunho salvo" **não é renderizado**. `AppHeaderComponent` entra
  como está, sem slot de status — some a única alteração que a Frente A faria
  num componente compartilhado.
- `saveState` sai do `TourDraftStore` (ver 4.3) e a tarefa de autosave sai do
  backlog da Frente A (−3 pts).
- **Recarregar a página no meio do wizard perde tudo**, imagens inclusive. É o
  preço aceito da decisão. Se em algum momento isso doer em campo, o caminho mais
  barato é um `beforeunload` avisando antes de sair — não um rascunho.

### 2.4 Upload acontece no publicar, não na soltura do arquivo

O README pede upload por arquivo com progresso e retry. Hoje `createTour` manda
todas as imagens em base64 de uma vez, no fim — e não existe tour antes do imóvel
existir, então não há onde subir antes.

**Recomendação:** manter o modelo atual neste sprint. O card de ambiente mostra
estado local (lendo / validando / pronto / recusado), e a tela de espera de
montagem que já existe (`montagemEtapa`) cobre o envio. Upload incremental é
dívida registrada, com custo de backend.

---

## 3. Estratégia de branches

Três branches, não duas: uma de **integração** que carrega o contrato, e duas de
trabalho. Sem a branch de integração as duas frentes brigam pelo shell do wizard
no primeiro dia.

```
main
 └── feature/tour-wizard                    ← integração + commit-zero (contrato)
      ├── feature/tour-wizard-fundacao      ← Dev A
      └── feature/tour-wizard-hotspots      ← Dev B
```

- PRs pequenos e frequentes das duas frentes **para `feature/tour-wizard`**.
- Rebase diário da branch de trabalho sobre a de integração — obrigatório.
- Um único PR `feature/tour-wizard` → `main` no fim, com QA de responsividade.
- `feature/tour-wizard` nunca recebe commit direto depois do commit-zero.

```bash
cd imob-view-360
git checkout main && git pull
git checkout -b feature/tour-wizard
# ... commit-zero (seção 4) ...
git push -u origin feature/tour-wizard
git checkout -b feature/tour-wizard-fundacao   # Dev A
git checkout feature/tour-wizard
git checkout -b feature/tour-wizard-hotspots   # Dev B
```

> As branches antigas `frontend/feature/new-tour-design` e
> `refactor/new-tour-screen` estão vazias ou defasadas em relação a `main`.
> Apagar antes de começar, para ninguém partir delas por engano.

---

## 4. Commit-zero — o contrato (meio dia, feito em dupla)

**Antes de qualquer dev começar sozinho.** É o que impede as duas frentes de
colidirem. Depois de mergeado, os arquivos marcados **CONGELADO** só mudam via
PR para a integração, com os dois cientes.

### 4.1 Estrutura de pastas criada vazia

```
src/app/tour-wizard/
  tour-wizard.page.ts|html|scss        A   shell navegável
  tour-wizard.model.ts                 CONGELADO
  tour-draft.store.ts                  A   + .spec.ts (12 testes de contrato)
  publish-payload.ts                   A   conversão para o corpo do createTour
  hotspot-editor.store.ts              B
  steps/step-images/                   A   stub
  steps/step-hotspots/                 B   stub
  steps/step-info/                     A   stub
  published/                           A   stub
  ui/                                  A   a criar (stepper, ações, card de cena)
  hotspots/                            B   a criar (overlay, pin, painel, sheet, rail)
src/theme/tour-wizard.scss             CONGELADO — tokens, entra no angular.json
src/theme/_tour-wizard-mixins.scss     CONGELADO — breakpoints, via @use
```

Os tokens ficam num arquivo e os mixins noutro de propósito: o de tokens tem um
bloco `:root`, que sairia duplicado dentro do CSS encapsulado de cada componente
que fizesse `@use` dele.

### 4.2 `tour-wizard.model.ts` — CONGELADO

```ts
/** UV do equirretangular, 0–1 — o mesmo par que o backend grava. */
export interface WizardHotspot {
  id: string;                 // uuid local; só vira id do servidor ao publicar
  u: number;                  // 0–1  (positionX)
  v: number;                  // 0–1  (positionY)
  label: string;
  target: string | null;      // id local do WizardScene de destino
  serverId?: string;          // preenchido no diff do publicar
}

export interface WizardScene {
  id: string;                 // uuid local
  room: string;               // default: nome do arquivo sem extensão, 28 chars
  fileName: string;
  fileSize: number;
  imageData: string;          // dataURL (mesmo formato do PanoramaUpload atual)
  order: number;              // 0 = capa
  hotspots: WizardHotspot[];
  frames?: CaptureFrameUpload[];      // só em captura guiada
  geometry?: CaptureGeometry | null;  // só em captura guiada
  state: 'reading' | 'ready' | 'rejected';
  rejectedReason?: 'type' | 'size' | 'ratio';
}

export type WizardStep = 1 | 2 | 3;
```

> `type: 'nav' | 'info'` está deliberadamente **fora** — ver 2.1. Se o PO
> reverter a decisão, o campo entra aqui e este arquivo descongela uma vez.

### 4.3 `tour-draft.store.ts` — assinaturas CONGELADAS, corpo é do Dev A

```ts
@Injectable()
export class TourDraftStore {
  // ---- estado (A) ----
  readonly step = signal<WizardStep>(1);
  readonly scenes = signal<WizardScene[]>([]);
  readonly selectedSceneId = signal<string | null>(null);
  readonly property = signal<PropertyDraft>(EMPTY_PROPERTY);
  readonly published = signal(false);
  readonly publishing = signal(false);   // trava o botão durante o publicar

  // ---- derivados (A) ----
  readonly selectedScene = computed<WizardScene | null>(...);
  readonly canAdvance    = computed(() => this.readyScenes().length > 0);
  readonly totalHotspots = computed(...);   // soma de TODOS os ambientes
  readonly progressPct   = computed(...);

  // ---- comandos de cena / navegação (A) ----
  addFiles(files: File[]): Promise<void>;
  renameScene(id: string, room: string): void;
  removeScene(id: string): void;
  selectScene(id: string): void;
  goTo(step: WizardStep): void;
  next(): void;
  back(): void;
  publish(): Promise<void>;

  /**
   * Mutador de baixo nível. É a ÚNICA porta pela qual o
   * HotspotEditorStore (Dev B) altera cenas — evita que as duas frentes
   * escrevam no mesmo arquivo.
   */
  patchScene(id: string, fn: (s: WizardScene) => WizardScene): void;
}
```

`hotspot-editor.store.ts` (Dev B) injeta `TourDraftStore`, usa `patchScene` para
tudo que muta, e guarda sozinho o estado efêmero (`sheet`, `pinDrag`, timers de
long-press, flag de supressão de clique).

**Regra:** Dev B nunca edita `tour-draft.store.ts`. Dev A nunca edita
`hotspot-editor.store.ts`.

### 4.4 Shell com os stubs das etapas

`tour-wizard.page.html` já com o `@switch`, apontando para componentes vazios:

```html
@switch (store.step()) {
  @case (1) { <app-tour-step-images /> }
  @case (2) { <app-tour-step-hotspots /> }   <!-- stub do Dev B -->
  @case (3) { <app-tour-step-info /> }
}
```

Cada stub renderiza só o `<h2>` da etapa. Assim as duas frentes rodam a página
inteira desde o primeiro commit.

### 4.5 i18n com os blocos já abertos

Em `pt.json` **e** `en.json`, para que os dois devs editem regiões distintas do
arquivo e o git resolva sozinho:

```json
"TOUR_WIZARD": {
  "COMMON":  {},   // A
  "STEP1":   {},   // A
  "STEP2":   {},   // B  ← única região que o Dev B toca
  "STEP3":   {},   // A
  "SUCCESS": {}    // A
}
```

### 4.6 Rota

`tour/novo` → `TourWizardPage`. A rota `upload` passa a **redirecionar** para
ela. A pasta `upload-tour/` só é apagada no último PR da integração — se um dos
devs apagar antes, o outro perde a referência viva do fluxo de publicação.

---

## 5. Frente A — `feature/tour-wizard-fundacao`

**Chrome do wizard, Etapa 1, Etapa 3 e Sucesso.** Dono do shell, do store
principal e do fluxo de publicação.

| # | Tarefa | Pts |
|---|---|---|
| A1 | Tokens em `_tour-wizard.scss` mapeados para o design system; grade de 4px, raios, sombras, `prefers-reduced-motion` | 3 |
| A2 | Shell: `AppHeaderComponent` consumido como está + stepper de chips (estados concluída/atual/futura/bloqueada, rótulos ocultos no mobile) + barra de progresso com `role="progressbar"` | 5 |
| A3 | Barra de ação sticky: Voltar (`visibility:hidden` na etapa 1), Pular (só etapa 2 e só sem hotspots), Próximo/Publicar com estado desabilitado + tooltip. Dentro de `ion-content`, com `[scrollEvents]` para o header | 3 |
| A4 | `TourDraftStore` completo + rota + i18n | 3 |
| A5 | Etapa 1 — dropzone: drag & drop, `<label>` real sobre o input (acessível por teclado), estado de drag, chips informativos, caixa de dica | 5 |
| A6 | Etapa 1 — botões: "Enviar arquivos" (input múltiplo) e "Tirar foto agora" → `Capture360Component` via `ModalController`, com fallback para o seletor quando `captureSupported()` é falso | 3 |
| A7 | Etapa 1 — validação no cliente: tipo, ≤ 25 MB, proporção ~2:1, com erro inline por card | 3 |
| A8 | Etapa 1 — lista de ambientes: grid responsivo, thumbnail, input de nome, badge Capa/Ambiente N, remover, contador | 5 |
| A9 | Etapa 3 — form (nome, tipo, finalidade) + acordeão de endereço com `CepService`, incluindo estados de carregando e CEP não encontrado; `font-size: 16px` nos inputs mobile | 5 |
| A10 | Etapa 3 — card "Resumo do tour" (capa, contagem de ambientes, `totalHotspots` do store) | 2 |
| A11 | Estado de sucesso: ícone, textos, "Copiar link" com feedback e "Criar outro tour" (reset) | 3 |
| A12 | Publicar: portar o fluxo de `upload-tour.page.ts` (createProperty → createTour → montarTour → acompanharMontagem), com erro inline por campo. `toCreateTourPayload` já existe — falta ligá-lo e avisar sobre os pontos descartados | 5 |
| A13 | Responsivo `<768px` + revogar objectURLs no destroy + varredura de a11y | 3 |
|  | **Total** | **48** |

**DoD da frente A**
- As três etapas navegam, com o stepper bloqueando 2 e 3 sem imagem.
- Nenhuma string cravada no template; `pt.json` e `en.json` completos nos blocos de A.
- Publica de ponta a ponta com o backend atual, sem regressão contra a tela antiga.
- Lighthouse a11y ≥ 90 na página; navegação por teclado fecha o ciclo em desktop.
- `npm run lint` e `npm test` limpos.

---

## 6. Frente B — `feature/tour-wizard-hotspots`

**Etapa 2 inteira.** Frente mais curta em superfície e mais densa em risco: a
projeção 3D→tela e o gesto de arraste são o miolo.

| # | Tarefa | Pts |
|---|---|---|
| B1 | Host do viewer: `PanoramicViewerComponent` em `editMode`, `aspect-ratio` 16/9 ↔ 4/3, estado sem imagem (hachura + placeholder), balão de dica | 3 |
| B2 | **Overlay HTML de pins.** O componente hoje desenha sprites no three.js; o design pede pílulas com blur, `pulseRing`, ellipsis e arraste — e a a11y pede `<button>` de verdade. Expor a câmera do viewer e projetar cada hotspot para coordenadas de tela a cada frame | 8 |
| B3 | `HotspotEditorStore`: comandos de hotspot via `patchScene` + estado efêmero (`sheet`, `pinDrag`) | 3 |
| B4 | Criar hotspot no clique/toque (consome `hotspotPlaced`, já em UV); clique no pin navega quando tem destino, abre o editor quando não | 3 |
| B5 | Rail de ambientes rolável, com borda de selecionado, fechando o sheet ao trocar | 2 |
| B6 | Painel desktop: cards, índice, input de título, seletor de tipo, select de destino (excluindo o ambiente atual), estado vazio | 5 |
| B7 | Linha-resumo mobile (contador, nomes unidos por " · ", "Ver todos") | 2 |
| B8 | Bottom sheet via `IonModal` com `breakpoints`, nos dois modos (editor e lista) | 5 |
| B9 | Long-press 320 ms + arraste com Pointer Events, clamp 2–98% / 2–96%, supressão de clique, `preventDefault` no context menu, `Haptics.impact()` | 8 |
| B10 | Alvo da lixeira: hit test (96px de altura, ±92px do eixo), dois estados visuais, soltar exclui | 3 |
| B11 | ~~Mapear os hotspots para o payload~~ — **movida para a Frente A** (A12). Ver 2.2 | — |
| B12 | A11y: lista de hotspots navegável por teclado como alternativa ao clique na imagem, `aria-label` descritivo nos pins, `prefers-reduced-motion` desligando `pulseRing` e as escalas | 3 |
|  | **Total** | **45** |

**DoD da frente B**
- Criar, renomear, apontar destino, mover e excluir hotspot funciona em desktop e mobile.
- Clicar num pin com destino **navega** e nunca abre editor.
- Rolar a página com o dedo sobre um pin não dispara arraste (o `pointermove` cancela o timer).
- Nenhuma chamada de rede na etapa 2 — nem durante a edição, nem no fim. Quem
  publica é a Frente A.
- Blocos `TOUR_WIZARD.STEP2` completos em `pt.json` e `en.json`.
- `npm run lint` e `npm test` limpos.

---

## 7. Mapa de propriedade de arquivos

A regra que substitui reunião de merge. Arquivo com dono não tem conflito.

| Caminho | Dono |
|---|---|
| `tour-wizard.page.*`, `ui/**`, `steps/step-images/**`, `steps/step-info/**`, `published/**` | **A** |
| `tour-draft.store.ts`, `publish-payload.ts` | **A** |
| `steps/step-hotspots/**`, `hotspots/**` | **B** |
| `hotspot-editor.store.ts` | **B** |
| `tour-wizard.model.ts`, `_tour-wizard.scss` | **CONGELADO** — PR à integração |
| `panoramic-viewer.component.ts` | **B** (única frente que o toca) |
| `app-header.component.*` | **ninguém** — consumido como está (ver 2.3) |
| `app.routes.ts`, `virtual-tour.service.ts`, `virtual-tour.model.ts` | **A** — B pede por PR |
| `i18n/*.json` → `TOUR_WIZARD.STEP2` | **B** |
| `i18n/*.json` → demais blocos | **A** |
| `upload-tour/**` | ninguém apaga até o último PR |

Dois pontos de atrito previstos, ambos desenhados fora:
1. **O store** — resolvido por `patchScene` e por dois arquivos separados.
2. **O `publish()`** — deixou de ser costura: a conversão para o payload é
   função pura sobre o estado da Frente A (`publish-payload.ts`) e a Frente B
   não participa. Ver 2.2.

---

## 8. Sequenciamento

| Quando | A | B | Marco |
|---|---|---|---|
| Dia 0 (½) | commit-zero em dupla | commit-zero em dupla | contrato mergeado |
| Dias 1–2 | A1–A4 | B1–B2 | **M1**: shell navegável + pin aparecendo sobre o panorama na posição certa ao girar |
| Dias 3–5 | A5–A8 | B3–B7 | **M2**: etapa 1 completa; etapa 2 usável no desktop |
| Dias 6–8 | A9–A11 | B8–B10 | **M3**: fluxo inteiro clicável ponta a ponta, mobile incluso |
| Dias 9–10 | A12–A13 | B11–B12 | **M4**: publica de verdade; a11y e responsivo fechados |
| Dia 11 | QA cruzado — A testa a etapa 2, B testa 1 e 3 | | PR para `main` |

**M1 é o marco que importa.** Se a projeção 3D→tela (B2) não estiver de pé no
fim do dia 2, a frente B derrapa inteira — é o único item do sprint sem plano B
barato. Vale uma spike de meio dia no dia 1 antes de estilizar qualquer pin.

QA cruzado no dia 11 é obrigatório: cada dev testa a etapa do outro. É o que
pega as inconsistências de token e de responsividade que ninguém vê no próprio
código.

---

## 9. Fora de escopo deste sprint

Registrado para não virar discussão no meio do caminho. Os seis primeiros vêm da
seção *Escopo assumido* do README do handoff.

1. Reordenar ambientes / escolher a capa manualmente.
2. Hotspot de informação (ver 2.1 — sem spec de conteúdo).
3. Editar um tour existente.
4. Limites reais de ambientes e hotspots por ambiente.
5. Confirmação ao sair no meio do fluxo (botão ← do topbar).
6. Desfazer exclusão (toast com "Desfazer").
7. Upload incremental com progresso e retry por arquivo (ver 2.4).
8. Rascunho, local ou no servidor, e o indicador "Rascunho salvo" — **cortado do
   produto**, não adiado (ver 2.3).
9. Persistir hotspot sem destino. O publicar avisa e descarta (ver 2.1).
10. Barra de ação não-sticky quando o conteúdo cabe na viewport — melhoria
    opcional citada no handoff.
