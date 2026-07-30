# Sprint 2 — testes, isolamento entre tenants e Fase 0 do storage

> **Sprint ENCERRADO por decisão de escopo, com backlog em aberto.**
>
> Este arquivo é o ponto de retomada. Quem for continuar — inclusive nós, daqui
> a meses — deve conseguir seguir lendo **só ele**: o que está feito, o que
> falta, por quê, e em que ordem. Se algo aqui estiver desatualizado em relação
> ao código, o código vence e esta nota é que está errada.

Branch: `chore/sprint-2-testes-e-storage-fase-0` → PR para `main`.
Escopo tocado: **apenas `server-api/`**. Nenhum arquivo de `inner-view-client/`,
conforme o mapa de fronteiras acordado com a frente de frontend.

---

## Por que o sprint foi encerrado aqui

O que era **grave e explorável** está fechado: o Sprint 1 inteiro está no `main`,
e o único achado de segurança novo deste sprint (ponto 20, tenancy do `targetId`)
foi corrigido antes do encerramento.

O que sobrou é **robustez e cobertura** — real, mas não urgente. Nada no backlog
abaixo é um buraco explorável conhecido; são testes que faltam, tratamento de
erro que podia ser melhor, e uma migração de arquitetura planejada.

**A exceção é o `trust proxy`** (item 3 abaixo): ele não é um buraco novo, mas
**bloqueia o deploy** do que o Sprint 1 já entregou. Ver a seção de bloqueios.

---

## Como retomar

```bash
cd server-api
npm install          # ou yarn, se sua máquina tiver — ver "para depois" nº 2
npm test             # sobe nada; exige o container do banco de pé
npm run build
```

O container do Postgres roda na **porta 5433** (`docker compose up -d --wait db`).
Na primeira execução dos testes o harness cria o banco `property-360-test` e
aplica as migrations sozinho. A seção 7 do `server-api/README.md` explica o
isolamento e as salvaguardas em detalhe.

---

## O que foi entregue

| Commit | O que faz |
|---|---|
| `9ab6360` | `chore(api)`: runner de teste destravado — jest 25→29, ts-jest 27→29, `@nestjs/common` ^10→^11, `types: ["node"]` no tsconfig que escondia o `@types/jest` |
| `f0344d4` | `fix(api)`: fecha o oráculo de existência em `record-view` e `record-share` — o item 4 do Sprint 1 cobriu só `find` e `thumbnail`, então tour em `DRAFT` respondia 201 e gravava registro enquanto id inexistente respondia 404 |
| `4f51904` | `chore(api)`: Postgres de desenvolvimento movido para a porta 5433 |
| `695c80a` | `test(api)`: harness de integração — banco dedicado, `globalSetup` idempotente, `TRUNCATE` entre testes, guarda em duas camadas, e a correção do flaky (`maxWorkers: 1`) |
| `e3cdba7` | `fix(api)`: tenancy do `targetId` no update de hotspot — **ponto 20**, achado ao levantar a cobertura do 2b |
| `e2b0ee3` | `test(api)`: isolamento de tenant em properties — **3 dos 20 pontos** |

### O harness de teste, em uma tela

Banco dedicado `property-360-test`, no mesmo container da porta 5433. O
`globalSetup` cria o banco se faltar e aplica as migrations — idempotente. Entre
cada teste, `TRUNCATE ... CASCADE` em todas as tabelas, lidas do catálogo
(`pg_tables`) e não de lista fixa, para que model novo entre sozinho. O truncate
roda no `beforeEach` e não no `afterEach`: teste que quebra deixa os dados para
inspeção e o próximo ainda começa zerado.

**Três salvaguardas**, porque truncate no banco errado apaga tudo sem volta:

1. O nome do banco é extraído da URL e comparado inteiro — não `endsWith`, que
   deixaria passar `producao-property-360-test`.
2. A guarda roda em **duas camadas**: no `globalSetup`, antes do migrate, e na
   importação do cliente Prisma, antes do truncate. Workers do Jest têm
   `process.env` próprio, então uma guarda só no `globalSetup` deixaria o
   truncate desprotegido.
3. A senha nunca aparece em mensagem de erro, que costuma ir parar em log de CI.

O `.env.test` é **versionado de propósito** (exceção `!.env.test` no
`.gitignore`), só com valores locais descartáveis. O dotenv não sobrescreve
variável existente, então o ambiente sempre vence e CI não precisa de arquivo
commitado.

**`maxWorkers: 1` não é preferência, é correção.** A suíte era flaky: workers
paralelos sobre um banco único faziam o `TRUNCATE` de um apagar as fixtures que
outro acabara de criar (violação de FK) e dois truncates simultâneos travarem
entre si (deadlock `40P01`). Com o cache do ts-jest frio passava; quente,
falhava. Fica no `package.json` e não como `--runInBand` no script, porque o flag
no script não vale para quem chama o jest direto.

---

## O que ficou para depois

Em ordem de prioridade. O item 3 é o único que **bloqueia deploy**.

### 1. `trust proxy` — BLOQUEIA DEPLOY

Era o item 3 do Sprint 2, promovido de "para depois" no Sprint 1 justamente por
isto: atrás de reverse proxy (nginx, Render, Railway, ALB) o Express vê o IP do
proxy em toda requisição, então o **rate limiting por IP entregue no Sprint 1
conta todo o tráfego como um único cliente** — não protege, e ainda pode
bloquear usuários legítimos em massa.

**Não suba o rate limiting em produção atrás de proxy sem resolver isto.**

### 2. Os 17 pontos restantes de isolamento entre tenants (item 2b)

Três dos 20 estão escritos (`e2b0ee3`, properties). O mapa completo está abaixo,
pronto para quem retomar. A extensão do `fixtures.ts` — tour, panorama e hotspot
por tenant — é pré-requisito dos pontos 10 a 20 e **não foi feita**.

| # | Ponto de tenancy | Service | O que o teste afirma | Estado |
|---|---|---|---|---|
| 1 | find por id | `FindPropertyService:19` | imóvel alheio dá 404 **idêntico** ao de id inexistente (mesmo status e mensagem) | ✅ |
| 2 | list | `ListPropertiesService:24` | só a própria agência; filtro `city`/`state` e busca textual que casariam com o alheio não o trazem | ✅ |
| 3 | delete | `DeletePropertyService:11` | 404 **e** o registro alheio continua no banco | ✅ |
| 4 | create — validação do `agentId` | `CreatePropertyService:40` | `agentId` de corretor de outra agência é rejeitado; nenhum imóvel é criado | — |
| 5 | create — `agencyId` do token | `CreatePropertyService:56` | imóvel nasce na agência do token mesmo se o DTO trouxer outro `agencyId` | — |
| 6 | find por id | `FindUserService:16` | usuário alheio dá 404 idêntico ao de inexistente | — |
| 7 | list | `ListUsersService:20` | só usuários da própria agência | — |
| 8 | update | `UpdateUserService:20` | 404 e o usuário alheio fica intacto | — |
| 9 | create — `agencyId` do token | `CreateUserService:31` | usuário nasce na agência do token, não na do DTO | — |
| 10 | create — tour sobre property | `CreateVirtualTourService:24` | `propertyId` de outra agência é rejeitado | — |
| 11 | update | `UpdateVirtualTourService:12` | 404 e tour alheio intacto | — |
| 12 | delete | `DeleteVirtualTourService:11` | 404 e tour alheio ainda existe | — |
| 13 | analytics | `GetAnalyticsService:11` | 404 — não vaza contagem de views de tour alheio | — |
| 14 | create — panorama sobre tour | `CreatePanoramaService:14` | `tourId` de outra agência é rejeitado | — |
| 15 | update | `UpdatePanoramaService:12` | 404 e panorama alheio intacto | — |
| 16 | delete | `DeletePanoramaService:11` | 404 e panorama alheio ainda existe | — |
| 17 | create — hotspot sobre panorama | `CreateHotspotService:14` | `panoramaId` de outra agência é rejeitado | — |
| 18 | update | `UpdateHotspotService:12` | 404 e hotspot alheio intacto | — |
| 19 | delete | `DeleteHotspotService:11` | 404 e hotspot alheio ainda existe | — |
| 20 | update — tenancy do `targetId` | `UpdateHotspotService:18` | `targetId` de panorama de outra agência é rejeitado com 400 e **não persiste** | fix feito (`e3cdba7`), teste **não** escrito |

**Fora do escopo, de propósito:** `FindVirtualTourService`, `GetThumbnailService`,
`RecordViewService` e `RecordShareService` não têm `agencyId` **por serem rotas
públicas** — o escopo delas é `status: 'PUBLISHED'`, do Sprint 1 e do `f0344d4`.
Não são buracos.

**A sonda que provou o ponto 20** cobria cinco casos e foi descartada ao fechar o
sprint; ela vira o teste do ponto 20 quando alguém retomar: rejeita target de
outra agência sem persistir; uuid inexistente dá 400 e não `P2003`; target válido
do mesmo tour segue funcionando; update só de `label` segue funcionando; hotspot
de outra agência segue dando 404.

### 3. O filtro global de exceção não mapeia erros conhecidos do Prisma

Não há nenhuma referência a `PrismaClientKnownRequestError`, `P2003` ou `P2025`
em `src/`. Então violação de FK ou update em registro inexistente escapam do
contrato de erro do Sprint 1 e caem no genérico `500 Erro interno do servidor` —
**com stack no log**, porque o filtro loga 5xx com stack.

Efeito duplo: usuário autenticado produz 500 e ruído de log com entrada que o
schema Zod aceita (era o caso do `targetId` inexistente, antes do ponto 20); e um
500 onde cabia 400 polui métrica de erro de servidor com erro de cliente.

Não corrigido porque mapear códigos do Prisma é decisão de **contrato de erro
para a API inteira**, não remendo num service. **A Fase 2 do storage é boa hora
para pegá-lo junto**, já que mexe nos caminhos do Prisma que leem panorama.

### 4. Separar unit de integração por projeto do Jest

O `beforeEach` de `test/setup/after-env.ts` vale para **todo** arquivo de spec,
então o teste puro da guarda paga conexão e `TRUNCATE` antes de cada caso. Depois
da serialização isso é desperdício, não incorreção — mas foi o que fez um teste
de unidade participar do deadlock que derrubou o 2a.

A saída é a chave `projects` do Jest: um projeto `unit` (sem `globalSetup` nem
`setupFilesAfterEnv`) e um `integration` (com os dois). Fica **depois do 2b** de
propósito: é com a suíte de integração cheia que dá para medir se paga o custo.

### 5. `yarn test:local` segue sem prova

O script (`docker compose up -d --wait db && jest`) foi entregue no 2a mas
**nunca rodou ponta a ponta**: o `yarn` não existe no PATH da máquina de
desenvolvimento, embora o `yarn.lock` esteja versionado. A verificação em runtime
usou o binário local do jest com o container já de pé — **a etapa do Docker é a
parte não coberta**.

Ou se valida numa máquina com yarn, ou se trocam os scripts para `npm`, que é o
que existe aqui. A segunda opção afeta o repositório inteiro e não cabia de
passagem. Enquanto isso, a seção 7 do README documenta um comando que ninguém
confirmou que funciona.

### 6. Migração base64 → object storage (Fases 0 a 6) — não começou

Nenhuma fase foi executada; o item 4 do sprint (Fases 0 e 1) ficou inteiro para
depois. Hoje os panoramas vivem como **base64 no Postgres**, na coluna
`Panorama.imageData` (`@db.Text`), o que é a raiz de vários itens já registrados.

**Aviso de honestidade:** o desenho completo das seis fases está no diagnóstico de
arquitetura original, **não neste repositório**. O que segue é só o que dá para
reconstruir a partir de referências espalhadas em código e notas — quem retomar
deve buscar o diagnóstico, não tratar esta lista como a especificação.

O que se sabe, por referência:

- **Fase 2** — bucket entra em cena. `CSP_EXTRA_ORIGINS` já existe no schema de
  env e alimenta `connect-src` e `img-src` justamente para isto; a CSP do app
  Angular, servida por outro host, precisa receber o mesmo domínio ou o viewer
  não carrega textura.
- **Fase 3** — upload vira **presigned PUT direto ao bucket**. É quando a lista
  manual `IMAGE_UPLOAD_ROUTES` (`body-limit.config.ts`) encolhe até desaparecer;
  hoje rota de imagem nova que não entrar nela recebe 413.
- **Fase 5** — `prisma/seed.ts:117-118` lê `../relax_inn.jpg` do disco e quebra.
- Fases 0, 1, 4 e 6: **sem registro recuperável aqui.**

---

## Herdado do Sprint 1 — quatro bloqueios de deploy

Continuam valendo integralmente. Detalhe em `SPRINT-1-NOTES.md`.

1. **`trust proxy`** — ver item 1 acima. É o único que este sprint chegou a
   promover de prioridade.
2. **`CORS_ORIGINS` precisa do domínio real do frontend.** Vazio em produção =
   nenhuma origem cross-origin aceita = o app não fala com a API.
3. **A exceção de `frame-ancestors` do `/embed` é do host do frontend.** Esta API
   responde `frame-ancestors 'none'`, correto para uma API JSON; a liberação para
   o tour embutido tem que ser no host do Angular.
4. **`CSP_EXTRA_ORIGINS` também no host do frontend**, ou o viewer não carrega
   textura do bucket na Fase 2.

E a dívida registrada lá: `IMAGE_UPLOAD_ROUTES` manual, **CRLF em todo o
repositório** (~2000 erros de lint pré-existentes; `--fix` destruiria o
`git blame`), mensagens do Nest em inglês, duplicação de `select` entre services,
branch morto em `inner-view-page.page.ts:56-100`, seed lendo do disco, e o
**vazamento de textura no viewer** (`panoramic-viewer.component.ts:130-134`,
~128 MiB de VRAM por navegação) — que é território da frente de frontend e segue
**CONDICIONADO** a alinhamento com aquele dev.

---

## Convenções firmadas neste sprint

- **Achado adiado nasce com `test.failing`, não com `it.skip`.** O teste do
  comportamento esperado entra na suíte marcado, documenta o que deveria
  acontecer e **falha o build no dia em que alguém corrigir o bug**, obrigando a
  remover a marcação. Um `skip` faz o oposto: some da vista e segue mentindo
  depois que o problema acabou. (Firmada ao decidir o ponto 20; não chegou a ser
  aplicada, porque a correção entrou na hora.)

- **Verificação em runtime, não em build.** Duas vezes neste sprint a diferença
  importou: o harness do 2a passava no build e era flaky em execução, e o ponto
  20 só ficou provado ao ver o `targetId` cross-tenant **persistido no banco** —
  o retorno do service sozinho não provaria.

- **Provar o defeito antes de corrigir.** No ponto 20 isso derrubou a suspeita
  original (o `create` estava correto) e apontou o buraco real, no `update`.
