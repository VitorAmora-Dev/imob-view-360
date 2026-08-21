# Filtros de pesquisa na home — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A home passa a filtrar imóveis por tipo, finalidade e localização, com os critérios na URL e a filtragem no servidor.

**Architecture:** Os critérios moram nos query params. A `HomePage` lê `queryParamMap` como observable, converte em `PropertyFilters` (módulo puro), e um `switchMap` transforma cada mudança numa chamada a `GET /properties`. O backend ganha um parâmetro `location` que casa cidade, bairro ou estado com **OU**, e `purpose` passa a incluir `SALE_OR_RENT`. A interface é um formulário só, montado embutido no desktop e dentro de um `IonModal` no mobile.

**Tech Stack:** Angular 20 (standalone, signals, `@if`/`@switch`, `input.required`/`output`), Ionic 8.8.9, ngx-translate, Karma + Jasmine + ChromeHeadless; NestJS 11, Prisma 7, Zod 4, Jest contra Postgres real.

**Spec:** `docs/superpowers/specs/2026-08-20-filtros-de-pesquisa-na-home-design.md`

---

## Antes de começar — leia isto

**O repositório inteiro é CRLF.** A ferramenta de escrita de arquivos grava LF por padrão. Depois de criar QUALQUER arquivo novo, converta:

```bash
python -c "import io,sys; p=sys.argv[1]; b=io.open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'); io.open(p,'wb').write(b)" CAMINHO/DO/ARQUIVO
```

E confira antes de commitar: `git diff --cached --stat` não deve mostrar arquivos inteiros reescritos.

**Convenções obrigatórias** (`.agents/AGENTS.md`):

- Código em inglês; **comentários e documentação em português**.
- Nunca hex solto — usar os tokens `--app-*` / `--ion-color-*`.
- Nunca string literal em template — tudo por ngx-translate.
- Touch targets ≥ 44px.
- Commits na convenção angular (`feat(client):`, `fix(api):`, `test(api):`…).

**Comandos:**

| O quê | Onde | Comando |
|---|---|---|
| Testes do cliente | `inner-view-client/` | `npm test -- --watch=false --browsers=ChromeHeadless` |
| Um arquivo só | `inner-view-client/` | acrescente `--include='**/nome.spec.ts'` |
| Lint do cliente | `inner-view-client/` | `npm run lint` |
| Testes da API | `server-api/` | `yarn test:local` (sobe o Postgres de teste antes) |
| Um arquivo só | `server-api/` | `yarn test:local -- test/filtros-listagem.spec.ts` |

**Desvio consciente da spec:** a spec lista `district` entre os parâmetros novos do `PropertyService`. Ele fica de fora — nenhum caminho desta entrega o usa, e `location` já cobre bairro. YAGNI.

---

## Estrutura de arquivos

### `server-api/`

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/properties/dto/list-properties.dto.ts` | **Modificar** — aceita `location`. |
| `src/modules/properties/services/list-properties.service.ts` | **Modificar** — `montarWhere` extraída, `purpose` inclusivo, `location` com OU, `AND` protegendo os dois OU. |
| `test/filtros-listagem.spec.ts` | **Criar** — os filtros contra Postgres real. |

### `inner-view-client/src/app/`

| Arquivo | Responsabilidade |
|---|---|
| `models/property.model.ts` | **Modificar** — passa a ser o dono de `PROPERTY_TYPES`/`PROPERTY_PURPOSES`; `ListPropertiesParams` ganha `location`. |
| `tour-wizard/tour-wizard.model.ts` | **Modificar** — reexporta as constantes; nenhum import do wizard muda. |
| `services/property.service.ts` | **Modificar** — repassa `location`. |
| `home/property-filters.ts` | **Criar** — o modelo dos critérios e todas as conversões. Puro. |
| `home/property-filters.spec.ts` | **Criar** |
| `home/home-view.ts` | **Modificar** — nova entrada de `resolveHomeView`. |
| `home/home-view.spec.ts` | **Modificar** |
| `components/property-filters-form/` | **Criar** — os três controles + limpar. Sem opinião de layout. |
| `components/active-filter-chips/` | **Criar** — chips removíveis. |
| `components/property-filters-sheet/` | **Criar** — `IonModal` hospedando o form, só no mobile. |
| `components/property-filters-bar/` | **Criar** — decide entre embutido e sheet. |
| `home/home.page.ts` \| `.html` \| `.scss` \| `.spec.ts` | **Modificar** — o fio que liga URL, serviço e tela. |
| `assets/i18n/pt.json`, `assets/i18n/en.json` | **Modificar** — `HOME.FILTERS.*`. |

---

## Task 1: Backend — extrair `montarWhere`

Refatoração pura, sem mudança de comportamento. Existe porque as tarefas 2 e 3 adicionam ramos que interagem, e a diferença entre um `OR` no lugar certo e no lugar errado é invisível dentro de um `execute()` de sessenta linhas.

**Files:**
- Modify: `server-api/src/modules/properties/services/list-properties.service.ts`

- [ ] **Step 1: Rodar os testes existentes para ter a linha de base**

Run (em `server-api/`): `yarn test:local -- test/tenant-properties.spec.ts test/paginacao-estavel.spec.ts`
Expected: PASS. Estes dois já exercitam a listagem e são a rede desta refatoração.

- [ ] **Step 2: Extrair a função**

Em `list-properties.service.ts`, mova a montagem do `where` para uma função exportada, ACIMA da classe, e deixe o `execute()` chamando-a. O conteúdo do objeto não muda nesta tarefa.

```ts
/**
 * Monta o filtro da listagem.
 *
 * Fora do `execute()` porque tem ramos que interagem entre si — ver o `AND`
 * mais abaixo — e essa interação é invisível quando ela está embutida no meio
 * da consulta.
 */
export function montarWhere(
  query: ListPropertiesDto,
  agencyId: string,
): Prisma.PropertyWhereInput {
  const {
    type,
    purpose,
    status,
    city,
    state,
    district,
    priceMin,
    priceMax,
    search,
  } = query;

  return {
    agencyId,
    status,
    ...(type && { type }),
    ...(purpose && { purpose }),
    ...((priceMin !== undefined || priceMax !== undefined) && {
      price: {
        ...(priceMin !== undefined && { gte: priceMin }),
        ...(priceMax !== undefined && { lte: priceMax }),
      },
    }),
    ...((city || state || district) && {
      address: {
        ...(city && { city: { contains: city, mode: 'insensitive' } }),
        ...(state && { state }),
        ...(district && {
          district: { contains: district, mode: 'insensitive' },
        }),
      },
    }),
    ...(search && {
      OR: [
        { code: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { address: { street: { contains: search, mode: 'insensitive' } } },
        { address: { district: { contains: search, mode: 'insensitive' } } },
        { address: { city: { contains: search, mode: 'insensitive' } } },
        { address: { state: { contains: search, mode: 'insensitive' } } },
        { address: { zipCode: { contains: search, mode: 'insensitive' } } },
      ],
    }),
  };
}
```

E o `execute()` passa a ser:

```ts
  async execute(query: ListPropertiesDto, currentUser: JwtPayload) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const where = montarWhere(query, currentUser.agencyId);

    // O desempate por `id` é o que torna a paginação confiável. `createdAt` não
    // é único — dois imóveis cadastrados no mesmo instante (importação em lote,
    // ou dois cliques rápidos) ficam com ordem indefinida entre si, e o
    // Postgres não promete devolvê-los na mesma ordem em duas consultas. Com
    // `skip`/`take` por cima disso, um imóvel aparece em duas páginas e outro
    // não aparece em nenhuma.
    const [data, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        select: PROPERTY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.property.count({ where }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }
```

- [ ] **Step 3: Rodar os mesmos testes**

Run: `yarn test:local -- test/tenant-properties.spec.ts test/paginacao-estavel.spec.ts`
Expected: PASS, iguais ao Step 1. Se algum falhar, a refatoração mudou comportamento — desfaça e refaça.

- [ ] **Step 4: Commit**

```bash
git add server-api/src/modules/properties/services/list-properties.service.ts
git commit -m "refactor(api): extrair montarWhere da listagem de imoveis"
```

---

## Task 2: Backend — finalidade passa a incluir "Venda ou Aluguel"

**Files:**
- Create: `server-api/test/filtros-listagem.spec.ts`
- Modify: `server-api/src/modules/properties/services/list-properties.service.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `server-api/test/filtros-listagem.spec.ts`:

```ts
import { ListPropertiesService } from '../src/modules/properties/services/list-properties.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

// Mesmo arranjo de `tenant-properties.spec.ts`: o service só usa métodos de
// query, que o cliente de teste também tem, então passar o cliente direto evita
// subir o AppModule inteiro para exercitar uma consulta.
const asPrismaService = prisma as unknown as PrismaService;
const listar = new ListPropertiesService(asPrismaService);

const CONSULTA = { page: 1, limit: 20, status: 'AVAILABLE' as const };

type Finalidade = 'SALE' | 'RENT' | 'SALE_OR_RENT';

interface Endereco {
  street: string;
  district: string;
  city: string;
  state: string;
}

/**
 * As fixtures já criam um imóvel por agência — `COD-alfa`, HOUSE/SALE, em
 * Centro / Porto Alegre / RS. As asserções são por CÓDIGO, e não por
 * quantidade, justamente porque esse imóvel participa das consultas.
 */
async function criarImovel(
  tenant: TenantFixture,
  code: string,
  extras: {
    purpose?: Finalidade;
    type?: 'HOUSE' | 'APARTMENT';
    title?: string;
    address?: Endereco;
  } = {},
): Promise<void> {
  await prisma.property.create({
    data: {
      code,
      title: extras.title ?? `Imóvel ${code}`,
      type: extras.type ?? 'HOUSE',
      purpose: extras.purpose ?? 'SALE',
      agencyId: tenant.agencyId,
      ...(extras.address && { address: { create: extras.address } }),
    },
  });
}

/** Códigos do resultado, ordenados — a ordem da listagem não é o assunto aqui. */
function codigos(resultado: { data: { code: string }[] }): string[] {
  return resultado.data.map((imovel) => imovel.code).sort();
}

describe('filtros da listagem de imóveis', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  describe('finalidade', () => {
    beforeEach(async () => {
      await criarImovel(tenants.a, 'ALUGA', { purpose: 'RENT' });
      await criarImovel(tenants.a, 'AMBOS', { purpose: 'SALE_OR_RENT' });
    });

    // Um imóvel marcado "Venda ou Aluguel" TAMBÉM está para alugar. Igualdade
    // exata o esconderia de quem procura aluguel — resultado faltando, não
    // resultado a mais.
    it('aluguel traz também os de venda ou aluguel', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, purpose: 'RENT' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['ALUGA', 'AMBOS']);
    });

    it('venda traz também os de venda ou aluguel', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, purpose: 'SALE' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['AMBOS', 'COD-alfa']);
    });

    // O caminho oposto NÃO é simétrico: quem escolhe "Venda ou Aluguel" está
    // perguntando por essa marcação, não pelo conjunto inteiro.
    it('venda ou aluguel continua sendo igualdade exata', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, purpose: 'SALE_OR_RENT' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['AMBOS']);
    });

    it('o filtro não atravessa a fronteira da agência', async () => {
      await criarImovel(tenants.b, 'ALHEIO', { purpose: 'RENT' });

      const resultado = await listar.execute(
        { ...CONSULTA, purpose: 'RENT' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['ALUGA', 'AMBOS']);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `server-api/`): `yarn test:local -- test/filtros-listagem.spec.ts`
Expected: FAIL. "aluguel traz também os de venda ou aluguel" recebe `['ALUGA']`; "venda…" recebe `['COD-alfa']`. Os outros dois passam desde já.

- [ ] **Step 3: Implementar**

Em `montarWhere`, troque a linha do `purpose`:

```ts
    // "Venda ou Aluguel" é as duas coisas: filtrar por aluguel precisa trazê-lo,
    // ou o resultado esconde imóveis que estão, sim, para alugar. O caminho
    // inverso não vale — quem escolhe "Venda ou Aluguel" pergunta pela marcação.
    ...(purpose && {
      purpose:
        purpose === 'SALE_OR_RENT'
          ? 'SALE_OR_RENT'
          : { in: [purpose, 'SALE_OR_RENT'] },
    }),
```

- [ ] **Step 4: Rodar e ver passar**

Run: `yarn test:local -- test/filtros-listagem.spec.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Rodar a suíte da API inteira**

Run: `yarn test:local`
Expected: PASS. `tenant-properties.spec.ts` também filtra por finalidade em alguns pontos — se algo mudar ali, é sinal de que a mudança alcançou mais do que devia.

- [ ] **Step 6: Commit**

```bash
git add server-api/test/filtros-listagem.spec.ts server-api/src/modules/properties/services/list-properties.service.ts
git commit -m "fix(api): filtrar por aluguel passa a incluir venda ou aluguel"
```

---

## Task 3: Backend — parâmetro `location`

**Files:**
- Modify: `server-api/src/modules/properties/dto/list-properties.dto.ts`
- Modify: `server-api/src/modules/properties/services/list-properties.service.ts`
- Modify: `server-api/test/filtros-listagem.spec.ts`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao `describe('filtros da listagem de imóveis')`, depois do bloco de finalidade:

```ts
  describe('localização', () => {
    beforeEach(async () => {
      await criarImovel(tenants.a, 'MOINHOS', {
        address: {
          street: 'Rua Padre Chagas',
          district: 'Moinhos de Vento',
          city: 'Porto Alegre',
          state: 'RS',
        },
      });
      await criarImovel(tenants.a, 'PINHEIROS', {
        address: {
          street: 'Rua dos Pinheiros',
          district: 'Pinheiros',
          city: 'São Paulo',
          state: 'SP',
        },
      });
    });

    it('casa por bairro', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, location: 'Moinhos' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['MOINHOS']);
    });

    it('casa por cidade', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, location: 'são paulo' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['PINHEIROS']);
    });

    it('casa por estado', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, location: 'SP' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['PINHEIROS']);
    });

    // O motivo de `location` existir. Os três campos de endereço da API aninham
    // dentro do MESMO objeto `address`, então combinam com E: mandar cidade,
    // bairro e estado com "Centro" pede um imóvel em que os três sejam
    // "Centro". Não havia como perguntar "em algum lugar chamado Centro".
    it('é um OU entre bairro, cidade e estado', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, location: 'Porto Alegre' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['COD-alfa', 'MOINHOS']);
    });

    it('não atravessa a fronteira da agência', async () => {
      await criarImovel(tenants.b, 'ALHEIO', {
        address: {
          street: 'Rua B',
          district: 'Moinhos de Vento',
          city: 'Porto Alegre',
          state: 'RS',
        },
      });

      const resultado = await listar.execute(
        { ...CONSULTA, location: 'Moinhos' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['MOINHOS']);
    });
  });

  // Este é o teste que justifica o `AND`. `search` e `location` são dois OU
  // independentes; espalhados no mesmo objeto, o segundo sobrescreve o primeiro
  // — sem erro de tipo, sem aviso, e o filtro que sumiu só aparece contando
  // resultado.
  describe('localização junto com busca por texto', () => {
    beforeEach(async () => {
      await criarImovel(tenants.a, 'CASA-CENTRO', {
        title: 'Casa ampla',
        address: {
          street: 'Rua X',
          district: 'Centro',
          city: 'Curitiba',
          state: 'PR',
        },
      });
      await criarImovel(tenants.a, 'LOJA-CENTRO', {
        title: 'Loja pequena',
        address: {
          street: 'Rua Y',
          district: 'Centro',
          city: 'Curitiba',
          state: 'PR',
        },
      });
      await criarImovel(tenants.a, 'CASA-LONGE', {
        title: 'Casa ampla',
        address: {
          street: 'Rua Z',
          district: 'Bela Vista',
          city: 'Curitiba',
          state: 'PR',
        },
      });
    });

    it('os dois filtros valem ao mesmo tempo', async () => {
      const resultado = await listar.execute(
        { ...CONSULTA, location: 'Centro', search: 'Casa ampla' },
        tenants.a.admin,
      );

      expect(codigos(resultado)).toEqual(['CASA-CENTRO']);
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn test:local -- test/filtros-listagem.spec.ts`
Expected: FAIL na compilação — `location` não existe em `ListPropertiesDto`.

- [ ] **Step 3: Aceitar o parâmetro no DTO**

Em `list-properties.dto.ts`, dentro do `z.object`, logo depois de `district`:

```ts
  // Uma caixa só para "onde": casa com bairro, cidade OU estado. Os três campos
  // acima continuam existindo — são API pública e podem ter consumidor.
  location: z.string().optional(),
```

- [ ] **Step 4: Rodar de novo e ver falhar por comportamento**

Run: `yarn test:local -- test/filtros-listagem.spec.ts`
Expected: FAIL — os cinco testes de localização recebem a lista inteira da agência, porque o `where` ainda ignora `location`.

- [ ] **Step 5: Implementar o OU e o AND**

Em `montarWhere`: acrescente `location` ao destructuring, monte os dois OU numa lista e devolva-os sob `AND`.

```ts
export function montarWhere(
  query: ListPropertiesDto,
  agencyId: string,
): Prisma.PropertyWhereInput {
  const {
    type,
    purpose,
    status,
    city,
    state,
    district,
    location,
    priceMin,
    priceMax,
    search,
  } = query;

  // Dois OU independentes. Espalhados os dois no mesmo objeto, a segunda chave
  // `OR` apaga a primeira em silêncio — é JavaScript fazendo o que promete, e
  // nenhum tipo reclama. Sob `AND`, cada um continua sendo um OU e os dois
  // precisam valer.
  const grupos: Prisma.PropertyWhereInput[] = [];

  if (search) {
    grupos.push({
      OR: [
        { code: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { address: { street: { contains: search, mode: 'insensitive' } } },
        { address: { district: { contains: search, mode: 'insensitive' } } },
        { address: { city: { contains: search, mode: 'insensitive' } } },
        { address: { state: { contains: search, mode: 'insensitive' } } },
        { address: { zipCode: { contains: search, mode: 'insensitive' } } },
      ],
    });
  }

  if (location) {
    grupos.push({
      OR: [
        { address: { city: { contains: location, mode: 'insensitive' } } },
        { address: { district: { contains: location, mode: 'insensitive' } } },
        { address: { state: { contains: location, mode: 'insensitive' } } },
      ],
    });
  }

  return {
    agencyId,
    status,
    ...(type && { type }),
    ...(purpose && {
      purpose:
        purpose === 'SALE_OR_RENT'
          ? 'SALE_OR_RENT'
          : { in: [purpose, 'SALE_OR_RENT'] },
    }),
    ...((priceMin !== undefined || priceMax !== undefined) && {
      price: {
        ...(priceMin !== undefined && { gte: priceMin }),
        ...(priceMax !== undefined && { lte: priceMax }),
      },
    }),
    ...((city || state || district) && {
      address: {
        ...(city && { city: { contains: city, mode: 'insensitive' } }),
        ...(state && { state }),
        ...(district && {
          district: { contains: district, mode: 'insensitive' },
        }),
      },
    }),
    ...(grupos.length > 0 && { AND: grupos }),
  };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `yarn test:local -- test/filtros-listagem.spec.ts`
Expected: PASS, 10 testes.

- [ ] **Step 7: Provar que o `AND` é carga viva**

Troque temporariamente `...(grupos.length > 0 && { AND: grupos })` por um espalhamento dos dois grupos direto no objeto:

```ts
    ...(grupos[0] ?? {}),
    ...(grupos[1] ?? {}),
```

Run: `yarn test:local -- test/filtros-listagem.spec.ts`
Expected: FAIL em "os dois filtros valem ao mesmo tempo". Se ele passar, o teste não está provando nada — conserte o teste antes de seguir. Desfaça a mutação depois.

- [ ] **Step 8: Suíte da API inteira**

Run: `yarn test:local`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server-api/src/modules/properties/dto/list-properties.dto.ts server-api/src/modules/properties/services/list-properties.service.ts server-api/test/filtros-listagem.spec.ts
git commit -m "feat(api): parametro location filtra por bairro, cidade ou estado"
```

---

## Task 4: Cliente — vocabulário de tipos e finalidades, e `location` no serviço

Hoje `PROPERTY_TYPES` e `PROPERTY_PURPOSES` moram em `tour-wizard/tour-wizard.model.ts`. A home vai precisar deles, e importar do wizard acoplaria a home a outra feature. Eles são vocabulário do domínio, não do wizard.

**Files:**
- Modify: `inner-view-client/src/app/models/property.model.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.model.ts`
- Modify: `inner-view-client/src/app/services/property.service.ts`

- [ ] **Step 1: Mover as constantes**

Em `models/property.model.ts`, acrescente ao TOPO do arquivo:

```ts
/**
 * Valores que a API aceita nos enums de imóvel.
 *
 * Moram aqui, e não no modelo do wizard, porque são vocabulário do domínio: o
 * wizard escolhe um deles ao cadastrar, e a home filtra por eles. A tradução
 * dos rótulos vive no i18n, sob `UPLOAD.TYPE.*` e `UPLOAD.PURPOSE.*`.
 */
export const PROPERTY_TYPES = [
  'HOUSE',
  'APARTMENT',
  'LAND',
  'COMMERCIAL',
  'RURAL',
  'OFFICE',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_PURPOSES = ['SALE', 'RENT', 'SALE_OR_RENT'] as const;
export type PropertyPurpose = (typeof PROPERTY_PURPOSES)[number];
```

E em `ListPropertiesParams`, acrescente:

```ts
  /** Bairro, cidade ou estado — o servidor casa qualquer um dos três. */
  location?: string;
```

- [ ] **Step 2: Reexportar do modelo do wizard**

Em `tour-wizard/tour-wizard.model.ts`, apague o bloco que define `PROPERTY_TYPES`, `PropertyType`, `PROPERTY_PURPOSES` e `PropertyPurpose` (o comentário longo acima deles vai junto — ele agora está no `property.model.ts`) e ponha no lugar:

```ts
/**
 * Reexportado: o dono destes valores é `models/property.model.ts`, porque a
 * home também filtra por eles. Fica aqui para não mexer nos vinte imports do
 * wizard, que continuam certos.
 */
export { PROPERTY_TYPES, PROPERTY_PURPOSES } from '../models/property.model';
export type { PropertyType, PropertyPurpose } from '../models/property.model';
```

E, logo abaixo, o import para o uso local dentro do próprio arquivo (`PropertyDraft` usa os dois tipos):

```ts
import type { PropertyPurpose, PropertyType } from '../models/property.model';
```

- [ ] **Step 3: Repassar `location` no serviço**

Em `services/property.service.ts`, dentro de `listProperties`, logo depois da linha do `state`:

```ts
    if (params.location) httpParams = httpParams.set('location', params.location);
```

- [ ] **Step 4: Compilar e rodar a suíte do cliente**

Run (em `inner-view-client/`): `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS, sem erro de compilação. Nada mudou de comportamento; o que se testa aqui é que a mudança de dono não quebrou import nenhum.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/models/property.model.ts inner-view-client/src/app/tour-wizard/tour-wizard.model.ts inner-view-client/src/app/services/property.service.ts
git commit -m "refactor(client): tipos e finalidades de imovel saem do wizard para o modelo"
```

---

## Task 5: Cliente — `property-filters.ts`

O módulo puro: tudo que se sabe sobre critérios, sem DOM, sem Angular além do tipo `ParamMap`. Mesmo lugar e mesmo papel do `home-view.ts`.

**Files:**
- Create: `inner-view-client/src/app/home/property-filters.ts`
- Create: `inner-view-client/src/app/home/property-filters.spec.ts`

- [ ] **Step 1: Escrever os testes que falham**

Crie `inner-view-client/src/app/home/property-filters.spec.ts`:

```ts
import { convertToParamMap } from '@angular/router';

import {
  FILTROS_VAZIOS,
  PropertyFilters,
  chipsAtivos,
  contarFiltros,
  limparTodos,
  mesmosFiltros,
  parseFilters,
  removerFiltro,
  temCriterios,
  temFiltros,
  toListParams,
  toQueryParams,
} from './property-filters';

function mapa(params: Record<string, string>) {
  return convertToParamMap(params);
}

describe('parseFilters', () => {
  it('sem params devolve tudo vazio', () => {
    expect(parseFilters(mapa({}))).toEqual(FILTROS_VAZIOS);
  });

  it('le os quatro criterios', () => {
    expect(parseFilters(mapa({
      type: 'APARTMENT',
      purpose: 'RENT',
      location: 'Centro',
      q: 'cobertura',
    }))).toEqual({
      type: 'APARTMENT',
      purpose: 'RENT',
      location: 'Centro',
      query: 'cobertura',
    });
  });

  // Um link colado ou editado a mao chegaria com valor fora do enum, o zod da
  // API devolveria 400, e a home mostraria erro de servidor por causa de um
  // erro de digitacao.
  it('descarta tipo que nao existe', () => {
    expect(parseFilters(mapa({ type: 'CASTELO' })).type).toBeNull();
  });

  it('descarta finalidade que nao existe', () => {
    expect(parseFilters(mapa({ purpose: 'TROCA' })).purpose).toBeNull();
  });

  it('espaco em branco conta como ausente', () => {
    const filtros = parseFilters(mapa({ location: '   ', q: '  ' }));
    expect(filtros.location).toBe('');
    expect(filtros.query).toBe('');
  });
});

describe('toQueryParams', () => {
  it('criterio ausente vira null, para sair da URL', () => {
    expect(toQueryParams(FILTROS_VAZIOS)).toEqual({
      type: null,
      purpose: null,
      location: null,
      q: null,
    });
  });

  it('ida e volta preserva os criterios', () => {
    const params = { type: 'HOUSE', purpose: 'SALE', location: 'Centro', q: 'casa' };
    expect(toQueryParams(parseFilters(mapa(params)))).toEqual(params);
  });
});

describe('temFiltros e temCriterios', () => {
  const soTexto: PropertyFilters = { ...FILTROS_VAZIOS, query: 'casa' };

  // A diferenca entre os dois decide duas coisas: se a faixa de "sem tour"
  // aparece (criterios) e se o botao "Limpar filtros" aparece (filtros).
  it('texto de busca e criterio, mas nao e filtro', () => {
    expect(temCriterios(soTexto)).toBeTrue();
    expect(temFiltros(soTexto)).toBeFalse();
  });

  it('sem nada, nenhum dos dois', () => {
    expect(temCriterios(FILTROS_VAZIOS)).toBeFalse();
    expect(temFiltros(FILTROS_VAZIOS)).toBeFalse();
  });

  it('localizacao e filtro', () => {
    const comLocal = { ...FILTROS_VAZIOS, location: 'Centro' };
    expect(temFiltros(comLocal)).toBeTrue();
    expect(temCriterios(comLocal)).toBeTrue();
  });
});

describe('limparTodos', () => {
  // O texto tem caixa propria, visivel, com botao de limpar do proprio
  // searchbar. Apaga-lo por tabela seria apagar algo que a pessoa nao pediu
  // para apagar e que ela esta vendo.
  it('mantem o texto da busca', () => {
    const antes: PropertyFilters = {
      type: 'HOUSE', purpose: 'SALE', location: 'Centro', query: 'casa',
    };

    expect(limparTodos(antes)).toEqual({ ...FILTROS_VAZIOS, query: 'casa' });
  });
});

describe('removerFiltro', () => {
  const cheio: PropertyFilters = {
    type: 'HOUSE', purpose: 'SALE', location: 'Centro', query: 'casa',
  };

  it('tira so o que foi pedido', () => {
    expect(removerFiltro(cheio, 'type')).toEqual({ ...cheio, type: null });
    expect(removerFiltro(cheio, 'purpose')).toEqual({ ...cheio, purpose: null });
    expect(removerFiltro(cheio, 'location')).toEqual({ ...cheio, location: '' });
  });
});

describe('chipsAtivos', () => {
  it('sem filtro, nenhum chip', () => {
    expect(chipsAtivos(FILTROS_VAZIOS)).toEqual([]);
    expect(contarFiltros(FILTROS_VAZIOS)).toBe(0);
  });

  it('o texto da busca nao vira chip', () => {
    expect(chipsAtivos({ ...FILTROS_VAZIOS, query: 'casa' })).toEqual([]);
  });

  it('tipo e finalidade viram chave de traducao; localizacao vira texto cru', () => {
    const chips = chipsAtivos({
      type: 'APARTMENT', purpose: 'RENT', location: 'Centro', query: '',
    });

    expect(chips).toEqual([
      { key: 'type', labelKey: 'UPLOAD.TYPE.APARTMENT', labelText: '' },
      { key: 'purpose', labelKey: 'UPLOAD.PURPOSE.RENT', labelText: '' },
      { key: 'location', labelKey: null, labelText: 'Centro' },
    ]);
    expect(contarFiltros({ type: 'APARTMENT', purpose: 'RENT', location: 'Centro', query: '' })).toBe(3);
  });
});

describe('toListParams', () => {
  it('so manda o que existe', () => {
    expect(toListParams(FILTROS_VAZIOS)).toEqual({ limit: 100 });
  });

  // `q` na URL vira `search` na API — sao vocabularios diferentes de proposito:
  // `q` e' curto porque a pessoa ve; `search` e' o nome do parametro da API.
  it('o texto da busca vira search', () => {
    expect(toListParams({ ...FILTROS_VAZIOS, query: 'cobertura' }))
      .toEqual({ limit: 100, search: 'cobertura' });
  });

  it('manda os tres filtros', () => {
    expect(toListParams({
      type: 'HOUSE', purpose: 'RENT', location: 'Centro', query: '',
    })).toEqual({ limit: 100, type: 'HOUSE', purpose: 'RENT', location: 'Centro' });
  });
});

describe('mesmosFiltros', () => {
  it('compara valor, nao referencia', () => {
    expect(mesmosFiltros({ ...FILTROS_VAZIOS }, { ...FILTROS_VAZIOS })).toBeTrue();
  });

  it('qualquer campo diferente e diferente', () => {
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, type: 'HOUSE' })).toBeFalse();
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, purpose: 'SALE' })).toBeFalse();
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, location: 'x' })).toBeFalse();
    expect(mesmosFiltros(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, query: 'x' })).toBeFalse();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/property-filters.spec.ts'`
Expected: FAIL na compilação — o módulo não existe.

- [ ] **Step 3: Implementar**

Crie `inner-view-client/src/app/home/property-filters.ts`:

```ts
import { ParamMap, Params } from '@angular/router';

import {
  ListPropertiesParams,
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  PropertyPurpose,
  PropertyType,
} from '../models/property.model';

/**
 * Os critérios da home.
 *
 * A fonte de verdade deles é a URL — este tipo é a forma que eles tomam depois
 * de lidos. `query` é a busca por texto; os outros três são os filtros.
 * A distinção importa: "limpar filtros" não apaga o texto, e a faixa de
 * "imóveis sem tour" some com qualquer um dos quatro.
 */
export interface PropertyFilters {
  readonly type: PropertyType | null;
  readonly purpose: PropertyPurpose | null;
  readonly location: string;
  readonly query: string;
}

export const FILTROS_VAZIOS: PropertyFilters = {
  type: null,
  purpose: null,
  location: '',
  query: '',
};

/** Teto de itens da home. Paginação continua fora de escopo. */
export const LIMITE_DA_HOME = 100;

/**
 * Um filtro ativo, pronto para virar chip.
 *
 * Dois formatos de rótulo porque são duas naturezas: tipo e finalidade são
 * valores fechados, e o rótulo deles é uma chave de tradução; localização é
 * texto que a pessoa escreveu, e traduzir não faz sentido.
 */
export interface FilterChip {
  readonly key: 'type' | 'purpose' | 'location';
  /** Chave de tradução, ou `null` quando o rótulo é texto do usuário. */
  readonly labelKey: string | null;
  /** Texto pronto — usado quando `labelKey` é nulo. */
  readonly labelText: string;
}

function valorValido<T extends string>(
  bruto: string | null,
  aceitos: readonly T[],
): T | null {
  return aceitos.includes(bruto as T) ? (bruto as T) : null;
}

/**
 * Lê os critérios da URL.
 *
 * Valor fora do enum é DESCARTADO, não repassado: um `?type=CASTELO` de link
 * colado ou editado à mão faria o zod da API devolver 400, e a home mostraria
 * erro de servidor por causa de um erro de digitação.
 */
export function parseFilters(params: ParamMap): PropertyFilters {
  return {
    type: valorValido(params.get('type'), PROPERTY_TYPES),
    purpose: valorValido(params.get('purpose'), PROPERTY_PURPOSES),
    location: (params.get('location') ?? '').trim(),
    query: (params.get('q') ?? '').trim(),
  };
}

/**
 * Converte para query params.
 *
 * Critério ausente vira `null` e não string vazia: o Router do Angular remove
 * da URL os params nulos, e é isso que faz o filtro desaparecer do endereço em
 * vez de ficar pendurado como `?type=`.
 */
export function toQueryParams(filtros: PropertyFilters): Params {
  return {
    type: filtros.type ?? null,
    purpose: filtros.purpose ?? null,
    location: filtros.location || null,
    q: filtros.query || null,
  };
}

/** Há tipo, finalidade ou localização — o que o "Limpar filtros" apaga. */
export function temFiltros(filtros: PropertyFilters): boolean {
  return (
    filtros.type !== null || filtros.purpose !== null || filtros.location !== ''
  );
}

/** Há filtro OU texto de busca — o que distingue "sem resultado" de "conta vazia". */
export function temCriterios(filtros: PropertyFilters): boolean {
  return temFiltros(filtros) || filtros.query !== '';
}

export function limparTodos(filtros: PropertyFilters): PropertyFilters {
  return { ...FILTROS_VAZIOS, query: filtros.query };
}

export function removerFiltro(
  filtros: PropertyFilters,
  key: FilterChip['key'],
): PropertyFilters {
  switch (key) {
    case 'type':
      return { ...filtros, type: null };
    case 'purpose':
      return { ...filtros, purpose: null };
    case 'location':
      return { ...filtros, location: '' };
  }
}

export function chipsAtivos(filtros: PropertyFilters): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filtros.type) {
    chips.push({
      key: 'type',
      labelKey: 'UPLOAD.TYPE.' + filtros.type,
      labelText: '',
    });
  }
  if (filtros.purpose) {
    chips.push({
      key: 'purpose',
      labelKey: 'UPLOAD.PURPOSE.' + filtros.purpose,
      labelText: '',
    });
  }
  if (filtros.location) {
    chips.push({ key: 'location', labelKey: null, labelText: filtros.location });
  }

  return chips;
}

export function contarFiltros(filtros: PropertyFilters): number {
  return chipsAtivos(filtros).length;
}

/** O que vai para o `PropertyService`. `q` da URL vira `search` da API. */
export function toListParams(filtros: PropertyFilters): ListPropertiesParams {
  return {
    limit: LIMITE_DA_HOME,
    ...(filtros.type && { type: filtros.type }),
    ...(filtros.purpose && { purpose: filtros.purpose }),
    ...(filtros.location && { location: filtros.location }),
    ...(filtros.query && { search: filtros.query }),
  };
}

/**
 * Igualdade por valor.
 *
 * `parseFilters` devolve um objeto novo a cada leitura da URL, então comparar
 * por referência dispararia uma requisição a cada emissão do router, inclusive
 * nas que não mexeram em critério nenhum.
 */
export function mesmosFiltros(a: PropertyFilters, b: PropertyFilters): boolean {
  return (
    a.type === b.type &&
    a.purpose === b.purpose &&
    a.location === b.location &&
    a.query === b.query
  );
}
```

- [ ] **Step 4: Converter para CRLF**

```bash
python -c "import io,sys; p=sys.argv[1]; b=io.open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'); io.open(p,'wb').write(b)" inner-view-client/src/app/home/property-filters.ts
python -c "import io,sys; p=sys.argv[1]; b=io.open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'); io.open(p,'wb').write(b)" inner-view-client/src/app/home/property-filters.spec.ts
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/property-filters.spec.ts'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/home/property-filters.ts inner-view-client/src/app/home/property-filters.spec.ts
git commit -m "feat(client): modelo puro dos criterios de pesquisa da home"
```

---

## Task 6: Cliente — chaves de tradução

Vêm antes dos componentes para que eles já nasçam referenciando chaves reais.

**Files:**
- Modify: `inner-view-client/src/assets/i18n/pt.json`
- Modify: `inner-view-client/src/assets/i18n/en.json`

- [ ] **Step 1: Acrescentar o bloco em `pt.json`**

Dentro do objeto `HOME`, depois de `NO_RESULTS`:

```json
    "FILTERS": {
      "TOGGLE": "Filtros",
      "TOGGLE_COUNT": "Filtros ({{n}})",
      "TYPE_LABEL": "Tipo",
      "PURPOSE_LABEL": "Finalidade",
      "LOCATION_LABEL": "Localização",
      "LOCATION_PLACEHOLDER": "Cidade, bairro ou estado",
      "ALL_TYPES": "Todos os tipos",
      "ALL_PURPOSES": "Todas as finalidades",
      "CLEAR": "Limpar filtros",
      "ACTIVE_TITLE": "Filtros ativos",
      "REMOVE_CHIP": "Remover filtro {{label}}",
      "SHEET_TITLE": "Filtrar imóveis",
      "SHEET_DONE": "Ver resultados",
      "RESULT_COUNT": "{{n}} imóveis encontrados.",
      "RESULT_COUNT_ONE": "1 imóvel encontrado.",
      "NO_RESULTS_FILTERS": "Nenhum imóvel corresponde aos filtros selecionados."
    }
```

`ALL_TYPES` e `ALL_PURPOSES` são chaves separadas, e não um `ALL` só, por causa do gênero: "Todos os tipos" e "Todas as finalidades".

- [ ] **Step 2: Acrescentar o mesmo bloco em `en.json`**

```json
    "FILTERS": {
      "TOGGLE": "Filters",
      "TOGGLE_COUNT": "Filters ({{n}})",
      "TYPE_LABEL": "Type",
      "PURPOSE_LABEL": "Purpose",
      "LOCATION_LABEL": "Location",
      "LOCATION_PLACEHOLDER": "City, district or state",
      "ALL_TYPES": "All types",
      "ALL_PURPOSES": "All purposes",
      "CLEAR": "Clear filters",
      "ACTIVE_TITLE": "Active filters",
      "REMOVE_CHIP": "Remove filter {{label}}",
      "SHEET_TITLE": "Filter properties",
      "SHEET_DONE": "See results",
      "RESULT_COUNT": "{{n}} properties found.",
      "RESULT_COUNT_ONE": "1 property found.",
      "NO_RESULTS_FILTERS": "No property matches the selected filters."
    }
```

- [ ] **Step 3: Conferir que os dois arquivos continuam JSON válido e simétricos**

```bash
python -c "
import json, io
pt = json.load(io.open('inner-view-client/src/assets/i18n/pt.json', encoding='utf-8'))
en = json.load(io.open('inner-view-client/src/assets/i18n/en.json', encoding='utf-8'))
assert sorted(pt['HOME']['FILTERS']) == sorted(en['HOME']['FILTERS']), 'chaves diferentes entre pt e en'
print('ok —', len(pt['HOME']['FILTERS']), 'chaves nos dois')
"
```

Expected: `ok — 16 chaves nos dois`

- [ ] **Step 4: Commit**

```bash
git add inner-view-client/src/assets/i18n/pt.json inner-view-client/src/assets/i18n/en.json
git commit -m "feat(client): chaves de traducao dos filtros da home"
```

---

## Task 7: Cliente — `property-filters-form`

Os três controles e o botão de limpar. Não sabe onde está: quem decide isso é a barra.

**Files:**
- Create: `inner-view-client/src/app/components/property-filters-form/property-filters-form.component.ts`
- Create: `inner-view-client/src/app/components/property-filters-form/property-filters-form.component.html`
- Create: `inner-view-client/src/app/components/property-filters-form/property-filters-form.component.scss`
- Create: `inner-view-client/src/app/components/property-filters-form/property-filters-form.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { PropertyFiltersFormComponent } from './property-filters-form.component';
import { FILTROS_VAZIOS, PropertyFilters } from '../../home/property-filters';

describe('PropertyFiltersFormComponent', () => {
  let fixture: ComponentFixture<PropertyFiltersFormComponent>;
  let emitidos: PropertyFilters[];

  async function montar(filtros: PropertyFilters = FILTROS_VAZIOS) {
    await TestBed.configureTestingModule({
      imports: [PropertyFiltersFormComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(PropertyFiltersFormComponent);
    fixture.componentRef.setInput('filters', filtros);
    emitidos = [];
    fixture.componentInstance.filtersChange.subscribe((f) => emitidos.push(f));
    fixture.detectChanges();
  }

  function select(nome: 'type' | 'purpose'): HTMLSelectElement {
    const el = fixture.nativeElement as HTMLElement;
    return el.querySelector(`select[data-filtro="${nome}"]`) as HTMLSelectElement;
  }

  it('monta um select de tipo com todos os valores mais "todos"', async () => {
    await montar();
    // 6 tipos + a opcao vazia
    expect(select('type').options.length).toBe(7);
  });

  it('monta um select de finalidade com todos os valores mais "todas"', async () => {
    await montar();
    expect(select('purpose').options.length).toBe(4);
  });

  it('escolher um tipo emite so o tipo trocado', async () => {
    await montar({ ...FILTROS_VAZIOS, query: 'casa' });

    select('type').value = 'APARTMENT';
    select('type').dispatchEvent(new Event('change'));

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, type: 'APARTMENT', query: 'casa' }]);
  });

  it('voltar para "todos os tipos" emite tipo nulo', async () => {
    await montar({ ...FILTROS_VAZIOS, type: 'HOUSE' });

    select('type').value = '';
    select('type').dispatchEvent(new Event('change'));

    expect(emitidos).toEqual([FILTROS_VAZIOS]);
  });

  it('escolher uma finalidade emite so a finalidade trocada', async () => {
    await montar();

    select('purpose').value = 'RENT';
    select('purpose').dispatchEvent(new Event('change'));

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, purpose: 'RENT' }]);
  });

  it('o select reflete o filtro que chegou', async () => {
    await montar({ type: 'LAND', purpose: 'SALE', location: 'Centro', query: '' });

    expect(select('type').value).toBe('LAND');
    expect(select('purpose').value).toBe('SALE');
  });

  it('digitar localizacao emite o texto sem espaco em volta', async () => {
    await montar();

    fixture.componentInstance.onLocation(
      new CustomEvent('ionInput', { detail: { value: '  Centro  ' } }),
    );

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, location: 'Centro' }]);
  });

  // "Limpar filtros" limpa filtros. O texto tem caixa propria, visivel, com
  // botao de limpar do proprio searchbar.
  it('limpar zera os tres filtros e mantem o texto', async () => {
    await montar({ type: 'HOUSE', purpose: 'SALE', location: 'Centro', query: 'casa' });

    const botao = (fixture.nativeElement as HTMLElement)
      .querySelector('button[data-filtro="clear"]') as HTMLButtonElement;
    botao.click();

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, query: 'casa' }]);
  });

  it('sem filtro ativo nao ha botao de limpar', async () => {
    await montar({ ...FILTROS_VAZIOS, query: 'casa' });

    expect((fixture.nativeElement as HTMLElement)
      .querySelector('button[data-filtro="clear"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/property-filters-form.component.spec.ts'`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar o componente**

`property-filters-form.component.ts`:

```ts
import { Component, computed, input, output } from '@angular/core';
import { IonInput } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';

import {
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  PropertyPurpose,
  PropertyType,
} from '../../models/property.model';
import {
  PropertyFilters,
  limparTodos,
  temFiltros,
} from '../../home/property-filters';

/**
 * Os controles de filtro, sem opinião sobre onde estão.
 *
 * Existe separado da barra porque é montado em dois lugares — embutido no
 * desktop, dentro do bottom sheet no mobile — e renderizar os dois ao mesmo
 * tempo, escondendo um por CSS, duplicaria rótulos e ids na árvore de
 * acessibilidade. Só um dos dois existe por vez; este componente é o que os
 * dois hospedam.
 *
 * Não navega e não chama serviço: emite o filtro novo e a página resolve.
 */
@Component({
  selector: 'app-property-filters-form',
  templateUrl: './property-filters-form.component.html',
  styleUrls: ['./property-filters-form.component.scss'],
  standalone: true,
  imports: [IonInput, TranslatePipe],
})
export class PropertyFiltersFormComponent {
  readonly filters = input.required<PropertyFilters>();
  readonly filtersChange = output<PropertyFilters>();

  readonly types = PROPERTY_TYPES;
  readonly purposes = PROPERTY_PURPOSES;

  readonly mostrarLimpar = computed(() => temFiltros(this.filters()));

  onType(event: Event): void {
    const valor = (event.target as HTMLSelectElement).value;
    this.filtersChange.emit({
      ...this.filters(),
      type: (valor || null) as PropertyType | null,
    });
  }

  onPurpose(event: Event): void {
    const valor = (event.target as HTMLSelectElement).value;
    this.filtersChange.emit({
      ...this.filters(),
      purpose: (valor || null) as PropertyPurpose | null,
    });
  }

  /**
   * O debounce é do próprio `ion-input` (400 ms, no template). Ele fica ANTES
   * da navegação, e não antes da requisição: com a URL atualizada a cada tecla
   * e a busca atrasada, um link copiado no meio da digitação apontaria para um
   * resultado que a pessoa nunca viu.
   */
  onLocation(event: CustomEvent<{ value?: string | null }>): void {
    this.filtersChange.emit({
      ...this.filters(),
      location: (event.detail.value ?? '').trim(),
    });
  }

  limpar(): void {
    this.filtersChange.emit(limparTodos(this.filters()));
  }
}
```

`property-filters-form.component.html`:

```html
<div class="filters-form">
  <label class="filters-form__field">
    <span class="filters-form__label">{{ 'HOME.FILTERS.TYPE_LABEL' | translate }}</span>
    <select data-filtro="type" (change)="onType($event)">
      <option value="" [selected]="!filters().type">
        {{ 'HOME.FILTERS.ALL_TYPES' | translate }}
      </option>
      @for (t of types; track t) {
        <option [value]="t" [selected]="filters().type === t">
          {{ 'UPLOAD.TYPE.' + t | translate }}
        </option>
      }
    </select>
  </label>

  <label class="filters-form__field">
    <span class="filters-form__label">{{ 'HOME.FILTERS.PURPOSE_LABEL' | translate }}</span>
    <select data-filtro="purpose" (change)="onPurpose($event)">
      <option value="" [selected]="!filters().purpose">
        {{ 'HOME.FILTERS.ALL_PURPOSES' | translate }}
      </option>
      @for (p of purposes; track p) {
        <option [value]="p" [selected]="filters().purpose === p">
          {{ 'UPLOAD.PURPOSE.' + p | translate }}
        </option>
      }
    </select>
  </label>

  <label class="filters-form__field">
    <span class="filters-form__label">{{ 'HOME.FILTERS.LOCATION_LABEL' | translate }}</span>
    <!--
      `debounce` do próprio Ionic: são 400 ms entre a última tecla e a
      navegação. Escrever o temporizador à mão custaria limpeza no destroy e
      teste de `fakeAsync` para reimplementar o que o componente já faz.
    -->
    <ion-input
      data-filtro="location"
      [value]="filters().location"
      [debounce]="400"
      [placeholder]="'HOME.FILTERS.LOCATION_PLACEHOLDER' | translate"
      [attr.aria-label]="'HOME.FILTERS.LOCATION_LABEL' | translate"
      (ionInput)="onLocation($event)">
    </ion-input>
  </label>

  @if (mostrarLimpar()) {
    <button type="button" data-filtro="clear" class="filters-form__clear" (click)="limpar()">
      {{ 'HOME.FILTERS.CLEAR' | translate }}
    </button>
  }
</div>
```

`property-filters-form.component.scss`:

```scss
.filters-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.filters-form__field {
  display: flex;
  flex: 1 1 180px;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.filters-form__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-muted);
}

.filters-form__field select {
  // 44px é o piso de touch target exigido pelo AGENTS.md.
  min-height: 44px;
  padding-inline: 12px;
  border: 1px solid var(--app-hairline);
  border-radius: var(--app-radius-sm);
  background: var(--ion-color-light, transparent);
  color: var(--app-ink);
  font-size: 15px;

  &:focus-visible {
    outline: 2px solid var(--ion-color-primary);
    outline-offset: 2px;
  }
}

.filters-form__field ion-input {
  --padding-start: 12px;
  --padding-end: 12px;
  min-height: 44px;
  border: 1px solid var(--app-hairline);
  border-radius: var(--app-radius-sm);
  font-size: 15px;
}

.filters-form__clear {
  min-height: 44px;
  padding-inline: 16px;
  border: 1px solid var(--app-hairline);
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-body);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--app-surface-soft);
  }

  &:focus-visible {
    outline: 2px solid var(--ion-color-primary);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 4: Converter os quatro arquivos para CRLF**

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/property-filters-form.component.spec.ts'`
Expected: PASS, 9 testes.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/components/property-filters-form
git commit -m "feat(client): formulario de filtros de imovel"
```

---

## Task 8: Cliente — `active-filter-chips`

**Files:**
- Create: `inner-view-client/src/app/components/active-filter-chips/active-filter-chips.component.ts`
- Create: `inner-view-client/src/app/components/active-filter-chips/active-filter-chips.component.html`
- Create: `inner-view-client/src/app/components/active-filter-chips/active-filter-chips.component.scss`
- Create: `inner-view-client/src/app/components/active-filter-chips/active-filter-chips.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { ActiveFilterChipsComponent } from './active-filter-chips.component';
import { FilterChip } from '../../home/property-filters';

const CHIPS: FilterChip[] = [
  { key: 'type', labelKey: 'UPLOAD.TYPE.APARTMENT', labelText: '' },
  { key: 'location', labelKey: null, labelText: 'Centro' },
];

describe('ActiveFilterChipsComponent', () => {
  let fixture: ComponentFixture<ActiveFilterChipsComponent>;

  async function montar(chips: FilterChip[] = CHIPS) {
    await TestBed.configureTestingModule({
      imports: [ActiveFilterChipsComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(ActiveFilterChipsComponent);
    fixture.componentRef.setInput('chips', chips);
    fixture.detectChanges();
  }

  function botoes(): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button[data-chip]'),
    );
  }

  it('monta um botao por chip', async () => {
    await montar();
    expect(botoes().length).toBe(2);
  });

  // Sem traducao carregada o pipe devolve a chave — e' o que se afirma aqui.
  it('tipo mostra a chave traduzida; localizacao mostra o texto cru', async () => {
    await montar();
    expect(botoes()[0].textContent).toContain('UPLOAD.TYPE.APARTMENT');
    expect(botoes()[1].textContent).toContain('Centro');
  });

  it('clicar num chip emite a chave dele', async () => {
    await montar();
    const emitidos: string[] = [];
    fixture.componentInstance.remove.subscribe((k) => emitidos.push(k));

    botoes()[1].click();

    expect(emitidos).toEqual(['location']);
  });

  it('cada chip tem nome acessivel de remocao', async () => {
    await montar();
    expect(botoes()[1].getAttribute('aria-label')).toContain('HOME.FILTERS.REMOVE_CHIP');
  });

  it('o limpar tudo emite clear', async () => {
    await montar();
    let limpou = 0;
    fixture.componentInstance.clear.subscribe(() => limpou++);

    ((fixture.nativeElement as HTMLElement)
      .querySelector('button[data-chips-clear]') as HTMLButtonElement).click();

    expect(limpou).toBe(1);
  });

  it('sem chips nao renderiza nada', async () => {
    await montar([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('ul')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/active-filter-chips.component.spec.ts'`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar**

`active-filter-chips.component.ts`:

```ts
import { Component, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';

import { FilterChip } from '../../home/property-filters';

/**
 * Os filtros ativos, à vista e removíveis um a um.
 *
 * Visível nas duas larguras, inclusive no mobile onde os controles estão
 * escondidos dentro do sheet: sem os chips, a única pista de que há filtro
 * ligado seria o número no botão, e uma lista curta sem explicação parece
 * acervo vazio.
 */
@Component({
  selector: 'app-active-filter-chips',
  templateUrl: './active-filter-chips.component.html',
  styleUrls: ['./active-filter-chips.component.scss'],
  standalone: true,
  imports: [IonIcon, TranslatePipe],
})
export class ActiveFilterChipsComponent {
  readonly chips = input.required<FilterChip[]>();
  readonly remove = output<FilterChip['key']>();
  readonly clear = output<void>();

  constructor() {
    addIcons({ closeOutline });
  }
}
```

`active-filter-chips.component.html`:

```html
@if (chips().length) {
  <ul class="filter-chips" [attr.aria-label]="'HOME.FILTERS.ACTIVE_TITLE' | translate">
    @for (chip of chips(); track chip.key) {
      <li>
        <!--
          O rótulo tem duas naturezas: tipo e finalidade são valores fechados e
          vêm por chave de tradução; localização é o que a pessoa escreveu.
        -->
        <button
          type="button"
          class="filter-chips__chip"
          [attr.data-chip]="chip.key"
          [attr.aria-label]="'HOME.FILTERS.REMOVE_CHIP' | translate: {
            label: chip.labelKey ? (chip.labelKey | translate) : chip.labelText
          }"
          (click)="remove.emit(chip.key)">
          <span>{{ chip.labelKey ? (chip.labelKey | translate) : chip.labelText }}</span>
          <ion-icon name="close-outline" aria-hidden="true"></ion-icon>
        </button>
      </li>
    }

    <li>
      <button
        type="button"
        data-chips-clear
        class="filter-chips__clear"
        (click)="clear.emit()">
        {{ 'HOME.FILTERS.CLEAR' | translate }}
      </button>
    </li>
  </ul>
}
```

`active-filter-chips.component.scss`:

```scss
.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.filter-chips__chip,
.filter-chips__clear {
  // 44px de alvo mesmo com o chip parecendo menor: o padding vertical entra
  // para chegar ao piso do AGENTS.md sem engordar o desenho.
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding-inline: 14px;
  border: 1px solid var(--app-hairline);
  border-radius: 9999px;
  background: var(--app-surface-soft);
  color: var(--app-ink);
  font-size: 14px;
  cursor: pointer;

  &:hover {
    background: var(--app-surface-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--ion-color-primary);
    outline-offset: 2px;
  }

  ion-icon {
    font-size: 16px;
    color: var(--app-muted);
  }
}

.filter-chips__clear {
  background: transparent;
  color: var(--app-body);
  font-weight: 600;
}
```

- [ ] **Step 4: Converter para CRLF**

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/active-filter-chips.component.spec.ts'`
Expected: PASS, 6 testes.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/components/active-filter-chips
git commit -m "feat(client): chips dos filtros ativos"
```

---

## Task 9: Cliente — `property-filters-sheet`

**Files:**
- Create: `inner-view-client/src/app/components/property-filters-sheet/property-filters-sheet.component.ts`
- Create: `inner-view-client/src/app/components/property-filters-sheet/property-filters-sheet.component.html`
- Create: `inner-view-client/src/app/components/property-filters-sheet/property-filters-sheet.component.scss`
- Create: `inner-view-client/src/app/components/property-filters-sheet/property-filters-sheet.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { PropertyFiltersSheetComponent } from './property-filters-sheet.component';
import { FILTROS_VAZIOS } from '../../home/property-filters';

describe('PropertyFiltersSheetComponent', () => {
  let fixture: ComponentFixture<PropertyFiltersSheetComponent>;

  async function montar(aberto: boolean) {
    await TestBed.configureTestingModule({
      imports: [PropertyFiltersSheetComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(PropertyFiltersSheetComponent);
    fixture.componentRef.setInput('filters', FILTROS_VAZIOS);
    fixture.componentRef.setInput('isOpen', aberto);
    fixture.detectChanges();
  }

  // Estes testes apresentam um IonModal de verdade, e um modal apresentado
  // prende o foco no documento inteiro do Karma — o mesmo cuidado que o
  // hotspot-sheet ja documenta.
  afterEach(() => {
    document.querySelectorAll('ion-modal').forEach((modal) => modal.remove());
  });

  it('o modal comeca fechado quando isOpen e falso', async () => {
    await montar(false);
    // A propriedade, e nao `ng-reflect-is-open`: aquele atributo so existe em
    // modo de desenvolvimento e o Angular esta removendo-o.
    const modal = (fixture.nativeElement as HTMLElement)
      .querySelector('ion-modal') as HTMLElement & { isOpen?: boolean };
    expect(modal.isOpen).toBeFalse();
  });

  // O `0` e' o que permite arrastar para baixo ate fechar; sem ele o sheet
  // trava na menor parada e a unica saida vira o botao.
  it('o primeiro breakpoint e zero', async () => {
    await montar(false);
    expect(fixture.componentInstance.breakpoints[0]).toBe(0);
  });

  it('repassa a mudanca de filtro do formulario', async () => {
    await montar(true);
    const emitidos: unknown[] = [];
    fixture.componentInstance.filtersChange.subscribe((f) => emitidos.push(f));

    fixture.componentInstance.aoMudar({ ...FILTROS_VAZIOS, type: 'HOUSE' });

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, type: 'HOUSE' }]);
  });

  it('fechar emite closed', async () => {
    await montar(true);
    let fechou = 0;
    fixture.componentInstance.closed.subscribe(() => fechou++);

    fixture.componentInstance.close();

    expect(fechou).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/property-filters-sheet.component.spec.ts'`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar**

`property-filters-sheet.component.ts`:

```ts
import { Component, inject, input, output } from '@angular/core';
import { IonContent, IonModal } from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PropertyFilters } from '../../home/property-filters';
import { PropertyFiltersFormComponent } from '../property-filters-form/property-filters-form.component';

/**
 * Os filtros no telefone.
 *
 * `IonModal` com `breakpoints` e não um painel à mão: arrastar para baixo,
 * prender o foco, fechar no Esc, devolver o foco a quem abriu e a animação de
 * entrada vêm prontos — mesma decisão do `hotspot-sheet`, e pelo mesmo motivo.
 *
 * Aplica AO VIVO: mexer num controle aqui dentro já navega e já refiltra, igual
 * ao desktop. O botão do rodapé só fecha. Acumular aqui e aplicar no botão
 * daria ao mobile um estado de filtro que o desktop não tem, e com ele um
 * "cancelar" que precisa desfazer.
 */
@Component({
  selector: 'app-property-filters-sheet',
  templateUrl: './property-filters-sheet.component.html',
  styleUrls: ['./property-filters-sheet.component.scss'],
  standalone: true,
  imports: [IonModal, IonContent, TranslatePipe, PropertyFiltersFormComponent],
})
export class PropertyFiltersSheetComponent {
  private readonly translate = inject(TranslateService);

  readonly filters = input.required<PropertyFilters>();
  readonly isOpen = input.required<boolean>();

  readonly filtersChange = output<PropertyFilters>();
  readonly closed = output<void>();

  /** O `0` é o que permite arrastar para baixo até fechar. */
  readonly breakpoints = [0, 0.6, 0.95];
  readonly initialBreakpoint = 0.6;

  aoMudar(filtros: PropertyFilters): void {
    this.filtersChange.emit(filtros);
  }

  close(): void {
    this.closed.emit();
  }

  /**
   * Dá nome ao diálogo, entrando no shadow DOM do Ionic.
   *
   * O `role="dialog"` não fica no `<ion-modal>`, e sim num `.modal-wrapper`
   * dentro do shadow root; `aria-label` no host nomeia o host, que é um nó
   * genérico, e `aria-labelledby` não atravessa fronteira de shadow. O
   * levantamento inteiro, feito com a árvore de acessibilidade na mão, está em
   * `hotspot-sheet.component.ts` — aqui é a mesma solução com um título fixo,
   * que dispensa o effect de lá.
   */
  nomearDialogo(event: Event): void {
    const modal = event.target as HTMLElement;
    modal.shadowRoot
      ?.querySelector('.modal-wrapper')
      ?.setAttribute('aria-label', this.translate.instant('HOME.FILTERS.SHEET_TITLE'));
  }
}
```

`property-filters-sheet.component.html`:

```html
<!--
  `breakpoints` e `initialBreakpoint` vêm ANTES de `isOpen`: o Ionic lê a altura
  inicial no momento de apresentar, e a ordem das ligações é a ordem em que o
  Angular as escreve.
-->
<ion-modal
  class="filters-sheet"
  [breakpoints]="breakpoints"
  [initialBreakpoint]="initialBreakpoint"
  [isOpen]="isOpen()"
  (didPresent)="nomearDialogo($event)"
  (didDismiss)="close()">
  <ng-template>
    <ion-content class="ion-padding">
      <header class="filters-sheet__head">
        <h2 class="filters-sheet__title">{{ 'HOME.FILTERS.SHEET_TITLE' | translate }}</h2>

        <!--
          Fechar explícito além do arrasto: o handle é descoberto por quem já
          conhece o gesto.
        -->
        <button type="button" class="filters-sheet__done" (click)="close()">
          {{ 'HOME.FILTERS.SHEET_DONE' | translate }}
        </button>
      </header>

      <app-property-filters-form
        [filters]="filters()"
        (filtersChange)="aoMudar($event)" />
    </ion-content>
  </ng-template>
</ion-modal>
```

`property-filters-sheet.component.scss`:

```scss
.filters-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.filters-sheet__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--app-ink);
}

.filters-sheet__done {
  min-height: 44px;
  padding-inline: 16px;
  border: none;
  border-radius: var(--app-radius-sm);
  background: var(--ion-color-primary);
  color: var(--ion-color-primary-contrast);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--ion-color-primary);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 4: Converter para CRLF**

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/property-filters-sheet.component.spec.ts'`
Expected: PASS, 4 testes.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/components/property-filters-sheet
git commit -m "feat(client): bottom sheet dos filtros no mobile"
```

---

## Task 10: Cliente — `property-filters-bar`

**Files:**
- Create: `inner-view-client/src/app/components/property-filters-bar/property-filters-bar.component.ts`
- Create: `inner-view-client/src/app/components/property-filters-bar/property-filters-bar.component.html`
- Create: `inner-view-client/src/app/components/property-filters-bar/property-filters-bar.component.scss`
- Create: `inner-view-client/src/app/components/property-filters-bar/property-filters-bar.component.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

O teste precisa controlar o `matchMedia`. Substitua-o antes de criar o componente:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { PropertyFiltersBarComponent } from './property-filters-bar.component';
import { FILTROS_VAZIOS, PropertyFilters } from '../../home/property-filters';

describe('PropertyFiltersBarComponent', () => {
  let fixture: ComponentFixture<PropertyFiltersBarComponent>;
  let matchMediaOriginal: typeof window.matchMedia;

  /**
   * O componente decide entre embutido e sheet por `matchMedia`. Trocar a
   * funcao e' o unico jeito de exercitar as duas larguras no Karma, que roda
   * numa janela so.
   */
  function fingirLargura(mobile: boolean) {
    window.matchMedia = ((consulta: string) => ({
      matches: mobile,
      media: consulta,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  beforeEach(() => {
    matchMediaOriginal = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = matchMediaOriginal;
    document.querySelectorAll('ion-modal').forEach((modal) => modal.remove());
  });

  async function montar(mobile: boolean, filtros: PropertyFilters = FILTROS_VAZIOS) {
    fingirLargura(mobile);

    await TestBed.configureTestingModule({
      imports: [PropertyFiltersBarComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(PropertyFiltersBarComponent);
    fixture.componentRef.setInput('filters', filtros);
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('no desktop o formulario fica embutido', async () => {
    await montar(false);
    expect(el().querySelector('app-property-filters-form')).not.toBeNull();
    expect(el().querySelector('button[data-filtros-toggle]')).toBeNull();
  });

  // Um IonModal escondido por CSS continua prendendo o foco, travando o scroll
  // e respondendo ao Esc. A diferenca entre "some da vista" e "nao esta la" e'
  // a diferenca entre uma barra de filtros e um teclado preso.
  it('no desktop o sheet nao existe no DOM', async () => {
    await montar(false);
    expect(el().querySelector('app-property-filters-sheet')).toBeNull();
  });

  it('no mobile o formulario embutido da lugar ao botao', async () => {
    await montar(true);
    expect(el().querySelector('button[data-filtros-toggle]')).not.toBeNull();
    expect(el().querySelector('app-property-filters-sheet')).not.toBeNull();
  });

  it('o botao mostra a contagem de filtros ativos', async () => {
    await montar(true, { type: 'HOUSE', purpose: 'RENT', location: '', query: '' });
    expect(fixture.componentInstance.quantidade()).toBe(2);
    expect(el().querySelector('button[data-filtros-toggle]')?.textContent)
      .toContain('HOME.FILTERS.TOGGLE_COUNT');
  });

  it('sem filtro o botao usa o rotulo sem numero', async () => {
    await montar(true);
    expect(el().querySelector('button[data-filtros-toggle]')?.textContent)
      .toContain('HOME.FILTERS.TOGGLE');
  });

  it('o botao abre o sheet', async () => {
    await montar(true);
    expect(fixture.componentInstance.sheetAberto()).toBeFalse();

    (el().querySelector('button[data-filtros-toggle]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.sheetAberto()).toBeTrue();
  });

  it('repassa a mudanca de filtro para cima', async () => {
    await montar(false);
    const emitidos: PropertyFilters[] = [];
    fixture.componentInstance.filtersChange.subscribe((f) => emitidos.push(f));

    fixture.componentInstance.aoMudar({ ...FILTROS_VAZIOS, type: 'LAND' });

    expect(emitidos).toEqual([{ ...FILTROS_VAZIOS, type: 'LAND' }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/property-filters-bar.component.spec.ts'`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar**

`property-filters-bar.component.ts`:

```ts
import { Component, computed, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { PropertyFilters, contarFiltros } from '../../home/property-filters';
import { PropertyFiltersFormComponent } from '../property-filters-form/property-filters-form.component';
import { PropertyFiltersSheetComponent } from '../property-filters-sheet/property-filters-sheet.component';
// O helper é genérico — um sinal de `matchMedia` que solta o listener no
// destroy — apesar de morar sob o wizard, que foi quem precisou dele primeiro.
// Movê-lo para um lugar neutro é limpeza de outro PR; duplicar a fiação do
// `matchMedia` aqui seria pior.
import { isMobileViewport } from '../../tour-wizard/hotspots/media';

/**
 * Onde os filtros ficam, dada a largura da tela.
 *
 * O ticket pede duas coisas que puxam em direções opostas: "os filtros ficam
 * visíveis e acessíveis" e "o layout não apresenta cortes ou overflow em
 * mobile". No desktop cabe uma barra; no telefone, três controles lado a lado
 * viram três controles espremidos. Então: barra embutida no desktop, botão
 * "Filtros (N)" abrindo um bottom sheet no telefone.
 *
 * Só um dos dois EXISTE por vez — não é um escondido por CSS. Ver o teste do
 * sheet ausente no desktop e o comentário de `hotspots/media.ts`.
 */
@Component({
  selector: 'app-property-filters-bar',
  templateUrl: './property-filters-bar.component.html',
  styleUrls: ['./property-filters-bar.component.scss'],
  standalone: true,
  imports: [PropertyFiltersFormComponent, PropertyFiltersSheetComponent, TranslatePipe],
})
export class PropertyFiltersBarComponent {
  readonly filters = input.required<PropertyFilters>();
  readonly filtersChange = output<PropertyFilters>();

  readonly mobile = isMobileViewport();
  readonly sheetAberto = signal(false);

  readonly quantidade = computed(() => contarFiltros(this.filters()));

  /**
   * O projeto resolve plural por sufixo escolhido no TypeScript. Aqui não é
   * plural, é presença: sem filtro o botão diz só "Filtros", porque "Filtros
   * (0)" anuncia um número que não quer dizer nada.
   */
  readonly rotuloKey = computed(() =>
    this.quantidade() > 0 ? 'HOME.FILTERS.TOGGLE_COUNT' : 'HOME.FILTERS.TOGGLE',
  );

  readonly rotuloParams = computed(() => ({ n: this.quantidade() }));

  abrirSheet(): void {
    this.sheetAberto.set(true);
  }

  fecharSheet(): void {
    this.sheetAberto.set(false);
  }

  aoMudar(filtros: PropertyFilters): void {
    this.filtersChange.emit(filtros);
  }
}
```

`property-filters-bar.component.html`:

```html
<div class="filters-bar">
  @if (mobile()) {
    <button
      type="button"
      data-filtros-toggle
      class="filters-bar__toggle"
      (click)="abrirSheet()">
      {{ rotuloKey() | translate: rotuloParams() }}
    </button>

    <app-property-filters-sheet
      [filters]="filters()"
      [isOpen]="sheetAberto()"
      (filtersChange)="aoMudar($event)"
      (closed)="fecharSheet()" />
  } @else {
    <app-property-filters-form
      [filters]="filters()"
      (filtersChange)="aoMudar($event)" />
  }
</div>
```

`property-filters-bar.component.scss`:

```scss
.filters-bar {
  max-width: 1280px;
  margin-inline: auto;
  padding-top: 12px;
}

.filters-bar__toggle {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding-inline: 18px;
  border: 1px solid var(--app-border-strong);
  border-radius: 9999px;
  background: transparent;
  color: var(--app-ink);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--app-surface-soft);
  }

  &:focus-visible {
    outline: 2px solid var(--ion-color-primary);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 4: Converter para CRLF**

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/property-filters-bar.component.spec.ts'`
Expected: PASS, 7 testes.

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/components/property-filters-bar
git commit -m "feat(client): barra de filtros embutida no desktop e sheet no mobile"
```

---

## Task 11: Cliente — a home filtra no servidor

A tarefa maior, e a única que não pode ser fatiada: mudar a assinatura de `resolveHomeView` quebra a compilação de `home.page.ts`, então os dois andam juntos.

**Files:**
- Modify: `inner-view-client/src/app/home/home-view.ts`
- Modify: `inner-view-client/src/app/home/home-view.spec.ts`
- Modify: `inner-view-client/src/app/home/home.page.ts`
- Modify: `inner-view-client/src/app/home/home.page.html`
- Modify: `inner-view-client/src/app/home/home.page.spec.ts`

- [ ] **Step 1: Reescrever `home-view.spec.ts`**

Substitua o arquivo inteiro:

```ts
import { resolveHomeView } from './home-view';

const PRONTO = { status: 'ready' as const, jaCarregou: true, vazio: false, comCriterios: false };

describe('resolveHomeView', () => {
  it('a primeira carga e carregando', () => {
    expect(resolveHomeView({ ...PRONTO, status: 'loading', jaCarregou: false })).toBe('loading');
  });

  // Refiltrar NAO volta para o placeholder de tela cheia. A busca e a barra de
  // filtros vivem dentro da moldura, que so aparece em `list` e `no-results`:
  // se refiltrar virasse `loading`, mexer num filtro faria a barra sumir, e
  // digitar na busca destruiria o campo em foco no meio da digitacao.
  it('refiltrar mantem a view anterior', () => {
    expect(resolveHomeView({ ...PRONTO, status: 'loading' })).toBe('list');
    expect(resolveHomeView({ ...PRONTO, status: 'loading', vazio: true, comCriterios: true }))
      .toBe('no-results');
  });

  it('erro vence o conteudo', () => {
    expect(resolveHomeView({ ...PRONTO, status: 'error' })).toBe('error');
    expect(resolveHomeView({ ...PRONTO, status: 'error', vazio: true })).toBe('error');
  });

  // Esta e' a asserção que trava a precedencia. Com o servidor filtrando, uma
  // resposta vazia pode ser conta zerada OU busca que nao casou — o que separa
  // as duas e' ter havido criterio. Quem tem trinta imoveis e digita "zzz"
  // precisa de "nenhum resultado", nao do onboarding de conta zerada.
  it('vazio sem criterio e onboarding', () => {
    expect(resolveHomeView({ ...PRONTO, vazio: true })).toBe('empty');
  });

  it('vazio com criterio e "sem resultado"', () => {
    expect(resolveHomeView({ ...PRONTO, vazio: true, comCriterios: true })).toBe('no-results');
  });

  it('com itens e lista, com ou sem criterio', () => {
    expect(resolveHomeView(PRONTO)).toBe('list');
    expect(resolveHomeView({ ...PRONTO, comCriterios: true })).toBe('list');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/home-view.spec.ts'`
Expected: FAIL na compilação — `HomeViewInput` ainda pede `total` e `filtered`.

- [ ] **Step 3: Reescrever `home-view.ts`**

```ts
/** Situação da requisição que alimenta a home. */
export type HomeStatus = 'loading' | 'error' | 'ready';

/** Qual bloco a home renderiza. */
export type HomeView = 'loading' | 'error' | 'empty' | 'no-results' | 'list';

/**
 * Com a filtragem no servidor, "conta vazia" e "busca sem resultado" chegam
 * exatamente iguais: uma resposta com zero imóveis. O que as separa é ter
 * havido critério — e é por isso que `comCriterios` inclui o texto da busca, e
 * não só os filtros.
 */
export interface HomeViewInput {
  readonly status: HomeStatus;
  /** Já houve ao menos uma resposta bem-sucedida nesta visita. */
  readonly jaCarregou: boolean;
  /** A última resposta veio sem nenhum imóvel. */
  readonly vazio: boolean;
  /** Há texto de busca ou algum filtro ativo. */
  readonly comCriterios: boolean;
}

/**
 * A ordem aqui É o contrato, porque mais de uma condição pode valer ao mesmo
 * tempo.
 *
 * O `jaCarregou` na primeira linha é o que faz refiltrar não voltar ao
 * placeholder de tela cheia: a busca e a barra de filtros só existem nas views
 * `list` e `no-results`, então uma refiltragem que virasse `loading`
 * destruiria o campo que a pessoa está usando.
 */
export function resolveHomeView({
  status,
  jaCarregou,
  vazio,
  comCriterios,
}: HomeViewInput): HomeView {
  if (status === 'loading' && !jaCarregou) return 'loading';
  if (status === 'error') return 'error';
  if (!vazio) return 'list';
  return comCriterios ? 'no-results' : 'empty';
}
```

- [ ] **Step 4: Rodar o spec do módulo puro**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/home-view.spec.ts'`
Expected: PASS. A suíte inteira ainda não compila — é o próximo passo.

- [ ] **Step 5: Reescrever `home.page.ts`**

Arquivo inteiro:

```ts
import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  IonContent,
  IonSearchbar,
  IonIcon,
  IonFab,
  IonFabButton,
  IonProgressBar,
} from '@ionic/angular/standalone';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, distinctUntilChanged, switchMap, tap } from 'rxjs';
import { addIcons } from 'ionicons';
import { add, alertCircleOutline, imagesOutline, searchOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';

import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { InnerViewListComponent } from '../components/inner-view-list/inner-view-list.component';
import { HomePlaceholderComponent } from '../components/home-placeholder/home-placeholder.component';
import { HomeNoTourBannerComponent } from '../components/home-no-tour-banner/home-no-tour-banner.component';
import { PropertyFiltersBarComponent } from '../components/property-filters-bar/property-filters-bar.component';
import { ActiveFilterChipsComponent } from '../components/active-filter-chips/active-filter-chips.component';
import { PropertyService } from '../services/property.service';
import { Property } from '../models/property.model';
import { HomeStatus, resolveHomeView } from './home-view';
import {
  FilterChip,
  PropertyFilters,
  chipsAtivos,
  limparTodos,
  mesmosFiltros,
  parseFilters,
  removerFiltro,
  temCriterios,
  temFiltros,
  toListParams,
  toQueryParams,
} from './property-filters';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    IonContent, IonSearchbar, IonIcon, IonFab, IonFabButton, IonProgressBar,
    AppHeaderComponent, InnerViewListComponent, HomePlaceholderComponent,
    HomeNoTourBannerComponent, PropertyFiltersBarComponent,
    ActiveFilterChipsComponent, RouterLink, TranslatePipe,
  ],
})
export class HomePage {
  @ViewChild(AppHeaderComponent) header?: AppHeaderComponent;

  private readonly propertyService = inject(PropertyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly status = signal<HomeStatus>('loading');
  readonly properties = signal<Property[]>([]);

  /** Só a PRIMEIRA carga ocupa a tela inteira. Ver `resolveHomeView`. */
  private readonly jaCarregou = signal(false);

  /** Bumped pelo "Tentar de novo": os critérios não mudam, a consulta refaz. */
  private readonly tentativa = signal(0);

  /**
   * A URL é a fonte de verdade dos critérios.
   *
   * Lido como observable, e não do `snapshot` no `ngOnInit`: com
   * `IonicRouteStrategy`, navegar de `/home?type=HOUSE` para `/home?type=LAND`
   * NÃO recria o componente, e um snapshot lido uma vez congelaria os filtros
   * na primeira montagem.
   */
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly filters = computed<PropertyFilters>(() => parseFilters(this.params()));

  readonly comCriterios = computed(() => temCriterios(this.filters()));
  readonly comFiltros = computed(() => temFiltros(this.filters()));
  readonly chips = computed(() => chipsAtivos(this.filters()));

  readonly view = computed(() =>
    resolveHomeView({
      status: this.status(),
      jaCarregou: this.jaCarregou(),
      vazio: this.properties().length === 0,
      comCriterios: this.comCriterios(),
    }),
  );

  /** Não é uma `view`: é uma barra de progresso por cima da view anterior. */
  readonly refiltrando = computed(
    () => this.status() === 'loading' && this.jaCarregou(),
  );

  private readonly semTour = computed(() =>
    this.properties().filter((p) => !p.virtualTour),
  );

  /**
   * Some com QUALQUER critério ativo.
   *
   * A faixa diz "N imóveis ainda não possuem imagens 360°" — uma frase sobre o
   * acervo. Com o servidor filtrando, `properties()` é a página filtrada, e a
   * mesma frase passaria a falar do resultado da busca no tom de quem fala da
   * conta inteira. É um empurrão sobre a conta, não sobre uma pesquisa.
   */
  readonly mostrarFaixa = computed(
    () =>
      this.view() === 'list' &&
      !this.comCriterios() &&
      this.properties().length > 0 &&
      this.semTour().length === this.properties().length,
  );

  readonly totalSemTour = computed(() => this.semTour().length);

  /**
   * Busca, filtros e FAB aparecem juntos, e de uma condição só.
   *
   * Lista branca de propósito: se um sexto estado entrar aqui um dia e ninguém
   * lembrar desta linha, a moldura some — que é uma tela incompleta. Com lista
   * negra, ela apareceria num estado que ninguém avaliou, oferecendo
   * "adicionar" sobre uma tela de erro. Some é melhor do que mente.
   */
  readonly mostrarMoldura = computed(
    () => this.view() === 'list' || this.view() === 'no-results',
  );

  /** O projeto resolve plural por sufixo `_ONE` escolhido no TypeScript. */
  readonly contagemKey = computed(() =>
    this.properties().length === 1
      ? 'HOME.FILTERS.RESULT_COUNT_ONE'
      : 'HOME.FILTERS.RESULT_COUNT',
  );

  readonly contagemParams = computed(() => ({ n: this.properties().length }));

  constructor() {
    addIcons({ add, alertCircleOutline, imagesOutline, searchOutline });

    const gatilho = computed(() => ({
      filtros: this.filters(),
      tentativa: this.tentativa(),
    }));

    toObservable(gatilho)
      .pipe(
        // `parseFilters` devolve objeto novo a cada emissão do router, e o
        // router emite em navegações que não mexeram em critério nenhum.
        distinctUntilChanged(
          (a, b) =>
            a.tentativa === b.tentativa && mesmosFiltros(a.filtros, b.filtros),
        ),
        tap(() => this.status.set('loading')),
        // `switchMap` cancela a requisição anterior. Sem ele, uma resposta
        // lenta de um critério antigo chega depois da rápida do critério novo e
        // sobrescreve a tela com o resultado errado — defeito que só aparece em
        // rede ruim e é quase impossível de reproduzir depois.
        switchMap(({ filtros }) =>
          this.propertyService.listProperties(toListParams(filtros)).pipe(
            catchError((erro) => {
              console.error('Error loading properties:', erro);
              this.status.set('error');
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        this.properties.set(res.data);
        this.status.set('ready');
        this.jaCarregou.set(true);
      });
  }

  /**
   * Todo caminho que muda critério passa por aqui: navega, e a requisição é
   * consequência da URL ter mudado. Um caminho só, sem estado duplicado para
   * sair de sincronia.
   *
   * `replaceUrl` porque empilhar uma entrada por filtro faria o botão voltar
   * do celular desfazer um filtro por vez, e sair da home exigiria tantos
   * toques quantos filtros a pessoa mexeu.
   */
  aplicarFiltros(filtros: PropertyFilters): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams(filtros),
      replaceUrl: true,
    });
  }

  onSearch(event: CustomEvent<{ value?: string | null }>): void {
    this.aplicarFiltros({
      ...this.filters(),
      query: (event.detail.value ?? '').trim(),
    });
  }

  removerChip(key: FilterChip['key']): void {
    this.aplicarFiltros(removerFiltro(this.filters(), key));
  }

  limpar(): void {
    this.aplicarFiltros(limparTodos(this.filters()));
  }

  /** "Tentar de novo": mesmos critérios, consulta refeita. */
  carregar(): void {
    this.tentativa.update((n) => n + 1);
  }

  irParaNovoTour(): void {
    void this.router.navigate(['/tour/novo']);
  }

  onScroll(event: CustomEvent<{ scrollTop: number }>) {
    this.header?.onContentScroll(event.detail.scrollTop);
  }
}
```

- [ ] **Step 6: Reescrever `home.page.html`**

```html
<ion-content [fullscreen]="true" [scrollEvents]="true" (ionScroll)="onScroll($event)">
  <app-header></app-header>

  @if (mostrarMoldura()) {
    <div class="search-band">
      <!--
        `[value]` ligado à URL: o texto pode vir preenchido no primeiro render,
        de um link compartilhado ou de um refresh, e um campo vazio sob
        "nenhum resultado para zzz" seria uma tela que se contradiz.
      -->
      <ion-searchbar
        class="home-search has-search-orb"
        [value]="filters().query"
        [debounce]="400"
        [placeholder]="'HOME.SEARCH_PLACEHOLDER' | translate"
        (ionInput)="onSearch($event)"
        animated="true">
      </ion-searchbar>
    </div>

    <app-property-filters-bar
      [filters]="filters()"
      (filtersChange)="aplicarFiltros($event)" />

    <div class="filters-band">
      <app-active-filter-chips
        [chips]="chips()"
        (remove)="removerChip($event)"
        (clear)="limpar()" />

      <!--
        Refiltrar não devolve o placeholder de tela cheia: a barra e a busca
        vivem dentro da moldura, e destruí-las tiraria o campo em foco de quem
        está digitando. O progresso entra por cima.
      -->
      @if (refiltrando()) {
        <ion-progress-bar type="indeterminate" class="home-refiltrando"></ion-progress-bar>
      }
    </div>
  }

  @switch (view()) {
    @case ('loading') {
      <app-home-placeholder [spinner]="true" text="HOME.LOADING" />
    }
    @case ('error') {
      <app-home-placeholder
        icon="alert-circle-outline"
        text="HOME.ERROR_TEXT"
        actionLabel="HOME.ERROR_RETRY"
        (action)="carregar()" />
    }
    @case ('empty') {
      <app-home-placeholder
        icon="images-outline"
        heading="HOME.EMPTY_TITLE"
        text="HOME.EMPTY_TEXT"
        actionLabel="HOME.EMPTY_CTA"
        (action)="irParaNovoTour()" />
    }
    @case ('no-results') {
      <!--
        Duas mensagens: "nenhum imóvel para 'cobertura'" numa tela com dois
        filtros ligados esconde a causa mais provável do zero.
      -->
      @if (comFiltros()) {
        <app-home-placeholder
          icon="search-outline"
          text="HOME.FILTERS.NO_RESULTS_FILTERS"
          actionLabel="HOME.FILTERS.CLEAR"
          (action)="limpar()" />
      } @else {
        <app-home-placeholder
          icon="search-outline"
          text="HOME.NO_RESULTS"
          [textParams]="{ query: filters().query }" />
      }
    }
    @case ('list') {
      <!--
        Sem esta região, mexer num `select` não anuncia nada a quem usa leitor
        de tela: a lista muda em silêncio. Os outros estados são anunciados
        pelo `role="status"` do próprio placeholder.
      -->
      <p class="home-anuncio" role="status" aria-live="polite">
        {{ contagemKey() | translate: contagemParams() }}
      </p>

      @if (mostrarFaixa()) {
        <app-home-no-tour-banner [count]="totalSemTour()" />
      }
      <app-inner-view-list
        [items]="properties()"
        [attr.aria-busy]="refiltrando() || null"></app-inner-view-list>
    }
  }

  @if (mostrarMoldura()) {
    <ion-fab slot="fixed" vertical="bottom" horizontal="end">
      <ion-fab-button routerLink="/tour/novo">
        <ion-icon name="add"></ion-icon>
      </ion-fab-button>
    </ion-fab>
  }
</ion-content>
```

- [ ] **Step 7: Acrescentar o SCSS**

Ao final de `home.page.scss`:

```scss
.filters-band {
  max-width: 1280px;
  margin-inline: auto;
  padding-inline: 4px;
}

.home-refiltrando {
  margin-top: 8px;
}

// A contagem existe para o leitor de tela; na tela ela seria ruído sobre uma
// lista que a pessoa está vendo.
.home-anuncio {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 8: Reescrever `home.page.spec.ts`**

Arquivo inteiro:

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { HomePage } from './home.page';
import { Property } from '../models/property.model';

function imovel(id: string, overrides: Partial<Property> = {}): Property {
  return {
    id,
    code: 'RLX-' + id,
    title: 'Imovel ' + id,
    type: 'HOUSE',
    purpose: 'SALE',
    status: 'AVAILABLE',
    agencyId: 'a1',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    virtualTour: null,
    ...overrides,
  };
}

describe('HomePage', () => {
  let harness: RouterTestingHarness;
  let component: HomePage;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        // Rota de verdade, e nao um ActivatedRoute falso: o assunto destes
        // testes e' justamente a URL mandando nos criterios.
        provideRouter([
          { path: 'home', component: HomePage },
          // O `RouterTestingHarness.create()` navega para `/` antes de
          // qualquer teste; sem uma rota que case, ele rejeita com NG04002.
          { path: '', children: [] },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });

    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  // `ignoreCancelled` porque o `switchMap` cancela a requisicao anterior de
  // proposito — e' contrato, nao vazamento.
  afterEach(() => http.verify({ ignoreCancelled: true }));

  /** Abre a home na URL dada e devolve a requisicao pendente. */
  async function abrir(url = '/home'): Promise<TestRequest> {
    component = await harness.navigateByUrl(url, HomePage);
    harness.detectChanges();
    return http.expectOne((r) => r.url.endsWith('/properties'));
  }

  /** Navega para outra URL da mesma rota e devolve a requisicao pendente. */
  async function refiltrar(url: string): Promise<TestRequest> {
    await harness.navigateByUrl(url);
    harness.detectChanges();
    return http.expectOne((r) => r.url.endsWith('/properties'));
  }

  function responder(req: TestRequest, data: Property[]): void {
    req.flush({ data, total: data.length, page: 1, limit: 100, pages: 1 });
    harness.detectChanges();
  }

  function falhar(req: TestRequest): void {
    req.flush(
      { statusCode: 500, message: 'boom' },
      { status: 500, statusText: 'Server Error' },
    );
    harness.detectChanges();
  }

  function el(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function texto(): string {
    return el().textContent ?? '';
  }

  function moldura() {
    return {
      busca: el().querySelector('ion-searchbar') !== null,
      filtros: el().querySelector('app-property-filters-bar') !== null,
      fab: el().querySelector('ion-fab') !== null,
    };
  }

  it('a primeira carga ocupa a tela', async () => {
    const req = await abrir();
    expect(component.view()).toBe('loading');
    expect(texto()).toContain('HOME.LOADING');
    responder(req, []);
  });

  it('falha mostra erro, nao onboarding', async () => {
    falhar(await abrir());
    expect(component.view()).toBe('error');
    expect(texto()).toContain('HOME.ERROR_TEXT');
    expect(texto()).not.toContain('HOME.EMPTY_TITLE');
  });

  it('conta sem imoveis mostra o onboarding', async () => {
    responder(await abrir(), []);
    expect(component.view()).toBe('empty');
    expect(texto()).toContain('HOME.EMPTY_TITLE');
  });

  // Com o servidor filtrando, conta vazia e busca sem resultado chegam iguais:
  // zero imoveis. O que separa as duas e' ter havido criterio.
  it('zero resultados com filtro e "sem resultado", nao onboarding', async () => {
    responder(await abrir('/home?type=LAND'), []);
    expect(component.view()).toBe('no-results');
    expect(texto()).toContain('HOME.FILTERS.NO_RESULTS_FILTERS');
    expect(texto()).toContain('HOME.FILTERS.CLEAR');
    expect(texto()).not.toContain('HOME.EMPTY_TITLE');
  });

  it('zero resultados so com texto usa a mensagem com o termo', async () => {
    responder(await abrir('/home?q=zzz'), []);
    expect(component.view()).toBe('no-results');
    expect(texto()).toContain('HOME.NO_RESULTS');
    expect(texto()).not.toContain('HOME.FILTERS.NO_RESULTS_FILTERS');
  });

  it('os criterios da URL viram parametros da requisicao', async () => {
    const req = await abrir('/home?type=APARTMENT&purpose=RENT&location=Centro&q=cobertura');

    expect(req.request.params.get('type')).toBe('APARTMENT');
    expect(req.request.params.get('purpose')).toBe('RENT');
    expect(req.request.params.get('location')).toBe('Centro');
    // `q` na URL vira `search` na API.
    expect(req.request.params.get('search')).toBe('cobertura');

    responder(req, [imovel('1')]);
  });

  // Um link colado com valor fora do enum faria a API devolver 400, e a home
  // mostraria erro de servidor por causa de um erro de digitacao.
  it('valor invalido na URL nao chega na API', async () => {
    const req = await abrir('/home?type=CASTELO');
    expect(req.request.params.get('type')).toBeNull();
    responder(req, [imovel('1')]);
  });

  it('mudar filtro dispara uma requisicao, e uma so', async () => {
    responder(await abrir(), [imovel('1')]);
    const req = await refiltrar('/home?type=HOUSE');
    expect(req.request.params.get('type')).toBe('HOUSE');
    responder(req, [imovel('1')]);
  });

  // A moldura sobrevive a refiltragem — senao mexer num filtro faria a barra
  // sumir, e digitar na busca destruiria o campo em foco no meio da digitacao.
  it('a moldura fica de pe enquanto refiltra', async () => {
    responder(await abrir(), [imovel('1')]);
    expect(moldura()).toEqual({ busca: true, filtros: true, fab: true });

    const req = await refiltrar('/home?type=HOUSE');

    expect(component.view()).toBe('list');
    expect(component.refiltrando()).toBeTrue();
    expect(moldura()).toEqual({ busca: true, filtros: true, fab: true });
    expect(el().querySelector('ion-progress-bar')).not.toBeNull();

    responder(req, [imovel('1')]);
    expect(component.refiltrando()).toBeFalse();
    expect(el().querySelector('ion-progress-bar')).toBeNull();
  });

  it('busca, filtros e FAB somem em carregando e em erro', async () => {
    const req = await abrir();
    expect(component.view()).toBe('loading');
    expect(moldura()).toEqual({ busca: false, filtros: false, fab: false });

    falhar(req);

    expect(component.view()).toBe('error');
    expect(moldura()).toEqual({ busca: false, filtros: false, fab: false });
  });

  // A faixa fala do acervo. Com o servidor filtrando, `properties()` e' a
  // pagina filtrada, e a mesma frase passaria a falar do resultado da busca.
  it('a faixa de "sem tour" some com criterio ativo', async () => {
    responder(await abrir(), [imovel('1'), imovel('2')]);
    expect(component.mostrarFaixa()).toBeTrue();

    responder(await refiltrar('/home?type=HOUSE'), [imovel('1'), imovel('2')]);
    expect(component.view()).toBe('list');
    expect(component.mostrarFaixa()).toBeFalse();
  });

  it('a faixa tambem some so com texto de busca', async () => {
    responder(await abrir('/home?q=imovel'), [imovel('1'), imovel('2')]);
    expect(component.mostrarFaixa()).toBeFalse();
  });

  it('um imovel com tour ja derruba a faixa', async () => {
    responder(await abrir(), [
      imovel('1', { virtualTour: { id: 't1', status: 'DRAFT' } }),
      imovel('2'),
    ]);
    expect(component.mostrarFaixa()).toBeFalse();
  });

  it('a busca mostra o texto que veio da URL', async () => {
    responder(await abrir('/home?q=cobertura'), [imovel('1')]);
    const busca = el().querySelector('ion-searchbar') as HTMLElement & {
      value?: string | null;
    };
    expect(busca.value).toBe('cobertura');
  });

  // "Limpar filtros" limpa filtros. O texto tem caixa propria, visivel.
  it('limpar filtros mantem o texto da busca', async () => {
    responder(await abrir('/home?type=LAND&q=abc'), [imovel('1')]);

    component.limpar();
    await harness.fixture.whenStable();
    harness.detectChanges();

    const url = TestBed.inject(Router).url;
    expect(url).not.toContain('type=');
    expect(url).toContain('q=abc');

    responder(http.expectOne((r) => r.url.endsWith('/properties')), [imovel('1')]);
  });

  it('remover um chip tira so aquele filtro da URL', async () => {
    responder(await abrir('/home?type=LAND&purpose=SALE'), [imovel('1')]);

    component.removerChip('type');
    await harness.fixture.whenStable();
    harness.detectChanges();

    const url = TestBed.inject(Router).url;
    expect(url).not.toContain('type=');
    expect(url).toContain('purpose=SALE');

    responder(http.expectOne((r) => r.url.endsWith('/properties')), [imovel('1')]);
  });

  it('tentar de novo refaz a chamada com os mesmos criterios', async () => {
    falhar(await abrir('/home?type=HOUSE'));

    component.carregar();
    harness.detectChanges();

    const req = http.expectOne((r) => r.url.endsWith('/properties'));
    expect(req.request.params.get('type')).toBe('HOUSE');
    responder(req, [imovel('1')]);
    expect(component.view()).toBe('list');
  });

  // O que o `switchMap` compra: sem ele, a resposta lenta do criterio antigo
  // chega por ultimo e sobrescreve a tela com o resultado errado.
  it('resposta de criterio antigo nao sobrescreve a nova', async () => {
    responder(await abrir(), [imovel('1')]);

    await harness.navigateByUrl('/home?type=HOUSE');
    harness.detectChanges();
    await harness.navigateByUrl('/home?type=APARTMENT');
    harness.detectChanges();

    const pendentes = http.match((r) => r.url.endsWith('/properties'));
    expect(pendentes.length).toBe(2);
    expect(pendentes[0].cancelled).toBeTrue();

    pendentes[1].flush({ data: [imovel('9')], total: 1, page: 1, limit: 100, pages: 1 });
    harness.detectChanges();

    expect(component.properties().map((p) => p.id)).toEqual(['9']);
  });
});
```

- [ ] **Step 9: Rodar o spec da home**

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/home.page.spec.ts'`
Expected: PASS, 18 testes.

Se "resposta de criterio antigo nao sobrescreve a nova" acusar `pendentes.length` diferente de 2, verifique se o `distinctUntilChanged` não está engolindo a segunda navegação — os dois `type` são diferentes, então ele não deveria.

- [ ] **Step 10: Provar que o `distinctUntilChanged` é carga viva**

Comente a linha do `distinctUntilChanged` no `home.page.ts` e rode a suíte de novo.

Run: `npm test -- --watch=false --browsers=ChromeHeadless --include='**/home.page.spec.ts'`
Expected: se TODOS continuarem passando, o `distinctUntilChanged` não está sendo provado por nada — nesse caso ele é defesa contra um comportamento que os testes não alcançam. Registre isso no corpo do commit em vez de fingir cobertura. Descomente antes de seguir.

- [ ] **Step 11: Suíte inteira do cliente**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS. Outros specs importam `home.page` indiretamente; um erro de compilação aparece aqui.

- [ ] **Step 12: Converter os arquivos tocados para CRLF e commitar**

```bash
git add inner-view-client/src/app/home
git commit -m "feat(client): a home filtra imoveis no servidor pelos criterios da URL"
```

---

## Task 12: Verificação final

**Files:** nenhum — é conferência.

- [ ] **Step 1: Lint do cliente**

Run (em `inner-view-client/`): `npm run lint`
Expected: PASS. O `checa-crases.js` roda antes do ESLint.

- [ ] **Step 2: Suíte completa dos dois lados**

Run (em `inner-view-client/`): `npm test -- --watch=false --browsers=ChromeHeadless`
Run (em `server-api/`): `yarn test:local`
Expected: PASS nos dois.

- [ ] **Step 3: Conferir que nenhum arquivo virou LF**

```bash
git log --stat -12 --oneline
python -c "
import io, subprocess
saida = subprocess.check_output(['git','ls-files','inner-view-client/src/app/home','inner-view-client/src/app/components/property-filters-bar','inner-view-client/src/app/components/property-filters-form','inner-view-client/src/app/components/property-filters-sheet','inner-view-client/src/app/components/active-filter-chips'], text=True)
for caminho in saida.split():
    b = io.open(caminho,'rb').read()
    lf = b.count(b'\n') - b.count(b'\r\n')
    if lf:
        print('LF solto em', caminho, '->', lf)
print('conferencia terminada')
"
```

Expected: `conferencia terminada` sem nenhuma linha de "LF solto".

- [ ] **Step 4: Conferência em navegador de verdade**

Suba a API e o cliente, entre com uma conta que tenha imóveis, e confira à mão o que teste de unidade não alcança:

1. **Caret na busca.** Digite devagar no campo de busca uma frase de dez caracteres. O cursor deve ficar onde você o deixou — é o risco registrado na spec: a URL passa a reescrever `[value]` enquanto a pessoa digita.
2. **Caret na localização.** O mesmo no campo de localização, dentro da barra.
3. **Compartilhar.** Aplique tipo + finalidade + localização, copie a URL, abra numa aba nova. Os três controles devem voltar preenchidos e a lista, igual.
4. **Voltar do imóvel.** Com filtros aplicados, abra um imóvel e volte pelo botão do navegador. Os filtros continuam.
5. **Voltar não desfaz filtro.** Mexa em três filtros seguidos e aperte voltar uma vez: deve sair da home, não desfazer um filtro.
6. **Mobile.** Em viewport de telefone, o botão "Filtros (N)" abre o sheet; mexer num controle lá dentro refiltra a lista atrás; "Ver resultados" só fecha; os chips aparecem fora do sheet. Nada corta na horizontal.
7. **Esc e foco.** Abra o sheet, aperte Esc: fecha e o foco volta para o botão.
8. **Traduções.** Todos os rótulos aparecem em português — nenhuma chave crua tipo `HOME.FILTERS.TOGGLE` na tela. Isto é o que a suíte estruturalmente NÃO prova, porque o harness de teste devolve a chave.

- [ ] **Step 5: Commit final, se algo mudou**

```bash
git add -A
git commit -m "fix(client): ajustes da conferencia em navegador dos filtros da home"
```

---

## Nota de PR

O corpo do PR precisa dizer, em uma linha, que **`GET /properties` mudou comportamento**: filtrar por `SALE` ou `RENT` agora traz também os imóveis marcados `SALE_OR_RENT`. É correção, não quebra — nenhum consumidor passa a receber menos do que o correto —, mas é mudança observável num endpoint que já está no ar.

E que este ticket toca `server-api/` e `inner-view-client/` ao mesmo tempo, quebrando a fronteira que os sprints anteriores respeitavam. A decisão de filtrar no servidor não tem como ser só de um lado.
