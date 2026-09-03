---
name: frontend-client
description: Guia para trabalhar no inner-view-client (Angular 20 + Ionic 8). Inclui componentes, design tokens, viewer Three.js, tour wizard, e padrões de SCSS/i18n.
---

# Skill: Frontend Client (inner-view-client)

## Como rodar

```bash
cd inner-view-client
npm install               # ou yarn
npm start                 # ng serve em localhost:4200
```

Proxy para API: `proxy.conf.json` redireciona `/api/*` para `localhost:3000`.

Login rápido (dev): `localStorage.setItem('accessToken', 'dev-token')` — o guard testa `!!token`, sem validar.

---

## Componentes compartilhados

### `PanoramicViewerComponent`
- Viewer Three.js: esfera + textura equirretangular + OrbitControls
- Props: `imageData` (base64/URL), `editMode` (habilita clique para hotspot), `roomNav` (lista de ambientes)
- Emite: `hotspotPlaced` com `{ positionX, positionY }` em UV (0-1)
- **Armadilhas conhecidas**:
  - `setPixelRatio(Math.min(window.devicePixelRatio, 2))` — sem isso, renderiza em 11% dos pixels
  - `forceContextLoss()` ANTES de `dispose()` — browser tem ~16 contextos
  - Textura anterior precisa de `.dispose()` antes de atribuir nova
  - `colorSpace = SRGBColorSpace` na textura de sprite — sem isso, as cores saem erradas
  - OrbitControls: `setPointerCapture` no `pointerdown` falha com pointerId sintético em testes

### `AppHeaderComponent`
- Header sticky com `backHref`, `pageTitle`, links de navegação
- 64px de altura (variável `--header-total-height` declarada no host — irmãos não herdam)

### `Capture360Component`
- Captura 360° guiada com giroscópio + stitching no browser
- Modal via `ModalController`
- `captureSupported()` verifica giroscópio disponível

### `BrandLogoComponent`
- Logo Arp Vision em SVG

---

## Tour Wizard (Sprint 3)

### Etapas
1. **Imagens** — upload/captura de fotos panorâmicas, nomeação de ambientes
2. **Hotspots** — criar pontos de navegação entre ambientes (clique/toque na foto)
3. **Informações** — dados do imóvel (nome, tipo, finalidade, endereço com CEP)

### Stores

**`TourDraftStore`** (estado principal):
```typescript
step: signal<WizardStep>(1)
scenes: signal<WizardScene[]>([])
selectedSceneId: signal<string | null>(null)
property: signal<PropertyDraft>(EMPTY_PROPERTY)
published: signal(false)
publishing: signal(false)
```

**`HotspotEditorStore`** (estado efêmero de edição):
- Injeta `TourDraftStore`, usa `patchScene` para mutar cenas
- Guarda: `editingId`, `sheet` (mode/open), `pinDrag`, timers de long-press

### Mapa de arquivos
| Arquivo/Pasta | Dono | Descrição |
|---|---|---|
| `tour-wizard.page.*` | Frente A | Shell, stepper, barra de ação |
| `tour-draft.store.ts` | Frente A | Estado principal |
| `steps/step-images/` | Frente A | Etapa 1 |
| `steps/step-info/` | Frente A | Etapa 3 |
| `steps/step-hotspots/` | Frente B | Etapa 2 |
| `hotspot-editor.store.ts` | Frente B | Estado efêmero |
| `hotspots/` | Frente B | Overlay, card, panel, sheet, rail, trash |
| `scene-graph.ts` | — | Alcançabilidade BFS entre ambientes |
| `publish-payload.ts` | Frente A | Converte estado → corpo do createTour |

---

## Design Tokens (SCSS)

### Camadas
```
L0  src/theme/_palette.scss        → --brand-*, --neutral-*, --status-*, --tour-*
L1  src/theme/variables.scss       → --ion-color-*, --app-*
L2  src/theme/tour-wizard.scss     → --tw-*   (wizard de criação de tour)
L2  src/theme/tour-viewer.scss     → --tv-*   (tela de visualização de tour)
L3  componentes                    → var(--tw-*), var(--tv-*), var(--app-*), var(--ion-*)
```

**Duas camadas L2, e não se misturam.** O wizard é claro, o visualizador é
escuro sobre foto. Componente de `app/tour-viewer/` usa `--tv-*`; componente do
wizard usa `--tw-*`. Token que falta nasce na L2 da própria tela, nunca no
componente — ver `SPRINT-4-TOUR-VIEWER.md`.

**Token de `--tv-*` que NÃO é cor precisa de marcador no nome** (`dur`, `blur`,
`grad`, `size`): `palette.contract.spec.ts` varre a camada e exige que todo
token varrido resolva como cor. Uma duração ou um gradiente sem marcador cai lá
como "cadeia quebrada" estando certo.

### Regra de ouro
Componente **nunca** usa primitivo (L0) diretamente. Pede pelo papel:
```scss
// CORRETO
color: var(--tw-text);
background: var(--tw-surface);

// ERRADO
color: var(--brand-primary);
background: #2563EB;
```

### Contraste e acessibilidade
- `brand-teal` (#14B8A6) é CLARO — texto branco sobre ele NÃO passa contraste
- Botão teal com texto branco → usar `brand-teal-dark` (#0F766E) como fundo
- Cores de status sempre com ícone, nunca só a cor

---

## i18n

Chaves em `src/assets/i18n/pt.json` e `en.json`:
```json
{
  "TOUR_WIZARD": {
    "COMMON": {},
    "STEP1": {},
    "STEP2": {},
    "STEP3": {},
    "SUCCESS": {}
  }
}
```

No template:
```html
{{ 'TOUR_WIZARD.STEP1.TITLE' | translate }}
```

---

## Testes

```bash
npm test                  # Karma + Jasmine
npm run lint              # ESLint
```

### Armadilhas em testes
- `OrbitControls.setPointerCapture` falha com pointerId sintético — neutralizar no test
- `IonModal` assíncrono: apresentação continua após teardown — usar `afterEach` para destruir fixtures
- Clique de ponteiro (`event.detail ≥ 1`) vs clique de teclado (`event.detail === 0`) — separar nos testes
- `elementFromPoint` para verificar visibilidade, não `getComputedStyle`

---

## Performance — checklist

- [ ] Render loop fora da zona Angular (`zone.runOutsideAngular`)
- [ ] Nenhum getter/método no template de componentes na zona
- [ ] `getBoundingClientRect` cacheado quando possível
- [ ] `objectURL.revokeObjectURL` no destroy
- [ ] Textura `.dispose()` antes de reatribuir
- [ ] `forceContextLoss()` antes de `dispose()` do renderer
- [ ] `setPixelRatio(Math.min(dpr, 2))` reaplicado no resize
