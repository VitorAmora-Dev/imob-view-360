---
name: backend-api
description: Guia para trabalhar no server-api (NestJS). Inclui estrutura de módulos, padrões de service, criação de endpoints, testes de integração, e como rodar localmente.
---

# Skill: Backend API (server-api)

## Como rodar localmente

### Com Docker (recomendado)
```bash
cd server-api
cp .env.example .env        # ajustar se necessário
yarn install
docker compose up --build -d # sobe DB + API
yarn seed                    # popula dados de exemplo
```

### Sem Docker (NixOS)
```bash
cd server-api
nix-shell
db-start
yarn install
npx prisma migrate deploy
yarn seed
db-start && yarn start:dev
```

### Credenciais do seed
| Papel | Email | Senha |
|---|---|---|
| Admin | `admin@relaxinn.com.br` | `admin123` |
| Corretor | `corretor@relaxinn.com.br` | `corretor123` |

### Swagger
- Dev: `http://localhost:3000/docs`
- Produção: desabilitado

---

## Estrutura de um módulo

Cada módulo segue o padrão:

```
modules/<nome>/
  <nome>.module.ts              # NestModule, providers + controllers
  <nome>.controller.ts          # rotas, decorators, DTOs inline ou importados
  services/
    create-<nome>.service.ts    # um service por operação
    find-<nome>.service.ts
    list-<nome>s.service.ts
    update-<nome>.service.ts
    delete-<nome>.service.ts
  dto/
    create-<nome>.dto.ts        # schema Zod + tipo inferido
    update-<nome>.dto.ts
```

### Exemplo de service
```typescript
@Injectable()
export class CreatePropertyService {
  constructor(private prisma: PrismaService) {}

  async execute(agencyId: string, dto: CreatePropertyDto) {
    // Validações de negócio aqui
    return this.prisma.property.create({
      data: { ...dto, agencyId },
    });
  }
}
```

### Multi-tenancy
Todo service autenticado recebe `agencyId` do JWT (extraído pelo guard/decorator) e filtra por ele:
```typescript
// CORRETO — filtra pelo tenant
this.prisma.property.findFirst({
  where: { id: propertyId, agencyId },
});

// ERRADO — expõe dados de outras agências
this.prisma.property.findUnique({
  where: { id: propertyId },
});
```

---

## Criando um novo endpoint

1. Criar o DTO com Zod em `dto/`
2. Criar o service em `services/`
3. Adicionar a rota no controller
4. Registrar o service como provider no module
5. Se for rota de imagem (body > 1MB), adicionar em `IMAGE_UPLOAD_ROUTES` no `body-limit.config.ts`

---

## Testes de integração

```bash
# Sobe banco de teste e roda tudo
yarn test:local

# Se o banco já está rodando
yarn test

# Scripts de imagem (sem banco)
yarn test:scripts
```

### Estrutura do teste
```typescript
describe('CreatePropertyService', () => {
  let service: CreatePropertyService;

  beforeEach(async () => {
    // O harness global já faz TRUNCATE e cria fixtures
    const module = await Test.createTestingModule({
      providers: [CreatePropertyService, PrismaService],
    }).compile();
    service = module.get(CreatePropertyService);
  });

  it('cria imóvel na agência do token', async () => {
    const result = await service.execute(fixtures.agency.id, dto);
    expect(result.agencyId).toBe(fixtures.agency.id);
  });
});
```

### Salvaguardas do banco de teste
- Nome obrigatório: `property-360-test`
- Guarda dupla: no globalSetup e na importação do Prisma
- `maxWorkers: 1` — sem paralelismo
- `.env.test` versionado com valores locais descartáveis

---

## Prisma — operações comuns

```bash
# Criar migration
npx prisma migrate dev --name <nome-da-migration>

# Aplicar migrations
npx prisma migrate deploy

# Gerar cliente
npx prisma generate

# Abrir studio (GUI do banco)
npx prisma studio

# Reset completo (apaga tudo!)
npx prisma migrate reset
```

---

## Tratamento de panoramas com IA

O tratamento corrige paralaxe e degrau de junção nas fotos 360°.

- Modelo: `gpt-image-2` via `OPENAI_API_KEY`
- Custo: ~US$ 0,19 por panorama
- Sem API key: etapa é `SKIPPED`

### CLI
```bash
yarn tratar-panorama --listar           # lista sem gastar
yarn tratar-panorama --id=7937c2d9      # aceita prefixo UUID
yarn tratar-panorama --pendentes        # tudo pendente
yarn tratar-panorama --pendentes --refazer  # inclui falhas
```

### Bake-off
```bash
yarn bakeoff-ia                         # só mede (grátis)
yarn bakeoff-ia --gerar                 # gera (gasta API)
```
