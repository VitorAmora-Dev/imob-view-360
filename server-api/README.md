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
