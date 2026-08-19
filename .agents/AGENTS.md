# IMOB360 — Instruções para Agentes de IA

## Contexto

Este repositório é um monorepo com 3 módulos (`server-api`, `inner-view-client`, `pano-cv`) que formam uma plataforma de tours virtuais 360° para o mercado imobiliário brasileiro.

## Antes de começar qualquer tarefa

1. **Leia as rules** em `.agents/rules/` — elas são carregadas automaticamente e contêm a visão geral, arquitetura, convenções, dívida técnica e schema do banco.

2. **Consulte as skills relevantes** em `.agents/skills/` para referência detalhada:
   - `backend-api` — NestJS, Prisma, testes, rodar localmente
   - `frontend-client` — Angular, Ionic, SCSS, tour wizard
   - `design-system` — paleta Arp Vision, tokens, contraste, tipografia
   - `viewer-360` — Three.js, projeção de hotspots, captura 360°, armadilhas
   - `api-endpoints` — referência rápida de rotas REST
   - `sprint-history` — decisões passadas e contexto de evolução

3. **Consulte os sprint notes** (`SPRINT-*-NOTES.md` na raiz) para detalhes profundos sobre decisões específicas.

## Regras gerais

- **Idioma do código**: inglês. Comentários e documentação: português.
- **Nunca hex solto** — usar design tokens.
- **Nunca string hardcoded no template** — usar ngx-translate.
- **Testes obrigatórios** — `npm test` deve passar limpo.
- **Acessibilidade** — Lighthouse a11y ≥ 90, contraste WCAG AA, touch targets ≥ 44px.
- **Commits**: convenção angular (`feat(api):`, `fix(client):`, etc.)

## Documentos-chave

| Documento | Onde | O que contém |
|---|---|---|
| `ARP-VISION-DESIGN.md` | raiz | Especificação de cores da identidade Arp Vision |
| `DESIGN.md` | raiz | Design system base (tipografia, espaçamento, componentes) |
| `SPRINT-1-NOTES.md` | raiz | Sprint de segurança da API |
| `SPRINT-2-NOTES.md` | raiz | Sprint de testes e tenant |
| `SPRINT-3-TOUR-WIZARD.md` | raiz | Plano do wizard de criação de tour |
| `SPRINT-3-NOTAS-FRENTE-B.md` | raiz | Detalhes técnicos dos hotspots |
| `server-api/README.md` | server-api | Como rodar a API, testes, tratamento IA |
| `prisma/schema.prisma` | server-api | Schema do banco de dados |
