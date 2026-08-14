# Como rodar o server-api localmente

## NixOS (sem Docker)

O projeto inclui um `shell.nix` que provisiona PostgreSQL 16, Node 22, Yarn e as engines do Prisma (os binários oficiais não existem para NixOS — o shell usa as do nixpkgs via `PRISMA_*_ENGINE_BINARY`).

```bash
cd server-api
nix-shell

# Setup inicial (uma vez):
db-start                      # inicializa o cluster PG local em .postgres/ e cria o banco
yarn install                  # instala deps (o postinstall roda prisma generate)
npx prisma migrate deploy     # aplica migrations
yarn seed                     # popula dados de exemplo

# Desenvolvimento:
db-start && yarn start:dev

# Outros comandos:
db-stop     # para o PostgreSQL
db-logs     # logs do PG
```

O restante deste README descreve o fluxo com Docker.

---

## Pré-requisitos

Antes de começar, certifique-se de ter instalado:

- [Node.js 22+](https://nodejs.org/) — recomendado via [nvm](https://github.com/nvm-sh/nvm)
- [Yarn](https://yarnpkg.com/) — gerenciador de pacotes
- [Docker](https://www.docker.com/get-started) + [Docker Compose](https://docs.docker.com/compose/) — para subir o banco e a API

Para verificar se tudo está instalado:

```bash
node -v        # deve mostrar v22.x.x
yarn -v        # deve mostrar 1.x.x ou 4.x.x
docker -v      # deve mostrar Docker version...
docker compose version  # deve mostrar Docker Compose version...
```

---

## 1. Clonar o repositório

```bash
git clone https://github.com/fabvarisco/ts-inner-view.git
cd ts-inner-view/server-api
```

---

## 2. Instalar as dependências

```bash
yarn
```

---

## 3. Configurar as variáveis de ambiente

Copie o arquivo de exemplo e ajuste se necessário:

```bash
cp .env.example .env
```

O arquivo `.env` padrão já está pronto para uso local com Docker. Os valores são:

```env
# Banco de dados
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=property-360
DB_PORT=5432

# Porta da API
API_PORT=3000

# Conexão do Prisma (usada para seed e migrations fora do Docker)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/property-360?schema=public

# JWT (pode usar qualquer string secreta)
JWT_ACCESS_SECRET=aaaa
JWT_REFRESH_SECRET=bbb
```

> **Nota:** Em produção, troque os valores de `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` por strings longas e aleatórias.

---

## 4. Subir os containers (banco + API)

```bash
docker compose up --build -d
```

Esse comando vai:

1. Construir a imagem da API a partir do `Dockerfile`
2. Subir o banco de dados PostgreSQL
3. Aguardar o banco estar saudável
4. Rodar as migrations do Prisma automaticamente
5. Iniciar a API na porta definida em `API_PORT` (padrão: `3000`)

Para acompanhar os logs:

```bash
docker compose logs -f
```

Aguarde aparecer algo como:

```
api-1  | Application is running on: http://[::1]:3000
```

---

## 5. Popular o banco com dados iniciais (seed)

Com a API no ar e o banco rodando, execute o seed para criar dados de exemplo:

```bash
yarn seed
```

Isso vai criar:

| O que       | Dados                                              |
| ----------- | -------------------------------------------------- |
| Imobiliária | Relax Inn                                          |
| Admin       | `admin@relaxinn.com.br` / `admin123`               |
| Corretor    | `corretor@relaxinn.com.br` / `corretor123`         |
| Imóveis     | `RLX-001` (com tour virtual) e `RLX-002`           |
| Analytics   | 3 visitantes, 5 visualizações, 3 compartilhamentos |

---

## 6. Verificar se está funcionando

Acesse no navegador ou via Insomnia/Postman:

- **Swagger (documentação da API):** [http://localhost:3000/api](http://localhost:3000/api)
- **Health check:** faça um `POST /auth/login` com as credenciais do seed acima

---

## 7. Rodar os testes

**Um comando, do zero:**

```bash
yarn test:local
```

Ele sobe o container do banco (`--wait`, então só segue quando o Postgres estiver
saudável) e roda a suíte. Se o banco já estiver no ar, use `yarn test` direto —
é o mesmo, sem a etapa do Docker.

Não é preciso criar nada à mão. Na primeira execução o harness cria o banco
`property-360-test` e aplica as migrations; nas seguintes, reaproveita.

**Como o isolamento funciona:**

- Os testes usam um banco **separado** (`property-360-test`), nunca o de
  desenvolvimento. A configuração está em `.env.test`, versionado de propósito
  para que a suíte rode sem setup manual — ele só contém valores locais
  descartáveis.
- Entre cada teste, todas as tabelas levam `TRUNCATE ... CASCADE` e as fixtures
  são recriadas. Cada teste começa do zero.
- Antes de qualquer migrate ou truncate, uma guarda verifica que a
  `DATABASE_URL` aponta para `property-360-test` e **aborta** caso contrário
  (`test/setup/require-test-database.ts`). É a proteção contra apontar o
  truncate para o banco errado.
- A suíte roda **em série** (`maxWorkers: 1`). O truncate global pressupõe posse
  exclusiva do banco; com workers em paralelo compartilhando o mesmo banco, o
  truncate de um apaga as fixtures que o outro acabou de criar (violação de FK) e
  dois truncates simultâneos travam entre si (deadlock `40P01`). Os sintomas
  variam a cada execução e dependem de timing — sem a serialização a suíte passa
  de vez em quando, o que é pior do que falhar sempre. A configuração está no
  `package.json`, e não como `--runInBand` no script, para valer também quando
  alguém chama o jest direto.

  Quando a suíte crescer a ponto de a serialização incomodar, a saída é um banco
  por worker (`property-360-test_${JEST_WORKER_ID}`) — o que exige afrouxar a
  guarda para aceitar o sufixo. Só vale a pena quando o tempo economizado
  justificar mexer justamente na peça que protege o banco de desenvolvimento.

**Para apontar a outro banco** (CI, container em outra porta), defina a variável
no ambiente — ela vence o `.env.test`, que não sobrescreve o que já existe:

```bash
DATABASE_URL=postgresql://user:senha@host:5432/property-360-test yarn test
```

O nome do banco continua tendo que ser `property-360-test`.

**Specs dos scripts de imagem** rodam por fora, porque não tocam em banco:

```bash
yarn test:scripts
```

A config separada (`jest.scripts.config.js`) existe para que a matemática de
cubemap e de cobertura não dependa de subir um container — atrito que faria essas
specs deixarem de ser rodadas.

---

## Tratamento de panoramas com IA

O alvo são os dois defeitos que o corretor enxerga no tour: **paralaxe** (objeto
duplicado ou com a borda quebrada na emenda, porque o celular não gira em torno
do centro óptico) e **degrau na junção** das fotos. O modelo recebe o equirect
montado pelo stitcher mais cada foto original como verdade de campo, e devolve o
mesmo panorama reparado — uma chamada, `gpt-image-2`, em 3840×1920.

Uma rota anterior decompunha o equirect em cubemap e só deixava a IA pintar onde
não havia pixel fotografado. Era segura por construção e mediu bem, mas foi
reprovada no olho: o chão e o teto recriados ficaram ruins. Ela continua viva no
bake-off, abaixo, como registro da evidência.

**Quem dispara.** O cliente, por `POST /virtual-tours/:id/montar`, depois de as
fotos originais subirem — sem elas o modelo não tem referência e o panorama é
dispensado. Os serviços de criação NÃO agendam nada: no instante em que o
panorama nasce, ele ainda não tem nenhuma `captureFrame`. O andamento sai por
`GET /virtual-tours/:id/montagem`, que é o que alimenta a tela de espera.

Sem `OPENAI_API_KEY` a etapa fica inerte: tudo é encerrado em `SKIPPED` na hora,
para a tela de espera não prender o corretor por algo que não vai acontecer.

Para operar à mão — reprocessar, tratar capturas antigas, testar em campo:

```bash
yarn tratar-panorama --listar          # o que existe, sem gastar nada
yarn tratar-panorama --id=7937c2d9     # aceita prefixo do UUID
yarn tratar-panorama --pendentes       # tudo que ainda não foi tratado
yarn tratar-panorama --pendentes --refazer   # inclui falhas e interrompidos
```

**Fidelidade.** O original nunca é sobrescrito: o resultado vai para
`treatedImageData`, e a troca acontece na leitura (`panorama-image.ts`). Reverter
é apagar uma coluna. Trocar a foto de um cômodo (`PATCH /panoramas/:id` com
`imageData`) limpa o tratamento junto, para o tour não continuar servindo o render
do cômodo antigo.

Nesta rota a imagem inteira passa pelo modelo, então não há trava geométrica como
na antiga — o que segura a fidelidade são as fotos de referência e o prompt. A
emenda da volta é a exceção: o modelo a quebra com frequência apesar de o prompt
proibir, e por isso ela é reconciliada por aritmética (`volta.ts`), não por
instrução.

**Custo:** ~US$ 0,19 por panorama, uma chamada, uma única vez por panorama (não
por visitante). O comando imprime o total previsto antes da primeira chamada.

---

## Bake-off de tratamento de panoramas

```bash
yarn bakeoff-ia                 # mede; NÃO chama API nenhuma
yarn bakeoff-ia --gerar         # roda também os experimentos generativos (gasta)
yarn bakeoff-ia --capturas=a,b  # limita o corpus
```

Compara rotas para os defeitos dos panoramas montados, sobre as capturas reais já
exportadas em `imagens-exportadas/`. Lê o campo vertical de cada captura do
`INDICE.md` e as orientações de `fotos-originais/<pasta>/orientacoes.json`.

O ponto da arquitetura: **o equirect nunca vai para o modelo**. Ele é decomposto
em seis faces de cubemap — imagens em perspectiva de 90°, que é o domínio nativo
desses modelos — e só as faces de teto e chão são regeradas, com máscara. Na
volta, as quatro laterais são cópia byte a byte do original
(`composeEquirect`, coberto por spec). Além disso, toda saída de modelo passa por
`recomporPelaCobertura`: fora do buraco de cobertura, vale o pixel fotografado.
A fidelidade não depende de o modelo obedecer à máscara — o quanto ele desobedeceu
vira métrica no relatório (`deriva`), não risco.

Sem `OPENAI_API_KEY` o script roda em modo medição e produz as faces, as
máscaras, as imagens de buraco e o `RELATORIO.md`. Com `--gerar`, o custo
previsto é impresso antes da primeira chamada.

---

## Comandos úteis

```bash
# Parar os containers
docker compose down

# Parar e remover os dados do banco (volume)
docker compose down -v

# Rebuild completo (após mudanças no código)
docker compose up --build -d

# Ver logs em tempo real
docker compose logs -f api

# Ver status dos containers
docker compose ps
```

---

## Estrutura dos containers

| Container | Porta  | Descrição     |
| --------- | ------ | ------------- |
| `db`      | `5432` | PostgreSQL 16 |
| `api`     | `3000` | NestJS API    |
