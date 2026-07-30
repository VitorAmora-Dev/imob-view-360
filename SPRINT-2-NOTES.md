# Sprint 2 — testes, isolamento entre tenants e Fase 0 do storage

> Documento vivo, escrito **durante** o sprint (o `SPRINT-1-NOTES.md` foi escrito
> no fim). A seção "Para depois" é a razão de ele existir cedo: dívida vista em
> sessão que se perde não volta.

Branch: `chore/sprint-2-testes-e-storage-fase-0`.

---

## Itens

| # | Item | Estado |
|---|---|---|
| 1 | Runner de teste destravado (jest 29, ts-jest 29, Nest ^11) | `9ab6360` |
| — | Oráculo de existência em views e shares | `f0344d4` |
| — | Postgres de dev movido para a porta 5433 | `4f51904` |
| 2a | Harness de integração + guarda do banco de teste | `695c80a` |
| 20 | Tenancy do `targetId` no update de hotspot (achado durante o 2b) | em revisão |
| 2b | Isolamento entre tenants — 20 pontos de `agencyId` | 3 de 20 escritos |
| 3 | `trust proxy` (promovido: sem ele o rate limiting do Sprint 1 não protege) | pendente |
| 4 | Migração base64 → object storage, Fases 0 e 1 | pendente |
| 5 | Vazamento de textura no `panoramic-viewer` | **CONDICIONADO** — arquivo do outro dev, não tocar sem ok explícito |

---

## Para depois

Dívida vista durante o sprint e deliberadamente **não** resolvida agora, cada uma
com o motivo de ter sido adiada.

### 1. Separar unit de integração por projeto do Jest

*Aprovado como item próprio, para depois do 2b.*

Hoje o `beforeEach` de `test/setup/after-env.ts` vale para **todo** arquivo de
spec, então um teste puro de unidade — como o da guarda em
`test/setup/require-test-database.spec.ts`, que só exercita uma função pura —
paga conexão ao banco e `TRUNCATE` em todas as tabelas antes de cada caso.

Depois da serialização (`maxWorkers: 1`) isso é só desperdício, não incorreção:
foi o que fez o teste de unidade participar do deadlock que derrubou o 2a. A
saída é a chave `projects` do Jest, com um projeto `unit` (sem `setupFilesAfterEnv`,
sem `globalSetup`) e um `integration` (com os dois).

Fica **depois do 2b** de propósito: o 2b vai encher a suíte de integração, e é
com ela cheia que dá para medir se a separação vale o custo de configuração.

### 2. `yarn test:local` segue sem prova nesta máquina

O script `test:local` (`docker compose up -d --wait db && jest`) foi entregue no
2a mas **nunca foi executado ponta a ponta**: o `yarn` não existe no PATH desta
máquina (só `npm` e `corepack`), embora o `yarn.lock` esteja versionado. A
verificação em runtime do 2a rodou o binário local do jest direto — o que o
`yarn test` invoca — com o container já de pé. **A etapa do Docker é a parte não
verificada.**

Duas saídas, a escolher:

- validar numa máquina que tenha yarn, mantendo o script como está; ou
- trocar os scripts para `npm`, que é o que existe aqui — decisão que afeta o
  repositório inteiro, não só o teste, e por isso não foi tomada de passagem.

Enquanto não resolver, a seção 7 do `server-api/README.md` documenta um comando
que ninguém confirmou que funciona.

### 3. O filtro global de exceção não mapeia erros conhecidos do Prisma

Não há nenhuma referência a `PrismaClientKnownRequestError`, `P2003` ou `P2025`
em `src/`. Então uma violação de chave estrangeira ou um update em registro
inexistente escapam do contrato de erro do Sprint 1 e caem no caso genérico:
`500 Erro interno do servidor` — **com stack no log**, porque o filtro loga 5xx
com stack.

O efeito prático é duplo. Um usuário autenticado consegue produzir 500 e ruído
de log com entrada que o schema Zod considera perfeitamente válida (era o caso
do `targetId` inexistente no update de hotspot, antes do fix do ponto 20). E um
500 onde cabia um 400 confunde o cliente e polui métrica de erro de servidor com
erro de cliente.

Descoberto ao investigar o ponto 20. **Não corrigido agora** porque mapear
códigos do Prisma é decisão de contrato de erro que vale para a API inteira, não
um remendo num service — merece o próprio item, com a lista de códigos e o
status de cada um.

**A Fase 2 da migração de storage é boa hora para pegar junto**, já que ela mexe
justamente nos caminhos do Prisma que leem panorama.

---

## Convenções firmadas neste sprint

- **Achado adiado nasce com `test.failing`, não com `it.skip`.** Quando um
  buraco é encontrado e a correção fica para depois, o teste do comportamento
  esperado entra na suíte marcado como `test.failing`: ele documenta o que
  deveria acontecer e **falha o build no dia em que alguém corrigir o bug**,
  obrigando a remover a marcação. Um `skip` faz o oposto — some da vista e
  continua mentindo depois que o problema acabou. (Regra firmada ao decidir o
  ponto 20; não chegou a ser aplicada lá, porque a correção entrou na hora.)

---

## Herdado do Sprint 1

O `SPRINT-1-NOTES.md` traz, e continua valendo:

- **4 bloqueios de deploy** (`trust proxy`, `CORS_ORIGINS`, `frame-ancestors` do
  `/embed`, `CSP_EXTRA_ORIGINS`) — três são configuração de infra, um é do host
  do frontend.
- Dívida registrada: `IMAGE_UPLOAD_ROUTES` manual, CRLF em todo o repositório,
  mensagens do Nest em inglês, duplicação de `select` entre services, branch
  morto em `inner-view-page.page.ts`, `prisma/seed.ts` lendo do disco.
