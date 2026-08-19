# IMOB360 — Visão Geral do Projeto

## O que é

IMOB360 (Inner View 360) é uma plataforma SaaS de tours virtuais 360° para o mercado imobiliário brasileiro. Corretores criam tours interativos de imóveis com fotos panorâmicas, hotspots de navegação e dados do imóvel, e compartilham um link público com clientes.

## Repositório: `imob-view-360`

Monorepo com três módulos independentes:

| Módulo | Caminho | Stack | Porta |
|---|---|---|---|
| **server-api** | `server-api/` | NestJS 11 + Prisma + PostgreSQL 16 | 3000 |
| **inner-view-client** | `inner-view-client/` | Angular 20 + Ionic 8 + SCSS + Three.js | 4200 |
| **pano-cv** | `pano-cv/` | Python (FastAPI) — processamento de imagem | — |

## Fronteiras entre módulos

- **server-api** e **inner-view-client** se comunicam via REST (JSON). O cliente faz proxy em dev via `proxy.conf.json`.
- **pano-cv** é chamado pelo server-api para operações de stitching e tratamento de imagem.
- Cada módulo tem seu próprio `package.json` / `requirements.txt`. Não há workspace root compartilhado.

## Banco de dados

PostgreSQL 16. Schema gerenciado pelo Prisma (`server-api/prisma/schema.prisma`).

Entidades principais:
- `Agency` → `User` (ADMINISTRATOR | AGENT)
- `Property` → `Address`, `VirtualTour`
- `VirtualTour` → `Panorama` → `Hotspot`, `CaptureFrame`, `Measurement`
- `Visitor` → `View`, `Share` (analytics públicos)

## Multi-tenancy

Isolamento por `agencyId`. Todo dado pertence a uma agência. Rotas autenticadas filtram pelo `agencyId` do JWT. Rotas públicas filtram por `status: PUBLISHED`.

## Estado atual

- **Sprint 1** (encerrado): Segurança da API — rate limiting, CORS, CSP, validação de env, contrato de erro unificado.
- **Sprint 2** (encerrado parcialmente): Testes de integração, isolamento de tenant, harness de teste.
- **Sprint 3** (em andamento): Tour Wizard no cliente — criação de tour em 3 etapas com captura 360° guiada.

## Branch ativa de trabalho

A branch principal de feature ativa é `feature/tour-wizard` (integração), com sub-branches `feature/tour-wizard-fundacao` (Frente A) e `feature/tour-wizard-hotspots` (Frente B).
