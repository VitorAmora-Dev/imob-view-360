# Briefings TV-2, TV-4 e TV-5

Cole o bloco da sua task inteiro na IA, junto com o ticket do Jira. Ele foi
escrito para ser lido por quem nunca abriu este repositório.

Estado em 02/09/2026: TV-0, TV-3, TV-7, TV-8, TV-10 e TV-11 estão prontos e
reconciliados. Faltam TV-1, TV-2, TV-4, TV-5, TV-6, TV-9 e TV-12.

---

## Antes de qualquer coisa — vale para as três

**Sua branch sai de `feature/tour-wizard-edicao`.** Não da `main`.

Essa é a única árvore que tem, ao mesmo tempo, o contrato do TV-0, a TV-3
encaixada e a pasta `design_handoff_tour_viewer/`. A TV-3 saiu da `main` e
custou um dia de reencaixe — ela reinventou o store de sheets, o bloco de
i18n e a camada de tokens porque, da `main`, nenhum dos três era visível.

```bash
git fetch origin
git checkout feature/tour-wizard-edicao
git checkout -b <sua-branch>
```

**Se você acabou de trocar de branch e o `ng serve` já estava rodando, reinicie
o servidor.** O `angular.json` ganhou `src/theme/tour-viewer.scss` e o `ng serve`
não recarrega mudança de configuração. O sintoma é traiçoeiro: todos os tokens
`--tv-*` resolvem vazio e a tela fica sem cor nenhuma, sem erro no console.

### O que ler, nesta ordem

1. `SPRINT-4-TOUR-VIEWER.md` — seções **3b** (as quatro regras da
   reconciliação), **2** (decisões D1–D10) e **4** (mapa de arquivos).
2. `design_handoff_tour_viewer/` — o arquivo que a sua task cita.
3. Um componente pronto como referência de estilo:
   `tour-viewer/hotspots/tour-hotspot-overlay.component.ts` (TV-7) ou
   `components/cenas-sheet/` (TV-3).

### As quatro regras que já custaram caro

| | Regra | O que acontece se ignorar |
|---|---|---|
| **R1** | Branch sai da ponta da pilha | Um dia de reencaixe |
| **R2** | i18n em `TOUR_VIEWER.*`, chaves em **inglês** | Dois blocos para o mesmo domínio |
| **R3** | Um sheet por vez é do `TourViewerStore` | Dois lugares sabendo a mesma coisa |
| **R4** | Sobre a foto lê `cenaNaTela()` | Pins do destino sobre a foto da origem |

### Regras de código deste repositório

- **Nenhum hex em componente.** As cores desta tela vêm de `--tv-*`
  (`theme/tour-viewer.scss`). Faltou uma? Ela nasce lá, não no seu `.scss`.
  Também **nada de `--ion-color-*`** aqui: são do tema claro do app, e esta tela
  é escura.
- **Token que não é cor precisa de marcador no nome** (`dur`, `blur`, `grad`,
  `size`, `radius`, `shadow`). O `palette.contract.spec.ts` varre os tokens e
  tenta resolvê-los como cor; sem marcador, o seu token novo derruba a suíte.
- **Comentários e nomes de teste em português**, explicando o *porquê*, não o
  *o quê*.
- **Imagem da API nunca vai em `<img src="/api/...">`.** A rota
  `/panoramas/:id/preview` é autenticada, o token está no `localStorage` e a tag
  `<img>` não passa pelo interceptor — dá 401 e card vazio. O caminho é sempre
  `PanoramaImageCache` → `blob:` → tela.
- Termine com `yarn lint` e `yarn test` passando. **Injete o defeito de volta**
  para confirmar que o seu teste realmente pega o que ele diz pegar.

### O que já existe e você NÃO deve reconstruir

`TourViewerStore` (injetado na página, não em root):

```ts
scenes()  panoramas()  currentScene()  currentSceneIndex()  tourName()  semCenas()
irParaCena(i)  irParaCenaPorId(id)
sheet()  abrirSheet('scenes'|'embed'|'delete'|'manage')  fecharSheet()
chromeVisible()  alternarChrome()  faixaVisivel()  hotspotsVisiveis()
toast()  mostrarToast(chave)
embedFormat()  embedShowControls()  linkPublico()
railCollapsed()  alternarRail()
apagando()  apagarTour()
```

`tour-viewer.model.ts`: `EMBED_FORMATOS`, `LARGURA_DA_MINIATURA` (292),
`comLargura(url, largura)`, `TOAST_MS`, `SheetKind`, `EmbedFormat`.

`components/tour-sheet/` (shell da TV-3): `[isOpen]`, `[titulo]`,
`[subtitulo]`, `[variante]` (`'sheet' | 'adaptavel'`), `[travado]`,
`[breakpoints]`, `(fechado)`, corpo por `<ng-content>` e rodapé por
`<ng-content select="[rodape]">`.

---

## TV-2 · Faixa de cenas (mobile) e rail (desktop)

**Ref.:** `02-mobile.md`, `05-desktop.md` · **Est.:** 1,5 · **Dep.:** TV-0

### Seus arquivos

`tour-viewer/scenes/**` — crie a pasta. Mais **uma linha** em
`tour-viewer.page.html`, no slot marcado `TV-2`, e o import correspondente no
`.ts`. Não toque em mais nada do arranjo.

### O que entregar

Faixa horizontal no mobile e rail de vidro no desktop, com as medidas do
handoff. Cabeçalho "CENAS" + "Ver todas"; miniaturas 104×70 (mobile) e 146×92
(desktop); borda accent 2px na cena atual; legenda com ellipsis sobre gradiente.

- **"Ver todas" chama `store.abrirSheet('scenes')`.** O sheet já existe e já
  está montado na página — você só precisa abri-lo. Não monte outro.
- **Marcar a cena atual usa `page.cenaNaTela()`, não `store.currentScene()`**
  (regra R4). O que a faixa destaca é o cômodo que está na tela.
- **Tocar troca a cena e não fecha nada:** `store.irParaCena(i)`.
- A faixa some sozinha se você ligar em `store.faixaVisivel()` — ele já combina
  modo imersivo, sheet aberto e tour sem cenas.
- **Miniaturas:** `comLargura(cena.imageUrl, LARGURA_DA_MINIATURA)` e
  `PanoramaImageCache`. Copie o padrão de
  `components/cenas-sheet/cenas-sheet.component.ts` — ele já resolveu o 401, o
  `blob:` e o motivo de não revogar no destroy.
- **Rail recolhido persiste na sessão:** `sessionStorage`, chave por tour.
  `store.railCollapsed()` e `alternarRail()` já existem; falta só a persistência.
- `role="tablist"` no trilho, `role="tab"` + `aria-selected` em cada miniatura.

### A armadilha desta task

A faixa fica **dentro do chrome**, e o chrome tem `pointer-events: none` no
container com `auto` em cada filho. Se você criar um wrapper intermediário sem
`pointer-events: auto`, a faixa não recebe toque. Se criar um com `inset: 0`,
você mata o arrasto do panorama — foi exatamente esse o bug do commit `df9658c`,
e o `tour-viewer.page.spec.ts` tem um teste que guarda isso.

### Aceite

Rola na horizontal sem scrollbar visível nos três motores; cena atual marcada
nos dois layouts; recolhido sobrevive a F5 na mesma aba; **nenhuma requisição de
imagem sem `w`** (confira na aba Network); arrastar o panorama continua
funcionando com a faixa na tela.

---

## TV-4 · Sheet Incorporar (embed)

**Ref.:** `04-sheets.md` §2, `screens/03` · **Est.:** 1,5 · **Dep.:** TV-3 ✅

### Seus arquivos

`tour-viewer/sheets/embed/**` — crie. Mais a linha do slot `TV-4` em
`tour-viewer.page.html`. E `embed/embed.page.ts`, para ler o parâmetro.

### O que entregar

Sheet sobre `TourSheetComponent`, aberto por `store.sheet() === 'embed'`.

- **Segmented control de formato:** Responsivo (padrão) · 16:9 · Quadrado.
  `EMBED_FORMATOS` no model já tem as medidas — não redigite a tabela do
  handoff. Ligue em `store.embedFormat()`.
- **Bloco de código** com destaque de tag/atributo, `word-break: break-all`,
  mono do sistema (D2). **O código muda com o formato.**
- **Toggle "Mostrar controles"** (padrão ligado) → `store.embedShowControls()`.
  Desligado, a URL ganha `?controles=0` — e `store.linkPublico()` **já faz
  isso**. Do outro lado, `EmbedPage` precisa ler o parâmetro e repassar a
  `[roomNav]` do viewer; essa metade ainda não existe.
- **Copiar mantém o sheet aberto.** Copiar não é escolher: quem copia o código
  frequentemente copia o link em seguida. Confirmação por
  `store.mostrarToast('TOUR_VIEWER.TOAST.CODE_COPIED')`.

### Aceite

O código muda com os três formatos; o toggle produz e remove `?controles=0`; o
embed aberto com `?controles=0` realmente esconde a navegação de ambientes
(teste ponta a ponta do parâmetro, não só da geração da string); copiar não
fecha o sheet.

---

## TV-5 · Apagar tour

**Ref.:** `04-sheets.md` §3, `screens/04` · **Est.:** 1 · **Dep.:** TV-3 ✅

### Seus arquivos

`tour-viewer/sheets/delete/**` — crie. Mais a linha do slot `TV-5`.

### O que entregar

Sheet no mobile e **diálogo centralizado de 480px no desktop** — é o caso que a
`variante="adaptavel"` do shell existe para servir. Passe `[variante]="'adaptavel'"`
e **não** invente media query própria: o shell já corta em 768px.

- Círculo de 46px com lixeira; título com o nome do tour; corpo com a contagem
  de cenas; caixa de aviso "não pode ser desfeita".
- **Botões empilhados com o destrutivo em cima**, no slot `[rodape]` do shell —
  não dentro do corpo, senão eles rolam junto e saem da tela.
- Este é o **único vermelho sólido da tela**. Em qualquer outro lugar o
  destrutivo é `--tv-danger-tint`.
- **Estado "Apagando…": passe `[travado]="true"` ao shell.** Ele alimenta o
  `canDismiss` do `IonModal`, o que trava os três gestos de fechar de uma vez —
  scrim, arrasto e Esc. Travar só o scrim deixaria os outros dois vivos, e
  fechar no meio da requisição deixa a tela em estado ambíguo.
- `store.apagando()` e `store.apagarTour()` já existem. `apagarTour()` devolve
  `false` na falha e já navega para a home no sucesso.
- **Falha:** toast em `danger`, sheet **segue aberto**.

### A regra de produto

`store.apagarTour()` **não confirma nada** — ele é o *depois* da confirmação. É
o seu sheet que confirma. Chamá-lo de qualquer outro lugar é o bug que essa
separação existe para impedir; o docstring dele diz isso.

### Aceite

APAGAR nunca executa sem confirmação (teste de unidade); durante o loading
**nenhum** dos três gestos fecha o sheet; falha de rede deixa o sheet aberto com
o toast, nunca a tela em estado ambíguo.

---

## Depois de terminar

1. `yarn lint` e `yarn test` verdes no `inner-view-client`.
2. **Prove que o seu teste não é decorativo**: reintroduza o defeito de propósito
   e veja o teste cair. Se ele não cair, ele não guarda nada.
3. PR contra `feature/tour-wizard-edicao`, não contra a `main`.
4. Se precisar mexer num arquivo fora da sua linha do mapa da seção 4, **pare e
   avise** — é assim que nasce o conflito que custou o dia da TV-3.
