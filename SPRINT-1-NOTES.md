# Sprint 1 — endurecimento de segurança da API

> Este arquivo é o texto que seria a descrição do Pull Request de
> `security/sprint-1` → `main`. O merge foi feito direto via git (`--no-ff`)
> porque o GitHub CLI não estava disponível na máquina; o resultado no `main` é
> idêntico ao de um "Merge pull request". A documentação vive aqui para não se
> perder.

Fecha os 6 itens do Sprint 1 do diagnóstico de arquitetura. Todos os itens foram
implementados um por vez, verificados **em runtime** (não só build) e aprovados
individualmente antes do commit.

Escopo: **apenas `server-api/`**. Nenhum arquivo de `inner-view-client/` foi
tocado, conforme o mapa de fronteiras acordado com a frente de frontend.

---

## Os 10 commits

| Commit | O que faz | Por que importa |
|---|---|---|
| `85b9c55` | `feat(api)`: rate limiting com `@nestjs/throttler` | Login e refresh ficavam abertos a força bruta ilimitada. Limite global 100/min; `signin` 5 por 5min; `refresh` 10/min; `record-view` 10/min; `record-share` 5/min |
| `40232e3` | `feat(api)`: criação de conta limitada a 3/hora por IP | Cadastro era um vetor de flood de registros e de enumeração de e-mails |
| `f9b98c1` | `fix(api)`: body de 50MB restrito às rotas de imagem | O limite alto valia para **toda** a API, transformando qualquer endpoint em amplificador de DoS. Agora o default é 1MB e só 3 rotas aceitam 50MB |
| `810f846` | `fix(api)`: rotas públicas servem apenas tours `PUBLISHED` | Tour em `DRAFT`/`ARCHIVED` era servido publicamente por quem tivesse o id. Agora cai no mesmo 404 de inexistente, sem revelar que o id existe |
| `b94552f` | `fix(api)`: timeout explícito na transação de criação de tour | O default do Prisma é 5s; a criação com panoramas em base64 pode passar disso em Postgres gerenciado. `timeout: 60s`, `maxWait: 10s` |
| `469954a` | `chore(api)`: remover `console.log` do create de property | Vazava o DTO inteiro (dados de cliente) no log de produção |
| `6c2567b` | `feat(api)`: filtro global de exceção com contrato de erro unificado | Erros saíam em 3 formatos diferentes e stack traces podiam vazar. Agora todo erro tem forma fixa e só 5xx gera log com stack |
| `ba2de4e` | `feat(api)`: helmet com CSP + Swagger fora de produção | Nenhum header de segurança era enviado; `/docs` expunha a superfície inteira da API em produção |
| `77d3539` | `feat(api)`: CORS com allowlist por variável de ambiente | CORS estava aberto. Agora lê de `CORS_ORIGINS`; lista vazia = nenhuma origem cross-origin |
| `42236c2` | `docs(api)`: documentar todas as variáveis no `.env.example` | `.env.example` estava incompleto e era a origem provável dos segredos fracos |

**Nota de leitura do histórico:** o **item 1 do sprint** (remoção dos 4 fallbacks
silenciosos de segredo JWT + `env.schema.ts` com validação Zod no boot) **não
tem commit próprio** — está dentro do commit de importação `9568bbc`. Quem
procurar "onde os fallbacks foram removidos" deve olhar lá, não nesta lista.

**Nota sobre `ba2de4e` + `77d3539`:** os dois tocam os mesmos 4 arquivos porque a
separação foi construída de propósito (estado intermediário só-helmet) para que
cada um fique revertível isoladamente.

---

## Contrato de erro (o que o frontend precisa tratar)

Toda resposta de erro da API agora tem esta forma:

```ts
{
  statusCode: number;
  message: string;
  details?: unknown;     // erro por campo, nas validações Zod
  retryAfter?: number;   // segundos, nas respostas 429
}
```

Exemplos reais, capturados nos testes de runtime:

```json
429 → {"statusCode":429,"message":"Muitas requisições. Tente novamente em instantes.","retryAfter":60}
413 → {"statusCode":413,"message":"Corpo da requisição excede o limite permitido"}
400 → {"statusCode":400,"message":"Dados inválidos","details":{"fieldErrors":{"sessionId":["Invalid input"]}}}
500 → {"statusCode":500,"message":"Erro interno do servidor"}
```

Dois códigos são **novos** para o cliente: **429** (rate limit — também vem com
header `Retry-After`, emitido nativamente pelo throttler) e **413** (payload
acima do limite).

---

## Variáveis de ambiente

Três novas passam pelo schema Zod e **derrubam o boot** se estiverem inválidas:

| Variável | Obrigatória | Observação |
|---|---|---|
| `JWT_ACCESS_SECRET` | sim | mín. 32 caracteres |
| `JWT_REFRESH_SECRET` | sim | mín. 32 caracteres e **diferente** do de acesso |
| `DATABASE_URL` | sim | — |
| `NODE_ENV` | não (`development`) | em `production` o `/docs` é desabilitado |
| `CORS_ORIGINS` | não (vazio) | lista por vírgula; vazio = nenhuma origem cross-origin |
| `CSP_EXTRA_ORIGINS` | não (vazio) | alimenta `connect-src` e `img-src`; reservado para o bucket na Fase 2 |

Gerar os segredos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Rodar duas vezes — os dois segredos precisam ser diferentes. O schema rejeita se
forem iguais.

---

## ⚠️ BLOQUEIA DEPLOY

Quatro coisas precisam ser feitas **antes** de subir isto para produção. Nenhuma
é código desta branch; três são configuração de infra e uma é do host do
frontend.

1. **`trust proxy` não está configurado.** Atrás de reverse proxy (nginx, Render,
   Railway, ALB) o Express vê o IP do proxy em toda requisição, então o rate
   limiting por IP entregue neste sprint **conta todo o tráfego como um único
   cliente** — ou seja, não protege e ainda pode bloquear usuários legítimos em
   massa. É o **item 3 do Sprint 2**, promovido de "para depois" justamente por
   isso. **Não suba o rate limiting em produção atrás de proxy sem resolver.**

2. **`CORS_ORIGINS` precisa do domínio real do frontend.** Vazio em produção
   significa que nenhuma origem cross-origin é aceita — o app não fala com a API.
   Formato: `https://app.dominio.com,https://staging.dominio.com`.

3. **A exceção de `frame-ancestors` do `/embed` é do host do frontend, não daqui.**
   Esta API responde `frame-ancestors 'none'` e `X-Frame-Options: deny`, que é o
   correto para uma API JSON. Mas a rota `/embed` (tour embutido em site de
   terceiro) é servida pelo app Angular, em outro host — a liberação tem que ser
   lá. Snippet de nginx para o host do frontend:

   ```nginx
   location /embed {
     add_header Content-Security-Policy "frame-ancestors *" always;
     add_header X-Frame-Options "" always;   # remove o header, nao sobrescreve
   }
   ```

4. **`CSP_EXTRA_ORIGINS` também precisa ser configurado no host do frontend.**
   A CSP desta API cobre as respostas da API. A CSP do app Angular é servida por
   outro host e precisa receber o mesmo domínio de bucket em `connect-src` e
   `img-src`, ou o viewer não carrega textura de object storage na Fase 2.

---

## Limitações conhecidas / dívida registrada

Itens vistos durante o sprint e **deliberadamente não corrigidos** para manter
mudança mínima:

- **`IMAGE_UPLOAD_ROUTES` é lista manual** (`body-limit.config.ts`). Rota nova de
  imagem que não entrar na lista recebe 413. Amarrado à **Fase 3 da migração de
  storage**: quando o upload virar presigned PUT direto ao bucket, esta lista
  encolhe até desaparecer.
- **Todo o repositório está em CRLF.** O lint acusa ~2000 erros `Delete ␍`, todos
  pré-existentes (comprovado lintando arquivo não tocado). Não rodei `--fix`
  porque reescreveria praticamente todos os arquivos e destruiria o `git blame`.
  Restam 34 erros em `app.module.ts`, todos CRLF — zero dívida nova.
- **Mensagens padrão do Nest seguem em inglês** (401 `"Unauthorized"`) enquanto as
  nossas estão em português. Resolver **no frontend por `statusCode` via i18n**,
  não caçando strings no backend.
- **Duplicação de `select` entre services**: `find` inclui `imageData`, `create`
  não. Contratos divergentes para a mesma entidade.
- **Branch morto** em `inner-view-page.page.ts:56-100` (comparação `=== undefined`
  inalcançável, porque `create-property` nunca retorna `virtualTour`).
- **`prisma/seed.ts:117-118`** lê `../relax_inn.jpg` do disco; quebra na Fase 5 da
  migração de storage.
- **Vazamento de textura no viewer** (`panoramic-viewer.component.ts:130-134`):
  `material.map` recebe textura nova sem `.dispose()` da anterior — ~128 MiB de
  VRAM por navegação. É território da frente de frontend; a correção está
  **condicionada** ao alinhamento com aquele dev.

---

## Como verificar

```bash
cd server-api
yarn build          # deve passar
yarn start:dev      # boot deve subir; com .env invalido, deve FALHAR com erro legivel
```

Testes de runtime executados manualmente durante o sprint (o runner de teste está
quebrado — é o **item 1 do Sprint 2**):

- 429 disparado por repetição de `signin`, com `Retry-After` e `retryAfter` no corpo
- 413 disparado em rota não-imagem com corpo > 1MB, passando pelo contrato de erro
  (não HTML cru do Express)
- upload de 32MB numa rota de imagem: aceito, 1,43s
- `timeout` da transação comprovado honrado forçando `timeout: 200` → P2028
- tour em `DRAFT` retornando 404 na rota pública
- thumbnail cross-origin carregando com `Cross-Origin-Resource-Policy: cross-origin`
- `/docs` ausente com `NODE_ENV=production`
