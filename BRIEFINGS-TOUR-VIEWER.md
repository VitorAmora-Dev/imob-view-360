# Briefing do sprint do visualizador

Cole este arquivo inteiro na IA, junto com o ticket do Jira. Ele foi escrito
para ser lido por quem nunca abriu este repositório.

Estado em 03/09/2026:

| Feito | Falta |
|---|---|
| TV-0, TV-2, TV-3, TV-4, TV-5, TV-7, TV-8, TV-10, TV-11 | **TV-1**, **TV-6**, **TV-9**, **TV-12** |

A tela hoje abre com a foto, os hotspots, a faixa de cenas e os três sheets
montados. Falta o **chrome** — header, pill de cena, tab bar, modo imersivo.

---

## Antes de qualquer coisa

**Sua branch sai de `feature/tour-wizard-edicao`.** Não da `main`.

Essa é a única árvore que tem, ao mesmo tempo, o contrato do TV-0, a TV-3
encaixada e a pasta `design_handoff_tour_viewer/`. A TV-3 saiu da `main` e custou
um dia de reencaixe — ela reinventou o store de sheets, o bloco de i18n e a
camada de tokens porque, da `main`, nenhum dos três era visível.

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
3. Um componente pronto como referência de estilo. Escolha pela forma do que
   você vai escrever:
   - peça de chrome sobre a foto → `tour-viewer/scenes/` (TV-2);
   - sheet → `tour-viewer/sheets/embed/` (TV-4) ou `sheets/delete/` (TV-5);
   - coisa desenhada sobre a equirretangular → `tour-viewer/hotspots/` (TV-7).

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
  `size`, `radius`, `shadow`, `family`). O `palette.contract.spec.ts` varre os
  tokens e tenta resolvê-los como cor; sem marcador, o seu token novo derruba a
  suíte.
- **Comentários e nomes de teste em português**, explicando o *porquê*, não o
  *o quê*.
- **Imagem da API nunca vai em `<img src="/api/...">`.** A rota
  `/panoramas/:id/preview` é autenticada, o token está no `localStorage` e a tag
  `<img>` não passa pelo interceptor — dá 401 e card vazio. O caminho é sempre
  `PanoramaImageCache` → `blob:` → tela.
- Termine com `yarn lint` e `yarn test` passando. **Injete o defeito de volta**
  para confirmar que o seu teste realmente pega o que ele diz pegar.

### O que já existe e você NÃO deve reconstruir

`TourViewerStore` (injetado na página, não em root — e por isso qualquer
componente dentro dela pode injetá-lo):

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

`TourViewerPage`: `cenaNaTela()` — a foto que está NO AR, que é diferente de
`store.currentScene()`. Ver R4.

`tour-viewer.model.ts`: `EMBED_FORMATOS`, `LARGURA_DA_MINIATURA` (292),
`comLargura(url, largura)`, `TOAST_MS`, `SheetKind`, `EmbedFormat`.

`components/tour-sheet/` (shell da TV-3): `[isOpen]`, `[titulo]`,
`[subtitulo]`, `[variante]` (`'sheet' | 'adaptavel'`), `[travado]`,
`[breakpoints]`, `[initialBreakpoint]`, `(fechado)`, corpo por `<ng-content>` e
rodapé por `<ng-content select="[rodape]">`.

`theme/_tour-viewer-mixins.scss`: `tv-mobile`, `tv-desktop`,
`tv-desktop-compacto`, `tv-trilho-sem-barra`, `tv-vidro($fundo, $blur, $borda)`,
`tv-oculto-no-imersivo`.

---

## O que TV-2, TV-4 e TV-5 deixaram pronto para vocês

### Para a TV-1 (chrome mobile)

**Os três sheets já estão montados na página** e ninguém precisa montá-los de
novo. Seus botões só precisam abrir:

| Botão da tab bar | O que chamar |
|---|---|
| EDITAR | `page.editarTour()` (já existe) |
| EMBED | `store.abrirSheet('embed')` |
| APAGAR | `store.abrirSheet('delete')` |
| pill de cena | `store.abrirSheet('scenes')` |
| olho | `store.alternarChrome()` |

**Não chame `store.apagarTour()` do seu botão.** Ele é o *depois* da
confirmação, e o sheet de TV-5 é quem confirma — o docstring dele diz isso, e é
o invariante 4 do sprint.

Os slots `tv-slot--header`, `tv-slot--pill`, `tv-slot--olho` e `tv-slot--acoes`
já estão no `tour-viewer.page.html`, com o comentário do que entra em cada um.

**A armadilha:** o componente que você encaixar precisa levar `class="tv-slot"`
no host, porque é dela que vem o `pointer-events: auto` — o chrome tira o
ponteiro de todo mundo de propósito. E o host **não pode** ganhar `inset: 0`: uma
caixa transparente sobre a foto inteira mata o arrasto do panorama, sem erro
nenhum no console. Foi o bug do commit `df9658c`, e o `tour-viewer.page.spec.ts`
tem um teste que guarda isso.

### Para a TV-6 (sheet Gerenciar)

Copie a forma de `tour-viewer/sheets/embed/`: um componente que injeta o store,
tem `aberto = computed(() => store.sheet() === 'manage')` e devolve o `(fechado)`
para `store.fecharSheet()`. Uma linha no `tour-viewer.page.html` e nada mais.

- **Passe `[breakpoints]`.** O default do shell (`[0, 0.55]`) foi calibrado para
  o sheet Cenas, que trava a grade em 340px. O Gerenciar é uma lista que cresce
  sem teto — `[0, 0.5, 0.9]`, como o `HotspotSheet` já usa. O `0` da primeira
  posição é o que permite arrastar para baixo até fechar; mantenha-o.
- **"Compartilhar link" usa `store.linkPublico()`** — a mesma string que o sheet
  Incorporar mostra, com o `?controles=0` quando for o caso. Não monte a URL de
  novo.
- Se copiar para a área de transferência, trate a **falha**: existe
  `TOUR_VIEWER.TOAST.COPY_ERROR` para isso. Anunciar "copiado" quando a
  permissão foi negada faz a pessoa colar o conteúdo anterior sem saber.

### Para a TV-9 (desktop)

**O rail de cenas já se posiciona sozinho** e não deve ser reposicionado pela
página: `left:24px`, `bottom:24px`, 640px (480px entre 768 e 1279), recolhido
persistindo em `sessionStorage` com chave por tour. Ele nasce recolhido entre
768 e 1023px, como o handoff pede.

Falta no desktop: a barra superior, o contexto de cena (`top:86px; left:24px`,
com "Cena 2 de 6"), o cluster do olho (`right:24px; bottom:150px`) e o cluster
de ações (`right:24px; bottom:24px`). O sheet Apagar **já** vira diálogo
centrado de 480px sozinho, pela `variante="adaptavel"` do shell — não escreva
media query para ele.

### Para a TV-12 (fechamento)

O que ficou anotado e ninguém arrumou ainda:

- `TourHotspotOverlayComponent` depende da classe concreta
  `PanoramicViewerComponent`. Uma interface mínima (só `onFrame` e a câmera)
  quebraria o acoplamento.
- `hotspot-projection.ts` mora em `tour-wizard/hotspots/` e é importado pelo
  visualizador. Mover para um lugar neutro mexe em arquivos de outra frente, e
  por isso ficou.
- `PanoramicViewerComponent` tem mais de mil linhas.
- **`yarn lint` do `server-api` reescreve o repositório inteiro.** O script é
  `eslint --fix` e há 55 arquivos que nunca passaram pelo prettier; sem
  `.gitattributes`, CRLF entra na conta. Merece um commit de normalização
  próprio, antes que ele contamine o diff de alguém.

---

## Depois de terminar

1. `yarn lint` e `yarn test` verdes no `inner-view-client`.
2. **Prove que o seu teste não é decorativo**: reintroduza o defeito de propósito
   e veja o teste cair. Se ele não cair, ele não guarda nada.
3. PR contra `feature/tour-wizard-edicao`, não contra a `main`.
4. Se precisar mexer num arquivo fora da sua linha do mapa da seção 4, **pare e
   avise** — é assim que nasce o conflito que custou o dia da TV-3.
