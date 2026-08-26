# Rascunho retomável — Plano de Implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Goal:** Persistir o último quilômetro do wizard (nome do cômodo, hotspots, dados do imóvel) no servidor conforme o corretor trabalha, e construir o caminho de volta ao rascunho a partir de uma faixa na home.

**Architecture:** O miolo do `publish()` — que já reconcilia nome, ordem, capa, hotspots e imóvel — é extraído para `salvarRascunho()` e passa a ser chamado ao sair do wizard, ao trocar de etapa e quando o app vai para segundo plano. Nenhuma rota de escrita nova: `PATCH /panoramas/:id`, `PATCH /properties/:id` e o CRUD de `/hotspots` já existem. Duas rotas de leitura novas cobrem listar e reidratar, porque a listagem de imóveis esconde DRAFT de propósito e `GET /virtual-tours/:id` é rota pública que filtra `PUBLISHED`.

**Tech Stack:** NestJS + Prisma + PostgreSQL (server-api); Angular 19 standalone + Ionic + signals (inner-view-client); Jest + Postgres real no servidor; Karma + Jasmine no cliente.

**Spec:** [`docs/superpowers/specs/2026-08-26-rascunho-retomavel-design.md`](../specs/2026-08-26-rascunho-retomavel-design.md)

## Global Constraints

- **`tour-wizard.model.ts` é CONGELADO** (SPRINT-3-TOUR-WIZARD.md §4.2): mudança só por PR para `feature/tour-wizard`, com as duas frentes cientes. A Tarefa 3 é essa mudança e deve virar PR próprio.
- **Nunca rodar `yarn lint` no `server-api`.** O script tem `--fix` embutido e reescreve o repositório inteiro. Para conferir: `npx eslint <arquivos>` sem a flag.
- **Cliente é Karma + Jasmine, não Jest.** Mock por `spyOn` no serviço injetado devolvendo `of(...)`. Nunca `HttpTestingController.expectOne`.
- **Servidor: services instanciados à mão**, sem `Test.createTestingModule`. Padrão em `test/rascunho-de-captura.spec.ts`.
- **Nenhuma coluna de imagem em resposta JSON.** `imageData` e `treatedImageData` são TOAST de dezenas de MB; foi o que fez o tour mais pesado sair com 58,4 MB. Imagem sempre por URL.
- **Rota autenticada não é carregável pelo `TextureLoader`** — ele não passa por interceptor. Caminho obrigatório: `HttpClient` → `blob:` → viewer.
- **Comentários em português**, explicando o *porquê* e não o *quê*, no padrão do repositório.
- Branch base: `feat/rascunho-retomavel`.

---

## Estrutura de arquivos

**Servidor — criar**
| Arquivo | Responsabilidade |
|---|---|
| `src/modules/virtual-tours/dto/list-draft-tours.dto.ts` | Valida `?status=DRAFT` |
| `src/modules/virtual-tours/services/list-draft-tours.service.ts` | Lista rascunhos da agência |
| `src/modules/virtual-tours/controllers/list-draft-tours.controller.ts` | `GET /virtual-tours` |
| `src/modules/virtual-tours/services/find-draft-tour.service.ts` | Lê um rascunho para reidratar |
| `src/modules/virtual-tours/controllers/find-draft-tour.controller.ts` | `GET /virtual-tours/:id/rascunho` |
| `test/rascunho-retomavel.spec.ts` | Casos do servidor |

**Servidor — modificar**
| Arquivo | Mudança |
|---|---|
| `src/modules/virtual-tours/virtual-tours.module.ts` | Registrar os dois controllers e services |
| `scripts/limpar-rascunhos.ts` | `DIAS_PADRAO` 7 → 30 |

**Cliente — criar**
| Arquivo | Responsabilidade |
|---|---|
| `src/app/services/panorama-image-cache.service.ts` | Baixa imagem autenticada e devolve `blob:`; dono dos blobs |
| `src/app/services/panorama-image-cache.service.spec.ts` | Casos do cache |
| `src/app/home/rascunhos-band/rascunhos-band.component.ts` | Faixa "Capturas em andamento" |
| `src/app/home/rascunhos-band/rascunhos-band.component.scss` | Estilo da faixa |
| `src/app/home/rascunhos-band/rascunhos-band.component.spec.ts` | Casos da faixa |

**Cliente — modificar**
| Arquivo | Mudança |
|---|---|
| `src/app/tour-wizard/tour-wizard.model.ts` | `serverHotspotId`, doc de `imageData` (CONGELADO) |
| `src/app/services/virtual-tour.service.ts` | `listarRascunhos`, `lerRascunho`, `atualizarHotspot` |
| `src/app/tour-wizard/tour-draft.store.ts` | `salvarRascunho`, `retomarRascunho`, `descartarRascunho`, `garantirImagem`, reconciliação de hotspot |
| `src/app/tour-wizard/steps/step-hotspots/step-hotspots.component.ts` | Pedir a foto de cena retomada |
| `src/app/tour-wizard/ui/scene-card/scene-card.component.*` | Miniatura de cena sem `imageData` |
| `src/app/tour-wizard/tour-wizard.page.ts/.html` | Diálogo do voltar, salvamento automático |
| `src/app/home/home.page.ts/.html` | Encaixar a faixa |
| `src/assets/i18n/pt.json`, `en.json` | Chaves novas |

> **i18n:** as chaves têm ordem narrativa, não alfabética. **Inserir depois da chave âncora indicada em cada tarefa** — nunca reordenar o arquivo.

---

### Task 1: Servidor — listar rascunhos

**Files:**
- Create: `server-api/src/modules/virtual-tours/dto/list-draft-tours.dto.ts`
- Create: `server-api/src/modules/virtual-tours/services/list-draft-tours.service.ts`
- Create: `server-api/src/modules/virtual-tours/controllers/list-draft-tours.controller.ts`
- Create: `server-api/test/rascunho-retomavel.spec.ts`
- Modify: `server-api/src/modules/virtual-tours/virtual-tours.module.ts`

**Interfaces:**
- Produces: `ListDraftToursService.execute(currentUser: JwtPayload): Promise<RascunhoResumo[]>` onde `RascunhoResumo = { id: string; propertyId: string; updatedAt: Date; ambientes: number; capaPanoramaId: string | null }`
- Consumes: `seedTwoTenants()`, `TwoTenants` de `test/fixtures.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server-api/test/rascunho-retomavel.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { CreateVirtualTourService } from '../src/modules/virtual-tours/services/create-virtual-tour.service';
import { ListDraftToursService } from '../src/modules/virtual-tours/services/list-draft-tours.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

/**
 * O rascunho deixa de ser invisível e passa a ter caminho de volta.
 *
 * Até aqui ele existia só para a montagem por IA poder rodar durante a
 * captura, e ninguém o lia de propósito. Estes casos cobrem as duas leituras
 * novas — a lista da faixa da home e a releitura para reidratar o wizard — e
 * o que elas não podem fazer: vazar rascunho de outra imobiliária, e trazer
 * coluna de imagem no JSON.
 */

const asPrismaService = prisma as unknown as PrismaService;
const criarTour = new CreateVirtualTourService(asPrismaService);
const listarRascunhos = new ListDraftToursService(asPrismaService);

describe('rascunho retomável', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  describe('listagem', () => {
    it('traz o rascunho da própria agência, com contagem de ambientes e capa', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );
      const capa = await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Ambiente 1',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 0,
          initialPanorama: true,
        },
        select: { id: true },
      });
      await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Ambiente 2',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 1,
          initialPanorama: false,
        },
      });

      const lista = await listarRascunhos.execute(tenants.a.admin);

      expect(lista).toHaveLength(1);
      expect(lista[0].id).toBe(tour!.id);
      expect(lista[0].ambientes).toBe(2);
      expect(lista[0].capaPanoramaId).toBe(capa.id);
    });

    it('não traz tour publicado', async () => {
      await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'PUBLISHED', panoramas: [] },
        tenants.a.admin,
      );

      expect(await listarRascunhos.execute(tenants.a.admin)).toEqual([]);
    });

    it('não vaza rascunho de outra imobiliária', async () => {
      await criarTour.execute(
        { propertyId: tenants.b.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.b.admin,
      );

      expect(await listarRascunhos.execute(tenants.a.admin)).toEqual([]);
    });

    it('devolve capa nula quando o rascunho ainda não tem cômodo nenhum', async () => {
      // É o estado entre `garantirRascunho()` e a primeira captura terminar.
      // A faixa da home precisa saber desenhar isso sem miniatura.
      await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );

      const lista = await listarRascunhos.execute(tenants.a.admin);

      expect(lista[0].ambientes).toBe(0);
      expect(lista[0].capaPanoramaId).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd server-api && yarn test:local rascunho-retomavel`
Expected: FAIL — `Cannot find module '../src/modules/virtual-tours/services/list-draft-tours.service'`

- [ ] **Step 3: Escrever o service**

Criar `server-api/src/modules/virtual-tours/services/list-draft-tours.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';

export interface RascunhoResumo {
  id: string;
  propertyId: string;
  updatedAt: Date;
  ambientes: number;
  /** Primeiro cômodo, para a miniatura. Nulo enquanto nenhum terminou. */
  capaPanoramaId: string | null;
}

/**
 * As capturas em andamento da imobiliária de quem pediu.
 *
 * Existe porque a listagem de imóveis esconde DRAFT de propósito — imóvel de
 * rascunho não tem título nem endereço e apareceria no lugar mais visível do
 * sistema como uma linha vazia. Esconder ali é certo; o que faltava era um
 * lugar onde o rascunho fosse o assunto, e não ruído.
 */
@Injectable()
export class ListDraftToursService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(currentUser: JwtPayload): Promise<RascunhoResumo[]> {
    const rascunhos = await this.prisma.virtualTour.findMany({
      where: {
        status: 'DRAFT',
        property: { agencyId: currentUser.agencyId },
      },
      // Mais recente primeiro: quem tem dois rascunhos quase sempre quer o
      // último. `updatedAt` e não `createdAt` porque uma captura retomada
      // ontem é mais relevante que uma começada hoje de manhã e abandonada.
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        propertyId: true,
        updatedAt: true,
        _count: { select: { panoramas: true } },
        // Nenhuma coluna de imagem: a miniatura vem por URL, do
        // `/panoramas/:id/preview?w=320`. Trazer base64 aqui carregaria
        // dezenas de MB para desenhar um card de 320px.
        panoramas: {
          orderBy: { order: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
    });

    return rascunhos.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      updatedAt: r.updatedAt,
      ambientes: r._count.panoramas,
      capaPanoramaId: r.panoramas[0]?.id ?? null,
    }));
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd server-api && yarn test:local rascunho-retomavel`
Expected: PASS — 4 casos

- [ ] **Step 5: Escrever o DTO e o controller**

Criar `server-api/src/modules/virtual-tours/dto/list-draft-tours.dto.ts`:

```ts
import { z } from 'zod';

export const ListDraftToursSchema = z.object({
  // Obrigatório, e só DRAFT por enquanto. `GET /virtual-tours` sem filtro
  // devolveria o catálogo inteiro por uma rota que ninguém pediu para isso —
  // e a listagem de imóveis, que já faz esse trabalho, tem paginação e filtros
  // que esta não tem.
  status: z.literal('DRAFT'),
});

export type ListDraftToursDto = z.infer<typeof ListDraftToursSchema>;
```

Criar `server-api/src/modules/virtual-tours/controllers/list-draft-tours.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { ListDraftToursSchema } from '../dto/list-draft-tours.dto';
import { ListDraftToursService } from '../services/list-draft-tours.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class ListDraftToursController {
  constructor(private readonly service: ListDraftToursService) {}

  // `@Get()` sem parâmetro DE PROPÓSITO. `GET /virtual-tours/rascunhos` seria
  // capturado pelo `@Get(':id')` do FindVirtualTourController dependendo da
  // ordem de registro dos controllers — uma armadilha que não quebra na
  // compilação e só aparece em runtime, como 404 de tour inexistente.
  @Get()
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Capturas em andamento da imobiliária' })
  @ApiQuery({ name: 'status', required: true, description: 'DRAFT' })
  list(
    @Query(new ZodValidationPipe(ListDraftToursSchema)) _query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(user);
  }
}
```

- [ ] **Step 6: Registrar no módulo**

Em `server-api/src/modules/virtual-tours/virtual-tours.module.ts`, acrescentar o import, e a entrada em `controllers` e em `providers`:

```ts
import { ListDraftToursController } from './controllers/list-draft-tours.controller';
import { ListDraftToursService } from './services/list-draft-tours.service';
```

`controllers`: acrescentar `ListDraftToursController` **antes** de `FindVirtualTourController`.
`providers`: acrescentar `ListDraftToursService`.

- [ ] **Step 7: Confirmar que a rota não colidiu**

Run: `cd server-api && npx nest build && node -e "1"` e depois subir a API e conferir no log de rotas que aparecem **as duas**: `GET /virtual-tours` e `GET /virtual-tours/:id`.

Run: `cd server-api && node --enable-source-maps dist/src/main 2>&1 | grep -E "virtual-tours(\}|/:id)" | head`
Expected: as duas linhas presentes.

- [ ] **Step 8: Lint e commit**

```bash
cd server-api && npx eslint src/modules/virtual-tours/dto/list-draft-tours.dto.ts src/modules/virtual-tours/services/list-draft-tours.service.ts src/modules/virtual-tours/controllers/list-draft-tours.controller.ts
git add server-api/src/modules/virtual-tours server-api/test/rascunho-retomavel.spec.ts
git commit -m "feat(api): listar capturas em andamento da imobiliária"
```

---

### Task 2: Servidor — ler um rascunho, e janela do sweeper

**Files:**
- Create: `server-api/src/modules/virtual-tours/services/find-draft-tour.service.ts`
- Create: `server-api/src/modules/virtual-tours/controllers/find-draft-tour.controller.ts`
- Modify: `server-api/test/rascunho-retomavel.spec.ts`
- Modify: `server-api/src/modules/virtual-tours/virtual-tours.module.ts`
- Modify: `server-api/scripts/limpar-rascunhos.ts:21`

**Interfaces:**
- Consumes: `seedTwoTenants()`, `CreateVirtualTourService`
- Produces: `FindDraftTourService.execute(id: string, currentUser: JwtPayload): Promise<RascunhoCompleto>` com
  ```ts
  interface RascunhoCompleto {
    id: string; propertyId: string; status: string; updatedAt: Date;
    property: { title: string; type: string; purpose: string; address: EnderecoDoRascunho | null };
    panoramas: Array<{
      id: string; roomName: string; order: number; initialPanorama: boolean;
      treatmentStatus: string;
      hotspots: Array<{ id: string; label: string | null; positionX: number; positionY: number; targetId: string }>;
    }>;
  }
  ```

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `server-api/test/rascunho-retomavel.spec.ts`, **dentro do `describe('rascunho retomável')`**, depois do `describe('listagem')`:

```ts
  describe('leitura para reidratar', () => {
    it('serve o rascunho da própria agência, com cômodos e hotspots', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );
      const sala = await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Sala',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 0,
          initialPanorama: true,
        },
        select: { id: true },
      });
      const quarto = await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Quarto',
          imageData: 'data:image/jpeg;base64,SGk=',
          order: 1,
          initialPanorama: false,
        },
        select: { id: true },
      });
      await prisma.hotspot.create({
        data: {
          originId: sala.id,
          targetId: quarto.id,
          label: 'Ir ao quarto',
          positionX: 0.25,
          positionY: 0.5,
        },
      });

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);

      expect(rascunho.panoramas.map((p) => p.roomName)).toEqual(['Sala', 'Quarto']);
      expect(rascunho.panoramas[0].hotspots).toHaveLength(1);
      expect(rascunho.panoramas[0].hotspots[0].targetId).toBe(quarto.id);
      expect(rascunho.panoramas[0].hotspots[0].positionX).toBe(0.25);
    });

    it('devolve os dados do imóvel para a etapa 3', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);

      expect(rascunho.propertyId).toBe(tenants.a.propertyId);
      expect(typeof rascunho.property.title).toBe('string');
    });

    it('não traz coluna de imagem nenhuma', async () => {
      // A equirect é TOAST de dezenas de MB. Foi ela que fez o tour mais
      // pesado sair com 58,4 MB de JSON, e reidratar não precisa dela: a
      // imagem vem por URL, sob demanda, e só a do cômodo que está à vista.
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.a.admin,
      );
      await prisma.panorama.create({
        data: {
          virtualTourId: tour!.id,
          roomName: 'Sala',
          imageData: 'data:image/jpeg;base64,SGk=',
          treatedImageData: 'data:image/jpeg;base64,VHJhdGFkYQ==',
          order: 0,
          initialPanorama: true,
        },
      });

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);

      const json = JSON.stringify(rascunho);
      expect(json).not.toContain('SGk=');
      expect(json).not.toContain('VHJhdGFkYQ==');
    });

    it('nega o rascunho de outra imobiliária com 404, sem confirmar o id', async () => {
      const tour = await criarTour.execute(
        { propertyId: tenants.b.propertyId, status: 'DRAFT', panoramas: [] },
        tenants.b.admin,
      );

      await expect(
        lerRascunho.execute(tour!.id, tenants.a.admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('serve também o tour já publicado, para o caso de retomar depois de publicar', async () => {
      // Sem filtro de status de propósito: a autorização aqui vem do token e
      // do escopo por agência, como no `/preview`. Filtrar status seria
      // repetir a defesa da rota pública numa rota que não é pública.
      const tour = await criarTour.execute(
        { propertyId: tenants.a.propertyId, status: 'PUBLISHED', panoramas: [] },
        tenants.a.admin,
      );

      const rascunho = await lerRascunho.execute(tour!.id, tenants.a.admin);

      expect(rascunho.status).toBe('PUBLISHED');
    });
  });
```

E no topo do arquivo, junto das outras instâncias:

```ts
import { FindDraftTourService } from '../src/modules/virtual-tours/services/find-draft-tour.service';

const lerRascunho = new FindDraftTourService(asPrismaService);
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd server-api && yarn test:local rascunho-retomavel`
Expected: FAIL — `Cannot find module '../src/modules/virtual-tours/services/find-draft-tour.service'`

- [ ] **Step 3: Escrever o service**

Criar `server-api/src/modules/virtual-tours/services/find-draft-tour.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/**
 * O tour inteiro para quem vai voltar a editá-lo.
 *
 * Existe separado do `FindVirtualTourService` pela mesma razão que o
 * `/panoramas/:id/preview` existe separado do `/image`: aquela rota é pública,
 * e por isso filtra `PUBLISHED` — sem o filtro, qualquer um com um uuid leria
 * o rascunho de qualquer imobiliária. Aqui a autorização vem do token e do
 * escopo por agência, e o status deixa de importar.
 *
 * Nenhuma coluna de imagem, pelo mesmo motivo daquela consulta: elas são TOAST
 * de dezenas de MB e o wizard só precisa da foto do cômodo que está à vista.
 */
@Injectable()
export class FindDraftTourService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const tour = await this.prisma.virtualTour.findFirst({
      where: { id, property: { agencyId: currentUser.agencyId } },
      select: {
        id: true,
        propertyId: true,
        status: true,
        updatedAt: true,
        property: {
          select: {
            title: true,
            type: true,
            purpose: true,
            address: {
              select: {
                street: true,
                number: true,
                complement: true,
                district: true,
                city: true,
                state: true,
                zipCode: true,
              },
            },
          },
        },
        panoramas: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            roomName: true,
            order: true,
            initialPanorama: true,
            treatmentStatus: true,
            originHotspots: {
              select: {
                id: true,
                label: true,
                positionX: true,
                positionY: true,
                targetId: true,
              },
            },
          },
        },
      },
    });
    // 404 e não 403: 403 confirmaria que o id existe em outra imobiliária.
    if (!tour) throw new NotFoundException('Virtual tour not found');

    return {
      ...tour,
      panoramas: tour.panoramas.map(({ originHotspots, ...panorama }) => ({
        ...panorama,
        hotspots: originHotspots,
      })),
    };
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd server-api && yarn test:local rascunho-retomavel`
Expected: PASS — 9 casos

- [ ] **Step 5: Escrever o controller**

Criar `server-api/src/modules/virtual-tours/controllers/find-draft-tour.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { FindDraftTourService } from '../services/find-draft-tour.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class FindDraftTourController {
  constructor(private readonly service: FindDraftTourService) {}

  @Get(':id/rascunho')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Tour completo para reidratar o wizard, inclusive em rascunho',
  })
  findDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(id, user);
  }
}
```

- [ ] **Step 6: Registrar no módulo e subir a janela do sweeper**

Em `virtual-tours.module.ts`: acrescentar `FindDraftTourController` em `controllers` e `FindDraftTourService` em `providers`, com os imports.

Em `server-api/scripts/limpar-rascunhos.ts`, trocar a linha 21 e o comentário acima dela:

```ts
// 30 dias, e não 7. Enquanto o rascunho era invisível, varrer cedo era higiene:
// ninguém sentia falta do que não sabia que existia. Agora ele aparece numa
// faixa na home, e o mesmo script passa a apagar o que o corretor acha que
// guardou — uma captura de sexta, retomada só depois das férias, cabe em 30.
const DIAS_PADRAO = 30;
```

E na linha de ajuda (linha 15), trocar `(padrão: 7)` por `(padrão: 30)`.

- [ ] **Step 7: Rodar a suíte inteira do servidor**

Run: `cd server-api && yarn test:local`
Expected: PASS — 66 casos anteriores + 9 novos = 75

- [ ] **Step 8: Lint e commit**

```bash
cd server-api && npx eslint src/modules/virtual-tours/services/find-draft-tour.service.ts src/modules/virtual-tours/controllers/find-draft-tour.controller.ts scripts/limpar-rascunhos.ts
git add server-api/
git commit -m "feat(api): ler rascunho para reidratar o wizard, e 30 dias no sweeper"
```

---

### Task 3: Modelo congelado — campos para a retomada

> **PR PRÓPRIO.** `tour-wizard.model.ts` é congelado (SPRINT-3-TOUR-WIZARD.md §4.2): PR para `feature/tour-wizard`, com as duas frentes cientes. **Não começar a Tarefa 4 antes deste PR estar alinhado.**

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.model.ts`

**Interfaces:**
- Produces: `WizardHotspot.serverHotspotId?: string`

- [ ] **Step 1: Acrescentar o id do servidor no hotspot**

Em `WizardHotspot`, depois do campo `id`, acrescentar:

```ts
  /**
   * Id do hotspot no servidor, quando ele já foi gravado.
   *
   * Existe para a reconciliação ser incremental. Antes, salvar apagava TODOS
   * os hotspots do tour e recriava — o que era aceitável rodando uma vez, no
   * publicar, e deixou de ser quando o salvamento passou a rodar a cada troca
   * de etapa: uma queda de rede dentro daquela janela devolvia o rascunho sem
   * os pontos que o corretor marcou.
   *
   * Ausente em ponto recém-criado e em cena que nunca foi salva.
   */
  serverHotspotId?: string;
```

E corrigir o comentário do campo `id` logo acima, que hoje afirma o contrário:

```ts
  /** uuid local. Vira o `tempId` do payload no publicar. */
```
vira
```ts
  /** uuid local. Nunca é o id do servidor — esse é o `serverHotspotId`. */
```

- [ ] **Step 2: Documentar o estado novo de `imageData`**

Em `WizardScene`, substituir o comentário do campo `imageData`:

```ts
  /** dataURL — mesmo formato que `PanoramaUpload.imageData` espera. */
  imageData: string;
```
por
```ts
  /**
   * dataURL — mesmo formato que `PanoramaUpload.imageData` espera.
   *
   * **Vazio numa cena retomada**, até alguém precisar da foto. O rascunho lido
   * do servidor traz os cômodos sem imagem de propósito: a equirect é TOAST de
   * dezenas de MB e reidratar seis deles no 4G, antes de mostrar qualquer
   * coisa, seria pior do que não retomar. A foto chega por URL, sob demanda,
   * pelo `PanoramaImageCache`.
   *
   * Logo: `imageData` vazio **e** `serverPanoramaId` presente é uma cena
   * íntegra, não uma cena quebrada. Quem consumir este campo precisa dos dois
   * para decidir.
   */
  imageData: string;
```

- [ ] **Step 3: Corrigir a afirmação envelhecida do cabeçalho**

O cabeçalho diz "Nada aqui é o que o servidor guarda". Isso deixou de ser verdade quando `serverPanoramaId` entrou. Trocar por:

```ts
 * Quase nada aqui é o que o servidor guarda: estes tipos existem enquanto o
 * corretor preenche o wizard. As exceções são os campos `server*Id`, que são a
 * ponte entre o rascunho em memória e as linhas que já subiram — sem eles não
 * há como retomar uma captura nem reconciliar o que mudou.
```

- [ ] **Step 4: Compilar**

Run: `cd inner-view-client && npx tsc --noEmit -p tsconfig.app.json`
Expected: sem erro — os dois campos são opcionais e nada existente quebra.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-wizard.model.ts
git commit -m "feat(wizard): serverHotspotId e cena retomada sem imageData

CONGELADO (SPRINT-3-TOUR-WIZARD.md §4.2) — abrir PR para feature/tour-wizard."
```

---

### Task 4: Cliente — métodos novos no `VirtualTourService`

**Files:**
- Modify: `inner-view-client/src/app/services/virtual-tour.service.ts`
- Modify: `inner-view-client/src/app/services/virtual-tour.service.spec.ts`

**Interfaces:**
- Consumes: rotas das Tarefas 1 e 2
- Produces:
  ```ts
  listarRascunhos(): Observable<RascunhoResumo[]>
  lerRascunho(tourId: string): Observable<RascunhoCompleto>
  atualizarHotspot(id: string, dto: { positionX: number; positionY: number; label?: string }): Observable<{ id: string }>
  ```
  com
  ```ts
  export interface RascunhoResumo {
    id: string; propertyId: string; updatedAt: string;
    ambientes: number; capaPanoramaId: string | null;
  }
  export interface RascunhoPanorama {
    id: string; roomName: string; order: number; initialPanorama: boolean;
    treatmentStatus: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'SKIPPED';
    hotspots: Array<{ id: string; label: string | null; positionX: number; positionY: number; targetId: string }>;
  }
  export interface RascunhoCompleto {
    id: string; propertyId: string; status: string; updatedAt: string;
    property: {
      title: string; type: string; purpose: string;
      address: { street: string; number: string | null; complement: string | null;
                 district: string | null; city: string; state: string; zipCode: string | null } | null;
    };
    panoramas: RascunhoPanorama[];
  }
  ```

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `inner-view-client/src/app/services/virtual-tour.service.spec.ts`:

```ts
  it('pede a lista de rascunhos com o filtro de status', () => {
    const http = TestBed.inject(HttpClient);
    const get = spyOn(http, 'get').and.returnValue(of([]));

    service.listarRascunhos().subscribe();

    expect(get).toHaveBeenCalledWith(
      `${environment.apiUrl}/virtual-tours`,
      { params: { status: 'DRAFT' } },
    );
  });

  it('lê o rascunho pela rota autenticada, e não pela pública', () => {
    // `GET /virtual-tours/:id` é sem guard e filtra PUBLISHED: usá-la para
    // retomar devolveria 404 em todo rascunho.
    const http = TestBed.inject(HttpClient);
    const get = spyOn(http, 'get').and.returnValue(of({}));

    service.lerRascunho('t1').subscribe();

    expect(get).toHaveBeenCalledWith(`${environment.apiUrl}/virtual-tours/t1/rascunho`);
  });

  it('move um hotspot com PATCH, sem apagar e recriar', () => {
    const http = TestBed.inject(HttpClient);
    const patch = spyOn(http, 'patch').and.returnValue(of({ id: 'h1' }));

    service.atualizarHotspot('h1', { positionX: 0.4, positionY: 0.6 }).subscribe();

    expect(patch).toHaveBeenCalledWith(
      `${environment.apiUrl}/hotspots/h1`,
      { positionX: 0.4, positionY: 0.6 },
    );
  });
```

> Se o spec não tiver ainda os imports de `HttpClient`, `of` e `environment`, acrescentá-los; e confirmar como `service` é construído no `beforeEach` existente, reaproveitando-o.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/virtual-tour.service.spec.ts"`
Expected: FAIL — `service.listarRascunhos is not a function`

- [ ] **Step 3: Implementar os três métodos**

Em `inner-view-client/src/app/services/virtual-tour.service.ts`, acrescentar as interfaces exportadas do bloco **Interfaces** acima, e os métodos — logo depois de `findTour`:

```ts
  /**
   * As capturas em andamento da imobiliária.
   *
   * Rota autenticada e sem paginação: rascunho é trabalho pela metade, não
   * catálogo. Quem tem uma dúzia deles tem outro problema, e a faixa da home
   * mostra os mais recentes primeiro.
   */
  listarRascunhos(): Observable<RascunhoResumo[]> {
    return this.http.get<RascunhoResumo[]>(`${environment.apiUrl}/virtual-tours`, {
      params: { status: 'DRAFT' },
    });
  }

  /**
   * O tour inteiro para reidratar o wizard.
   *
   * `/rascunho` e não `GET /virtual-tours/:id`: aquela é pública, filtra
   * `PUBLISHED`, e devolveria 404 em exatamente todo rascunho que esta função
   * existe para abrir.
   *
   * Não traz imagem. As fotos vêm depois, uma a uma, pelo `PanoramaImageCache`.
   */
  lerRascunho(tourId: string): Observable<RascunhoCompleto> {
    return this.http.get<RascunhoCompleto>(
      `${environment.apiUrl}/virtual-tours/${tourId}/rascunho`,
    );
  }

  /**
   * Move ou renomeia um hotspot que já existe no servidor.
   *
   * Existe para o salvamento não precisar apagar e recriar. Ver
   * `WizardHotspot.serverHotspotId`.
   */
  atualizarHotspot(
    id: string,
    dto: { positionX: number; positionY: number; label?: string },
  ): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(
      `${environment.apiUrl}/hotspots/${id}`,
      dto,
    );
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/virtual-tour.service.spec.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/services/virtual-tour.service.ts inner-view-client/src/app/services/virtual-tour.service.spec.ts
git commit -m "feat(client): listar e ler rascunho, e mover hotspot por PATCH"
```

---

### Task 5: Cliente — extrair `salvarRascunho()` de `publish()`

Refatoração pura: nenhum comportamento novo. O teste que a protege é o de que publicar continua funcionando igual.

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Interfaces:**
- Produces: `TourDraftStore.salvarRascunho(): Promise<void>` — reconcilia nome, ordem, capa, hotspots e imóvel no servidor. Lança em falha de rede; quem chama decide o que fazer.
- `publish()` passa a ser `await this.salvarRascunho()` seguido de `publicarTour(tourId)`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `tour-draft.store.spec.ts`:

```ts
  it('salvarRascunho grava nome, ordem e capa sem publicar', async () => {
    const store = criarStore();
    const patch = spyOn(store['virtualTourService'], 'atualizarPanorama')
      .and.returnValue(of({ id: 'p1' } as never));
    const publicar = spyOn(store['virtualTourService'], 'publicarTour')
      .and.returnValue(of({} as never));
    prepararRascunhoCom(store, [{ id: 's1', room: 'Sala', serverPanoramaId: 'p1' }]);

    await store.salvarRascunho();

    expect(patch).toHaveBeenCalledWith('p1', {
      roomName: 'Sala',
      order: 0,
      initialPanorama: true,
    });
    // O que separa salvar de publicar é exatamente esta linha.
    expect(publicar).not.toHaveBeenCalled();
  });

  it('publicar depois de salvar não duplica nada', async () => {
    const store = criarStore();
    const criarHotspot = spyOn(store['virtualTourService'], 'createHotspot')
      .and.returnValue(of({ id: 'h-srv' } as never));
    spyOn(store['virtualTourService'], 'atualizarPanorama')
      .and.returnValue(of({ id: 'p1' } as never));
    spyOn(store['virtualTourService'], 'publicarTour').and.returnValue(of({} as never));
    prepararRascunhoCom(store, [
      { id: 's1', room: 'Sala', serverPanoramaId: 'p1' },
      { id: 's2', room: 'Quarto', serverPanoramaId: 'p2' },
    ]);
    ligarHotspot(store, 's1', 's2');

    await store.salvarRascunho();
    await store.publish();

    // Um ponto marcado, um hotspot no servidor. O bug que isto protege
    // publicava cada ponto em dobro.
    expect(criarHotspot).toHaveBeenCalledTimes(1);
  });
```

E os helpers, no topo do `describe` — são usados pelas Tarefas 5 a 11:

```ts
  /**
   * Store com o TestBed já montado.
   *
   * Reaproveita o `TestBed.configureTestingModule` que o `beforeEach` deste
   * spec já faz; se ele não existir com `provideHttpClient()`, acrescentar.
   */
  function criarStore(): TourDraftStore {
    return TestBed.inject(TourDraftStore);
  }

  /**
   * Coloca o store no estado "rascunho já criado, com N cômodos".
   *
   * Preenche os ids do rascunho à mão em vez de deixar `garantirRascunho()`
   * criá-los: o que estes casos exercitam é o salvamento, e passar pela
   * criação obrigaria a mockar duas rotas a mais em cada um deles.
   */
  function prepararRascunhoCom(
    store: TourDraftStore,
    cenas: Array<Partial<WizardScene> & { id: string }>,
  ): void {
    store.rascunhoTourId.set('tour-1');
    store.rascunhoPropertyId.set('imovel-1');
    store.scenes.set(
      cenas.map((c, i) => ({
        id: c.id,
        room: c.room ?? '',
        fileName: c.fileName ?? `foto-${i}.jpg`,
        fileSize: 0,
        imageData: c.imageData ?? 'data:image/jpeg;base64,SGk=',
        order: i,
        hotspots: c.hotspots ?? [],
        state: 'ready',
        ...c,
      })) as WizardScene[],
    );
    store.selectedSceneId.set(cenas[0]?.id ?? null);
  }

  /** Liga `origem` a `destino` e devolve o id local do ponto criado. */
  function ligarHotspot(
    store: TourDraftStore,
    origemId: string,
    destinoId: string,
  ): string {
    const id = `h-${origemId}-${destinoId}`;
    store.patchScene(origemId, (s) => ({
      ...s,
      hotspots: [...s.hotspots, { id, u: 0.5, v: 0.5, label: '', target: destinoId }],
    }));
    return id;
  }

  /** Move o primeiro ponto de uma cena, como o arrasto do pin faz. */
  function moverHotspot(
    store: TourDraftStore,
    sceneId: string,
    pos: { u: number; v: number },
  ): void {
    store.patchScene(sceneId, (s) => ({
      ...s,
      hotspots: s.hotspots.map((h, i) => (i === 0 ? { ...h, ...pos } : h)),
    }));
  }

  /** Remove um ponto da tela, como o botão de apagar do editor faz. */
  function removerHotspot(
    store: TourDraftStore,
    sceneId: string,
    hotspotId: string,
  ): void {
    store.patchScene(sceneId, (s) => ({
      ...s,
      hotspots: s.hotspots.filter((h) => h.id !== hotspotId),
    }));
  }
```

> **Atenção ao `removerHotspot`:** ele descarta o ponto e, com ele, o `serverHotspotId`. É exatamente o caso que a Tarefa 7 resolve com a lista `hotspotsParaApagar` — o helper aqui imita a remoção real da UI, então a Tarefa 7 precisa ligar essa pilha **dentro do `removeHotspot` do store**, não neste helper. Se a UI remover por outro caminho, ajustar o helper para chamar o método real do store.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: FAIL — `store.salvarRascunho is not a function`

- [ ] **Step 3: Extrair o método**

Em `tour-draft.store.ts`, recortar de `publish()` tudo entre `const tourId = await this.garantirRascunho();` e a linha `await firstValueFrom(this.virtualTourService.publicarTour(tourId));` (exclusive), e colar num método novo:

```ts
  /**
   * Grava no servidor o que hoje só existe na memória do wizard.
   *
   * É o miolo do `publish()`, extraído. O corretor perdia o nome dos cômodos,
   * os hotspots e os dados do imóvel ao tocar em voltar ou recarregar, porque
   * essas três coisas só subiam no publicar — enquanto as fotos e o
   * tratamento por IA, que são o caro, já subiam durante a captura.
   *
   * Chamado de três lugares: ao publicar, ao sair do wizard, e quando o app
   * vai para segundo plano. Publicar exercitar o mesmo caminho é de propósito:
   * é o que impede o salvamento de apodrecer sem ninguém notar.
   *
   * Lança em falha de rede. Quem chama decide — publicar aborta, sair não.
   */
  async salvarRascunho(): Promise<void> {
    const tourId = await this.garantirRascunho();

    // ... corpo recortado do publish, sem alteração ...
  }
```

E `publish()` fica:

```ts
    this.publishing.set(true);
    this.publishError.set(null);
    try {
      await this.salvarRascunho();

      // Por último: até esta linha nada é visível fora da imobiliária. Se algo
      // acima falhar, o rascunho continua rascunho e o retry reaproveita tudo o
      // que já subiu, em vez de duplicar imóvel a cada tentativa.
      await firstValueFrom(
        this.virtualTourService.publicarTour(this.rascunhoTourId()!),
      );

      this.publishedTourId.set(this.rascunhoTourId());
      this.publishedPropertyId.set(this.rascunhoPropertyId());
      this.published.set(true);
    } catch (error) {
      this.publishError.set(publishErrorKey(error));
    } finally {
      this.publishing.set(false);
    }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: PASS — inclusive todos os casos de `publish` que já existiam, sem alteração neles.

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-draft.store.ts inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts
git commit -m "refactor(client): extrair salvarRascunho do publish"
```

---

### Task 6: Cliente — pular o `PATCH` do imóvel quando a etapa 3 está vazia

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Interfaces:**
- Consumes: `salvarRascunho()` da Tarefa 5

- [ ] **Step 1: Escrever o teste que falha**

```ts
  it('não chama o PATCH do imóvel quando a etapa 3 está em branco', async () => {
    // `PATCH /properties/:id` tem `.refine()` recusando corpo vazio, para que
    // um PATCH sem campo nenhum não passe por sucesso. Salvar um rascunho
    // recém-começado não tem o que mandar — e engolir o 400 esconderia falha
    // de rede real no mesmo silêncio.
    const store = criarStore();
    const update = spyOn(store['propertyService'], 'updateProperty')
      .and.returnValue(of({} as never));
    spyOn(store['virtualTourService'], 'atualizarPanorama')
      .and.returnValue(of({ id: 'p1' } as never));
    prepararRascunhoCom(store, [{ id: 's1', room: 'Sala', serverPanoramaId: 'p1' }]);
    // property() continua em EMPTY_PROPERTY

    await store.salvarRascunho();

    expect(update).not.toHaveBeenCalled();
  });

  it('chama o PATCH do imóvel assim que houver um campo preenchido', async () => {
    const store = criarStore();
    const update = spyOn(store['propertyService'], 'updateProperty')
      .and.returnValue(of({} as never));
    spyOn(store['virtualTourService'], 'atualizarPanorama')
      .and.returnValue(of({ id: 'p1' } as never));
    prepararRascunhoCom(store, [{ id: 's1', room: 'Sala', serverPanoramaId: 'p1' }]);
    store.property.update((p) => ({ ...p, name: 'Casa na praia' }));

    await store.salvarRascunho();

    expect(update).toHaveBeenCalled();
    expect(update.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ title: 'Casa na praia' }),
    );
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: FAIL no primeiro caso — `updateProperty` foi chamado.

- [ ] **Step 3: Implementar**

Em `salvarRascunho()`, envolver o bloco do imóvel:

```ts
    const p = this.property();
    // Monta só o que tem conteúdo. Um rascunho recém-começado não tem nada da
    // etapa 3, e `PATCH /properties/:id` recusa corpo vazio de propósito —
    // mandar assim trocaria "não havia o que salvar" por um 400 que quem
    // chamou não sabe distinguir de rede fora.
    const camposDoImovel = {
      ...(p.name.trim() ? { title: p.name.trim() } : {}),
      ...(p.type ? { type: p.type as string } : {}),
      ...(p.purpose ? { purpose: p.purpose as string } : {}),
      ...(this.addressTouched()
        ? {
            address: {
              street: p.address.street.trim(),
              number: p.address.number.trim() || undefined,
              complement: p.address.complement.trim() || undefined,
              district: p.address.district.trim() || undefined,
              city: p.address.city.trim(),
              state: p.address.state.trim().toUpperCase(),
              zipCode: p.address.zip.replace(/\D/g, '') || undefined,
            },
          }
        : {}),
    };

    if (Object.keys(camposDoImovel).length) {
      await firstValueFrom(
        this.propertyService.updateProperty(
          this.rascunhoPropertyId()!,
          camposDoImovel,
        ),
      );
    }
```

> **Atenção:** no `publish()` os três campos são obrigatórios e validados por `invalidFields()` antes de chegar aqui, então publicar continua mandando os três. A diferença só aparece no salvamento intermediário.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/tour-draft.store.ts inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts
git commit -m "fix(client): não mandar PATCH de imóvel vazio ao salvar rascunho"
```

---

### Task 7: Cliente — reconciliação incremental de hotspots

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Interfaces:**
- Consumes: `WizardHotspot.serverHotspotId` (Tarefa 3), `atualizarHotspot` (Tarefa 4)
- Produces: o campo privado `hotspotsNoServidor` deixa de existir — o id passa a viver em cada `WizardHotspot`

- [ ] **Step 1: Escrever os testes que falham**

```ts
  it('mover um ponto vira PATCH, não apagar e recriar', async () => {
    const store = criarStore();
    const criar = spyOn(store['virtualTourService'], 'createHotspot')
      .and.returnValue(of({ id: 'h-srv' } as never));
    const mover = spyOn(store['virtualTourService'], 'atualizarHotspot')
      .and.returnValue(of({ id: 'h-srv' } as never));
    const apagar = spyOn(store['virtualTourService'], 'deleteHotspot')
      .and.returnValue(of(undefined as never));
    spyOn(store['virtualTourService'], 'atualizarPanorama')
      .and.returnValue(of({ id: 'p1' } as never));
    prepararRascunhoCom(store, [
      { id: 's1', room: 'Sala', serverPanoramaId: 'p1' },
      { id: 's2', room: 'Quarto', serverPanoramaId: 'p2' },
    ]);
    ligarHotspot(store, 's1', 's2');

    await store.salvarRascunho();
    expect(criar).toHaveBeenCalledTimes(1);

    moverHotspot(store, 's1', { u: 0.8, v: 0.4 });
    await store.salvarRascunho();

    expect(mover).toHaveBeenCalledTimes(1);
    expect(criar).toHaveBeenCalledTimes(1);
    expect(apagar).not.toHaveBeenCalled();
  });

  it('remover um ponto apaga só ele', async () => {
    const store = criarStore();
    spyOn(store['virtualTourService'], 'createHotspot').and.returnValues(
      of({ id: 'h-a' } as never),
      of({ id: 'h-b' } as never),
    );
    const apagar = spyOn(store['virtualTourService'], 'deleteHotspot')
      .and.returnValue(of(undefined as never));
    spyOn(store['virtualTourService'], 'atualizarPanorama')
      .and.returnValue(of({ id: 'p1' } as never));
    prepararRascunhoCom(store, [
      { id: 's1', room: 'Sala', serverPanoramaId: 'p1' },
      { id: 's2', room: 'Quarto', serverPanoramaId: 'p2' },
    ]);
    const a = ligarHotspot(store, 's1', 's2');
    ligarHotspot(store, 's2', 's1');

    await store.salvarRascunho();
    removerHotspot(store, 's1', a);
    await store.salvarRascunho();

    expect(apagar).toHaveBeenCalledTimes(1);
    expect(apagar).toHaveBeenCalledWith('h-a');
  });

  it('guarda o id do servidor em cada ponto, e não numa lista solta', async () => {
    const store = criarStore();
    spyOn(store['virtualTourService'], 'createHotspot')
      .and.returnValue(of({ id: 'h-srv' } as never));
    spyOn(store['virtualTourService'], 'atualizarPanorama')
      .and.returnValue(of({ id: 'p1' } as never));
    prepararRascunhoCom(store, [
      { id: 's1', room: 'Sala', serverPanoramaId: 'p1' },
      { id: 's2', room: 'Quarto', serverPanoramaId: 'p2' },
    ]);
    ligarHotspot(store, 's1', 's2');

    await store.salvarRascunho();

    const ponto = store.scenes().find((s) => s.id === 's1')!.hotspots[0];
    expect(ponto.serverHotspotId).toBe('h-srv');
  });
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: FAIL — `atualizarHotspot` nunca é chamado; o código atual apaga tudo e recria.

- [ ] **Step 3: Trocar o bloco de hotspots**

Em `salvarRascunho()`, substituir o laço de apagar-tudo-e-recriar por:

```ts
      // Reconciliação incremental, e não apagar-e-recriar.
      //
      // Apagar todos e recriar era aceitável quando isto rodava uma vez, no
      // publicar: a janela em que o tour ficava sem hotspot durava
      // milissegundos e ninguém a via. Rodando a cada troca de etapa, essa
      // janela passa a existir muitas vezes — e uma queda de rede dentro dela
      // devolve o rascunho retomado sem os pontos que o corretor marcou.
      const vivos = new Set<string>();

      for (const scene of cenasFinais) {
        const origem = porCena.get(scene.id);
        for (const h of scene.hotspots) {
          const destino = h.target ? porCena.get(h.target) : undefined;
          // Ponto sem destino é inerte: some do viewer do visitante e ninguém
          // entende por quê. Ele não sobe, mas também não é erro — é como todo
          // hotspot nasce, no instante do toque.
          if (!origem || !destino) continue;

          const dados = {
            positionX: h.u,
            positionY: h.v,
            ...(h.label ? { label: h.label } : {}),
          };

          if (h.serverHotspotId) {
            vivos.add(h.serverHotspotId);
            await firstValueFrom(
              this.virtualTourService.atualizarHotspot(h.serverHotspotId, dados),
            );
            continue;
          }

          const criado = await firstValueFrom(
            this.virtualTourService.createHotspot({
              panoramaId: origem,
              targetId: destino,
              ...dados,
            }),
          );
          vivos.add(criado.id);
          // Gravado UM A UM: se o laço morrer no meio, o retry precisa saber
          // exatamente o que já entrou para não criar em dobro.
          this.patchScene(scene.id, (s) => ({
            ...s,
            hotspots: s.hotspots.map((x) =>
              x.id === h.id ? { ...x, serverHotspotId: criado.id } : x,
            ),
          }));
        }
      }

      // Só o que sumiu de verdade.
      for (const scene of cenasFinais) {
        for (const h of scene.hotspots) {
          if (h.serverHotspotId && !vivos.has(h.serverHotspotId)) {
            await firstValueFrom(
              this.virtualTourService.deleteHotspot(h.serverHotspotId),
            ).catch(() => undefined);
          }
        }
      }
```

> **Ponto que exige cuidado:** o laço de exclusão acima só alcança hotspot que ainda está em `scenes()`. Um ponto **removido da tela** já não está lá, e seu id do servidor iria embora junto. Por isso `removeHotspot` (e `removeScene`) precisam empilhar o `serverHotspotId` removido numa lista `hotspotsParaApagar: signal<string[]>`, consumida e esvaziada aqui. Implementar isso no mesmo passo.

- [ ] **Step 4: Apagar `hotspotsNoServidor`**

O campo `private readonly hotspotsNoServidor = signal<string[]>([])` (linha ~681) e todos os seus usos saem: o id agora vive em cada ponto. Confirmar que nenhuma referência sobrou:

Run: `cd inner-view-client && grep -rn "hotspotsNoServidor" src/`
Expected: nenhuma saída.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/
git commit -m "fix(client): reconciliar hotspot por id, sem apagar e recriar"
```

---

### Task 8: Cliente — `PanoramaImageCache`

**Files:**
- Create: `inner-view-client/src/app/services/panorama-image-cache.service.ts`
- Create: `inner-view-client/src/app/services/panorama-image-cache.service.spec.ts`

**Interfaces:**
- Consumes: `VirtualTourService.baixarPreview(panoramaId, variante)`
- Produces:
  ```ts
  @Injectable({ providedIn: 'root' })
  class PanoramaImageCache {
    obter(panoramaId: string, variante: 'treated' | 'original'): Promise<string>;
    liberar(panoramaId?: string): void;
  }
  ```

- [ ] **Step 1: Escrever o teste que falha**

Criar `inner-view-client/src/app/services/panorama-image-cache.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { PanoramaImageCache } from './panorama-image-cache.service';
import { VirtualTourService } from './virtual-tour.service';

/**
 * A rota de preview é autenticada, então o `TextureLoader` não consegue
 * buscá-la: ele não passa por interceptor e não teria como levar o token. O
 * caminho obrigatório é `HttpClient` → `blob:` → viewer, e este serviço é o
 * dono desses blobs — sem um dono, cada cômodo aberto deixa alguns MB presos
 * até a aba fechar.
 */
describe('PanoramaImageCache', () => {
  let cache: PanoramaImageCache;
  let baixar: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    cache = TestBed.inject(PanoramaImageCache);
    baixar = spyOn(TestBed.inject(VirtualTourService), 'baixarPreview')
      .and.returnValue(of(new Blob(['x'], { type: 'image/jpeg' })));
  });

  afterEach(() => cache.liberar());

  it('baixa uma vez e reaproveita na segunda chamada', async () => {
    const a = await cache.obter('p1', 'treated');
    const b = await cache.obter('p1', 'treated');

    expect(a).toBe(b);
    expect(baixar).toHaveBeenCalledTimes(1);
  });

  it('trata tratada e original como imagens diferentes', async () => {
    // Sem separar por variante, o "ver original" da etapa 2 receberia de volta
    // a tratada — o mesmo tipo de colisão que o ETag da rota já evita.
    const tratada = await cache.obter('p1', 'treated');
    const original = await cache.obter('p1', 'original');

    expect(tratada).not.toBe(original);
    expect(baixar).toHaveBeenCalledTimes(2);
  });

  it('não dispara dois downloads para chamadas simultâneas', async () => {
    const [a, b] = await Promise.all([
      cache.obter('p1', 'treated'),
      cache.obter('p1', 'treated'),
    ]);

    expect(a).toBe(b);
    expect(baixar).toHaveBeenCalledTimes(1);
  });

  it('liberar revoga e força novo download', async () => {
    const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
    await cache.obter('p1', 'treated');

    cache.liberar('p1');
    await cache.obter('p1', 'treated');

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(baixar).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/panorama-image-cache.service.spec.ts"`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `inner-view-client/src/app/services/panorama-image-cache.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VirtualTourService } from './virtual-tour.service';

type Variante = 'treated' | 'original';

/**
 * As fotos de panorama que o wizard mostra, como `blob:`.
 *
 * A rota `/panoramas/:id/preview` é autenticada, e o `TextureLoader` do
 * three.js não passa por interceptor nenhum — ele não teria como levar o
 * token. O caminho é sempre `HttpClient` → `blob:` → viewer. (Passar o
 * endereço da API direto ao viewer foi o que deixou a tela branca em `036b4ac`.)
 *
 * Existe como serviço, e não como chamada solta, por duas razões:
 *
 * 1. **Alguém precisa ser dono dos blobs.** `URL.createObjectURL` só é
 *    liberado por `revokeObjectURL` ou pelo fim da aba. Espalhados pelo store
 *    e pelo modal de captura, cada cômodo aberto deixava MB presos.
 * 2. **Retomar um rascunho abriria N downloads.** Com cache por `(id,
 *    variante)`, voltar a um cômodo já visto é de graça, e a promessa em voo é
 *    compartilhada — dois pedidos simultâneos do mesmo cômodo são um download.
 */
@Injectable({ providedIn: 'root' })
export class PanoramaImageCache {
  private readonly virtualTourService = inject(VirtualTourService);

  /** `panoramaId:variante` → `blob:` pronto. */
  private readonly prontos = new Map<string, string>();
  /** `panoramaId:variante` → download em voo, para não duplicar. */
  private readonly emVoo = new Map<string, Promise<string>>();

  async obter(panoramaId: string, variante: Variante): Promise<string> {
    const chave = `${panoramaId}:${variante}`;

    const pronto = this.prontos.get(chave);
    if (pronto) return pronto;

    const emVoo = this.emVoo.get(chave);
    if (emVoo) return emVoo;

    const promessa = firstValueFrom(
      this.virtualTourService.baixarPreview(panoramaId, variante),
    )
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        this.prontos.set(chave, url);
        return url;
      })
      .finally(() => this.emVoo.delete(chave));

    this.emVoo.set(chave, promessa);
    return promessa;
  }

  /**
   * Solta os blobs de um cômodo, ou de todos.
   *
   * Chamado no `reset` do wizard e ao descartar um rascunho. Não cancela
   * download em voo: a promessa já entregue a quem pediu precisa resolver, e
   * o blob que ela criar é pequeno perto de deixar quem chamou pendurado.
   */
  liberar(panoramaId?: string): void {
    for (const [chave, url] of this.prontos) {
      if (panoramaId && !chave.startsWith(`${panoramaId}:`)) continue;
      URL.revokeObjectURL(url);
      this.prontos.delete(chave);
    }
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/panorama-image-cache.service.spec.ts"`
Expected: PASS — 4 casos

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/services/panorama-image-cache.service.ts inner-view-client/src/app/services/panorama-image-cache.service.spec.ts
git commit -m "feat(client): cache de imagem de panorama, dono dos blobs"
```

---

### Task 9: Cliente — `retomarRascunho()`

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Interfaces:**
- Consumes: `lerRascunho` (Tarefa 4), `PanoramaImageCache` (Tarefa 8)
- Produces: `TourDraftStore.retomarRascunho(tourId: string): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
  it('remonta as cenas do rascunho sem baixar equirect nenhuma', async () => {
    // Retomar um tour de seis cômodos baixando as fotos inteiras seriam
    // dezenas de MB no 4G antes de mostrar qualquer coisa. A foto chega
    // quando o viewer pedir.
    const store = criarStore();
    spyOn(store['virtualTourService'], 'lerRascunho').and.returnValue(
      of({
        id: 't1',
        propertyId: 'imovel-1',
        status: 'DRAFT',
        updatedAt: '2026-08-26T12:00:00Z',
        property: {
          title: 'Casa na praia',
          type: 'HOUSE',
          purpose: 'SALE',
          address: null,
        },
        panoramas: [
          {
            id: 'p1', roomName: 'Sala', order: 0, initialPanorama: true,
            treatmentStatus: 'DONE',
            hotspots: [
              { id: 'h1', label: null, positionX: 0.25, positionY: 0.5, targetId: 'p2' },
            ],
          },
          {
            id: 'p2', roomName: 'Quarto', order: 1, initialPanorama: false,
            treatmentStatus: 'DONE', hotspots: [],
          },
        ],
      } as never),
    );
    const baixar = spyOn(TestBed.inject(PanoramaImageCache), 'obter');

    await store.retomarRascunho('t1');

    expect(store.scenes().map((s) => s.room)).toEqual(['Sala', 'Quarto']);
    expect(store.rascunhoTourId()).toBe('t1');
    expect(store.rascunhoPropertyId()).toBe('imovel-1');
    expect(store.property().name).toBe('Casa na praia');
    expect(baixar).not.toHaveBeenCalled();
  });

  it('religa os hotspots aos ids locais das cenas', async () => {
    // O hotspot do servidor aponta para um panoramaId; o wizard trabalha com
    // o id local da cena. Sem a tradução, a etapa 2 abre com todo ponto sem
    // destino — que é como um ponto inerte, descartado no publicar.
    const store = criarStore();
    spyOn(store['virtualTourService'], 'lerRascunho').and.returnValue(
      of(rascunhoDeDoisComodos()) as never,
    );

    await store.retomarRascunho('t1');

    const sala = store.scenes()[0];
    const quarto = store.scenes()[1];
    expect(sala.hotspots[0].target).toBe(quarto.id);
    expect(sala.hotspots[0].serverHotspotId).toBe('h1');
  });

  it('a cena retomada guarda o id do servidor e fica sem imageData', async () => {
    const store = criarStore();
    spyOn(store['virtualTourService'], 'lerRascunho').and.returnValue(
      of(rascunhoDeDoisComodos()) as never,
    );

    await store.retomarRascunho('t1');

    expect(store.scenes()[0].serverPanoramaId).toBe('p1');
    expect(store.scenes()[0].imageData).toBe('');
    // E mesmo assim é cena íntegra: `readyScenes` precisa contá-la, ou o
    // wizard retomado abre dizendo que não há imagem nenhuma.
    expect(store.readyScenes()).toHaveLength(2);
  });
```

> `rascunhoDeDoisComodos()` é um helper do spec devolvendo o mesmo objeto do primeiro caso.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: FAIL — `store.retomarRascunho is not a function`

- [ ] **Step 3: Implementar**

Em `tour-draft.store.ts`:

```ts
  /**
   * Traz de volta uma captura interrompida.
   *
   * As fotos e o tratamento por IA nunca se perderam — eles sobem durante a
   * captura, cômodo a cômodo. O que se perdia ao tocar em voltar era o nome
   * dos ambientes, os hotspots e os dados do imóvel, que só existiam aqui.
   *
   * Não baixa foto. Um tour de seis cômodos são dezenas de MB de equirect, e
   * reidratar todas antes de mostrar qualquer coisa seria pior do que não
   * retomar. A imagem chega pelo `PanoramaImageCache` quando o viewer pedir.
   */
  async retomarRascunho(tourId: string): Promise<void> {
    const rascunho = await firstValueFrom(
      this.virtualTourService.lerRascunho(tourId),
    );

    this.rascunhoTourId.set(rascunho.id);
    this.rascunhoPropertyId.set(rascunho.propertyId);

    // Uma cena local por panorama, antes dos hotspots: eles apontam para
    // panoramaId e precisam do mapa completo para traduzir ao id local.
    const porPanoramaId = new Map<string, string>();
    const cenas: WizardScene[] = rascunho.panoramas.map((p) => {
      const idLocal = crypto.randomUUID();
      porPanoramaId.set(p.id, idLocal);
      return {
        id: idLocal,
        room: p.roomName,
        fileName: p.roomName,
        fileSize: 0,
        // Vazio de propósito. Ver o comentário do campo no modelo: cena com
        // `imageData` vazio E `serverPanoramaId` presente é íntegra.
        imageData: '',
        order: p.order,
        hotspots: [],
        state: 'ready',
        serverPanoramaId: p.id,
        aiState: p.treatmentStatus === 'DONE' ? 'done' : 'idle',
      };
    });

    for (const p of rascunho.panoramas) {
      const cena = cenas.find((c) => c.serverPanoramaId === p.id)!;
      cena.hotspots = p.hotspots.map((h) => ({
        id: crypto.randomUUID(),
        u: h.positionX,
        v: h.positionY,
        label: h.label ?? '',
        target: porPanoramaId.get(h.targetId) ?? null,
        serverHotspotId: h.id,
      }));
    }

    this.scenes.set(cenas);
    this.selectedSceneId.set(cenas[0]?.id ?? null);
    this.step.set(1);

    const endereco = rascunho.property.address;
    this.property.set({
      ...EMPTY_PROPERTY,
      name: rascunho.property.title,
      type: rascunho.property.type as PropertyDraft['type'],
      purpose: rascunho.property.purpose as PropertyDraft['purpose'],
      ...(endereco
        ? {
            address: {
              street: endereco.street,
              number: endereco.number ?? '',
              complement: endereco.complement ?? '',
              district: endereco.district ?? '',
              city: endereco.city,
              state: endereco.state,
              zip: endereco.zipCode ?? '',
            },
          }
        : {}),
    });
  }
```

> **Verificar:** `readyScenes` filtra por `state === 'ready'`. Confirmar que ele **não** exige `imageData` preenchido; se exigir, ajustar para aceitar cena com `serverPanoramaId`, e cobrir isso pelo terceiro caso do Step 1.

> **Verificar:** o título do imóvel-marcador é `'Captura em andamento'`. Se o corretor não chegou à etapa 3, `property().name` volta com esse marcador na tela. Tratar: quando `title === 'Captura em andamento'`, devolver string vazia.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/
git commit -m "feat(client): retomar um rascunho sem baixar as fotos"
```

---

### Task 10: Cliente — mostrar a foto de uma cena retomada

Sem esta tarefa, a Tarefa 9 entrega um rascunho retomado **sem imagem nenhuma**: o card da etapa 1 usa `scene.imageData` como fundo e a etapa 2 o usa como `imageUrl`, e numa cena retomada ele é vazio de propósito.

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/steps/step-hotspots/step-hotspots.component.ts`
- Modify: `inner-view-client/src/app/tour-wizard/steps/step-hotspots/step-hotspots.component.spec.ts`
- Modify: `inner-view-client/src/app/tour-wizard/ui/scene-card/scene-card.component.ts` (+ `.html`)
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`

**Interfaces:**
- Consumes: `PanoramaImageCache.obter(panoramaId, variante)` (Tarefa 8), `WizardScene.serverPanoramaId` + `imageData` vazio (Tarefas 3 e 9)
- Produces: `TourDraftStore.garantirImagem(sceneId: string, variante: 'treated' | 'original'): Promise<string>` — devolve `blob:` e preenche `treatedImageUrl`/`imageData` da cena na primeira vez.

- [ ] **Step 1: Escrever os testes que falham**

Em `tour-draft.store.spec.ts`:

```ts
  it('garantirImagem baixa a foto de uma cena retomada e a guarda na cena', async () => {
    const store = criarStore();
    spyOn(TestBed.inject(PanoramaImageCache), 'obter')
      .and.resolveTo('blob:http://localhost/abc');
    prepararRascunhoCom(store, [
      { id: 's1', room: 'Sala', serverPanoramaId: 'p1', imageData: '' },
    ]);

    const url = await store.garantirImagem('s1', 'treated');

    expect(url).toBe('blob:http://localhost/abc');
    expect(store.scenes()[0].treatedImageUrl).toBe('blob:http://localhost/abc');
  });

  it('garantirImagem não vai à rede quando a cena já tem a foto em memória', async () => {
    // Cena recém-capturada já traz a dataURL da costura e o blob da tratada,
    // vindos do modal. Baixar de novo seria pagar 4G por algo que está ali.
    const store = criarStore();
    const obter = spyOn(TestBed.inject(PanoramaImageCache), 'obter');
    prepararRascunhoCom(store, [
      {
        id: 's1', room: 'Sala', serverPanoramaId: 'p1',
        imageData: 'data:image/jpeg;base64,SGk=',
        treatedImageUrl: 'blob:http://localhost/ja-tenho',
      },
    ]);

    const url = await store.garantirImagem('s1', 'treated');

    expect(url).toBe('blob:http://localhost/ja-tenho');
    expect(obter).not.toHaveBeenCalled();
  });
```

Em `step-hotspots.component.spec.ts`:

```ts
  it('pede a foto ao abrir uma cena retomada', async () => {
    // Sem isto, a etapa 2 de um rascunho retomado abre com a esfera branca:
    // `imageUrl` vazio faz o TextureLoader falhar calado e o material fica
    // sem mapa. É o mesmo sintoma corrigido em 036b4ac, por outra causa.
    const { fixture, store } = montarEtapa2ComCenaRetomada();
    const garantir = spyOn(store, 'garantirImagem')
      .and.resolveTo('blob:http://localhost/abc');

    fixture.detectChanges();
    await fixture.whenStable();

    expect(garantir).toHaveBeenCalledWith(jasmine.any(String), 'treated');
  });
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts" --include="**/step-hotspots.component.spec.ts"`
Expected: FAIL — `store.garantirImagem is not a function`

- [ ] **Step 3: Implementar `garantirImagem` no store**

```ts
  /**
   * A foto de um cômodo, venha ela da memória ou do servidor.
   *
   * Cena recém-capturada já tem tudo: a dataURL da costura e o `blob:` da
   * tratada, entregues pelo modal. Cena retomada não tem nada — o rascunho é
   * lido sem coluna de imagem de propósito, porque reidratar seis
   * equirretangulares antes de mostrar qualquer coisa seria pior do que não
   * retomar.
   *
   * Então a regra é: usa o que está em memória; se não houver, baixa uma vez e
   * guarda na cena. O download passa pelo `PanoramaImageCache` porque a rota
   * é autenticada e o `TextureLoader` não leva token.
   */
  async garantirImagem(
    sceneId: string,
    variante: 'treated' | 'original',
  ): Promise<string> {
    const cena = this.scenes().find((s) => s.id === sceneId);
    if (!cena) return '';

    const jaTenho = variante === 'treated' ? cena.treatedImageUrl : cena.imageData;
    if (jaTenho) return jaTenho;

    const panoramaId = cena.serverPanoramaId;
    // Cena que nunca subiu e não tem foto em memória não existe na prática;
    // devolver vazio deixa quem chamou decidir, em vez de estourar.
    if (!panoramaId) return '';

    const url = await this.imagens.obter(panoramaId, variante);
    this.patchScene(sceneId, (s) =>
      variante === 'treated'
        ? { ...s, treatedImageUrl: url }
        : { ...s, imageData: url },
    );
    return url;
  }
```

- [ ] **Step 4: Ligar na etapa 2 e no card da etapa 1**

Em `step-hotspots.component.ts`, no `effect` que reage à cena selecionada (ou num `effect` novo), pedir a imagem quando ela faltar:

```ts
    // A cena retomada chega sem foto. Pedir aqui, e não no `computed` de
    // `viewerPanoramas`, porque aquele computed é comparado por identidade e
    // recriá-lo a cada resposta assíncrona recarregaria a equirect inteira —
    // é o que o par de testes de identidade de referência protege.
    effect(() => {
      const cena = this.draft.selectedScene();
      if (!cena || cena.treatedImageUrl || cena.imageData) return;
      void this.draft.garantirImagem(cena.id, 'treated');
    });
```

Em `scene-card.component`, o fundo da miniatura precisa aceitar cena sem `imageData`: usar `scene.treatedImageUrl ?? scene.imageData` e, quando os dois faltarem, **não** desenhar o `background-image` (um `url('')` desenha ícone quebrado). O componente recebe a cena por `@Input`, então quem pede o download é a etapa 1:

```ts
    // Miniatura de cena retomada. `w=320` pela rota de preview: a equirect
    // inteira para desenhar um card de 320px seriam megabytes por cômodo.
    void this.draft.garantirImagem(cena.id, 'treated');
```

- [ ] **Step 5: Rodar e confirmar que passam**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/
git commit -m "feat(client): baixar sob demanda a foto de uma cena retomada"
```

---

### Task 11: Cliente — `descartarRascunho()`

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-draft.store.spec.ts`

**Interfaces:**
- Consumes: `PropertyService.deleteProperty(id)`, `PanoramaImageCache.liberar()`
- Produces: `TourDraftStore.descartarRascunho(): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
  it('descartar apaga o IMÓVEL, não só o tour', async () => {
    // Imóvel sem tour nenhum passa pelo filtro da listagem: ele esconde quem
    // tem tour DRAFT, não quem não tem tour. Apagar só o tour deixaria no
    // catálogo a linha vazia "Captura em andamento" que aquele filtro existe
    // para evitar. `Property` é onDelete: Cascade, então uma chamada basta.
    const store = criarStore();
    const apagarImovel = spyOn(store['propertyService'], 'deleteProperty')
      .and.returnValue(of(undefined as never));
    const apagarTour = spyOn(store['virtualTourService'], 'deleteTour')
      .and.returnValue(of(undefined as never));
    prepararRascunhoCom(store, [{ id: 's1', room: 'Sala', serverPanoramaId: 'p1' }]);

    await store.descartarRascunho();

    expect(apagarImovel).toHaveBeenCalledWith('imovel-1');
    expect(apagarTour).not.toHaveBeenCalled();
  });

  it('descartar limpa o wizard e solta os blobs', async () => {
    const store = criarStore();
    spyOn(store['propertyService'], 'deleteProperty')
      .and.returnValue(of(undefined as never));
    const liberar = spyOn(TestBed.inject(PanoramaImageCache), 'liberar');
    prepararRascunhoCom(store, [{ id: 's1', room: 'Sala', serverPanoramaId: 'p1' }]);

    await store.descartarRascunho();

    expect(store.scenes()).toEqual([]);
    expect(store.rascunhoTourId()).toBeNull();
    expect(liberar).toHaveBeenCalled();
  });

  it('descartar um rascunho que nunca subiu não chama a rede', async () => {
    const store = criarStore();
    const apagarImovel = spyOn(store['propertyService'], 'deleteProperty')
      .and.returnValue(of(undefined as never));

    await store.descartarRascunho();

    expect(apagarImovel).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: FAIL — `store.descartarRascunho is not a function`

- [ ] **Step 3: Implementar**

```ts
  /**
   * Joga fora a captura em andamento.
   *
   * Apaga o **imóvel**, não o tour. `VirtualTour.property` é
   * `onDelete: Cascade`, então uma chamada derruba tour, panoramas, hotspots e
   * frames de uma vez — e apagar só o tour deixaria para trás um imóvel órfão
   * chamado "Captura em andamento". Imóvel sem tour nenhum passa pelo filtro
   * da listagem, que esconde quem tem tour DRAFT e não quem não tem tour: o
   * descarte pela metade apareceria no catálogo como a linha vazia que aquele
   * filtro existe para evitar.
   */
  async descartarRascunho(): Promise<void> {
    const propertyId = this.rascunhoPropertyId();
    if (propertyId) {
      await firstValueFrom(this.propertyService.deleteProperty(propertyId));
    }
    this.reset();
  }
```

E em `reset()`, acrescentar a liberação do cache e a limpeza dos ids do rascunho:

```ts
    this.imagens.liberar();
    this.rascunhoTourId.set(null);
    this.rascunhoPropertyId.set(null);
```

> `imagens` é `private readonly imagens = inject(PanoramaImageCache);`, a acrescentar junto dos outros `inject` do store.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-draft.store.spec.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/
git commit -m "feat(client): descartar rascunho apagando o imóvel inteiro"
```

---

### Task 12: UI — diálogo do voltar e salvamento automático

**Files:**
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.page.ts`
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.page.html`
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.page.spec.ts`
- Modify: `inner-view-client/src/assets/i18n/pt.json`, `en.json`

**Interfaces:**
- Consumes: `salvarRascunho()`, `descartarRascunho()`

- [ ] **Step 1: Acrescentar as chaves de i18n**

Em `pt.json`, dentro de `TOUR_WIZARD.COMMON`, **logo depois da chave `NEEDS_IMAGE`** (é a última do bloco — inserir ao final dele, sem reordenar nada):

```json
    "LEAVE_TITLE": "Sua captura fica salva",
    "LEAVE_MESSAGE": "As fotos e o tratamento da IA já estão guardados. Você pode continuar depois pela tela inicial.",
    "LEAVE_KEEP": "Continuar depois",
    "LEAVE_DISCARD": "Descartar captura",
    "LEAVE_CANCEL": "Ficar aqui"
```

Em `en.json`, na posição equivalente:

```json
    "LEAVE_TITLE": "Your capture is saved",
    "LEAVE_MESSAGE": "The photos and the AI treatment are already stored. You can pick it up later from the home screen.",
    "LEAVE_KEEP": "Continue later",
    "LEAVE_DISCARD": "Discard capture",
    "LEAVE_CANCEL": "Stay here"
```

- [ ] **Step 2: Escrever o teste que falha**

```ts
  it('não pergunta nada quando não há o que perder', async () => {
    const page = montarPagina();
    const alerta = spyOn(TestBed.inject(AlertController), 'create');

    await page.aoVoltar();

    expect(alerta).not.toHaveBeenCalled();
  });

  it('salva antes de sair quando o corretor escolhe continuar depois', async () => {
    const page = montarPagina();
    const salvar = spyOn(page['store'], 'salvarRascunho').and.resolveTo();
    comUmaCena(page);
    escolherNoAlerta('LEAVE_KEEP');

    await page.aoVoltar();

    expect(salvar).toHaveBeenCalled();
  });

  it('sai mesmo quando salvar falha', async () => {
    // Segurar alguém dentro do wizard porque a rede caiu é pior que perder as
    // edições da última etapa: as fotos e a IA já estão no servidor de
    // qualquer forma.
    const page = montarPagina();
    spyOn(page['store'], 'salvarRascunho').and.rejectWith(new Error('rede'));
    const navegar = spyOn(TestBed.inject(Router), 'navigateByUrl');
    comUmaCena(page);
    escolherNoAlerta('LEAVE_KEEP');

    await page.aoVoltar();

    expect(navegar).toHaveBeenCalled();
  });

  it('salva quando o app vai para segundo plano', async () => {
    // `beforeunload` é ignorado ou limitado nos navegadores de celular, e não
    // dispara quando o sistema mata o app. `visibilitychange` dispara.
    const page = montarPagina();
    const salvar = spyOn(page['store'], 'salvarRascunho').and.resolveTo();
    comUmaCena(page);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(salvar).toHaveBeenCalled();
  });
```

E o helper que simula a escolha no alerta — é o único não óbvio:

```ts
  /**
   * Faz o `AlertController` "abrir" e o usuário tocar num botão.
   *
   * O `AlertController` real monta um overlay fora da árvore do componente e
   * não termina dentro de um `whenStable`. O que interessa testar é o que
   * acontece DEPOIS da escolha, então o stub devolve um alerta cujo
   * `present()` resolve e já dispara o handler do botão pedido.
   *
   * `chave` é o sufixo da chave de i18n do botão: LEAVE_KEEP, LEAVE_DISCARD.
   */
  function escolherNoAlerta(chave: string): void {
    spyOn(TestBed.inject(AlertController), 'create').and.callFake(
      async (opts: { buttons?: unknown[] } = {}) => {
        const botoes = (opts.buttons ?? []) as Array<{
          text?: string;
          handler?: () => void;
        }>;
        return {
          present: async () => {
            // O texto vem traduzido; o TranslateService nos testes devolve a
            // própria chave, então basta procurar o sufixo dentro dele.
            const alvo = botoes.find((b) => (b.text ?? '').includes(chave));
            alvo?.handler?.();
          },
        } as never;
      },
    );
  }
```

> `montarPagina()` e `comUmaCena(page)` seguem o padrão do `beforeEach` que o spec já tem: o primeiro devolve a instância do componente pelo `TestBed.createComponent`, o segundo chama `prepararRascunhoCom` da Tarefa 5 no store injetado. **Confirmar como o `TranslateService` está configurado nos testes** — se ele não devolver a própria chave, ajustar o `find` acima para o texto traduzido.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-wizard.page.spec.ts"`
Expected: FAIL

- [ ] **Step 4: Implementar na página**

Trocar o `backHref="/home"` do `app-header` por um handler. Em `tour-wizard.page.html`, linha 2:

```html
  <app-header
    [pageTitle]="'TOUR_WIZARD.COMMON.TITLE' | translate"
    (back)="aoVoltar()"></app-header>
```

> Conferir a API do `app-header`: se ele não emite `back`, manter `backHref` e acrescentar o `@Output`. Um `backHref` é um link e não dá chance de perguntar nada.

Em `tour-wizard.page.ts`:

```ts
  /**
   * Sair do wizard.
   *
   * Pergunta antes porque a alternativa é sair calado com trabalho em cima da
   * mesa. O salvamento em si já aconteceu — a pergunta não é "salvar?", é se
   * ele QUER guardar: quem só estava testando precisa de um caminho para não
   * deixar rascunho na home.
   *
   * Sem cômodo nenhum não há o que perguntar, e um diálogo ali seria só
   * atrito entre ele e a saída.
   */
  async aoVoltar(): Promise<void> {
    if (!this.store.readyScenes().length) {
      await this.sair();
      return;
    }

    const alerta = await this.alertController.create({
      header: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_TITLE'),
      message: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_MESSAGE'),
      buttons: [
        {
          text: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_CANCEL'),
          role: 'cancel',
        },
        {
          text: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_DISCARD'),
          role: 'destructive',
          handler: () => {
            void this.descartarESair();
          },
        },
        {
          text: this.translate.instant('TOUR_WIZARD.COMMON.LEAVE_KEEP'),
          handler: () => {
            void this.salvarESair();
          },
        },
      ],
    });
    await alerta.present();
  }

  private async salvarESair(): Promise<void> {
    // Falhar aqui não pode prender ninguém na tela: as fotos e o tratamento
    // por IA já estão no servidor, e o que se perde é a edição da última
    // etapa. Segurar alguém dentro do wizard porque a rede caiu é pior.
    await this.store.salvarRascunho().catch(() => undefined);
    await this.sair();
  }

  private async descartarESair(): Promise<void> {
    await this.store.descartarRascunho().catch(() => undefined);
    await this.sair();
  }

  private sair(): Promise<boolean> {
    return this.router.navigateByUrl('/home');
  }
```

E o salvamento automático, no construtor ou `ngOnInit`:

```ts
    // `visibilitychange` e não `beforeunload`: os navegadores de celular
    // ignoram ou limitam o segundo, e ele não dispara quando o sistema mata o
    // app em segundo plano — que são justamente os dois casos em que o
    // corretor perdia o trabalho.
    const aoEsconder = () => {
      if (document.visibilityState !== 'hidden') return;
      if (!this.store.readyScenes().length) return;
      void this.store.salvarRascunho().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', aoEsconder);
    this.destroyRef.onDestroy(() =>
      document.removeEventListener('visibilitychange', aoEsconder),
    );
```

E ao trocar de etapa — no método que já avança o `step` (`avancar`/`next`), acrescentar antes da troca:

```ts
    // Cada etapa fecha um bloco de trabalho: nome dos cômodos, hotspots,
    // dados do imóvel. Salvar na fronteira entre elas é o ponto em que há mais
    // a perder e menos a atrapalhar.
    void this.store.salvarRascunho().catch(() => undefined);
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/tour-wizard.page.spec.ts"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add inner-view-client/src/app/tour-wizard/ inner-view-client/src/assets/i18n/
git commit -m "feat(client): perguntar ao sair do wizard e salvar em segundo plano"
```

---

### Task 13: UI — faixa "Capturas em andamento" na home

**Files:**
- Create: `inner-view-client/src/app/home/rascunhos-band/rascunhos-band.component.ts`
- Create: `inner-view-client/src/app/home/rascunhos-band/rascunhos-band.component.spec.ts`
- Modify: `inner-view-client/src/app/home/home.page.ts`, `home.page.html`
- Modify: `inner-view-client/src/app/tour-wizard/tour-wizard.page.ts` (aceitar `?rascunho=`)
- Modify: `inner-view-client/src/assets/i18n/pt.json`, `en.json`

**Interfaces:**
- Consumes: `VirtualTourService.listarRascunhos()`, `urlDoPreview(panoramaId, 'treated')`
- Produces: componente `<app-rascunhos-band />`; navega para `/tour/novo?rascunho=<tourId>`

- [ ] **Step 1: Acrescentar as chaves de i18n**

Em `pt.json`, dentro de `HOME`, ao final do bloco:

```json
    "DRAFTS_TITLE": "Capturas em andamento",
    "DRAFTS_ROOMS": "{{count}} ambiente(s)",
    "DRAFTS_EMPTY_ROOMS": "Nenhum ambiente ainda",
    "DRAFTS_RESUME": "Continuar",
    "DRAFTS_DISCARD": "Descartar"
```

Em `en.json`, na posição equivalente:

```json
    "DRAFTS_TITLE": "Captures in progress",
    "DRAFTS_ROOMS": "{{count}} room(s)",
    "DRAFTS_EMPTY_ROOMS": "No rooms yet",
    "DRAFTS_RESUME": "Resume",
    "DRAFTS_DISCARD": "Discard"
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `rascunhos-band.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { RascunhosBandComponent } from './rascunhos-band.component';
import { VirtualTourService } from '../../services/virtual-tour.service';

describe('RascunhosBandComponent', () => {
  let fixture: ComponentFixture<RascunhosBandComponent>;

  function montar(rascunhos: unknown[]) {
    TestBed.configureTestingModule({
      imports: [RascunhosBandComponent],
      providers: [provideHttpClient()],
    });
    spyOn(TestBed.inject(VirtualTourService), 'listarRascunhos')
      .and.returnValue(of(rascunhos) as never);
    fixture = TestBed.createComponent(RascunhosBandComponent);
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  it('não desenha nada quando não há rascunho', () => {
    // A faixa não pode ocupar espaço permanente na home: quem nunca deixou
    // captura pela metade não deve ver um vazio explicando isso.
    montar([]);

    expect(fixture.nativeElement.querySelector('.rascunhos')).toBeNull();
  });

  it('desenha um cartão por rascunho, com a contagem de ambientes', () => {
    montar([
      { id: 't1', propertyId: 'i1', updatedAt: '2026-08-26T12:00:00Z', ambientes: 3, capaPanoramaId: 'p1' },
      { id: 't2', propertyId: 'i2', updatedAt: '2026-08-25T12:00:00Z', ambientes: 1, capaPanoramaId: 'p9' },
    ]);

    const cartoes = fixture.nativeElement.querySelectorAll('.rascunhos__card');
    expect(cartoes.length).toBe(2);
    expect(cartoes[0].textContent).toContain('3');
  });

  it('desenha o rascunho sem nenhum cômodo, sem miniatura quebrada', () => {
    // É o estado entre criar o rascunho e a primeira captura terminar. Um
    // <img> com src vazio desenha ícone de imagem quebrada.
    montar([
      { id: 't1', propertyId: 'i1', updatedAt: '2026-08-26T12:00:00Z', ambientes: 0, capaPanoramaId: null },
    ]);

    expect(fixture.nativeElement.querySelector('.rascunhos__card')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.rascunhos__thumb img')).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless --include="**/rascunhos-band.component.spec.ts"`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar o componente**

Criar `inner-view-client/src/app/home/rascunhos-band/rascunhos-band.component.ts`:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { PanoramaImageCache } from '../../services/panorama-image-cache.service';
import { PropertyService } from '../../services/property.service';
import {
  RascunhoResumo,
  VirtualTourService,
} from '../../services/virtual-tour.service';

interface CartaoDeRascunho extends RascunhoResumo {
  /** `blob:` da miniatura, quando ela já baixou. */
  miniatura?: string;
}

/**
 * As capturas que ficaram pela metade, no topo da home.
 *
 * O corretor perdia o tour ao tocar em voltar. As fotos e o tratamento por IA
 * nunca se perderam — sobem durante a captura —, mas não havia nada no
 * aplicativo que o levasse de volta a elas: a listagem de imóveis esconde
 * rascunho de propósito, porque imóvel sem título apareceria no lugar mais
 * visível do sistema como uma linha vazia.
 *
 * A faixa **não é renderizada quando não há rascunho**. Quem nunca deixou
 * captura pela metade não deve ver um vazio explicando isso, e a home já tem
 * busca, filtros e chips disputando o topo.
 */
@Component({
  selector: 'app-rascunhos-band',
  standalone: true,
  imports: [DatePipe, TranslateModule],
  template: `
    @if (rascunhos().length) {
      <section class="rascunhos">
        <h2 class="rascunhos__titulo">{{ 'HOME.DRAFTS_TITLE' | translate }}</h2>

        <ul class="rascunhos__lista">
          @for (r of rascunhos(); track r.id) {
            <li class="rascunhos__card">
              <button type="button" class="rascunhos__abrir" (click)="retomar(r)">
                <span class="rascunhos__thumb">
                  <!--
                    Só com miniatura baixada: um <img> com src vazio desenha o
                    ícone de imagem quebrada, e o rascunho sem cômodo nenhum é
                    um estado normal — existe entre criar o rascunho e a
                    primeira captura terminar.
                  -->
                  @if (r.miniatura) {
                    <img [src]="r.miniatura" alt="" />
                  }
                </span>

                <span class="rascunhos__info">
                  <span class="rascunhos__ambientes">
                    @if (r.ambientes) {
                      {{ 'HOME.DRAFTS_ROOMS' | translate: { count: r.ambientes } }}
                    } @else {
                      {{ 'HOME.DRAFTS_EMPTY_ROOMS' | translate }}
                    }
                  </span>
                  <span class="rascunhos__data">{{ r.updatedAt | date: 'short' }}</span>
                </span>
              </button>

              <button
                type="button"
                class="rascunhos__descartar"
                (click)="descartar(r)">
                {{ 'HOME.DRAFTS_DISCARD' | translate }}
              </button>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styleUrl: './rascunhos-band.component.scss',
})
export class RascunhosBandComponent implements OnInit {
  private readonly virtualTourService = inject(VirtualTourService);
  private readonly propertyService = inject(PropertyService);
  private readonly imagens = inject(PanoramaImageCache);
  private readonly router = inject(Router);

  readonly rascunhos = signal<CartaoDeRascunho[]>([]);

  ngOnInit(): void {
    void this.carregar();
  }

  private async carregar(): Promise<void> {
    // Falhar aqui não pode derrubar a home: a faixa é um atalho, e o catálogo
    // abaixo dela é o que o corretor veio ver.
    const lista = await firstValueFrom(
      this.virtualTourService.listarRascunhos(),
    ).catch(() => [] as RascunhoResumo[]);

    this.rascunhos.set(lista);
    for (const r of lista) void this.carregarMiniatura(r);
  }

  /**
   * A miniatura passa pelo cache, e não por `<img src="/api/...">`.
   *
   * A rota de preview é autenticada e a tag `<img>` não leva o token — ela não
   * passa pelo interceptor. O caminho é o mesmo do viewer: `HttpClient` →
   * `blob:` → tela.
   */
  private async carregarMiniatura(r: RascunhoResumo): Promise<void> {
    if (!r.capaPanoramaId) return;

    const url = await this.imagens
      .obter(r.capaPanoramaId, 'treated')
      .catch(() => '');
    if (!url) return;

    this.rascunhos.update((atual) =>
      atual.map((x) => (x.id === r.id ? { ...x, miniatura: url } : x)),
    );
  }

  retomar(r: CartaoDeRascunho): void {
    void this.router.navigate(['/tour/novo'], {
      queryParams: { rascunho: r.id },
    });
  }

  /**
   * Apaga o IMÓVEL, e não o tour.
   *
   * `VirtualTour.property` é `onDelete: Cascade`, então uma chamada derruba
   * tour, panoramas, hotspots e frames. Apagar só o tour deixaria um imóvel
   * órfão chamado "Captura em andamento" — e imóvel sem tour nenhum passa pelo
   * filtro da listagem, que esconde quem tem tour DRAFT e não quem não tem
   * tour. O descarte pela metade apareceria no catálogo.
   */
  async descartar(r: CartaoDeRascunho): Promise<void> {
    await firstValueFrom(
      this.propertyService.deleteProperty(r.propertyId),
    ).catch(() => undefined);

    if (r.capaPanoramaId) this.imagens.liberar(r.capaPanoramaId);
    this.rascunhos.update((atual) => atual.filter((x) => x.id !== r.id));
  }
}
```

Criar também `rascunhos-band.component.scss` com as classes usadas acima (`.rascunhos`, `__titulo`, `__lista`, `__card`, `__abrir`, `__thumb`, `__info`, `__ambientes`, `__data`, `__descartar`), seguindo as variáveis e o espaçamento dos outros blocos de `home/`. A lista é horizontal e rolável (`overflow-x: auto`) para não empurrar o catálogo para baixo quando houver vários rascunhos.

> **Confirmar antes:** se o projeto usa `styleUrl` (Angular 17+) ou `styleUrls`. Copiar do componente vizinho em `home/`.

- [ ] **Step 5: Encaixar na home e aceitar o parâmetro no wizard**

Em `home.page.html`, logo depois de `<app-header></app-header>` e **antes** de `@if (mostrarMoldura())`:

```html
  <app-rascunhos-band />
```

Em `home.page.ts`: acrescentar `RascunhosBandComponent` ao array `imports`.

Em `tour-wizard.page.ts`, no `ngOnInit`, ler o parâmetro:

```ts
    // Entrada pela faixa da home. Sem o parâmetro, o wizard começa vazio como
    // sempre começou.
    const rascunho = this.route.snapshot.queryParamMap.get('rascunho');
    if (rascunho) void this.store.retomarRascunho(rascunho);
```

- [ ] **Step 6: Rodar a suíte inteira do cliente**

Run: `cd inner-view-client && npx ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS — 521 anteriores + os novos.

- [ ] **Step 7: Lint, build e commit**

```bash
cd inner-view-client && npm run lint && npx ng build --configuration production
git add inner-view-client/
git commit -m "feat(client): faixa de capturas em andamento na home"
```

---

## Verificação final, na mão

Precisa de `OPENAI_API_KEY` no `.env` do `server-api` — sem ela tudo vira `SKIPPED` e o caminho que interessa não é exercitado. Túnel HTTPS obrigatório para os sensores da captura guiada.

1. Capturar um cômodo, dar nome, tocar em voltar, escolher **"Continuar depois"**. Voltar pela faixa da home e encontrar **o nome que foi digitado** — não `"Ambiente 1"`.
2. Capturar dois cômodos, marcar um hotspot, **recarregar a página** sem tocar em mais nada. Retomar e achar o hotspot no lugar.
3. Retomar num aparelho diferente do que capturou.
4. Mover um hotspot já salvo, sair e voltar: ele está na posição nova, e o `id` no banco é o mesmo de antes.
5. Descartar pela faixa e confirmar que imóvel, tour e panoramas somem — e que **nenhuma linha vazia** aparece na listagem de imóveis.
6. Rascunho recém-criado, sem nenhum cômodo: a faixa o desenha sem miniatura quebrada.

## Fora de escopo

**Salvamento offline.** Sem rede, `salvarRascunho()` falha e o estado continua só em memória. Cobrir isso pede fila local de escritas — outra task, outro risco.

**Retomar na etapa em que parou.** O rascunho retomado abre sempre na etapa 1.
