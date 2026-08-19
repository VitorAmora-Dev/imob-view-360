# Convenções de Código

## Idioma

- **Código**: inglês (nomes de variáveis, funções, classes, interfaces, tipos)
- **Comentários**: português, quando explicam decisão de negócio ou contexto local
- **Strings i18n**: português (`pt.json`) e inglês (`en.json`)
- **Commits**: convenção angular (`feat(api):`, `fix(client):`, `chore:`, `docs:`, `test:`)
- **Documentação interna** (README, SPRINT-*-NOTES): português

## Backend (NestJS / TypeScript)

- Um service por operação (ex: `CreatePropertyService`, não um service monolítico)
- DTOs validados com Zod (não class-validator)
- Prisma como ORM — nunca SQL cru, exceto no harness de teste
- Erros seguem o contrato `{ statusCode, message, details?, retryAfter? }`
- `console.log` proibido em produção — vazou DTO no Sprint 1 e foi removido
- Testes de integração com banco real (`property-360-test`), não mocks de Prisma
- `test.failing` para bugs conhecidos adiados, **nunca** `it.skip`
- Verificar em runtime, não só em build

## Frontend (Angular / Ionic / SCSS)

- Componentes standalone (sem NgModules)
- Estado via Angular Signals (`signal()`, `computed()`), não RxJS para estado local
- Todas as strings visíveis passam por `ngx-translate` — nenhuma string hardcoded no template
- Design tokens: componente nunca usa primitivo direto (ex: nunca `var(--brand-primary)`, sempre `var(--tw-surface)` ou `var(--ion-color-primary)`)
- SCSS encapsulado por componente, com orçamento de 6kB por folha (ajustado para 8kB no capture-360)
- `prefers-reduced-motion` respeitado — transitions e animations zeradas
- Three.js: render loop FORA da zona Angular quando possível (`zone.runOutsideAngular`)
- Nenhum getter/método no template de componentes que rodam dentro da zona — usar campos recalculados em `ngOnChanges`
- WebGL: sempre chamar `forceContextLoss()` antes de `dispose()` para liberar o contexto
- Texturas: sempre `.dispose()` a anterior antes de atribuir nova ao material

## Branches

```
main
  └── feature/tour-wizard              ← integração
       ├── feature/tour-wizard-fundacao ← Frente A (chrome, etapa 1, etapa 3, publicar)
       └── feature/tour-wizard-hotspots ← Frente B (etapa 2, overlay, arraste)
```

- PRs das frentes para `feature/tour-wizard`, nunca direto para `main`
- Rebase diário da branch de trabalho sobre integração
- Arquivo com dono não dá conflito (mapa de propriedade no SPRINT-3-TOUR-WIZARD.md §7)

## Testes

- `yarn test` ou `npm test` — sobe banco de teste automaticamente
- Banco separado: `property-360-test` (nunca o de desenvolvimento)
- `maxWorkers: 1` — serialização obrigatória por causa do truncate
- Guarda dupla: verifica nome do banco antes de truncar
- `yarn test:scripts` — testes de scripts de imagem (sem banco)

## Acessibilidade

- Lighthouse a11y ≥ 90
- Touch targets: mínimo 44px
- Contraste WCAG AA (4.5:1 para texto normal)
- `aria-label` descritivo em elementos interativos
- Navegação completa por teclado em desktop
