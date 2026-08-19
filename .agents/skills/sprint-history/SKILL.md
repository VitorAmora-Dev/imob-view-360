---
name: sprint-history
description: Resumo dos sprints realizados, decisões tomadas, e o que ficou pendente. Use quando precisar de contexto sobre por que algo foi feito de determinada forma.
---

# Skill: Histórico de Sprints

## Sprint 1 — Segurança da API

**Branch**: `security/sprint-1` → merged em `main`
**Escopo**: apenas `server-api/`

### O que foi feito
- Rate limiting com `@nestjs/throttler` (global 100/min, sensíveis com limites específicos)
- Criação de conta limitada a 3/hora por IP
- Body limit de 50MB restrito a rotas de imagem (default 1MB)
- Rotas públicas filtram `status: PUBLISHED` (DRAFT/ARCHIVED = 404)
- Timeout de 60s na transação de criação de tour
- Remoção de `console.log` que vazava DTO
- Filtro global de exceção com contrato de erro unificado
- Helmet com CSP + Swagger desabilitado em produção
- CORS com allowlist por variável de ambiente
- Validação de env com Zod (boot falha se inválido)
- Documentação de variáveis no `.env.example`

### Bloqueios de deploy (herdados)
1. `trust proxy` — rate limiting não funciona atrás de proxy
2. `CORS_ORIGINS` vazio em produção
3. `frame-ancestors` do `/embed` — responsabilidade do host Angular
4. `CSP_EXTRA_ORIGINS` — também no host do frontend

### Arquivo de referência
`SPRINT-1-NOTES.md` — detalhes completos dos 10 commits

---

## Sprint 2 — Testes, Tenant e Storage (parcial)

**Branch**: `chore/sprint-2-testes-e-storage-fase-0`
**Escopo**: apenas `server-api/`
**Status**: encerrado parcialmente

### O que foi feito
- Runner de teste destravado (jest 25→29, ts-jest 27→29)
- Oráculo de existência fechado em `record-view`/`record-share`
- Postgres de dev movido para porta 5433
- Harness de integração completo (banco dedicado, truncate, guarda dupla)
- Tenancy do `targetId` no update de hotspot (ponto 20 — **correção de segurança**)
- 3 dos 20 pontos de tenant testados (properties)

### Convenções firmadas
- `test.failing` para bugs adiados, nunca `it.skip`
- Verificação em runtime, não só em build
- Provar o defeito ANTES de corrigir

### O que ficou
- 17 pontos de tenant pendentes (mapa completo no arquivo)
- Erros do Prisma não mapeados no filtro global
- Separar unit de integração por projeto Jest
- Migração base64 → object storage (Fases 0-6) — não iniciada

### Arquivo de referência
`SPRINT-2-NOTES.md` — mapa dos 20 pontos de tenant, detalhes do harness

---

## Sprint 3 — Tour Wizard (em andamento)

**Branch**: `feature/tour-wizard` (integração)
**Escopo**: apenas `inner-view-client/`
**Status**: em andamento, com duas frentes paralelas

### Decisões estruturais
1. **Hotspot 'info' cortado** — sem spec de conteúdo
2. **Hotspots vivem em memória** — sobem todos no `createTour` no publicar (uma chamada)
3. **Rascunho cortado do produto** — recarregar perde tudo
4. **Upload no publicar** — não incremental (dívida registrada)

### Frente A (fundacao) — 48 pts
Chrome do wizard, Etapa 1 (imagens), Etapa 3 (info), Publicar

### Frente B (hotspots) — 45 pts
Etapa 2 inteira: overlay HTML de pins, arraste, sheet, painel, rail, lixeira

### Marcos
- M1: shell + pin projetando sobre panorama
- M2: etapa 1 completa, etapa 2 usável no desktop
- M3: fluxo ponta a ponta, mobile incluso
- M4: publica de verdade, a11y e responsivo fechados

### Notas detalhadas (Frente B)
- Eixo vertical corrigido (`positionY * PI`, não `(1-positionY) * PI`)
- Clique no fim do arrasto resolvido (folga de 6px)
- Contexto WebGL vazando resolvido (`forceContextLoss`)
- Pin redesenhado (50×134px, borda vermelha, halo escuro)
- Alcançabilidade BFS entre ambientes (não publica com ambientes ilhados)
- Seletor de destino ancorado no pin (não mais editor completo)
- Nomes de ambiente derivados do destino (não cópia)
- Lixeira com SVG (não emoji, que ignora `color`)

### Arquivos de referência
- `SPRINT-3-TOUR-WIZARD.md` — plano completo, mapa de propriedade de arquivos
- `SPRINT-3-NOTAS-FRENTE-B.md` — 19 seções de detalhes técnicos

---

## Linha do tempo resumida

| Sprint | Foco | Branch | Status |
|---|---|---|---|
| 1 | Segurança API | `security/sprint-1` | ✅ Merged em main |
| 2 | Testes + Tenant | `chore/sprint-2-*` | ⚠️ Parcial |
| 3 | Tour Wizard | `feature/tour-wizard` | 🔄 Em andamento |
