# Overlay Guiado v2 — Domo Estático + Polos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Substituir a experiência do Método 2 por um overlay guiado estático (visor do gomo no centro + mapa do domo no topo + instruções passo a passo), com 18 fotos (16 células + zênite + nadir) para fechar teto e chão.

**Architecture:** Reaproveita o núcleo testado (projeção, warp de gomo, montagem). Generaliza o warp para regiões arbitrárias (polos reusam a mesma projeção com pitch ±90°). Adiciona um módulo de plano de captura (18 passos) e um mapa de domo. Reescreve o componente para overlay estático guiado. Só `inner-view-client/`.

**Tech Stack:** Angular 20 standalone, Canvas 2D, Karma/Jasmine, ngx-translate.

**Decisões travadas com o usuário:** overlay estático (não giroscópio); fluxo guiado linear; 18 fotos com zênite/nadir; sobreposição leve entre células para margem de costura.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `capture-360.types.ts` | modificar | + tipos de passo/região/polo e constantes |
| `camera-projection.ts` | reusar | projeção (fonte de verdade); + helper de câmera de polo |
| `mesh-warp.ts` | modificar | generalizar `warpFrameToRegion`; `warpFrameToTile` vira wrapper |
| `pole-warp.ts` | criar | warp de zênite/nadir para as calotas do equiretangular |
| `equirect-assembler.ts` | modificar | colar calotas reais nos polos (degradê vira fallback) |
| `capture-plan.ts` | criar | gera a sequência de 18 passos com metadados |
| `dome-map.ts` | criar | desenha o mini-domo de progresso (estático) |
| `spherical-mask.ts` | reusar | visor do gomo (já existe `buildMaskGeometry`/`drawMaskOverlay`) |
| `capture-360.component.*` | reescrever | overlay estático + máquina de 18 passos + mapa |
| `pt.json` / `en.json` | modificar | novas chaves de instrução |

---

## Task 1: Generalizar o warp para regiões arbitrárias

**Files:** Modify `mesh-warp.ts`; Test `mesh-warp.spec.ts`

- [ ] **Step 1 — teste falho:** região custom deve bater com o tile 512×455 padrão.

```ts
// mesh-warp.spec.ts — novo teste
it('warpFrameToRegion reproduz warpFrameToTile para a região do gomo superior', () => {
  const cam = { pitchDeg: 20, vFovDeg: 100, width: 720, height: 1280 };
  const frame = makeFrame(cam, (lon, lat) =>
    (lon>=-22.5&&lon<22.5&&lat>=0&&lat<40) ? [120,60,200] : [0,0,0]);
  const viaTile = warpFrameToTile(frame, cam, 'upper');
  const viaRegion = warpFrameToRegion(frame, cam, { lonLo:-22.5, lonHi:22.5, latLo:0, latHi:40, outW:512, outH:455 });
  for (let k=0;k<viaTile.data.length;k+=4*997) expect(viaRegion.data[k]).toBe(viaTile.data[k]);
});
```

- [ ] **Step 2 — rodar, ver falhar** (`warpFrameToRegion` indefinido).
- [ ] **Step 3 — implementar** `warpFrameToRegion(frame, cam, region)` extraindo o loop atual (linha 0 = latHi; varredura lon lonLo..lonHi, lat latHi..latLo) e reescrever `warpFrameToTile` como wrapper que chama `warpFrameToRegion` com a região do gomo da faixa.
- [ ] **Step 4 — rodar todos os specs de mesh-warp** (`ng test --include=**/mesh-warp.spec.ts`): PASS, sem regressão nos testes existentes.
- [ ] **Step 5 — commit** `refactor(client): generalizar warp para regiões arbitrárias`.

## Task 2: Warp de polo (zênite/nadir)

**Files:** Create `pole-warp.ts`, `pole-warp.spec.ts`

Zênite = câmera reta pra cima (pitch +90°) cobrindo lat +40..+90 em todas as longitudes → tira superior do equiretangular (`EQUIRECT_W × UPPER_BAND_Y` linhas). Nadir = pitch −90°, lat −90..−40 → tira inferior.

- [ ] **Step 1 — teste falho:** um zênite sintético (padrão radial por lat/lon via inversa) recai na cor certa nas linhas do polo.

```ts
it('warpZenith mapeia a calota +40..+90 para a tira superior', () => {
  const cam = { pitchDeg: 90, vFovDeg: 120, width: 900, height: 900 };
  const frame = makeFrame(cam, (lon,lat) => lat>40 ? [Math.round((lat-40)/50*255), 100, 50] : [0,0,0]);
  const strip = warpZenith(frame, cam); // ImageData EQUIRECT_W × UPPER_BAND_Y
  expect(strip.width).toBe(EQUIRECT_W); expect(strip.height).toBe(UPPER_BAND_Y);
  // linha perto do polo (topo) ~ lat 90 → canal R alto; linha perto de +40 (base) → R baixo
  const top = (10*EQUIRECT_W+2000)*4, bot = ((UPPER_BAND_Y-10)*EQUIRECT_W+2000)*4;
  expect(strip.data[top]).toBeGreaterThan(strip.data[bot]);
});
```

(makeFrame reutiliza o helper de inversa do mesh-warp.spec — extrair para `test-helpers.ts` no Step 3.)

- [ ] **Step 2 — rodar, ver falhar.**
- [ ] **Step 3 — implementar:** extrair `makeFrame` para `capture-360/test-helpers.ts`; `warpZenith(frame,cam)` = `warpFrameToRegion(frame, {...cam, pitchDeg:90}, {lonLo:-180,lonHi:180,latLo:40,latHi:90,outW:EQUIRECT_W,outH:UPPER_BAND_Y})`; `warpNadir` análogo (pitch −90, lat −90..−40, outH = EQUIRECT_H−(LOWER_BAND_Y+TILE_H)).
- [ ] **Step 4 — rodar:** PASS.
- [ ] **Step 5 — commit** `feat(client): warp de zênite e nadir para as calotas`.

## Task 3: Assembler cola as calotas reais

**Files:** Modify `equirect-assembler.ts`, `equirect-assembler.spec.ts`

- [ ] **Step 1 — teste falho:** passar tiras de polo preenche o topo/base com elas (não o degradê).

```ts
it('cola a calota do zênite na tira superior quando fornecida', () => {
  const zenith = solidStrip(EQUIRECT_W, UPPER_BAND_Y, [10,220,30]);
  const canvas = assembleEquirectCanvas(allTiles(), { zenith });
  const px = canvas.getContext('2d')!.getImageData(2000, 10, 1, 1).data;
  expect(px[1]).toBe(220);
});
```

- [ ] **Step 2 — rodar, ver falhar** (assinatura não aceita polos).
- [ ] **Step 3 — implementar:** `assembleEquirectCanvas(tiles, poles?)` e `assembleEquirect(tiles, poles?, quality?)`. Se `poles.zenith` existe → `putImageData(zenith,0,0)`, senão `fillPole(...)` como hoje. Idem `poles.nadir` na base.
- [ ] **Step 4 — rodar todos os specs do assembler:** PASS (degradê ainda testado no caminho sem polos).
- [ ] **Step 5 — commit** `feat(client): montar calotas reais de polo quando disponíveis`.

## Task 4: Plano de captura (18 passos)

**Files:** Create `capture-plan.ts`, `capture-plan.spec.ts`; Modify `capture-360.types.ts`

Cada passo: `{ kind:'band'|'pole', band?, index?, pole?, cam:CameraModel-partial, viewfinder:'gore'|'disc', instructionKey, arrow? }`.

- [ ] **Step 1 — teste falho:**

```ts
it('gera 18 passos: 8 superior, 8 inferior, zênite, nadir', () => {
  const steps = buildCapturePlan();
  expect(steps.length).toBe(18);
  expect(steps.slice(0,8).every(s=>s.kind==='band'&&s.band==='upper')).toBeTrue();
  expect(steps[8].band).toBe('lower');
  expect(steps[16].pole).toBe('zenith'); expect(steps[16].viewfinder).toBe('disc');
  expect(steps[17].pole).toBe('nadir');
  // primeira de cada faixa: instrução de inclinar; demais: girar
  expect(steps[0].instructionKey).toContain('TILT_UP');
  expect(steps[1].instructionKey).toContain('TURN');
});
```

- [ ] **Step 2 — rodar, ver falhar.**
- [ ] **Step 3 — implementar** `buildCapturePlan()` puro (8 upper pitch+20, 8 lower pitch−20, zenith pitch+90, nadir pitch−90), com `instructionKey`/`arrow` por passo.
- [ ] **Step 4 — rodar:** PASS.
- [ ] **Step 5 — commit** `feat(client): plano guiado de 18 passos`.

## Task 5: Mapa do domo (progresso)

**Files:** Create `dome-map.ts`, `dome-map.spec.ts`

- [ ] **Step 1 — teste falho:** desenha sem erro e marca célula atual/feitas (checa pixels não-vazios numa região esperada).

```ts
it('desenha o domo e destaca a célula atual', () => {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width=200; ctx.canvas.height=120;
  drawDomeMap(ctx, { capturedKeys:new Set(['upper:0']), currentKey:'upper:1' });
  const any = ctx.getImageData(0,0,200,120).data.some((v,i)=>i%4===3&&v>0);
  expect(any).toBeTrue();
});
```

- [ ] **Step 2 — rodar, ver falhar.**
- [ ] **Step 3 — implementar** `drawDomeMap(ctx,{capturedKeys,currentKey})` — projeção em perspectiva (pitch pequeno) das 18 células; feitas em verde, atual pulsando (cor sólida), resto tênue.
- [ ] **Step 4 — rodar:** PASS.
- [ ] **Step 5 — commit** `feat(client): mapa de domo de progresso`.

## Task 6: Visor circular para polos

**Files:** Modify `spherical-mask.ts`, `spherical-mask.spec.ts`

- [ ] **Step 1 — teste falho:** `buildDiscViewfinder(cx,cy,r)` devolve Path2D de círculo; `drawViewfinder` desenha véu + janela transparente + borda para 'gore' e 'disc'.
- [ ] **Step 2 — rodar, ver falhar.**
- [ ] **Step 3 — implementar** `drawDiscOverlay(ctx, centerX, centerY, radius, stroke)` reusando a lógica de véu+destination-out+stroke do `drawMaskOverlay`.
- [ ] **Step 4 — rodar:** PASS.
- [ ] **Step 5 — commit** `feat(client): visor circular para zênite/nadir`.

## Task 7: Reescrever o componente (overlay guiado estático)

**Files:** Modify `capture-360.component.ts/.html/.scss`, `capture-360.component.spec.ts`

Estado dirigido pelo plano: `stepIndex`, `results: Map<stepKey, ImageData|strip>`. Sem giroscópio, sem `refreshMask` por orientação; a máscara é estática (câmera do passo atual). Reusa initCamera/teardown atuais (com os fixes de robustez já feitos).

- [ ] **Step 1 — atualizar smoke spec:** componente cria; `stepIndex=0`; progresso "1 de 18"; captura avança stepIndex; ao destruir, tracks param. (Molde do spec atual, adaptado.)
- [ ] **Step 2 — rodar, ver falhar.**
- [ ] **Step 3 — implementar:**
  - `plan = buildCapturePlan()`; getters `currentStep`, `progressParams` (memoizado por stepIndex), `isComplete = results.size===18`.
  - `loopDraw()` desenha o visor do passo atual (gore via `drawMaskOverlay` com a câmera do passo, ou disc via `drawDiscOverlay`) + `drawDomeMap` no canvas do topo. Estático — redesenha em rAF leve só para o pulse.
  - `onCapture()`: snapshot nativo → se band: `warpFrameToRegion` da célula (com margem de sobreposição de +3° lon); se pole: `warpZenith/ warpNadir` → guarda em `results` → avança.
  - `finish()`: separa 16 tiles + 2 strips → `assembleEquirect(tiles,{zenith,nadir})` → emit.
  - `redoLast()`: volta stepIndex e apaga o result.
  - Template: visor central (canvas overlay), mapa no topo (canvas), instrução grande (`currentStep.instructionKey | translate` + seta), progresso, shutter/refazer/concluir, banners de permissão/lente/landscape mantidos.
- [ ] **Step 4 — rodar specs do componente + suíte capture-360:** PASS (só os 3 baseline pré-existentes falham).
- [ ] **Step 5 — commit** `feat(client): overlay guiado estático com mapa de domo e polos`.

## Task 8: i18n das instruções

**Files:** Modify `pt.json`, `en.json`

- [ ] **Step 1:** adicionar chaves `CAPTURE.TURN`, `TILT_UP`, `TILT_DOWN`, `POINT_UP` (zênite), `POINT_DOWN` (nadir), `PROGRESS` (`Foto {{current}} de 18`), ajustar `BAND_*`. Nos dois arquivos.
- [ ] **Step 2 — build i18n** (`ng build` não quebra) — chaves usadas existem nos dois.
- [ ] **Step 3 — commit** `feat(client): i18n do fluxo guiado de 18 passos`.

## Verificação final (não é task de código)

- `ng test` — meus specs verdes, só os 3 baseline falham.
- `ng build --configuration production` — exit 0, chunk `@defer` do capture-360 isolado, sem budget.
- `ng lint` — 0.
- Runtime no túnel: abrir `/upload` → capturar, dirigir headless com fake device confirmando os 18 passos, troca de faixa, zênite/nadir, e a montagem final no preview 360°.
- Apagar o `dome-proto.html` (protótipo descartável) antes de fechar.

## Cobertura do spec (self-review)

- Overlay estático guiado → Tasks 4,5,7. Visor central → Task 6,7. Mapa de domo → Task 5. Instruções passo a passo → Tasks 4,8. 18 fotos c/ zênite+nadir → Tasks 2,3,4,7. Sobreposição de costura → Task 7 Step 3. Núcleo reutilizado → Tasks 1–3. Limitação sem-giroscópio → aceita no design (guia + sobreposição mitigam).
