# Arquitetura e Decisões Estruturais

## Backend — `server-api/`

### Estrutura de pastas

```
src/
  main.ts                    # bootstrap (Nest, Swagger, CORS, Helmet, body limits)
  app.module.ts              # root module
  config/
    env.schema.ts            # Zod — valida .env no boot; falha = não sobe
    body-limit.config.ts     # 1MB default; 50MB para IMAGE_UPLOAD_ROUTES
    security.config.ts       # Helmet + CSP + CORS
    throttle.config.ts       # rate limiting por rota
  modules/
    auth/                    # JWT (access + refresh), signin, signup
    users/                   # CRUD de usuários (agencyId do token)
    properties/              # CRUD de imóveis (multi-tenant)
    virtual-tours/           # CRUD de tours, createTour com panoramas inline
    panoramas/               # CRUD de panoramas, tratamento IA, imagem servida por URL
    hotspots/                # CRUD de hotspots (origin → target entre panoramas)
  common/                    # decorators, guards, pipes
  infra/                     # prisma service, filtro global de exceção
  shared/                    # utils compartilhados
```

### Padrões do backend

- **Um service por operação**: `CreatePropertyService`, `FindPropertyService`, `DeletePropertyService` etc.
- **Contrato de erro**: `{ statusCode, message, details?, retryAfter? }` — todo erro segue essa forma.
- **Rate limiting**: global 100/min, rotas sensíveis com limites específicos.
- **Body limit**: 1MB default, 50MB só para rotas de imagem explicitamente listadas em `IMAGE_UPLOAD_ROUTES`.
- **Swagger**: disponível em `/docs`, desabilitado em produção (`NODE_ENV=production`).
- **Imagens**: hoje como base64 no Postgres (`Panorama.imageData`). Migração para object storage planejada mas não iniciada.

### Variáveis de ambiente obrigatórias

| Variável | Regra |
|---|---|
| `JWT_ACCESS_SECRET` | mín. 32 chars |
| `JWT_REFRESH_SECRET` | mín. 32 chars, diferente do access |
| `DATABASE_URL` | connection string do Postgres |
| `NODE_ENV` | `development` (default) ou `production` |
| `CORS_ORIGINS` | lista por vírgula (vazio = sem cross-origin) |
| `OPENAI_API_KEY` | opcional — sem ela, tratamento de panorama é SKIPPED |

---

## Frontend — `inner-view-client/`

### Estrutura de pastas

```
src/
  app/
    app.routes.ts            # lazy loading de todas as páginas
    components/              # componentes compartilhados
      app-header/            # header com back, título, links, sticky
      brand-logo/            # logo Arp Vision
      capture-360/           # câmera 360° guiada (gyroscope + stitching)
      panoramic-viewer/      # viewer Three.js (esfera + hotspot sprites)
      inner-view-card/       # card de tour na home
      inner-view-list/       # lista de tours
    services/                # HTTP services (auth, property, virtual-tour, cep, user)
    models/                  # interfaces TypeScript (Property, VirtualTour, User)
    guards/                  # authGuard (verifica token no localStorage)
    interceptors/            # auth interceptor (injeta Bearer token)
    tour-wizard/             # wizard de 3 etapas (Sprint 3)
      tour-wizard.model.ts   # WizardScene, WizardHotspot, WizardStep
      tour-draft.store.ts    # signal store principal
      hotspot-editor.store.ts # estado efêmero de edição de hotspots
      scene-graph.ts         # alcançabilidade entre ambientes (BFS)
      publish-payload.ts     # converte estado local → corpo do createTour
      steps/                 # step-images, step-hotspots, step-info
      hotspots/              # overlay, card, panel, sheet, rail, trash, projection
      ui/                    # stepper, action bar, scene card
    home/                    # lista de tours do corretor
    login/, register/        # auth pages
    inner-view-page/         # gerenciamento de tour individual
    embed/                   # viewer público (só canvas, sem chrome)
    upload-tour/             # tela legada (redirect para tour/novo)
  theme/
    _palette.scss            # tokens primitivos (L0): --brand-*, --neutral-*, --status-*, --tour-*
    variables.scss           # camada semântica (L1): --ion-color-*, --app-*
    tour-wizard.scss         # tokens do wizard (L2): --tw-*
    _tour-wizard-mixins.scss # breakpoints do wizard
    palette.contract.spec.ts # 43 testes de contrato (contraste, coerência, slots)
```

### Padrões do frontend

- **Standalone components**: Angular 20, sem NgModules. Todos os componentes são standalone.
- **Signals**: estado gerenciado por `signal()` e `computed()` do Angular, não RxJS.
- **i18n**: `ngx-translate` com arquivos `pt.json` e `en.json`. Nenhuma string cravada no template.
- **Design tokens**: 4 camadas — L0 (primitivos), L1 (semânticos Ionic), L2 (wizard), L3 (componentes).
- **Componente nunca usa token primitivo direto**: pede pelo papel, não pela cor.
- **Three.js**: `PanoramicViewerComponent` desenha uma esfera com textura equirretangular. Hotspots são sprites no three.js (inner-view) e overlay HTML (wizard).

### Rotas

| Path | Componente | Guard |
|---|---|---|
| `/login` | LoginPage | — |
| `/register` | RegisterPage | — |
| `/home` | HomePage | authGuard |
| `/tour/novo` | TourWizardPage | authGuard |
| `/inner-view-page/:id` | InnerViewPagePage | authGuard |
| `/embed/:id` | EmbedPage | — (público) |
| `/profile` | ProfilePage | authGuard |

---

## Design System — Arp Vision

Paleta documentada em `ARP-VISION-DESIGN.md`. Regra 60/30/10:
- **60% neutro** (fundos claros, texto)
- **30% azul** (`--brand-primary` / `#2563EB`) — identidade
- **10% teal** (`--brand-accent` / `#14B8A6`) — pontuação, estados concluídos

**Tema imersivo** (tour 360°): fundo escuro `--tour-bg`, controles em `--tour-surface`, accent brilhante `--tour-teal-glow`. Restrito ao viewer. **Não é dark mode.**

Tipografia: Inter (fallback de Airbnb Cereal VF). Spacing: base 4px. Raios: soft (8px botões, 14px cards).
