---
name: api-endpoints
description: Referência rápida dos endpoints da API REST. Inclui todos os módulos, formatos de request/response, e particularidades.
---

# Skill: API Endpoints — Referência Rápida

## Autenticação

Todas as rotas autenticadas esperam `Authorization: Bearer <accessToken>`.

### Auth
| Método | Rota | Body | Resposta | Rate Limit |
|---|---|---|---|---|
| `POST` | `/auth/signin` | `{ email, password }` | `{ accessToken, refreshToken, user }` | 5/5min |
| `POST` | `/auth/signup` | `{ name, email, password, type, agencyName?, licenseNumber? }` | `{ accessToken, refreshToken, user }` | 3/hora |
| `POST` | `/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` | 10/min |

---

## Imóveis (Properties)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/properties` | ✅ | Lista imóveis da agência (filtros: `city`, `state`, busca textual) |
| `GET` | `/properties/:id` | ✅ | Detalhe do imóvel (tenant isolado) |
| `POST` | `/properties` | ✅ | Criar imóvel (`agencyId` do JWT, validação do `agentId`) |
| `PATCH` | `/properties/:id` | ✅ | Atualizar imóvel |
| `DELETE` | `/properties/:id` | ✅ | Excluir imóvel |

---

## Tours Virtuais

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/virtual-tours` | ✅ | Lista tours da agência |
| `GET` | `/virtual-tours/:id` | Público | Tour com `status: PUBLISHED` (DRAFT/ARCHIVED = 404) |
| `GET` | `/virtual-tours/:id/thumbnail` | Público | Thumbnail do tour |
| `POST` | `/virtual-tours` | ✅ | **Criar tour completo** (panoramas + hotspots inline) |
| `PATCH` | `/virtual-tours/:id` | ✅ | Atualizar tour |
| `DELETE` | `/virtual-tours/:id` | ✅ | Excluir tour |
| `POST` | `/virtual-tours/:id/montar` | ✅ | Dispara montagem (stitching + tratamento IA) |
| `GET` | `/virtual-tours/:id/montagem` | ✅ | Andamento da montagem |

### Criação de tour (payload completo)
```typescript
{
  propertyId: string;        // ou dados inline do imóvel
  panoramas: [
    {
      tempId: string;        // UUID local
      roomName: string;
      imageData: string;     // base64 JPEG
      order: number;
      initialPanorama: boolean;
      measurements?: [...];
      hotspots?: [
        {
          label?: string;
          positionX: number;  // UV 0-1
          positionY: number;  // UV 0-1
          targetTempId: string; // referência a outro panorama pelo tempId
        }
      ]
    }
  ]
}
```

O servidor resolve `targetTempId` → `targetId` real na mesma transação.

---

## Panoramas

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/panoramas/:id` | Público | Dados do panorama (sem imageData) |
| `GET` | `/panoramas/:id/image` | Público | Imagem servida com ETag e Cache-Control |
| `POST` | `/panoramas` | ✅ | Criar panorama avulso |
| `PATCH` | `/panoramas/:id` | ✅ | Atualizar (trocar foto limpa tratamento) |
| `DELETE` | `/panoramas/:id` | ✅ | Excluir |

### Imagem servida por URL
- `GET /panoramas/:id/image` serve a imagem tratada (se existir) ou a original
- ETag baseada em `updatedAt` do panorama
- `Cache-Control` com revalidação

---

## Hotspots

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `POST` | `/hotspots` | ✅ | Criar hotspot |
| `PATCH` | `/hotspots/:id` | ✅ | Atualizar (label, posição, target) |
| `DELETE` | `/hotspots/:id` | ✅ | Excluir |

**⚠️ Tenancy do targetId**: o `PATCH` valida que o `targetId` pertence à mesma agência (corrigido no ponto 20 do Sprint 2).

---

## Analytics (rotas públicas)

| Método | Rota | Auth | Descrição | Rate Limit |
|---|---|---|---|---|
| `POST` | `/record-view` | — | Registrar visualização | 10/min |
| `POST` | `/record-share` | — | Registrar compartilhamento | 5/min |
| `GET` | `/analytics/:tourId` | ✅ | Estatísticas do tour (tenant isolado) |

---

## Usuários

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/users` | ✅ | Lista usuários da agência |
| `GET` | `/users/:id` | ✅ | Detalhe (tenant isolado) |
| `POST` | `/users` | ✅ | Criar (agencyId do token) |
| `PATCH` | `/users/:id` | ✅ | Atualizar |

---

## Contrato de Erro

Toda resposta de erro:
```typescript
{
  statusCode: number;
  message: string;
  details?: unknown;     // erros por campo (Zod)
  retryAfter?: number;   // segundos (429)
}
```

Códigos especiais:
- **429**: rate limit — header `Retry-After` + campo `retryAfter`
- **413**: payload acima do limite (1MB default, 50MB para imagem)

---

## Body Limits

| Rotas | Limite |
|---|---|
| Default (todas) | 1 MB |
| `POST /virtual-tours` | 50 MB |
| `POST /panoramas` | 50 MB |
| `PATCH /panoramas/:id` | 50 MB |
