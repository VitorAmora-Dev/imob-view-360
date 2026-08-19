# Dívida Técnica e Bloqueios de Deploy

## Bloqueios de Deploy (resolve ANTES de subir para produção)

1. **`trust proxy` não configurado** — o rate limiting conta todo tráfego atrás de proxy como um único cliente. Sem isso, o rate limiting do Sprint 1 não funciona em produção.
2. **`CORS_ORIGINS` vazio** — nenhuma origem cross-origin aceita. O frontend não fala com a API em produção sem configurar.
3. **`frame-ancestors` do `/embed`** — a API responde `frame-ancestors 'none'`. A liberação para tour embutido em iframe tem que ser no host do Angular (nginx).
4. **`CSP_EXTRA_ORIGINS`** — precisa ser configurado também no host do frontend, ou o viewer não carrega textura do bucket quando migrar para object storage.

## Dívida Registrada

| Item | Onde | Impacto |
|---|---|---|
| Imagens como base64 no Postgres | `Panorama.imageData` | Banco grande, queries lentas. Migração para object storage planejada (Fases 0-6), não iniciada |
| `IMAGE_UPLOAD_ROUTES` manual | `body-limit.config.ts` | Rota nova de imagem que não entrar na lista recebe 413 |
| CRLF em todo o repositório | ~2000 erros de lint | Não rodar `--fix` — destruiria `git blame` |
| Mensagens do Nest em inglês | 401 "Unauthorized" | Resolver no frontend por `statusCode` via i18n, não no backend |
| Duplicação de `select` entre services | find inclui `imageData`, create não | Contratos divergentes para a mesma entidade |
| Branch morto | `inner-view-page.page.ts:56-100` | Comparação `=== undefined` inalcançável |
| Seed lê do disco | `prisma/seed.ts:117-118` | Quebra na Fase 5 da migração de storage |
| 17 pontos de tenant pendentes | Mapa no SPRINT-2-NOTES.md | 3 de 20 testados; ponto 20 corrigido mas sem teste |
| Erros do Prisma não mapeados | Filtro global de exceção | `P2003`/`P2025` caem em 500 genérico |
| Separar unit de integração | Jest config | Todo spec paga conexão + truncate |
| `addHotspots` duplica `hotspotToWorld` | `panoramic-viewer.component.ts` | Duplicação que produziu bug do eixo espelhado |
| Render loop dentro da zona Angular | `panoramic-viewer.component.ts` | Change detection 60×/s — corrigir com `zone.runOutsideAngular` |

## O que NÃO é dívida (decisões conscientes)

- Rascunho cortado do produto (§2.3 do Sprint 3) — deliberado, não adiado
- Hotspot de informação (type: 'info') — sem spec de conteúdo
- Upload incremental com progresso — dívida de backend registrada
- Editar tour existente — fora de escopo do Sprint 3
