# Sprint 3 — Notas da Frente B (etapa 2, hotspots)

> Complemento de `SPRINT-3-TOUR-WIZARD.md`, não substituto. Arquivo novo em vez
> de edição no plano compartilhado, pela mesma razão do §7: arquivo com dono não
> dá conflito.
>
> Escrito para quem pegar a etapa 2 no meio, e para a Frente A saber o que a
> alcança. Se algo aqui divergir do código, o código vence.

Branch: `feature/tour-wizard-hotspots`, quatro commits sobre o commit-zero
(`b069201`).

---

## 1. O que está de pé

| Tarefa | Estado | Onde |
|---|---|---|
| B1 — host do viewer em `editMode` | feito (falta hachura/dica do handoff) | `steps/step-hotspots/` |
| B2 — overlay HTML de pins | feito, **sem estilo** (§8) | `hotspots/hotspot-overlay/` |
| B3 — `HotspotEditorStore` | veio quase pronto do commit-zero | `hotspot-editor.store.ts` |
| B4 — criar no clique | criação feita; falta navegar/abrir editor | `step-hotspots.component.ts` |
| B5–B12 | não começados | — |

**29 testes novos.** Suíte em 197 passando / 3 falhando (as 3 são herdadas, ver §2.2).

Arquivos tocados, todos dentro do §7: `hotspots/**`, `steps/step-hotspots/**`,
`panoramic-viewer.component.ts`, e o bloco `TOUR_WIZARD.STEP2` do i18n. Nada da
Frente A foi alterado.

---

## 2. Três decisões que não são de uma frente só

### 2.1 `addHotspots` desenha os hotspots espelhados — NÃO corrigido

`panoramic-viewer.component.ts`, em `addHotspots`:

```ts
const theta = (1 - hotspot.positionY) * Math.PI;   // errado
```

Deveria ser `positionY * Math.PI`. Ver §3 para a derivação.

O efeito: a função renderiza refletido no equador o mesmo ponto que o
`onCanvasClick` do próprio componente gravou. Como `hotspotPlaced` é o único
produtor de `positionX`/`positionY` no cliente, **os hotspots do inner-view são
desenhados no lugar errado hoje**. O dado no banco está certo; só a renderização
inverte.

Não corrigi porque muda o que a página do inner-view mostra para todos os tours
já existentes, e isso não é chamada de uma frente sozinha. É uma linha.

O wizard não é afetado: a etapa 2 passa `originHotspots: []` ao viewer, porque
quem desenha os pins é o overlay HTML.

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

---

## 7. Próximos passos sugeridos

Na ordem em que eu pegaria:

1. As duas pendências do §2 que travam o DoD (§2.2 é de uma linha).
2. B5 e B6 — rail de ambientes e painel do desktop. Destravam a edição real
   (nomear, apontar destino) e não dependem de mais nada.
3. B4 completo — clicar num pin com destino navega, sem destino abre o editor.
4. B8 e B9 — sheet do mobile e arraste. O `pinDrag` já está declarado no store
   esperando o gesto, com um `TODO(B9)` descrevendo o que falta.
5. B2 acabamento — pílula, blur, `pulseRing`, ellipsis. Só depois de B5/B6, para
   estilizar uma coisa só uma vez.
