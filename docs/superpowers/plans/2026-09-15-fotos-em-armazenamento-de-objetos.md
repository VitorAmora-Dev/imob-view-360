# Fotos em armazenamento de objetos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar as fotos de dentro do Postgres e pô-las num balde de objetos, mantendo todo tour publicado no ar durante a troca.

**Architecture:** Uma porta `ArmazenamentoDeImagens` com três implementações (R2 em produção, disco em desenvolvimento, memória em teste). O banco passa a guardar a CHAVE do arquivo, não os bytes; a leitura prefere a chave e cai na coluna antiga quando ela não existe, e é essa queda que mantém tour antigo vivo enquanto o preenchimento roda. A gravação é sempre balde primeiro, banco depois. Uma capa de 640 px é gravada ao lado de cada imagem, o que apaga o redimensionamento sob demanda.

**Tech Stack:** NestJS 11, Prisma 7 / Postgres 17, sharp 0.35, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, Jest 29 (duas configs), Angular 20 (só na Task 14).

**Spec:** `docs/superpowers/specs/2026-09-15-fotos-em-armazenamento-de-objetos-design.md`

---

## Correções à spec, achadas ao ler o código

Duas coisas que a spec afirma não sobreviveram à leitura do código. As duas viraram decisão deste plano, e estão aqui em vez de escondidas dentro de uma task.

**1. O cliente MUDA — seis linhas, e só na entrega B.** A spec diz que
`urlDaImagem` do Angular já devolve endereço absoluto intacto, e isso é
verdade. Mas a faixa de cenas não usa `imageUrl` direto: ela chama
`comLargura(urlDaImagem(panorama), 292)`
([tour-viewer.model.ts:160](inner-view-client/src/app/tour-viewer/tour-viewer.model.ts#L160)),
que emenda `?w=292`. Contra a API isso devolve uma miniatura; contra a CDN,
`?w=` é parâmetro desconhecido e o R2 devolve **o arquivo inteiro** — 14 MB por
cômodo para desenhar um retângulo de 104 px, que é exatamente o defeito que
`LARGURA_DA_MINIATURA` existe para evitar. A Task 14 resolve emitindo um
`thumbnailUrl` próprio no payload.

**2. O portão das miniaturas não pode sumir junto com a entrega.** A spec diz
que o portão de duas reduções simultâneas deixa de ser necessário, e ele deixa
— **depois** que toda linha tem capa gravada. Entre o deploy e o fim do
`migrar-imagens`, linha não migrada ainda precisa reduzir sob demanda, e um
tour de nove cômodos não migrados custaria os mesmos 113 MB de 10/09. Então o
portão e o LRU **mudam de arquivo** (saem de `panorama-miniatura.ts`, como a
spec pede) e viram explicitamente o caminho de queda; apagá-los é a etapa 5 da
migração, operacional, documentada na Task 17 e fora deste plano.

---

## Global Constraints

Valores copiados da spec. Valem para toda task.

- **Escopo:** `server-api/`. O cliente Angular só é tocado na Task 14.
- **Gravar no balde ANTES do banco, sempre** (decisão 10). Arquivo órfão custa centavos; linha apontando para o nada é tela sem imagem.
- **`versao` é um carimbo gerado pela aplicação no instante da gravação**, nunca `updatedAt` — o Prisma atribui `updatedAt` durante a escrita no banco, que acontece depois.
- **Nenhum arquivo é sobrescrito** em `panoramas/`. Gravação nova = versão nova = chave nova.
- **O gatilho do endereço público é a configuração (`STORAGE_PUBLIC_URL`), não a chave.** Sem a variável, a API emite o endereço relativo de hoje mesmo com `imageKey` preenchido.
- **Largura da capa: 640.** Um tamanho só.
- **Validade do link assinado: 300 segundos.**
- **A suíte roda sem rede e sem credencial.** Nenhuma task pode exigir bucket para `yarn test` passar.
- **Nenhuma coluna de imagem em resposta JSON.** `imageData`, `treatedImageData` e `CaptureFrame.imageData` são colunas TOAST de dezenas de MB.
- **NUNCA rode `yarn lint` no `server-api`.** O script tem `--fix` embutido e reescreve o repositório inteiro. Use `npx eslint <arquivos>` sem a flag.
- Chaves: `panoramas/{panoramaId}/{versao}/{original|tratada}.jpg`, `panoramas/{panoramaId}/{versao}/capa.jpg`, `capturas/{panoramaId}/{indice}.jpg`.

### Comandos

```bash
cd server-api
docker compose up -d --wait db     # uma vez por sessão; a suíte da API precisa
yarn test                          # suíte com banco (test/)
yarn test:scripts                  # suíte sem banco (src/shared/, scripts/)
npx eslint <arquivos>              # NUNCA `yarn lint`
```

---

## Estrutura de arquivos

**Novos, em `server-api/`:**

| arquivo | responsabilidade |
|---|---|
| `src/shared/armazenamento/armazenamento.port.ts` | a interface, o token de injeção, e as funções que montam chave |
| `src/shared/armazenamento/armazenamento-em-memoria.ts` | o dublê de teste |
| `src/shared/armazenamento/armazenamento-local.ts` | disco, para desenvolvimento |
| `src/shared/armazenamento/armazenamento-r2.ts` | S3/R2, para produção |
| `src/shared/armazenamento/armazenamento.module.ts` | escolhe a implementação pela configuração |
| `src/modules/panoramas/capa-do-panorama.ts` | faz a capa de 640; e guarda o caminho de queda (portão + LRU) enquanto houver linha não migrada |
| `src/modules/panoramas/gravador-de-imagens.service.ts` | grava imagem + capa no balde e devolve a chave |
| `scripts/migrar-imagens.ts` | o preenchimento, idempotente e retomável |
| `scripts/varrer-orfaos.ts` | lixo de versão antiga e de gravação interrompida |
| `docs/operacao/migracao-das-fotos.md` | o runbook dos cinco passos |

**Modificados:** `prisma/schema.prisma`, `src/config/env.schema.ts`, `.env.example`, `src/app.module.ts`, `src/modules/panoramas/{panorama-image.ts, panorama-image.reader.ts, panorama-miniatura.ts, panoramas.module.ts}`, os serviços de create/update/upload/treat/get-image/get-preview, `src/modules/virtual-tours/services/{get-thumbnail.service.ts, find-virtual-tour.service.ts}`, os dois controllers de preview, `package.json`.

**Cliente (só Task 14):** `inner-view-client/src/app/services/virtual-tour.service.ts` (o tipo `Panorama`) e `src/app/tour-viewer/tour-viewer.model.ts`.

---

### Task 1: A porta, as chaves e o dublê em memória

**Files:**
- Create: `server-api/src/shared/armazenamento/armazenamento.port.ts`
- Create: `server-api/src/shared/armazenamento/armazenamento-em-memoria.ts`
- Test: `server-api/src/shared/armazenamento/armazenamento.port.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `ArmazenamentoDeImagens` (interface), `ARMAZENAMENTO` (token), `ObjetoArmazenado`, `VarianteDeImagem`, `VALIDADE_DO_LINK_ASSINADO`, `versaoAgora(agora?: Date): string`, `chaveDoPanorama(panoramaId: string, versao: string, variante: VarianteDeImagem): string`, `chaveDaCapa(chaveDaImagem: string): string`, `chaveDaCaptura(panoramaId: string, indice: number): string`, `ArmazenamentoEmMemoria`.

Esta suíte roda em `yarn test:scripts`, sem banco — `src/shared` já está no `testRegex` da config de scripts.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/src/shared/armazenamento/armazenamento.port.spec.ts`:

```ts
import {
  ArmazenamentoEmMemoria,
} from './armazenamento-em-memoria';
import {
  chaveDaCapa,
  chaveDaCaptura,
  chaveDoPanorama,
  versaoAgora,
} from './armazenamento.port';

describe('chaves do armazenamento', () => {
  it('monta a chave do panorama com a versão no caminho', () => {
    expect(chaveDoPanorama('p1', '1757950000000', 'original')).toBe(
      'panoramas/p1/1757950000000/original.jpg',
    );
    expect(chaveDoPanorama('p1', '1757950000000', 'tratada')).toBe(
      'panoramas/p1/1757950000000/tratada.jpg',
    );
  });

  it('a capa mora ao lado da imagem, na MESMA versão', () => {
    // É o que permite achar a capa sem uma terceira coluna no banco: quem tem
    // a chave da imagem tem a da capa por aritmética de string.
    expect(chaveDaCapa('panoramas/p1/1757950000000/tratada.jpg')).toBe(
      'panoramas/p1/1757950000000/capa.jpg',
    );
  });

  it('recusa chave sem diretório em vez de inventar uma', () => {
    expect(() => chaveDaCapa('tratada.jpg')).toThrow(/sem diretório/);
  });

  it('a foto da captura não carrega versão', () => {
    // Reenvio depois de falha de rede repõe a MESMA foto, como o upsert por
    // (panorama, índice) já faz no banco. Versionar aqui acumularia cópias.
    expect(chaveDaCaptura('p1', 7)).toBe('capturas/p1/7.jpg');
  });

  it('a versão é o instante da gravação, em milissegundos', () => {
    expect(versaoAgora(new Date(1757950000000))).toBe('1757950000000');
  });

  it('duas gravações do mesmo panorama nunca dividem a mesma chave', () => {
    // A imutabilidade do arquivo é o que faz invalidação de CDN sumir como
    // classe de problema. Se duas versões colidissem, ela voltaria.
    const primeira = chaveDoPanorama('p1', versaoAgora(new Date(1)), 'tratada');
    const segunda = chaveDoPanorama('p1', versaoAgora(new Date(2)), 'tratada');
    expect(primeira).not.toBe(segunda);
  });
});

describe('ArmazenamentoEmMemoria', () => {
  it('devolve o que gravou', async () => {
    const memoria = new ArmazenamentoEmMemoria();
    await memoria.gravar('a/b.jpg', Buffer.from('oi'));

    expect((await memoria.ler('a/b.jpg'))?.toString()).toBe('oi');
  });

  it('devolve null para chave que não existe, em vez de lançar', async () => {
    // Quem lê precisa distinguir "não está no balde" de "o balde falhou": é
    // esse null que autoriza a queda para a coluna antiga.
    expect(await new ArmazenamentoEmMemoria().ler('nao/existe.jpg')).toBeNull();
  });

  it('sem endereço público configurado, não inventa um', async () => {
    const memoria = new ArmazenamentoEmMemoria();

    expect(memoria.enderecoPublico('a/b.jpg')).toBeNull();
    expect(await memoria.enderecoAssinado('a/b.jpg', 300)).toBeNull();
  });

  it('com endereço público configurado, emite o absoluto', () => {
    const memoria = new ArmazenamentoEmMemoria('https://cdn.teste');

    expect(memoria.enderecoPublico('a/b.jpg')).toBe('https://cdn.teste/a/b.jpg');
  });

  it('lista só o que está sob o prefixo', async () => {
    const memoria = new ArmazenamentoEmMemoria();
    await memoria.gravar('panoramas/p1/1/original.jpg', Buffer.from('a'));
    await memoria.gravar('capturas/p1/0.jpg', Buffer.from('b'));

    const achados: string[] = [];
    for await (const objeto of memoria.listar('panoramas/')) {
      achados.push(objeto.chave);
    }

    expect(achados).toEqual(['panoramas/p1/1/original.jpg']);
  });

  it('apagar some com o objeto', async () => {
    const memoria = new ArmazenamentoEmMemoria();
    await memoria.gravar('a/b.jpg', Buffer.from('oi'));

    await memoria.apagar('a/b.jpg');

    expect(await memoria.ler('a/b.jpg')).toBeNull();
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test:scripts armazenamento.port
```

Esperado: FAIL — `Cannot find module './armazenamento.port'`.

- [ ] **Step 3: Escreva a porta**

Crie `server-api/src/shared/armazenamento/armazenamento.port.ts`:

```ts
/**
 * Onde as fotos moram.
 *
 * Existe para que trocar de fornecedor seja mudar de endereço, e não de
 * código: a R2 fala o protocolo da S3, e quem consome esta interface não sabe
 * a diferença. As três implementações — R2, disco e memória — são o que
 * mantém a suíte rodando sem rede e sem credencial.
 *
 * `enderecoPublico` e `enderecoAssinado` devolvem `null` quando aquele modo de
 * entrega não está configurado. Isso NÃO é falha: é o que separa a entrega A
 * (a API lê do balde e transmite) da entrega B (o navegador busca direto). Em
 * desenvolvimento os dois são `null` e tudo continua passando pela API.
 */
export interface ArmazenamentoDeImagens {
  gravar(chave: string, bytes: Buffer): Promise<void>;

  /** `null` quando o objeto não existe — é ele que autoriza a queda para a coluna. */
  ler(chave: string): Promise<Buffer | null>;

  /** `null` quando não há endereço público configurado. */
  enderecoPublico(chave: string): string | null;

  /** `null` quando a implementação não assina (disco e memória). */
  enderecoAssinado(chave: string, segundos: number): Promise<string | null>;

  apagar(chave: string): Promise<void>;

  /**
   * `modificadoEm` vem junto porque a varredura de órfãos precisa dele: a
   * decisão 10 grava no balde ANTES do banco, então existe uma janela em que
   * um objeto legítimo ainda não tem dono. Sem a data, a varredura apagaria
   * uma gravação em curso.
   */
  listar(prefixo: string): AsyncIterable<ObjetoArmazenado>;
}

export interface ObjetoArmazenado {
  chave: string;
  modificadoEm: Date;
}

/**
 * Interface não existe em tempo de execução, e o Nest injeta por valor. O
 * símbolo é o valor.
 */
export const ARMAZENAMENTO = Symbol('ArmazenamentoDeImagens');

export type VarianteDeImagem = 'original' | 'tratada';

/**
 * Cinco minutos. O link assinado é consumido pelo navegador no instante
 * seguinte ao 302; o prazo existe para o caso de a aba ficar aberta, não para
 * ser um cache.
 */
export const VALIDADE_DO_LINK_ASSINADO = 300;

/**
 * A versão que vai no caminho do arquivo.
 *
 * Carimbo próprio, e NÃO `updatedAt`. `updatedAt` é `@updatedAt`: o Prisma o
 * atribui durante a escrita no banco, e a gravação no balde acontece antes
 * dela — derivar a chave de `updatedAt` seria precisar do número antes de ele
 * existir. Nada se perde por isso: a chave inteira fica guardada na coluna.
 */
export function versaoAgora(agora: Date = new Date()): string {
  return String(agora.getTime());
}

/**
 * Nenhum arquivo em `panoramas/` é sobrescrito. Quando a IA trata o cômodo ou
 * o corretor refotografa a sala, nasce um endereço novo e o payload passa a
 * apontar para ele — a CDN cacheia para sempre e nunca é preciso mandar limpar
 * nada. O preço é a versão anterior ficar no balde, que `varrer-orfaos`
 * resolve por centavos.
 */
export function chaveDoPanorama(
  panoramaId: string,
  versao: string,
  variante: VarianteDeImagem,
): string {
  return `panoramas/${panoramaId}/${versao}/${variante}.jpg`;
}

/**
 * A capa mora na MESMA pasta de versão da imagem que a originou, e por isso
 * se deduz da chave dela. É o que evita uma terceira coluna no banco só para
 * guardar um endereço que já é calculável.
 *
 * `original.jpg` e `tratada.jpg` nunca dividem uma pasta: cada gravação cria a
 * sua versão. Então uma pasta tem uma capa, e ela é a daquela imagem.
 */
export function chaveDaCapa(chaveDaImagem: string): string {
  const barra = chaveDaImagem.lastIndexOf('/');
  if (barra <= 0) {
    throw new Error(`Chave de imagem sem diretório: ${chaveDaImagem}`);
  }
  return `${chaveDaImagem.slice(0, barra)}/capa.jpg`;
}

/**
 * Sem versão, de propósito: o envio acontece foto a foto em segundo plano e um
 * reenvio depois de falha de rede precisa REPOR a mesma foto, como o
 * `upsert` por (panorama, índice) já faz no banco.
 */
export function chaveDaCaptura(panoramaId: string, indice: number): string {
  return `capturas/${panoramaId}/${indice}.jpg`;
}
```

- [ ] **Step 4: Escreva o dublê**

Crie `server-api/src/shared/armazenamento/armazenamento-em-memoria.ts`:

```ts
import {
  ArmazenamentoDeImagens,
  ObjetoArmazenado,
} from './armazenamento.port';

/**
 * A porta, num Map.
 *
 * Existe para que toda a suíte de imagem continue rodando sem rede e sem
 * credencial — que é requisito, não conveniência: uma suíte que precisa de
 * bucket é uma suíte que deixa de ser rodada.
 *
 * `gravacoes` é público porque vários testes precisam contar escritas: é assim
 * que se prova que `migrar-imagens` é idempotente (a segunda execução não sobe
 * nada) e que a leitura prefere o endereço (não toca na coluna).
 */
export class ArmazenamentoEmMemoria implements ArmazenamentoDeImagens {
  private readonly objetos = new Map<string, { bytes: Buffer; modificadoEm: Date }>();

  gravacoes = 0;
  leituras = 0;

  /** Sem base, `enderecoPublico` devolve `null` — que é o estado da entrega A. */
  constructor(private readonly base: string | null = null) {}

  async gravar(chave: string, bytes: Buffer): Promise<void> {
    this.objetos.set(chave, { bytes, modificadoEm: new Date() });
    this.gravacoes++;
  }

  async ler(chave: string): Promise<Buffer | null> {
    this.leituras++;
    return this.objetos.get(chave)?.bytes ?? null;
  }

  enderecoPublico(chave: string): string | null {
    return this.base ? `${this.base}/${chave}` : null;
  }

  async enderecoAssinado(chave: string, segundos: number): Promise<string | null> {
    return this.base ? `${this.base}/${chave}?assinado=${segundos}` : null;
  }

  async apagar(chave: string): Promise<void> {
    this.objetos.delete(chave);
  }

  async *listar(prefixo: string): AsyncIterable<ObjetoArmazenado> {
    // Cópia da lista antes de percorrer: quem varre órfãos apaga durante a
    // iteração, e mutar o Map debaixo do próprio iterador pula entradas.
    for (const [chave, objeto] of [...this.objetos]) {
      if (chave.startsWith(prefixo)) {
        yield { chave, modificadoEm: objeto.modificadoEm };
      }
    }
  }

  /** Só para teste: afirma o conteúdo sem expor o Map. */
  tem(chave: string): boolean {
    return this.objetos.has(chave);
  }

  chaves(): string[] {
    return [...this.objetos.keys()];
  }
}
```

- [ ] **Step 5: Rode e veja passar**

```bash
cd server-api && yarn test:scripts armazenamento.port
```

Esperado: PASS, 13 testes.

- [ ] **Step 6: Lint e commit**

```bash
cd server-api && npx eslint src/shared/armazenamento
git add server-api/src/shared/armazenamento
git commit -m "feat(armazenamento): porta de imagens, chaves versionadas e dublê em memória"
```

---

### Task 2: Armazenamento em disco, para desenvolvimento

**Files:**
- Create: `server-api/src/shared/armazenamento/armazenamento-local.ts`
- Test: `server-api/src/shared/armazenamento/armazenamento-local.spec.ts`

**Interfaces:**
- Consumes: `ArmazenamentoDeImagens`, `ObjetoArmazenado` de `./armazenamento.port`.
- Produces: `class ArmazenamentoLocal implements ArmazenamentoDeImagens`, construtor `(raiz: string)`.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/src/shared/armazenamento/armazenamento-local.spec.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArmazenamentoLocal } from './armazenamento-local';

describe('ArmazenamentoLocal', () => {
  let raiz: string;
  let disco: ArmazenamentoLocal;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'armazenamento-'));
    disco = new ArmazenamentoLocal(raiz);
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it('grava criando os diretórios do caminho', async () => {
    // A chave tem três níveis e nenhum deles existe antes da primeira foto.
    await disco.gravar('panoramas/p1/1/original.jpg', Buffer.from('oi'));

    const lido = await readFile(join(raiz, 'panoramas/p1/1/original.jpg'));
    expect(lido.toString()).toBe('oi');
  });

  it('devolve o que gravou', async () => {
    await disco.gravar('panoramas/p1/1/original.jpg', Buffer.from('oi'));

    expect((await disco.ler('panoramas/p1/1/original.jpg'))?.toString()).toBe('oi');
  });

  it('devolve null para arquivo que não existe, em vez de lançar', async () => {
    // É esse null que autoriza a queda para a coluna antiga do banco.
    expect(await disco.ler('panoramas/nao/existe.jpg')).toBeNull();
  });

  it('recusa chave que sobe de diretório', async () => {
    // A chave é montada a partir de ids, mas ela cruza a fronteira do processo
    // em `migrar-imagens` e em `varrer-orfaos`, que leem chave do banco. Uma
    // chave com `..` escreveria fora da raiz.
    await expect(
      disco.gravar('../fora.jpg', Buffer.from('x')),
    ).rejects.toThrow(/fora da raiz/);
  });

  it('não emite endereço público nem assinado', async () => {
    // Em desenvolvimento não existe CDN nem link assinado: a API continua
    // servindo os bytes, e é esse null que diz isso a quem pergunta.
    expect(disco.enderecoPublico('panoramas/p1/1/original.jpg')).toBeNull();
    expect(await disco.enderecoAssinado('panoramas/p1/1/original.jpg', 300)).toBeNull();
  });

  it('lista recursivamente o que está sob o prefixo, com a data', async () => {
    await disco.gravar('panoramas/p1/1/original.jpg', Buffer.from('a'));
    await disco.gravar('panoramas/p2/1/original.jpg', Buffer.from('b'));
    await disco.gravar('capturas/p1/0.jpg', Buffer.from('c'));

    const achados = [];
    for await (const objeto of disco.listar('panoramas/')) achados.push(objeto);

    expect(achados.map((o) => o.chave).sort()).toEqual([
      'panoramas/p1/1/original.jpg',
      'panoramas/p2/1/original.jpg',
    ]);
    expect(achados[0].modificadoEm).toBeInstanceOf(Date);
  });

  it('listar num prefixo inexistente devolve vazio, sem lançar', async () => {
    const achados = [];
    for await (const objeto of disco.listar('panoramas/')) achados.push(objeto);

    expect(achados).toEqual([]);
  });

  it('apagar some com o arquivo e não reclama se já não havia', async () => {
    await disco.gravar('panoramas/p1/1/original.jpg', Buffer.from('oi'));

    await disco.apagar('panoramas/p1/1/original.jpg');
    await disco.apagar('panoramas/p1/1/original.jpg');

    expect(await disco.ler('panoramas/p1/1/original.jpg')).toBeNull();
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test:scripts armazenamento-local
```

Esperado: FAIL — `Cannot find module './armazenamento-local'`.

- [ ] **Step 3: Escreva a implementação**

Crie `server-api/src/shared/armazenamento/armazenamento-local.ts`:

```ts
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve, sep } from 'node:path';
import {
  ArmazenamentoDeImagens,
  ObjetoArmazenado,
} from './armazenamento.port';

/**
 * A porta, em arquivos.
 *
 * Existe para que desenvolvimento e teste de integração não precisem de conta
 * na Cloudflare. O comportamento observável é o mesmo da R2 em tudo que
 * importa, com uma diferença deliberada: não há endereço público nem link
 * assinado, então a API continua servindo os bytes — que é exatamente o
 * comportamento da entrega A em produção.
 */
export class ArmazenamentoLocal implements ArmazenamentoDeImagens {
  constructor(private readonly raiz: string) {}

  async gravar(chave: string, bytes: Buffer): Promise<void> {
    const caminho = this.caminhoDe(chave);
    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, bytes);
  }

  async ler(chave: string): Promise<Buffer | null> {
    try {
      return await readFile(this.caminhoDe(chave));
    } catch (erro) {
      if (semArquivo(erro)) return null;
      throw erro;
    }
  }

  /** Não há CDN em desenvolvimento: a API serve. */
  enderecoPublico(): string | null {
    return null;
  }

  /** Não há o que assinar num arquivo local: a API serve, autenticada. */
  async enderecoAssinado(): Promise<string | null> {
    return null;
  }

  async apagar(chave: string): Promise<void> {
    await rm(this.caminhoDe(chave), { force: true });
  }

  async *listar(prefixo: string): AsyncIterable<ObjetoArmazenado> {
    yield* this.percorrer(prefixo.replace(/\/+$/, ''));
  }

  private async *percorrer(relativo: string): AsyncIterable<ObjetoArmazenado> {
    let entradas;
    try {
      entradas = await readdir(this.caminhoDe(relativo), { withFileTypes: true });
    } catch (erro) {
      // Prefixo que ainda não existe é "nada gravado ali", não erro: o balde
      // de um ambiente novo não tem nenhuma das duas pastas.
      if (semArquivo(erro)) return;
      throw erro;
    }

    for (const entrada of entradas) {
      const filho = posix.join(relativo, entrada.name);
      if (entrada.isDirectory()) {
        yield* this.percorrer(filho);
      } else {
        const info = await stat(this.caminhoDe(filho));
        yield { chave: filho, modificadoEm: info.mtime };
      }
    }
  }

  /**
   * A chave vem do banco em `migrar-imagens` e em `varrer-orfaos`, então ela
   * cruza a fronteira do processo. Uma com `..` escreveria fora da raiz — o
   * custo de conferir é uma comparação de string.
   */
  private caminhoDe(chave: string): string {
    const caminho = resolve(this.raiz, chave);
    if (caminho !== this.raiz && !caminho.startsWith(this.raiz + sep)) {
      throw new Error(`Chave aponta para fora da raiz do armazenamento: ${chave}`);
    }
    return caminho;
  }
}

function semArquivo(erro: unknown): boolean {
  return (erro as NodeJS.ErrnoException)?.code === 'ENOENT';
}
```

- [ ] **Step 4: Rode e veja passar**

```bash
cd server-api && yarn test:scripts armazenamento-local
```

Esperado: PASS, 8 testes.

- [ ] **Step 5: Lint e commit**

```bash
cd server-api && npx eslint src/shared/armazenamento
git add server-api/src/shared/armazenamento
git commit -m "feat(armazenamento): implementação em disco para desenvolvimento"
```

---

### Task 3: Armazenamento R2, configuração e módulo global

**Files:**
- Create: `server-api/src/shared/armazenamento/armazenamento-r2.ts`
- Create: `server-api/src/shared/armazenamento/armazenamento.module.ts`
- Test: `server-api/src/shared/armazenamento/armazenamento-r2.spec.ts`
- Modify: `server-api/src/config/env.schema.ts`
- Modify: `server-api/.env.example`
- Modify: `server-api/src/app.module.ts`
- Modify: `server-api/package.json` (dependências)

**Interfaces:**
- Consumes: `ArmazenamentoDeImagens`, `ObjetoArmazenado` (Task 1); `ArmazenamentoLocal` (Task 2).
- Produces: `class ArmazenamentoR2 implements ArmazenamentoDeImagens` com construtor `(config: ConfigDaR2)`; `interface ConfigDaR2 { endpoint: string; bucket: string; chaveId: string; chaveSecreta: string; urlPublica: string | null }`; `ArmazenamentoModule` (global, provê o token `ARMAZENAMENTO`).

- [ ] **Step 1: Instale as dependências**

```bash
cd server-api && yarn add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Escreva o teste que falha**

Crie `server-api/src/shared/armazenamento/armazenamento-r2.spec.ts`:

```ts
import { ArmazenamentoR2 } from './armazenamento-r2';

/**
 * Nenhum destes testes toca a rede. Assinar uma URL é criptografia sobre o
 * pedido e a credencial — não há I/O — e é justamente isso que dá para provar
 * sem bucket.
 */
const CONFIG = {
  endpoint: 'https://conta.r2.cloudflarestorage.com',
  bucket: 'imob360',
  chaveId: 'chave-de-teste',
  chaveSecreta: 'segredo-de-teste',
  urlPublica: null,
};

describe('ArmazenamentoR2', () => {
  it('sem URL pública configurada, não emite endereço público', () => {
    // É o estado da entrega A: as chaves já estão preenchidas, o domínio ainda
    // não existe, e a API continua servindo. Emitir aqui derrubaria a tela.
    const r2 = new ArmazenamentoR2(CONFIG);

    expect(r2.enderecoPublico('panoramas/p1/1/tratada.jpg')).toBeNull();
  });

  it('com URL pública configurada, emite o absoluto da CDN', () => {
    const r2 = new ArmazenamentoR2({ ...CONFIG, urlPublica: 'https://fotos.arpvision.com.br' });

    expect(r2.enderecoPublico('panoramas/p1/1/tratada.jpg')).toBe(
      'https://fotos.arpvision.com.br/panoramas/p1/1/tratada.jpg',
    );
  });

  it('a barra final da URL pública não vira barra dupla', () => {
    const r2 = new ArmazenamentoR2({ ...CONFIG, urlPublica: 'https://fotos.arpvision.com.br/' });

    expect(r2.enderecoPublico('panoramas/p1/1/tratada.jpg')).toBe(
      'https://fotos.arpvision.com.br/panoramas/p1/1/tratada.jpg',
    );
  });

  it('o link assinado expira no prazo pedido', async () => {
    // O teste 9 da spec. `X-Amz-Expires` é o prazo em segundos, gravado DENTRO
    // da assinatura: mexer nele invalida o link em vez de estendê-lo.
    const r2 = new ArmazenamentoR2(CONFIG);

    const assinado = await r2.enderecoAssinado('panoramas/p1/1/tratada.jpg', 300);

    const url = new URL(assinado!);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.host).toBe('conta.r2.cloudflarestorage.com');
    expect(url.pathname).toContain('panoramas/p1/1/tratada.jpg');
  });

  it('o link assinado carrega a credencial, e não o segredo', async () => {
    const r2 = new ArmazenamentoR2(CONFIG);

    const assinado = await r2.enderecoAssinado('panoramas/p1/1/tratada.jpg', 300);

    expect(assinado).toContain('chave-de-teste');
    expect(assinado).not.toContain('segredo-de-teste');
  });
});
```

- [ ] **Step 3: Rode e veja falhar**

```bash
cd server-api && yarn test:scripts armazenamento-r2
```

Esperado: FAIL — `Cannot find module './armazenamento-r2'`.

- [ ] **Step 4: Escreva a implementação da R2**

Crie `server-api/src/shared/armazenamento/armazenamento-r2.ts`:

```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ArmazenamentoDeImagens,
  ObjetoArmazenado,
} from './armazenamento.port';

export interface ConfigDaR2 {
  endpoint: string;
  bucket: string;
  chaveId: string;
  chaveSecreta: string;
  /** `null` até a entrega B: sem domínio, a API continua servindo. */
  urlPublica: string | null;
}

/**
 * A porta, na Cloudflare R2.
 *
 * A R2 fala o protocolo da S3, então a biblioteca é a da AWS e trocar de
 * fornecedor depois é mudar `endpoint`. `region: 'auto'` é o que a R2 exige: ela
 * não tem regiões, mas o assinador da AWS não assina sem uma.
 */
export class ArmazenamentoR2 implements ArmazenamentoDeImagens {
  private readonly cliente: S3Client;
  private readonly urlPublica: string | null;

  constructor(private readonly config: ConfigDaR2) {
    this.cliente = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.chaveId,
        secretAccessKey: config.chaveSecreta,
      },
    });
    // Sem a barra final, para a concatenação de `enderecoPublico` não produzir
    // `//` — que a CDN trata como caminho diferente e cacheia duas vezes.
    this.urlPublica = config.urlPublica?.replace(/\/+$/, '') ?? null;
  }

  async gravar(chave: string, bytes: Buffer): Promise<void> {
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: chave,
        Body: bytes,
        ContentType: 'image/jpeg',
        // `immutable` é honesto aqui e só aqui: a chave carrega a versão, então
        // este arquivo nunca muda. É o que faz invalidação de CDN sumir.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async ler(chave: string): Promise<Buffer | null> {
    try {
      const resposta = await this.cliente.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: chave }),
      );
      const bytes = await resposta.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (erro) {
      // Objeto ausente é resposta, não falha: é ele que autoriza a queda para a
      // coluna antiga do banco durante a migração. Qualquer outro erro sobe —
      // engolir um 403 aqui faria toda foto do balde parecer "não migrada".
      if (naoExiste(erro)) return null;
      throw erro;
    }
  }

  enderecoPublico(chave: string): string | null {
    return this.urlPublica ? `${this.urlPublica}/${chave}` : null;
  }

  async enderecoAssinado(chave: string, segundos: number): Promise<string | null> {
    return getSignedUrl(
      this.cliente,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: chave }),
      { expiresIn: segundos },
    );
  }

  async apagar(chave: string): Promise<void> {
    await this.cliente.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: chave }),
    );
  }

  async *listar(prefixo: string): AsyncIterable<ObjetoArmazenado> {
    let continuacao: string | undefined;
    do {
      const pagina = await this.cliente.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefixo,
          ContinuationToken: continuacao,
        }),
      );
      for (const objeto of pagina.Contents ?? []) {
        if (objeto.Key) {
          yield { chave: objeto.Key, modificadoEm: objeto.LastModified ?? new Date(0) };
        }
      }
      // Sem esta paginação a varredura enxergaria só as primeiras mil chaves e
      // declararia o resto órfão — que, com `--apagar`, seria apagar foto viva.
      continuacao = pagina.IsTruncated ? pagina.NextContinuationToken : undefined;
    } while (continuacao);
  }
}

function naoExiste(erro: unknown): boolean {
  const nome = (erro as { name?: string })?.name;
  const status = (erro as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return nome === 'NoSuchKey' || nome === 'NotFound' || status === 404;
}
```

- [ ] **Step 5: Rode e veja passar**

```bash
cd server-api && yarn test:scripts armazenamento-r2
```

Esperado: PASS, 5 testes.

- [ ] **Step 6: Deixe `src/config` rodar sem banco**

A spec de configuração do passo seguinte é código puro e não pode exigir
Postgres. `src/shared` já foi movido para a config de scripts pelo mesmo
motivo; `src/config` segue o mesmo caminho.

Em `server-api/jest.scripts.config.js`:

```js
  testRegex: '(scripts|src/shared|src/config)/.*\\.spec\\.ts$',
```

Em `server-api/package.json`, no bloco `jest`, acrescente a última linha de
`testPathIgnorePatterns`:

```json
    "testPathIgnorePatterns": [
      "/node_modules/",
      "/dist/",
      "/scripts/",
      "/src/shared/",
      "/src/config/"
    ],
```

- [ ] **Step 7: Escreva o teste de configuração**

Crie `server-api/src/config/env.schema.spec.ts`:

```ts
import { validateEnv } from './env.schema';

const MINIMO = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('configuração do armazenamento', () => {
  it('sobe sem nenhuma variável de storage: o disco local atende', () => {
    // Desenvolvimento e a suíte de teste NÃO podem exigir bucket.
    const env = validateEnv(MINIMO);

    expect(env.STORAGE_ENDPOINT).toBe('');
    expect(env.STORAGE_LOCAL_DIR).toBe('.armazenamento');
  });

  it('recusa configuração pela metade em vez de cair no disco calado', () => {
    // Uma produção com endpoint e sem credencial gravaria no disco efêmero do
    // container, e a foto sumiria no próximo deploy sem nada denunciando.
    expect(() =>
      validateEnv({
        ...MINIMO,
        STORAGE_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
      }),
    ).toThrow(/STORAGE_BUCKET/);
  });

  it('aceita a configuração completa da R2', () => {
    const env = validateEnv({
      ...MINIMO,
      STORAGE_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
      STORAGE_BUCKET: 'imob360',
      STORAGE_ACCESS_KEY_ID: 'id',
      STORAGE_SECRET_ACCESS_KEY: 'segredo',
    });

    expect(env.STORAGE_BUCKET).toBe('imob360');
    // A entrega B é ligar ESTA variável. Vazia por padrão, de propósito.
    expect(env.STORAGE_PUBLIC_URL).toBe('');
  });
});
```

Rode e veja falhar:

```bash
cd server-api && yarn test:scripts env.schema
```

Esperado: FAIL — `env.STORAGE_ENDPOINT` é `undefined`.

- [ ] **Step 8: Some as variáveis ao schema**

Em `server-api/src/config/env.schema.ts`, dentro do `z.object({...})`, depois de `CSP_EXTRA_ORIGINS`:

```ts
    /**
     * Onde as fotos moram. Vazio = disco local, que é o modo de desenvolvimento
     * e o da suíte de teste. Preenchido = R2, e aí as três abaixo passam a ser
     * obrigatórias (ver o `refine` no fim do schema).
     */
    STORAGE_ENDPOINT: z.string().default(''),
    STORAGE_BUCKET: z.string().default(''),
    STORAGE_ACCESS_KEY_ID: z.string().default(''),
    STORAGE_SECRET_ACCESS_KEY: z.string().default(''),
    /**
     * Endereço público do balde, com domínio próprio na Cloudflare.
     *
     * **É esta variável que liga a entrega B.** Preenchida, o payload do tour
     * passa a emitir o endereço da CDN e o navegador busca direto; vazia, a API
     * continua servindo mesmo com as chaves todas preenchidas. Apagá-la é o
     * caminho de volta, sem deploy e sem migração reversa.
     */
    STORAGE_PUBLIC_URL: z.string().default(''),
    /** Raiz do armazenamento em disco, relativa a `server-api/`. */
    STORAGE_LOCAL_DIR: z.string().default('.armazenamento'),
```

E, depois do `.refine` que já existe, encadeie outro:

```ts
  .refine(
    (env) =>
      !env.STORAGE_ENDPOINT ||
      Boolean(
        env.STORAGE_BUCKET &&
          env.STORAGE_ACCESS_KEY_ID &&
          env.STORAGE_SECRET_ACCESS_KEY,
      ),
    {
      // Meia configuração é pior que nenhuma: com endpoint e sem credencial a
      // API cairia no disco do container, e a foto sumiria no deploy seguinte
      // sem nada denunciando. Este schema existe para transformar isso em
      // falha visível no boot.
      message:
        'com STORAGE_ENDPOINT definido, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID e STORAGE_SECRET_ACCESS_KEY são obrigatórias',
      path: ['STORAGE_BUCKET'],
    },
  )
```

Rode: `yarn test:scripts env.schema` → PASS, 3 testes.

- [ ] **Step 9: Escreva o módulo**

Crie `server-api/src/shared/armazenamento/armazenamento.module.ts`:

```ts
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { Env } from '../../config/env.schema';
import { ArmazenamentoLocal } from './armazenamento-local';
import { ArmazenamentoR2 } from './armazenamento-r2';
import { ARMAZENAMENTO, ArmazenamentoDeImagens } from './armazenamento.port';

/**
 * Escolhe onde as fotos moram, uma vez, no boot.
 *
 * `@Global` pelo mesmo motivo do `PrismaModule`: a porta é lida em três
 * módulos (panoramas, virtual-tours e os scripts), e importá-la em cada um
 * seria repetir a fiação sem ganhar nada.
 *
 * A escolha é por `STORAGE_ENDPOINT` e não por `NODE_ENV`: é o que permite
 * apontar um ambiente de desenvolvimento para um balde de verdade sem mentir
 * sobre o ambiente, e é o que mantém a suíte no disco sem precisar saber que é
 * uma suíte.
 */
@Global()
@Module({
  providers: [
    {
      provide: ARMAZENAMENTO,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ArmazenamentoDeImagens => {
        const endpoint = config.get('STORAGE_ENDPOINT', { infer: true });
        const logger = new Logger('Armazenamento');

        if (!endpoint) {
          const raiz = resolve(config.get('STORAGE_LOCAL_DIR', { infer: true }));
          logger.log(`Fotos em disco, em ${raiz}. Sem STORAGE_ENDPOINT.`);
          return new ArmazenamentoLocal(raiz);
        }

        const urlPublica = config.get('STORAGE_PUBLIC_URL', { infer: true });
        logger.log(
          urlPublica
            ? `Fotos na R2, servidas por ${urlPublica}.`
            : 'Fotos na R2, servidas pela API (STORAGE_PUBLIC_URL vazia).',
        );

        return new ArmazenamentoR2({
          endpoint,
          bucket: config.get('STORAGE_BUCKET', { infer: true }),
          chaveId: config.get('STORAGE_ACCESS_KEY_ID', { infer: true }),
          chaveSecreta: config.get('STORAGE_SECRET_ACCESS_KEY', { infer: true }),
          urlPublica: urlPublica || null,
        });
      },
    },
  ],
  exports: [ARMAZENAMENTO],
})
export class ArmazenamentoModule {}
```

- [ ] **Step 10: Ligue o módulo no `AppModule`**

Em `server-api/src/app.module.ts`, some o import e a entrada em `imports`, logo depois de `PrismaModule`:

```ts
import { ArmazenamentoModule } from './shared/armazenamento/armazenamento.module';
```

```ts
    PrismaModule,
    ArmazenamentoModule,
```

- [ ] **Step 11: Documente as variáveis**

Em `server-api/.env.example`, na seção **OPCIONAIS**, depois de `CSP_EXTRA_ORIGINS`:

```
# ---------------------------------------------------------------------------
# ARMAZENAMENTO DAS FOTOS
# ---------------------------------------------------------------------------
# Vazias = as fotos ficam em disco, sob STORAGE_LOCAL_DIR. É o modo de
# desenvolvimento e o da suíte de teste: nenhum dos dois precisa de bucket.
#
# [validada] Endpoint S3 do balde. Na Cloudflare R2:
# https://<ID-DA-CONTA>.r2.cloudflarestorage.com
# Definir esta obriga as três seguintes — meia configuração derruba o boot de
# propósito, para a API não cair calada no disco efêmero do container.
STORAGE_ENDPOINT=
STORAGE_BUCKET=
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=

# [validada] Endereço público do balde, com domínio próprio na Cloudflare.
# É ESTA variável que liga a entrega B: com ela, o payload do tour emite o
# endereço da CDN e o navegador busca direto; sem ela, a API continua servindo
# mesmo com todas as chaves preenchidas. Apagá-la é o caminho de volta.
# Atenção: o domínio precisa entrar também em CSP_EXTRA_ORIGINS, e nos
# cabeçalhos do site estático que serve o Angular.
# Ex.: https://fotos.arpvision.com.br
STORAGE_PUBLIC_URL=

# [validada] Raiz do armazenamento em disco, relativa a server-api/.
# Default: .armazenamento (já ignorada pelo git).
STORAGE_LOCAL_DIR=
```

E acrescente `.armazenamento/` ao `.gitignore` do `server-api/` (ou da raiz, onde os outros ignores vivem).

- [ ] **Step 12: A suíte inteira continua verde**

```bash
cd server-api && yarn test:scripts && yarn test
```

Esperado: tudo PASS. O `AppModule` agora provê o token; nenhum consumidor existe ainda.

- [ ] **Step 13: Lint e commit**

```bash
cd server-api && npx eslint src/shared/armazenamento src/config/env.schema.ts src/app.module.ts
git add server-api
git commit -m "feat(armazenamento): implementação R2, configuração validada e módulo global"
```

---

### Task 4: As colunas de endereço no banco

**Files:**
- Modify: `server-api/prisma/schema.prisma`
- Create: `server-api/prisma/migrations/20260915120000_imagens_em_armazenamento/migration.sql`
- Modify: `server-api/src/modules/panoramas/services/treat-panorama.service.ts:380-433`
- Test: `server-api/test/colunas-de-endereco.spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `Panorama.imageKey: string | null`, `Panorama.treatedImageKey: string | null`, `CaptureFrame.imageKey: string | null`; `Panorama.imageData` e `CaptureFrame.imageData` passam a `string | null`.

Esta task não muda comportamento nenhum: ela só abre espaço. É o passo 1 da migração da spec.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/colunas-de-endereco.spec.ts`:

```ts
import { prisma } from './setup/prisma';
import { seedTwoTenants, TwoTenants } from './fixtures';

/**
 * O passo 1 da migração: as colunas de endereço nascem vazias e as de bytes
 * passam a aceitar nulo. Nada muda de comportamento — o que muda é o que o
 * banco permite guardar.
 */
describe('colunas de endereço', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  it('aceita panorama com endereço e SEM bytes', async () => {
    // O estado final da migração: a coluna some e sobra a chave.
    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'PUBLISHED' },
    });

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: tour.id,
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageKey: 'panoramas/x/2/tratada.jpg',
      },
    });

    expect(panorama.imageData).toBeNull();
    expect(panorama.imageKey).toBe('panoramas/x/1/original.jpg');
    expect(panorama.treatedImageKey).toBe('panoramas/x/2/tratada.jpg');
  });

  it('aceita panorama com bytes e SEM endereço', async () => {
    // O estado de hoje, que tem de continuar válido durante a migração inteira.
    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'PUBLISHED' },
    });

    const panorama = await prisma.panorama.create({
      data: { roomName: 'Sala', virtualTourId: tour.id, imageData: 'AAAA' },
    });

    expect(panorama.imageKey).toBeNull();
    expect(panorama.imageData).toBe('AAAA');
  });

  it('aceita foto de captura com endereço e sem bytes', async () => {
    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'DRAFT' },
    });
    const panorama = await prisma.panorama.create({
      data: { roomName: 'Sala', virtualTourId: tour.id, imageData: 'AAAA' },
    });

    const frame = await prisma.captureFrame.create({
      data: {
        panoramaId: panorama.id,
        index: 0,
        qx: 0, qy: 0, qz: 0, qw: 1,
        imageKey: 'capturas/x/0.jpg',
      },
    });

    expect(frame.imageData).toBeNull();
    expect(frame.imageKey).toBe('capturas/x/0.jpg');
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && docker compose up -d --wait db && yarn test colunas-de-endereco
```

Esperado: FAIL — `Unknown argument 'imageKey'`.

- [ ] **Step 3: Mude o schema**

Em `server-api/prisma/schema.prisma`, no `model Panorama`:

```prisma
  imageData       String? @db.Text // base64 JPEG — legado, sai no fim da migração
```

E, logo abaixo do bloco de `treatedImageData`/`treatmentStatus`, some:

```prisma
  /// Onde a foto mora no balde de objetos.
  ///
  /// A chave carrega a versão (`panoramas/{id}/{versao}/original.jpg`) e o
  /// arquivo é imutável: refotografar a sala escreve uma chave nova e esta
  /// coluna passa a apontar para ela. É isso que faz invalidação de CDN sumir
  /// como classe de problema.
  ///
  /// Convive com `imageData` durante a migração, e a leitura PREFERE a chave.
  /// É a queda para a coluna que mantém tour publicado vivo enquanto o
  /// preenchimento roda.
  imageKey        String?
  treatedImageKey String?
```

No `model CaptureFrame`:

```prisma
  imageData String? @db.Text // base64 JPEG — legado, sai no fim da migração
  /// Onde a foto de referência mora no balde. Sem versão: um reenvio depois de
  /// falha de rede repõe a mesma foto, como o upsert por (panorama, índice).
  imageKey  String?
```

- [ ] **Step 4: Escreva a migração**

Crie `server-api/prisma/migrations/20260915120000_imagens_em_armazenamento/migration.sql`:

```sql
-- Passo 1 da migração das fotos para armazenamento de objetos.
-- Sozinha, sem mudança de comportamento: as colunas nascem vazias e a leitura
-- ainda não as consulta.
ALTER TABLE "Panorama" ADD COLUMN "imageKey" TEXT;
ALTER TABLE "Panorama" ADD COLUMN "treatedImageKey" TEXT;
ALTER TABLE "CaptureFrame" ADD COLUMN "imageKey" TEXT;

-- As colunas de bytes passam a aceitar nulo. Nenhuma linha existente muda.
ALTER TABLE "Panorama" ALTER COLUMN "imageData" DROP NOT NULL;
ALTER TABLE "CaptureFrame" ALTER COLUMN "imageData" DROP NOT NULL;
```

- [ ] **Step 5: Aplique e gere o cliente**

```bash
cd server-api && npx prisma migrate dev --name imagens_em_armazenamento && npx prisma generate
```

- [ ] **Step 6: Trate os dois pontos onde o nulo agora aparece**

Com `imageData` opcional, o TypeScript aponta dois usos em `treat-panorama.service.ts`. Os dois recebem guarda, e as guardas são reais — uma linha com chave e sem bytes é exatamente o que a migração produz.

Em `equirectParaOModelo`, troque:

```ts
    if (!original) throw new NotFoundException('Panorama não encontrado.');

    const originalBuf = Buffer.from(base64Puro(original.imageData), 'base64');
```

por:

```ts
    if (!original?.imageData) {
      // Sem bytes na coluna: ou o panorama sumiu, ou ele já migrou para o
      // balde. A Task 10 troca esta leitura pelo leitor; até lá, dispensar é
      // mais honesto do que montar a partir de nada.
      throw new NotFoundException('Panorama sem imagem para tratar.');
    }

    const originalBuf = Buffer.from(base64Puro(original.imageData), 'base64');
```

Em `referencias`, troque o corpo do laço:

```ts
    const fotos: Buffer[] = [];
    for (let linha = linhas.shift(); linha; linha = linhas.shift()) {
      if (!linha.imageData) continue;
      fotos.push(
        await sharp(Buffer.from(base64Puro(linha.imageData), 'base64'))
          .resize({ width: LARGURA_DA_REFERENCIA })
          .png()
          .toBuffer(),
      );
    }
```

- [ ] **Step 7: Rode e veja passar**

```bash
cd server-api && yarn test
```

Esperado: tudo PASS, incluindo os 3 novos.

- [ ] **Step 8: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas/services/treat-panorama.service.ts
git add server-api/prisma server-api/src server-api/test
git commit -m "feat(panoramas): colunas de endereço no banco, bytes passam a opcionais"
```

---

### Task 5: A capa, e a poda de `panorama-miniatura.ts`

**Files:**
- Create: `server-api/src/modules/panoramas/capa-do-panorama.ts`
- Modify: `server-api/src/modules/panoramas/panorama-miniatura.ts` (fica só com `etagDe` e `clienteJaTem`)
- Modify: `server-api/src/modules/panoramas/services/get-panorama-image.service.ts` (imports)
- Modify: `server-api/src/modules/panoramas/services/get-panorama-preview.service.ts` (imports)
- Modify: `server-api/src/modules/virtual-tours/services/get-thumbnail.service.ts` (imports)
- Modify: `server-api/test/miniaturas-em-lote.spec.ts`, `server-api/test/panorama-image.spec.ts` (imports)
- Test: `server-api/test/capa-do-panorama.spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces, de `capa-do-panorama.ts`: `LARGURA_DA_CAPA = 640`, `LARGURA_MAXIMA = 2048`, `reduzir(original: Buffer, largura: number): Promise<Buffer>`, `reduzirParaCapa(original: Buffer): Promise<Buffer>`, `chaveDeCache(panoramaId, updatedAt, largura, variante?)`, `reduzirComCache(chave, largura, carregar)`, `limparCacheDeCapa()`.
- `panorama-miniatura.ts` continua exportando `etagDe` e `clienteJaTem`, sem mudança de assinatura.

**Nada muda de comportamento nesta task.** É mudança de endereço: o
redimensionamento sob demanda sai de `panorama-miniatura.ts` e vira, no arquivo
novo, o **caminho de queda** — o que atende linha ainda não migrada. Quem revisa
deve ver os mesmos bytes saindo pelas mesmas rotas.

> **Por que o portão não morre aqui.** A spec diz que o portão de duas reduções
> simultâneas deixa de ser necessário, e deixa — depois que toda linha tem capa
> gravada. Entre o deploy e o fim do `migrar-imagens`, um tour de nove cômodos
> não migrados custaria os mesmos 113 MB de 10/09/2026. Apagar o portão é a
> etapa 5 da migração, operacional, documentada na Task 17.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/capa-do-panorama.spec.ts`:

```ts
import sharp from 'sharp';
import {
  LARGURA_DA_CAPA,
  reduzirParaCapa,
} from '../src/modules/panoramas/capa-do-panorama';

async function panoramica(largura: number, altura: number): Promise<Buffer> {
  return sharp({
    create: { width: largura, height: altura, channels: 3, background: { r: 120, g: 120, b: 120 } },
  })
    .jpeg()
    .toBuffer();
}

describe('capa do panorama', () => {
  it('sai com 640 de largura', async () => {
    // O teste 5 da spec. Um tamanho só: 640 cobre o card de imóvel (320 CSS px
    // em tela 2x) e a faixa de cenas (292), e a diferença de banda entre os
    // dois não paga a complexidade de manter duas capas.
    const capa = await reduzirParaCapa(await panoramica(4096, 2048));

    expect((await sharp(capa).metadata()).width).toBe(LARGURA_DA_CAPA);
  });

  it('mantém a proporção 2:1 da equirretangular', async () => {
    const capa = await reduzirParaCapa(await panoramica(4096, 2048));

    const meta = await sharp(capa).metadata();
    expect(meta.height).toBe(LARGURA_DA_CAPA / 2);
  });

  it('não amplia uma panorâmica menor que a capa', async () => {
    // Esticar uma foto pequena só gastaria bytes: não há detalhe para inventar.
    const capa = await reduzirParaCapa(await panoramica(400, 200));

    expect((await sharp(capa).metadata()).width).toBe(400);
  });

  it('a capa é muito menor que a panorâmica de origem', async () => {
    const original = await panoramica(4096, 2048);

    const capa = await reduzirParaCapa(original);

    expect(capa.length).toBeLessThan(original.length / 4);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test capa-do-panorama
```

Esperado: FAIL — `Cannot find module '../src/modules/panoramas/capa-do-panorama'`.

- [ ] **Step 3: Crie `capa-do-panorama.ts` movendo o que é redimensionamento**

Crie `server-api/src/modules/panoramas/capa-do-panorama.ts` com o conteúdo abaixo. **Todo o corpo de `reduzir`, `chaveDeCache`, `doCache`, `guardar`, `naVez` e `reduzirComCache` vem de `panorama-miniatura.ts` sem uma linha de diferença** — mova, não reescreva, e leve os comentários junto: eles guardam medições que não se reconstroem.

```ts
import sharp from 'sharp';

/**
 * A capa de 640 px de um panorama: a que é GRAVADA ao lado da imagem no balde,
 * e a que é calculada sob demanda enquanto houver linha não migrada.
 *
 * Um tamanho só. Antes havia 640 (card de imóvel) e 292 (faixa de cenas); 640
 * serve os dois, pesa uns 50 kB, e a diferença de banda não paga a
 * complexidade de manter duas.
 *
 * A metade de baixo deste arquivo — cache, portão e `reduzirComCache` — é o
 * CAMINHO DE QUEDA, e tem prazo de validade. Ela atende a linha que ainda não
 * tem capa gravada. Quando `migrar-imagens` terminar e as colunas de bytes
 * saírem, ela sai junto e sobra `reduzirParaCapa`. Ver o runbook em
 * `docs/operacao/migracao-das-fotos.md`.
 */

/** Cobre um card de ~320 CSS px em tela 2x, e a faixa de cenas de 292. */
export const LARGURA_DA_CAPA = 640;

/** Teto de `?w=`: acima disso serve a imagem original, sem custo de sharp. */
export const LARGURA_MAXIMA = 2048;

/**
 * Reduz o JPEG para a largura pedida, mantendo a proporção 2:1 da
 * equirretangular. `withoutEnlargement` porque esticar uma foto pequena só
 * gastaria bytes.
 *
 * Qualidade 78 e `progressive`: a capa aparece borrada e vai nitidando em vez
 * de descer de cima para baixo, que é o que se quer numa lista.
 */
export async function reduzir(original: Buffer, largura: number): Promise<Buffer> {
  return sharp(original)
    .resize({ width: largura, withoutEnlargement: true })
    .jpeg({ quality: 78, progressive: true })
    .toBuffer();
}

/**
 * A capa que vai para o balde, ao lado da imagem.
 *
 * Sem portão e sem cache de propósito: aqui a redução acontece UMA vez na vida
 * da imagem, no caminho de escrita, onde já existe um limite de concorrência
 * (a montagem é serial e a captura é foto a foto). O que precisa de portão é a
 * LEITURA de linha não migrada, abaixo.
 */
export async function reduzirParaCapa(original: Buffer): Promise<Buffer> {
  return reduzir(original, LARGURA_DA_CAPA);
}

// ---------------------------------------------------------------------------
// Caminho de queda: linha que ainda não tem capa gravada no balde.
// Some quando as colunas de bytes saírem (etapa 5 da migração).
// ---------------------------------------------------------------------------

// [MOVER DE panorama-miniatura.ts, sem alteração:]
//   MAX_ENTRADAS, cache, chaveDeCache, doCache, guardar,
//   SIMULTANEAS, rodando, esperando, naVez, reduzirComCache
//
// E renomeie APENAS `limparCacheDeMiniatura` para `limparCacheDeCapa` — o nome
// antigo fala de um arquivo que deixou de existir.
```

O arquivo final tem, além do que está escrito acima, os blocos movidos. `limparCacheDeCapa` é o único rename.

- [ ] **Step 4: Pode `panorama-miniatura.ts`**

O arquivo passa a ter só o cabeçalho novo, `etagDe` e `clienteJaTem`, com os comentários dos dois preservados. Substitua o cabeçalho do arquivo por:

```ts
/**
 * Identidade de cache das imagens de panorama: o ETag e a leitura do
 * `If-None-Match`.
 *
 * O redimensionamento que morava aqui foi para `capa-do-panorama.ts` quando a
 * capa passou a ser GRAVADA em vez de calculada. O que sobrou é o par que
 * responde "o cliente já tem esta versão?", e ele continua valendo para os
 * dois caminhos: bytes vindos do balde e bytes vindos da coluna antiga.
 */
```

Apague de `panorama-miniatura.ts`: o `import sharp`, `LARGURA_MINIATURA`,
`LARGURA_MAXIMA`, `MAX_ENTRADAS`, `cache`, `chaveDeCache`, `doCache`,
`guardar`, `limparCacheDeMiniatura`, `SIMULTANEAS`, `rodando`, `esperando`,
`naVez`, `reduzir` e `reduzirComCache`. Ficam **só** `etagDe` e `clienteJaTem`.

- [ ] **Step 5: Aponte os importadores para o endereço novo**

Em `get-panorama-image.service.ts` e `get-panorama-preview.service.ts`, troque o import único por dois:

```ts
import { clienteJaTem, etagDe } from '../panorama-miniatura';
import {
  LARGURA_MAXIMA,
  chaveDeCache,
  reduzirComCache,
} from '../capa-do-panorama';
```

Em `get-thumbnail.service.ts`:

```ts
import { clienteJaTem, etagDe } from '../../panoramas/panorama-miniatura';
import {
  LARGURA_DA_CAPA,
  chaveDeCache,
  reduzirComCache,
} from '../../panoramas/capa-do-panorama';
```

e troque as duas ocorrências de `LARGURA_MINIATURA` por `LARGURA_DA_CAPA` (mesmo valor, 640).

Em `test/miniaturas-em-lote.spec.ts`, troque a origem de `reduzirComCache` e de
`limparCacheDeMiniatura` para `../src/modules/panoramas/capa-do-panorama`, e o
nome da segunda para `limparCacheDeCapa`.

Em `test/panorama-image.spec.ts`, mesma troca para `limparCacheDeCapa`.

Faça uma varredura final para garantir que nada ficou apontando para o nome antigo:

```bash
cd server-api && npx tsc --noEmit
grep -rn "limparCacheDeMiniatura\|LARGURA_MINIATURA" src test
```

Esperado: `tsc` limpo e o `grep` sem resultado.

- [ ] **Step 6: Rode a suíte inteira**

```bash
cd server-api && yarn test
```

Esperado: tudo PASS, incluindo os 4 novos de `capa-do-panorama`. **Nenhuma
asserção de largura muda nesta task** — se alguma mudou, o movimento não foi
puro e algo foi reescrito em vez de movido.

- [ ] **Step 7: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas src/modules/virtual-tours/services/get-thumbnail.service.ts test/capa-do-panorama.spec.ts
git add server-api/src server-api/test
git commit -m "refactor(panoramas): capa ganha arquivo próprio; panorama-miniatura fica só com o ETag"
```

---

### Task 6: O gravador de imagens

**Files:**
- Create: `server-api/src/modules/panoramas/gravador-de-imagens.service.ts`
- Modify: `server-api/src/modules/panoramas/panoramas.module.ts`
- Test: `server-api/test/gravador-de-imagens.spec.ts`

**Interfaces:**
- Consumes: `ARMAZENAMENTO`, `ArmazenamentoDeImagens`, `chaveDoPanorama`, `chaveDaCapa`, `chaveDaCaptura`, `versaoAgora`, `VarianteDeImagem` (Task 1); `reduzirParaCapa` (Task 5).
- Produces: `class GravadorDeImagens` com
  - `gravarPanorama(panoramaId: string, bytes: Buffer, variante: VarianteDeImagem): Promise<string>` → devolve a chave da imagem (a da capa se deduz com `chaveDaCapa`)
  - `gravarCaptura(panoramaId: string, indice: number, bytes: Buffer): Promise<string>` → devolve a chave
  - Exportado do `PanoramasModule` (o tratamento e as fotos de captura o usam de outros arquivos).

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/gravador-de-imagens.spec.ts`:

```ts
import sharp from 'sharp';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';

async function panoramica(): Promise<Buffer> {
  return sharp({
    create: { width: 4096, height: 2048, channels: 3, background: { r: 90, g: 90, b: 90 } },
  })
    .jpeg()
    .toBuffer();
}

describe('GravadorDeImagens', () => {
  let balde: ArmazenamentoEmMemoria;
  let gravador: GravadorDeImagens;

  beforeEach(() => {
    balde = new ArmazenamentoEmMemoria();
    gravador = new GravadorDeImagens(balde);
  });

  it('grava a imagem e a capa, na mesma versão', async () => {
    const chave = await gravador.gravarPanorama('p1', await panoramica(), 'original');

    expect(chave).toMatch(/^panoramas\/p1\/\d+\/original\.jpg$/);
    expect(balde.tem(chave)).toBe(true);
    expect(balde.tem(chaveDaCapa(chave))).toBe(true);
  });

  it('a capa gravada tem 640 de largura', async () => {
    const chave = await gravador.gravarPanorama('p1', await panoramica(), 'tratada');

    const capa = await balde.ler(chaveDaCapa(chave));
    expect((await sharp(capa!).metadata()).width).toBe(640);
  });

  it('duas gravações do mesmo panorama não se sobrescrevem', async () => {
    // A imutabilidade é o que faz invalidação de CDN sumir. Se a segunda
    // gravação reusasse a chave, um visitante com a primeira em cache ficaria
    // com a foto velha para sempre.
    const primeira = await gravador.gravarPanorama('p1', await panoramica(), 'tratada');
    await new Promise((seguir) => setTimeout(seguir, 2));
    const segunda = await gravador.gravarPanorama('p1', await panoramica(), 'tratada');

    expect(primeira).not.toBe(segunda);
    expect(balde.tem(primeira)).toBe(true);
    expect(balde.tem(segunda)).toBe(true);
  });

  it('a foto da captura vai sem capa e sem versão', async () => {
    // Referência para o modelo, nunca mostrada em tela: capa seria trabalho e
    // bytes para nada. Sem versão porque o reenvio precisa REPOR a mesma foto.
    const chave = await gravador.gravarCaptura('p1', 7, Buffer.from('foto'));

    expect(chave).toBe('capturas/p1/7.jpg');
    expect(balde.chaves()).toEqual(['capturas/p1/7.jpg']);
  });

  it('o reenvio da mesma foto da captura repõe, em vez de acumular', async () => {
    await gravador.gravarCaptura('p1', 7, Buffer.from('primeira'));
    await gravador.gravarCaptura('p1', 7, Buffer.from('segunda'));

    expect(balde.chaves()).toEqual(['capturas/p1/7.jpg']);
    expect((await balde.ler('capturas/p1/7.jpg'))?.toString()).toBe('segunda');
  });

  it('se a capa falhar, nada é dado por gravado', async () => {
    // A ordem da decisão 10 vale para dentro: quem chama só recebe a chave
    // quando as DUAS existem. Devolver a chave com a capa faltando produziria
    // um card de imóvel sem imagem, e nada denunciando.
    const balde = new ArmazenamentoEmMemoria();
    jest
      .spyOn(balde, 'gravar')
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw new Error('balde recusou a capa');
      });

    await expect(
      new GravadorDeImagens(balde).gravarPanorama('p1', await panoramica(), 'original'),
    ).rejects.toThrow('balde recusou a capa');
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test gravador-de-imagens
```

Esperado: FAIL — módulo não encontrado.

- [ ] **Step 3: Escreva o gravador**

Crie `server-api/src/modules/panoramas/gravador-de-imagens.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import {
  ARMAZENAMENTO,
  ArmazenamentoDeImagens,
  VarianteDeImagem,
  chaveDaCapa,
  chaveDaCaptura,
  chaveDoPanorama,
  versaoAgora,
} from '../../shared/armazenamento/armazenamento.port';
import { reduzirParaCapa } from './capa-do-panorama';

/**
 * Põe uma imagem no balde e devolve a chave. Um lugar só, para as três rotas
 * que gravam foto: a captura de um cômodo, a refotografia e o tratamento por
 * IA.
 *
 * Existe por DRY com consequência: a capa é gerada aqui, e duas cópias dessa
 * regra divergiriam na qualidade sem ninguém perceber — foi o argumento que
 * criou `panorama-miniatura.ts` e continua valendo.
 *
 * **Quem chama grava o banco DEPOIS.** Este serviço não toca o Prisma de
 * propósito: é o `await` dele que precisa ter terminado antes de a linha
 * apontar para a chave. Se o balde aceitar e o banco falhar, sobra um arquivo
 * sem dono, que custa centavos e `varrer-orfaos` recolhe; se o banco gravasse
 * primeiro, uma falha deixaria uma linha apontando para o nada — e isso é tela
 * sem imagem.
 */
@Injectable()
export class GravadorDeImagens {
  constructor(
    @Inject(ARMAZENAMENTO)
    private readonly armazenamento: ArmazenamentoDeImagens,
  ) {}

  /**
   * Devolve a chave da imagem. A da capa se deduz com `chaveDaCapa` — não há
   * terceira coluna no banco guardando um endereço que já é calculável.
   */
  async gravarPanorama(
    panoramaId: string,
    bytes: Buffer,
    variante: VarianteDeImagem,
  ): Promise<string> {
    const chave = chaveDoPanorama(panoramaId, versaoAgora(), variante);

    // Imagem antes da capa: se a capa falhar, o `throw` sobe e quem chamou não
    // grava o banco. O que fica no balde é órfão, que é o lado barato do erro.
    await this.armazenamento.gravar(chave, bytes);
    await this.armazenamento.gravar(chaveDaCapa(chave), await reduzirParaCapa(bytes));

    return chave;
  }

  /**
   * Foto de referência da captura. Sem capa: ela nunca é mostrada em tela, só
   * lida pelo tratamento. Sem versão: o envio acontece foto a foto em segundo
   * plano e um reenvio depois de falha de rede precisa REPOR a mesma foto.
   */
  async gravarCaptura(
    panoramaId: string,
    indice: number,
    bytes: Buffer,
  ): Promise<string> {
    const chave = chaveDaCaptura(panoramaId, indice);
    await this.armazenamento.gravar(chave, bytes);
    return chave;
  }
}
```

- [ ] **Step 4: Registre no módulo**

Em `server-api/src/modules/panoramas/panoramas.module.ts`, some o import, a
entrada em `providers` e a entrada em `exports` (o tratamento e as fotos de
captura vivem noutros arquivos, e `virtual-tours` vai precisar dele também):

```ts
import { GravadorDeImagens } from './gravador-de-imagens.service';
```

```ts
    PanoramaImageReader,
    GravadorDeImagens,
```

```ts
  exports: [TreatPanoramaService, PanoramaImageReader, GravadorDeImagens],
```

- [ ] **Step 5: Rode e veja passar**

```bash
cd server-api && yarn test gravador-de-imagens
```

Esperado: PASS, 6 testes.

- [ ] **Step 6: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas test/gravador-de-imagens.spec.ts
git add server-api/src server-api/test
git commit -m "feat(panoramas): gravador que põe imagem e capa no balde"
```

---

### Task 7: A leitura prefere o endereço e cai na coluna

**Files:**
- Modify: `server-api/src/modules/panoramas/panorama-image.reader.ts`
- Modify: `server-api/src/modules/panoramas/panorama-image.ts` (acrescenta `chaveServida`)
- Modify: `server-api/test/panorama-image.spec.ts:11-14`, `server-api/test/thumbnail.spec.ts:11-14`, `server-api/test/rascunho-de-captura.spec.ts:29` (o construtor do leitor ganha um argumento)
- Test: `server-api/test/leitura-do-balde.spec.ts`

**Interfaces:**
- Consumes: `ARMAZENAMENTO`, `ArmazenamentoDeImagens`, `chaveDaCapa` (Task 1); as colunas da Task 4.
- Produces:
  - `new PanoramaImageReader(prisma: PrismaService, armazenamento: ArmazenamentoDeImagens)` — **a assinatura do construtor muda**; todo teste que o constrói passa a precisar de um `ArmazenamentoEmMemoria`.
  - `carregar(panoramaId: string, preferirTratada: boolean): Promise<Buffer | null>` — sem mudança de assinatura.
  - `carregarCapa(panoramaId: string, preferirTratada: boolean): Promise<Buffer | null>` — **novo**; `null` quando a variante servida ainda não tem chave, e é esse `null` que manda quem chama reduzir sob demanda.
  - `chaveServida(linha: { imageKey: string | null; treatedImageKey: string | null }, preferirTratada: boolean): string | null`, exportada de `panorama-image.ts`.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/leitura-do-balde.spec.ts`:

```ts
import sharp from 'sharp';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TenantFixture, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function jpeg(tom: number): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 400, channels: 3, background: { r: tom, g: tom, b: tom } },
  })
    .jpeg()
    .toBuffer();
}

/** O tom médio distingue uma imagem da outra sem comparar bytes. */
async function tomDe(bytes: Buffer): Promise<number> {
  const { channels } = await sharp(bytes).stats();
  return Math.round(channels[0].mean);
}

async function seedTour(tenant: TenantFixture): Promise<string> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId: tenant.propertyId, status: 'PUBLISHED' },
  });
  return tour.id;
}

describe('leitura de imagem: balde antes da coluna', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let leitor: PanoramaImageReader;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    leitor = new PanoramaImageReader(asPrismaService, balde);
  });

  it('cai para a coluna quando a linha não tem endereço', async () => {
    // Teste 1 da spec. É esta queda que mantém tour publicado vivo enquanto o
    // preenchimento roda — sem ela, a migração seria um apagão.
    const bytes = await jpeg(60);
    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageData: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      },
    });

    const lido = await leitor.carregar(panorama.id, false);

    expect(await tomDe(lido!)).toBe(60);
  });

  it('prefere o endereço e não toca na coluna', async () => {
    // Teste 2 da spec. As duas fontes carregam imagens DIFERENTES de propósito:
    // é o tom que prova qual delas saiu.
    const doBalde = await jpeg(200);
    const daColuna = await jpeg(60);
    await balde.gravar('panoramas/x/1/original.jpg', doBalde);

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageData: `data:image/jpeg;base64,${daColuna.toString('base64')}`,
        imageKey: 'panoramas/x/1/original.jpg',
      },
    });

    const lido = await leitor.carregar(panorama.id, false);

    expect(await tomDe(lido!)).toBe(200);
  });

  it('cai para a coluna quando a chave existe mas o objeto sumiu', async () => {
    // Rede de segurança, não caminho normal: uma chave gravada cujo objeto não
    // está lá é defeito. Servir a coluna é melhor que servir tela vazia.
    const daColuna = await jpeg(60);
    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageData: `data:image/jpeg;base64,${daColuna.toString('base64')}`,
        imageKey: 'panoramas/x/1/original.jpg',
      },
    });

    const lido = await leitor.carregar(panorama.id, false);

    expect(await tomDe(lido!)).toBe(60);
  });

  it('com tratamento pronto no balde, serve a tratada', async () => {
    await balde.gravar('panoramas/x/1/original.jpg', await jpeg(60));
    await balde.gravar('panoramas/x/2/tratada.jpg', await jpeg(200));

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageKey: 'panoramas/x/2/tratada.jpg',
        treatmentStatus: 'DONE',
      },
    });

    expect(await tomDe((await leitor.carregar(panorama.id, true))!)).toBe(200);
  });

  it('com a tratada só na coluna, NÃO serve o original do balde', async () => {
    // O caso que a migração cria e que mostraria a foto errada: o original já
    // migrou, a tratada ainda não. Cair para `imageKey` aqui entregaria o
    // cômodo SEM tratamento a quem pediu o tratado, e nada denunciaria.
    await balde.gravar('panoramas/x/1/original.jpg', await jpeg(60));
    const tratada = await jpeg(200);

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageData: `data:image/jpeg;base64,${tratada.toString('base64')}`,
        treatmentStatus: 'DONE',
      },
    });

    expect(await tomDe((await leitor.carregar(panorama.id, true))!)).toBe(200);
  });

  it('devolve a capa gravada ao lado da imagem servida', async () => {
    const chave = 'panoramas/x/2/tratada.jpg';
    await balde.gravar(chave, await jpeg(200));
    await balde.gravar(chaveDaCapa(chave), await jpeg(210));

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageKey: chave,
        treatmentStatus: 'DONE',
      },
    });

    expect(await tomDe((await leitor.carregarCapa(panorama.id, true))!)).toBe(210);
  });

  it('sem capa para a variante servida, devolve null em vez de a errada', async () => {
    // O null é instrução: quem chama reduz sob demanda. Devolver a capa do
    // original aqui mostraria o cômodo sem tratamento no card.
    await balde.gravar('panoramas/x/1/original.jpg', await jpeg(60));
    await balde.gravar(chaveDaCapa('panoramas/x/1/original.jpg'), await jpeg(65));

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: await seedTour(tenants.a),
        imageKey: 'panoramas/x/1/original.jpg',
        treatedImageData: 'ainda-na-coluna',
        treatmentStatus: 'DONE',
      },
    });

    expect(await leitor.carregarCapa(panorama.id, true)).toBeNull();
  });

  it('devolve null para panorama que não existe', async () => {
    expect(
      await leitor.carregar('00000000-0000-0000-0000-000000000000', false),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test leitura-do-balde
```

Esperado: FAIL — `carregarCapa is not a function` e o construtor com dois argumentos.

- [ ] **Step 3: Acrescente `chaveServida` a `panorama-image.ts`**

No fim de `server-api/src/modules/panoramas/panorama-image.ts`:

```ts
/**
 * Qual chave do balde corresponde à imagem que se quer servir.
 *
 * **Não é `treatedImageKey ?? imageKey`**, e a diferença importa. Durante a
 * migração existe a linha cujo original já subiu e cuja tratada ainda está na
 * coluna. Caindo para `imageKey`, quem pedisse a tratada receberia o cômodo SEM
 * tratamento — a foto errada, sem nenhuma requisição para denunciar.
 *
 * `null` significa "esta variante ainda não está no balde", e quem chama trata
 * isso lendo a coluna.
 *
 * `preferirTratada` é o mesmo discriminador que o leitor usa, e nos dois
 * lugares ele vem de `treatmentStatus === 'DONE'`. Mexer num sem o outro faz a
 * rota servir uma imagem e o payload apontar para outra.
 */
export function chaveServida(
  linha: { imageKey: string | null; treatedImageKey: string | null },
  preferirTratada: boolean,
): string | null {
  return preferirTratada ? linha.treatedImageKey : linha.imageKey;
}
```

- [ ] **Step 4: Reescreva o leitor**

Substitua o corpo de `server-api/src/modules/panoramas/panorama-image.reader.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  ARMAZENAMENTO,
  ArmazenamentoDeImagens,
  chaveDaCapa,
} from '../../shared/armazenamento/armazenamento.port';
import { base64Puro, chaveServida } from './panorama-image';

/**
 * Lê a imagem de um panorama, do balde ou da coluna antiga.
 *
 * A precedência é o coração da migração: o endereço primeiro, a coluna como
 * queda. É essa queda que mantém tour publicado vivo enquanto o preenchimento
 * roda — sem ela, o deploy que introduz o balde seria um apagão.
 *
 * A queda é POR VARIANTE, e não "qualquer chave que exista". Ver `chaveServida`
 * em `panorama-image.ts` para o caso que isso evita.
 *
 * `treatmentStatus` continua sendo o discriminador de `preferirTratada` nos
 * três chamadores, porque anda junto de `treatedImageData`/`treatedImageKey`
 * nos dois lugares que os escrevem: `treat-panorama.service.ts` ao concluir e o
 * `SEM_TRATAMENTO` de `update-panorama.service.ts` ao refotografar.
 */
@Injectable()
export class PanoramaImageReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARMAZENAMENTO)
    private readonly armazenamento: ArmazenamentoDeImagens,
  ) {}

  async carregar(
    panoramaId: string,
    preferirTratada: boolean,
  ): Promise<Buffer | null> {
    const enderecos = await this.enderecos(panoramaId);
    if (!enderecos) return null;

    // Com o palpite certo e a linha já migrada, isto é UMA consulta estreita
    // mais uma leitura do balde: nenhuma coluna TOAST sai do banco.
    const tratada = preferirTratada
      ? (await this.doBalde(enderecos.treatedImageKey)) ??
        (await this.daColuna(panoramaId, 'tratada'))
      : null;

    return (
      tratada ??
      (await this.doBalde(enderecos.imageKey)) ??
      (await this.daColuna(panoramaId, 'original'))
    );
  }

  /**
   * A capa gravada ao lado da imagem que seria servida.
   *
   * `null` quando a variante servida ainda não tem chave: é instrução para
   * quem chama reduzir sob demanda, e some quando a migração terminar.
   */
  async carregarCapa(
    panoramaId: string,
    preferirTratada: boolean,
  ): Promise<Buffer | null> {
    const enderecos = await this.enderecos(panoramaId);
    if (!enderecos) return null;

    const chave = chaveServida(enderecos, preferirTratada);
    return chave ? this.armazenamento.ler(chaveDaCapa(chave)) : null;
  }

  private async enderecos(
    id: string,
  ): Promise<{ imageKey: string | null; treatedImageKey: string | null } | null> {
    return this.prisma.panorama.findUnique({
      where: { id },
      select: { imageKey: true, treatedImageKey: true },
    });
  }

  /**
   * `null` tanto para "não há chave" quanto para "o objeto não está lá". O
   * segundo é defeito, e a queda para a coluna é rede de segurança: servir a
   * coluna é melhor que servir tela vazia.
   */
  private async doBalde(chave: string | null): Promise<Buffer | null> {
    return chave ? this.armazenamento.ler(chave) : null;
  }

  /**
   * Consulta separada por variante, e não uma trazendo as duas: são colunas
   * TOAST de dezenas de MB, e pedir as duas para descartar uma em JS é o que
   * fazia a consulta mais pesada do sistema custar o dobro do que precisava.
   */
  private async daColuna(
    id: string,
    qual: 'original' | 'tratada',
  ): Promise<Buffer | null> {
    const linha =
      qual === 'tratada'
        ? await this.prisma.panorama.findUnique({
            where: { id },
            select: { treatedImageData: true },
          })
        : await this.prisma.panorama.findUnique({
            where: { id },
            select: { imageData: true },
          });

    const base64 =
      linha && 'treatedImageData' in linha ? linha.treatedImageData : linha?.imageData;

    return base64 ? Buffer.from(base64Puro(base64), 'base64') : null;
  }
}
```

- [ ] **Step 5: Ajuste os testes que constroem o leitor**

Em `test/panorama-image.spec.ts`, `test/thumbnail.spec.ts` e
`test/rascunho-de-captura.spec.ts`, some no topo:

```ts
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';

const balde = new ArmazenamentoEmMemoria();
```

e passe `balde` como segundo argumento de todo `new PanoramaImageReader(...)`.
Os testes existentes não gravam nada no balde, então continuam exercitando a
queda para a coluna — que é exatamente o que eles sempre testaram.

- [ ] **Step 6: Rode a suíte inteira**

```bash
cd server-api && yarn test
```

Esperado: tudo PASS, incluindo os 8 novos.

- [ ] **Step 7: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas test/leitura-do-balde.spec.ts
git add server-api/src server-api/test
git commit -m "feat(panoramas): leitura prefere o balde e cai na coluna por variante"
```

---

### Task 8: Criar e atualizar panorama gravam no balde

**Files:**
- Modify: `server-api/src/modules/panoramas/services/create-panorama.service.ts`
- Modify: `server-api/src/modules/panoramas/services/update-panorama.service.ts`
- Modify: `server-api/test/rascunho-retomavel.spec.ts:26-27` (construtores)
- Test: `server-api/test/gravacao-no-balde.spec.ts`

**Interfaces:**
- Consumes: `GravadorDeImagens.gravarPanorama` (Task 6); `base64Puro` de `panorama-image.ts`.
- Produces:
  - `new CreatePanoramaService(prisma: PrismaService, gravador: GravadorDeImagens)`
  - `new UpdatePanoramaService(prisma: PrismaService, gravador: GravadorDeImagens)`
  - As duas continuam gravando `imageData` **e** passam a gravar `imageKey`. A escrita dupla é o passo 2 da migração; a coluna só para de ser escrita na etapa 5, que é operacional.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/gravacao-no-balde.spec.ts`:

```ts
import sharp from 'sharp';
import { CreatePanoramaService } from '../src/modules/panoramas/services/create-panorama.service';
import { UpdatePanoramaService } from '../src/modules/panoramas/services/update-panorama.service';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function dataUri(tom: number): Promise<string> {
  const bytes = await sharp({
    create: { width: 1600, height: 800, channels: 3, background: { r: tom, g: tom, b: tom } },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

describe('gravação de panorama no balde', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let criar: CreatePanoramaService;
  let atualizar: UpdatePanoramaService;
  let tourId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    const gravador = new GravadorDeImagens(balde);
    criar = new CreatePanoramaService(asPrismaService, gravador);
    atualizar = new UpdatePanoramaService(asPrismaService, gravador);
    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'DRAFT' },
    });
    tourId = tour.id;
  });

  it('criar grava a imagem e a capa no balde, e guarda a chave', async () => {
    const criado = await criar.execute(
      { tourId, roomName: 'Sala', imageData: await dataUri(90), measurements: [] } as never,
      tenants.a.admin,
    );

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id: criado!.id },
      select: { imageKey: true },
    });
    expect(linha.imageKey).toMatch(/^panoramas\/.+\/original\.jpg$/);
    expect(balde.tem(linha.imageKey!)).toBe(true);
    expect(balde.tem(chaveDaCapa(linha.imageKey!))).toBe(true);
  });

  it('a coluna continua sendo escrita durante a migração', async () => {
    // Escrita dupla é o passo 2: enquanto ela existe, um rollback de deploy
    // volta a servir sem perder nada. A coluna só para na etapa 5.
    const criado = await criar.execute(
      { tourId, roomName: 'Sala', imageData: await dataUri(90), measurements: [] } as never,
      tenants.a.admin,
    );

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id: criado!.id },
      select: { imageData: true },
    });
    expect(linha.imageData).toBeTruthy();
  });

  it('refotografar escreve uma chave NOVA e não sobrescreve a anterior', async () => {
    const criado = await criar.execute(
      { tourId, roomName: 'Sala', imageData: await dataUri(90), measurements: [] } as never,
      tenants.a.admin,
    );
    const antes = await prisma.panorama.findUniqueOrThrow({
      where: { id: criado!.id },
      select: { imageKey: true },
    });

    await new Promise((seguir) => setTimeout(seguir, 2));
    await atualizar.execute(
      criado!.id,
      { imageData: await dataUri(200) } as never,
      tenants.a.admin,
    );

    const depois = await prisma.panorama.findUniqueOrThrow({
      where: { id: criado!.id },
      select: { imageKey: true, treatedImageKey: true, treatmentStatus: true },
    });
    expect(depois.imageKey).not.toBe(antes.imageKey);
    expect(balde.tem(antes.imageKey!)).toBe(true);
    // A tratada da foto ANTERIOR deixa de descrever este cômodo: a regra já
    // existia para a coluna, e a chave tem de acompanhá-la.
    expect(depois.treatedImageKey).toBeNull();
    expect(depois.treatmentStatus).toBe('PENDING');
  });

  it('renomear o cômodo não escreve nada no balde', async () => {
    const criado = await criar.execute(
      { tourId, roomName: 'Sala', imageData: await dataUri(90), measurements: [] } as never,
      tenants.a.admin,
    );
    const gravacoes = balde.gravacoes;

    await atualizar.execute(criado!.id, { roomName: 'Cozinha' } as never, tenants.a.admin);

    expect(balde.gravacoes).toBe(gravacoes);
  });

  it('se o banco falhar, nenhuma linha aponta para o nada', async () => {
    // O teste 6 da spec, e a decisão 10 inteira. O que sobra é um arquivo sem
    // dono — o lado barato do erro, que `varrer-orfaos` recolhe.
    jest
      .spyOn(prisma.panorama, 'create')
      .mockRejectedValueOnce(new Error('banco recusou'));

    await expect(
      criar.execute(
        { tourId, roomName: 'Sala', imageData: await dataUri(90), measurements: [] } as never,
        tenants.a.admin,
      ),
    ).rejects.toThrow('banco recusou');

    expect(await prisma.panorama.count({ where: { virtualTourId: tourId } })).toBe(0);
    // E o arquivo ESTÁ no balde: é isso que prova que a ordem foi balde→banco.
    expect(balde.gravacoes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test gravacao-no-balde
```

Esperado: FAIL — `CreatePanoramaService` não aceita segundo argumento.

- [ ] **Step 3: `CreatePanoramaService` grava antes da transação**

Em `server-api/src/modules/panoramas/services/create-panorama.service.ts`, some ao construtor e grave antes do `$transaction`:

```ts
import { GravadorDeImagens } from '../gravador-de-imagens.service';
import { base64Puro } from '../panorama-image';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly gravador: GravadorDeImagens,
  ) {}
```

Logo depois da checagem do tour e ANTES do `$transaction`:

```ts
    // Balde primeiro, banco depois, e por isso FORA da transação: uma escrita
    // de rede dentro de `$transaction` seguraria uma conexão do pool durante
    // um upload. Se isto der certo e a transação abaixo falhar, sobra um
    // arquivo sem dono — centavos, que `varrer-orfaos` recolhe. Se a ordem se
    // invertesse, a falha deixaria uma linha apontando para o nada, que é tela
    // sem imagem.
    const imageKey = await this.gravador.gravarPanorama(
      randomUUID(),
      Buffer.from(base64Puro(panoramaData.imageData), 'base64'),
      'original',
    );
```

> **Atenção ao id.** A chave precisa do id do panorama, e ele só existe depois
> do `create`. Gerar o uuid aqui e passá-lo explicitamente ao `tx.panorama.create`
> resolve sem inverter a ordem: `import { randomUUID } from 'node:crypto'` e
> `data: { id, ...panoramaData, imageKey, virtualTourId: tourId }`. O schema já
> declara `@default(uuid())`, então fornecer o id é permitido e nada mais muda.

Guarde o id numa constante antes:

```ts
    const id = randomUUID();
    const imageKey = await this.gravador.gravarPanorama(
      id,
      Buffer.from(base64Puro(panoramaData.imageData), 'base64'),
      'original',
    );
```

e no `create` dentro da transação:

```ts
      const panorama = await tx.panorama.create({
        data: { id, ...panoramaData, imageKey, virtualTourId: tourId },
      });
```

- [ ] **Step 4: `UpdatePanoramaService` grava quando a foto muda**

Em `server-api/src/modules/panoramas/services/update-panorama.service.ts`:

```ts
import { GravadorDeImagens } from '../gravador-de-imagens.service';
import { base64Puro } from '../panorama-image';
```

Acrescente `treatedImageKey: null` ao bloco `SEM_TRATAMENTO`, com um comentário
ligando-o ao que já está lá:

```ts
const SEM_TRATAMENTO = {
  treatedImageData: null,
  // A chave acompanha a coluna: deixá-la para trás faria o leitor preferir o
  // render do cômodo ANTIGO, que é o bug silencioso que este bloco existe
  // para evitar.
  treatedImageKey: null,
  treatmentStatus: 'PENDING',
  ...
```

Construtor e gravação, antes do `$transaction`:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly gravador: GravadorDeImagens,
  ) {}
```

```ts
    // Só quando a foto muda. Renomear e reordenar cômodos é o que o salvamento
    // de rascunho mais faz, e gravar o balde a cada um deles produziria uma
    // versão nova por tecla digitada.
    const imageKey = dto.imageData
      ? await this.gravador.gravarPanorama(
          id,
          Buffer.from(base64Puro(dto.imageData), 'base64'),
          'original',
        )
      : undefined;
```

e no `update` dentro da transação:

```ts
        data: {
          ...dto,
          ...(dto.imageData ? { ...SEM_TRATAMENTO, imageKey } : {}),
        },
```

- [ ] **Step 5: Ajuste os construtores em `rascunho-retomavel.spec.ts`**

```ts
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';

const gravador = new GravadorDeImagens(new ArmazenamentoEmMemoria());
const criarPanorama = new CreatePanoramaService(asPrismaService, gravador);
const atualizarPanorama = new UpdatePanoramaService(asPrismaService, gravador);
```

- [ ] **Step 6: Rode a suíte inteira**

```bash
cd server-api && yarn test
```

Esperado: tudo PASS, incluindo os 5 novos.

- [ ] **Step 7: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas test/gravacao-no-balde.spec.ts
git add server-api/src server-api/test
git commit -m "feat(panoramas): criar e refotografar gravam no balde antes do banco"
```

---

### Task 9: As fotos da captura vão para o balde

**Files:**
- Modify: `server-api/src/modules/panoramas/services/upload-capture-frame.service.ts`
- Modify: `server-api/test/capture-frames.spec.ts:8` (construtor)
- Test: `server-api/test/capturas-no-balde.spec.ts`

**Interfaces:**
- Consumes: `GravadorDeImagens.gravarCaptura` (Task 6); `base64Puro`.
- Produces: `new UploadCaptureFrameService(prisma: PrismaService, gravador: GravadorDeImagens)`. O `upsert` passa a escrever `imageKey` junto de `imageData`.

São 116 MB do banco de hoje, oito por cômodo, lidas só pelo tratamento. **Não
são apagadas depois de tratar** (decisão 4): apagar continua disponível para
sempre, inclusive por regra de validade automática no balde; recuperar nunca
fica. E são elas que permitem retratar um cômodo com um modelo melhor depois.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/capturas-no-balde.spec.ts`:

```ts
import { UploadCaptureFrameService } from '../src/modules/panoramas/services/upload-capture-frame.service';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

const FOTO = `data:image/jpeg;base64,${Buffer.from('foto-de-referencia').toString('base64')}`;

function dto(index: number) {
  return {
    index,
    imageData: FOTO,
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  } as never;
}

describe('fotos da captura no balde', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let upload: UploadCaptureFrameService;
  let panoramaId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    upload = new UploadCaptureFrameService(asPrismaService, new GravadorDeImagens(balde));

    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'DRAFT' },
    });
    const panorama = await prisma.panorama.create({
      data: { roomName: 'Sala', virtualTourId: tour.id, imageData: 'AAAA' },
    });
    panoramaId = panorama.id;
  });

  it('grava a foto no balde e guarda a chave', async () => {
    await upload.execute(panoramaId, dto(3), tenants.a.admin);

    const linha = await prisma.captureFrame.findFirstOrThrow({
      where: { panoramaId, index: 3 },
      select: { imageKey: true },
    });
    expect(linha.imageKey).toBe(`capturas/${panoramaId}/3.jpg`);
    expect(balde.tem(linha.imageKey!)).toBe(true);
  });

  it('não gera capa para foto de referência', async () => {
    // Ela nunca é mostrada em tela: capa seria trabalho e bytes para nada.
    await upload.execute(panoramaId, dto(3), tenants.a.admin);

    expect(balde.chaves()).toEqual([`capturas/${panoramaId}/3.jpg`]);
  });

  it('o reenvio repõe a foto em vez de acumular cópias', async () => {
    // O envio acontece foto a foto em segundo plano, então uma falha de rede é
    // reenviada. A chave sem versão é o que faz o reenvio REPOR.
    await upload.execute(panoramaId, dto(3), tenants.a.admin);
    await upload.execute(panoramaId, dto(3), tenants.a.admin);

    expect(balde.chaves()).toEqual([`capturas/${panoramaId}/3.jpg`]);
    expect(await prisma.captureFrame.count({ where: { panoramaId } })).toBe(1);
  });

  it('recusa panorama de outra agência sem tocar no balde', async () => {
    await expect(
      upload.execute(panoramaId, dto(3), tenants.b.admin),
    ).rejects.toThrow('Panorama not found');

    expect(balde.gravacoes).toBe(0);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test capturas-no-balde
```

Esperado: FAIL — o construtor não aceita segundo argumento.

- [ ] **Step 3: Grave no balde antes do upsert**

Em `server-api/src/modules/panoramas/services/upload-capture-frame.service.ts`:

```ts
import { GravadorDeImagens } from '../gravador-de-imagens.service';
import { base64Puro } from '../panorama-image';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly gravador: GravadorDeImagens,
  ) {}
```

Depois da checagem de escopo e antes do `upsert`:

```ts
    // Balde primeiro, banco depois. A checagem de agência fica ANTES disto: um
    // pedido de outra imobiliária não pode nem escrever um órfão.
    const imageKey = await this.gravador.gravarCaptura(
      panoramaId,
      dto.index,
      Buffer.from(base64Puro(dto.imageData), 'base64'),
    );
```

e no `upsert`:

```ts
    const saved = await this.prisma.captureFrame.upsert({
      where: { panoramaId_index: { panoramaId, index: dto.index } },
      create: { ...data, imageKey, panoramaId },
      update: { ...data, imageKey },
      select: { id: true, index: true },
    });
```

- [ ] **Step 4: Ajuste `capture-frames.spec.ts`**

```ts
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';

const upload = new UploadCaptureFrameService(
  asPrismaService,
  new GravadorDeImagens(new ArmazenamentoEmMemoria()),
);
```

- [ ] **Step 5: Rode e veja passar**

```bash
cd server-api && yarn test
```

Esperado: tudo PASS, incluindo os 4 novos.

- [ ] **Step 6: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas test/capturas-no-balde.spec.ts
git add server-api/src server-api/test
git commit -m "feat(panoramas): fotos da captura gravadas no balde"
```

---

### Task 10: O tratamento lê e grava pelo balde

**Files:**
- Modify: `server-api/src/modules/panoramas/services/treat-panorama.service.ts`
- Modify: `server-api/test/montagem-por-ia.spec.ts:70`, `server-api/test/rascunho-de-captura.spec.ts:39` (construtores)
- Test: `server-api/test/tratamento-no-balde.spec.ts`

**Interfaces:**
- Consumes: `PanoramaImageReader.carregar` (Task 7); `GravadorDeImagens.gravarPanorama` (Task 6); `ARMAZENAMENTO`/`ArmazenamentoDeImagens` (Task 1).
- Produces: `new TreatPanoramaService(prisma, leitor: PanoramaImageReader, gravador: GravadorDeImagens, armazenamento: ArmazenamentoDeImagens)`.

Esta é a rota que mais custa memória do sistema inteiro, e a leitura pelo balde
tira dela a maior fonte de pressão: hoje `referencias` traz até quinze colunas
TOAST numa consulta só.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/tratamento-no-balde.spec.ts`:

```ts
import sharp from 'sharp';
import { TreatPanoramaService } from '../src/modules/panoramas/services/treat-panorama.service';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function jpeg(largura: number, tom: number): Promise<Buffer> {
  return sharp({
    create: { width: largura, height: largura / 2, channels: 3, background: { r: tom, g: tom, b: tom } },
  })
    .jpeg()
    .toBuffer();
}

describe('tratamento com as imagens no balde', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let servico: TreatPanoramaService;
  let panoramaId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    servico = new TreatPanoramaService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      new GravadorDeImagens(balde),
      balde,
    );

    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'DRAFT' },
    });
    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: tour.id,
        imageKey: 'panoramas/p/1/original.jpg',
      },
    });
    panoramaId = panorama.id;
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
  });

  it('dispensa sem fotos de referência suficientes, e não grava nada', async () => {
    // Menos de 4 referências: sem verdade de campo o modelo repintaria o cômodo
    // a partir da própria imagem, que é o caso reprovado no bake-off.
    const gravacoes = balde.gravacoes;

    const r = await servico.execute(panoramaId);

    expect(r.status).toBe('SKIPPED');
    expect(balde.gravacoes).toBe(gravacoes);
  });

  it('grava a tratada e a capa no balde e guarda a chave', async () => {
    // O modelo é dublado: esta suíte não gasta US$ 0,19 por execução.
    jest
      .spyOn(servico as never, 'montar')
      .mockImplementation(async () => {
        const chave = await new GravadorDeImagens(balde).gravarPanorama(
          panoramaId,
          await jpeg(2048, 200),
          'tratada',
        );
        await prisma.panorama.update({
          where: { id: panoramaId },
          data: { treatedImageKey: chave, treatmentStatus: 'DONE', treatedAt: new Date() },
        });
        return { status: 'DONE', fotos: 8, saltoAntes: 0, saltoDepois: 0, custoUSD: 0, ms: 1 };
      });

    for (let i = 0; i < 8; i++) {
      await prisma.captureFrame.create({
        data: {
          panoramaId, index: i, qx: 0, qy: 0, qz: 0, qw: 1,
          imageKey: `capturas/${panoramaId}/${i}.jpg`,
        },
      });
      await balde.gravar(`capturas/${panoramaId}/${i}.jpg`, await jpeg(256, 100 + i));
    }

    await servico.execute(panoramaId);

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id: panoramaId },
      select: { treatedImageKey: true },
    });
    expect(linha.treatedImageKey).toMatch(/tratada\.jpg$/);
    expect(balde.tem(chaveDaCapa(linha.treatedImageKey!))).toBe(true);
  });

  it('lê as fotos de referência do balde, uma por vez', async () => {
    for (let i = 0; i < 6; i++) {
      await prisma.captureFrame.create({
        data: {
          panoramaId, index: i, qx: 0, qy: 0, qz: 0, qw: 1,
          imageKey: `capturas/${panoramaId}/${i}.jpg`,
        },
      });
      await balde.gravar(`capturas/${panoramaId}/${i}.jpg`, await jpeg(256, 100 + i));
    }

    const fotos = await (servico as never as {
      referencias(ids: string[]): Promise<Buffer[]>;
    }).referencias(
      (
        await prisma.captureFrame.findMany({
          where: { panoramaId },
          select: { id: true },
          orderBy: { index: 'asc' },
        })
      ).map((f) => f.id),
    );

    expect(fotos).toHaveLength(6);
  });

  it('lê a foto de referência da coluna quando ela ainda não migrou', async () => {
    // A queda vale aqui também: um rascunho capturado antes do deploy tem as
    // referências só na coluna, e tratá-lo não pode falhar por isso.
    const bytes = await jpeg(256, 140);
    await prisma.captureFrame.create({
      data: {
        panoramaId, index: 0, qx: 0, qy: 0, qz: 0, qw: 1,
        imageData: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      },
    });

    const linha = await prisma.captureFrame.findFirstOrThrow({
      where: { panoramaId },
      select: { id: true },
    });
    const fotos = await (servico as never as {
      referencias(ids: string[]): Promise<Buffer[]>;
    }).referencias([linha.id]);

    expect(fotos).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test tratamento-no-balde
```

Esperado: FAIL — o construtor não aceita os argumentos novos.

- [ ] **Step 3: Injete as três dependências**

Em `server-api/src/modules/panoramas/services/treat-panorama.service.ts`:

```ts
import {
  ARMAZENAMENTO,
  ArmazenamentoDeImagens,
} from '../../../shared/armazenamento/armazenamento.port';
import { GravadorDeImagens } from '../gravador-de-imagens.service';
import { PanoramaImageReader } from '../panorama-image.reader';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly leitor: PanoramaImageReader,
    private readonly gravador: GravadorDeImagens,
    @Inject(ARMAZENAMENTO)
    private readonly armazenamento: ArmazenamentoDeImagens,
  ) {}
```

(`Inject` entra no import de `@nestjs/common`.)

- [ ] **Step 4: `equirectParaOModelo` lê pelo leitor**

Substitua o corpo:

```ts
  private async equirectParaOModelo(
    panoramaId: string,
  ): Promise<{ reduzido: Buffer; largura: number; altura: number }> {
    // Pelo leitor, e não pela coluna: é ele que sabe preferir o balde e cair
    // na coluna. Duas cópias dessa precedência divergiriam, e divergir aqui
    // significa tratar a imagem errada.
    //
    // `false`: a entrada do tratamento é sempre o ORIGINAL. Tratar a tratada
    // seria empilhar geração sobre geração.
    const originalBuf = await this.leitor.carregar(panoramaId, false);
    if (!originalBuf) throw new NotFoundException('Panorama sem imagem para tratar.');

    const meta = await sharp(originalBuf).metadata();
    if (!meta.width || !meta.height)
      throw new Error('Panorama sem dimensões legíveis.');

    return {
      reduzido: await sharp(originalBuf)
        .resize(LARGURA_MODELO, ALTURA_MODELO, { fit: 'fill', kernel: 'lanczos3' })
        .png()
        .toBuffer(),
      largura: meta.width,
      altura: meta.height,
    };
  }
```

- [ ] **Step 5: `referencias` lê do balde, uma por vez**

Substitua o corpo:

```ts
  /**
   * As fotos de referência, uma por vez.
   *
   * A consulta traz só `id` e `imageKey` — bytes nenhum. Antes ela trazia
   * `imageData` de TODAS as escolhidas de uma vez: quinze colunas TOAST
   * materializadas juntas antes de a primeira virar PNG. O `shift` do laço
   * soltava as strings, mas elas já tinham entrado no heap.
   *
   * Conversão em série, e não `Promise.all`: quinze `sharp` simultâneos
   * decodificam quinze JPEG de 1536×2048 ao mesmo tempo. Medido em 09/2026,
   * pico de 84 MB em paralelo contra 33 MB em série, para um resultado idêntico
   * byte a byte. Numa caixa de 512 MB essa diferença é o processo.
   */
  private async referencias(escolhidas: string[]): Promise<Buffer[]> {
    const linhas = await this.prisma.captureFrame.findMany({
      where: { id: { in: escolhidas } },
      select: { id: true, imageKey: true },
      orderBy: { index: 'asc' },
    });

    const fotos: Buffer[] = [];
    for (const linha of linhas) {
      const bytes = await this.bytesDaReferencia(linha);
      if (!bytes) continue;
      fotos.push(
        await sharp(bytes)
          .resize({ width: LARGURA_DA_REFERENCIA })
          .png()
          .toBuffer(),
      );
    }

    return fotos;
  }

  /** Balde primeiro, coluna como queda — a mesma precedência do leitor. */
  private async bytesDaReferencia(linha: {
    id: string;
    imageKey: string | null;
  }): Promise<Buffer | null> {
    if (linha.imageKey) {
      const doBalde = await this.armazenamento.ler(linha.imageKey);
      if (doBalde) return doBalde;
    }

    const daColuna = await this.prisma.captureFrame.findUnique({
      where: { id: linha.id },
      select: { imageData: true },
    });
    return daColuna?.imageData
      ? Buffer.from(base64Puro(daColuna.imageData), 'base64')
      : null;
  }
```

- [ ] **Step 6: `montar` grava a tratada no balde antes do banco**

Em `montar`, troque o `prisma.panorama.update` por:

```ts
    // Balde primeiro, banco depois. Uma versão nova nasce aqui: a chave leva o
    // carimbo do instante da gravação, o arquivo é imutável, e o payload passa
    // a apontar para ele sem ninguém precisar limpar cache de CDN.
    const treatedImageKey = await this.gravador.gravarPanorama(
      panoramaId,
      finalJpeg,
      'tratada',
    );

    await this.prisma.panorama.update({
      where: { id: panoramaId },
      data: {
        treatedImageKey,
        // A coluna continua sendo escrita: é a escrita dupla do passo 2, e é
        // ela que permite voltar um deploy sem perder o tratamento. Sai na
        // etapa 5 da migração — ver docs/operacao/migracao-das-fotos.md.
        treatedImageData: `data:image/jpeg;base64,${finalJpeg.toString('base64')}`,
        treatmentStatus: 'DONE',
        ...
```

(O resto do `data` fica como está.)

- [ ] **Step 7: Ajuste os construtores nos testes existentes**

Em `test/montagem-por-ia.spec.ts:70` e `test/rascunho-de-captura.spec.ts:39`,
passe os três argumentos novos, com um `ArmazenamentoEmMemoria` compartilhado
no escopo do arquivo — o mesmo padrão das tasks anteriores.

- [ ] **Step 8: Rode a suíte inteira**

```bash
cd server-api && yarn test
```

Esperado: tudo PASS, incluindo os 4 novos.

- [ ] **Step 9: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas test/tratamento-no-balde.spec.ts
git add server-api/src server-api/test
git commit -m "feat(panoramas): tratamento lê referências do balde e grava a tratada nele"
```

---

### Task 11: As rotas públicas servem a capa gravada

**Files:**
- Modify: `server-api/src/modules/panoramas/capa-do-panorama.ts` (acrescenta `larguraPedida`)
- Modify: `server-api/src/modules/panoramas/services/get-panorama-image.service.ts`
- Modify: `server-api/src/modules/virtual-tours/services/get-thumbnail.service.ts`
- Modify: `server-api/src/modules/virtual-tours/virtual-tours.module.ts` (o thumbnail passa a precisar do leitor, já exportado)
- Modify: `server-api/test/panorama-image.spec.ts` (a largura reduzida passa a ser 640)
- Test: `server-api/test/rotas-publicas-do-balde.spec.ts`

**Interfaces:**
- Consumes: `PanoramaImageReader.carregarCapa` (Task 7); `LARGURA_DA_CAPA`, `LARGURA_MAXIMA`, `chaveDeCache`, `reduzirComCache` (Task 5).
- Produces: `larguraPedida(w?: number): number | null` em `capa-do-panorama.ts` — `null` significa "sem reduzir"; qualquer outro valor é `LARGURA_DA_CAPA`. Substitui as duas cópias de `normalizarLargura`.

**Mudança de comportamento visível:** `?w=292` e `?w=320` passam a devolver 640
de largura. É a decisão 5 — um tamanho só — e é por isso que a asserção de
`panorama-image.spec.ts` muda de 320 para 640.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/rotas-publicas-do-balde.spec.ts`:

```ts
import sharp from 'sharp';
import { GetPanoramaImageService } from '../src/modules/panoramas/services/get-panorama-image.service';
import { GetThumbnailService } from '../src/modules/virtual-tours/services/get-thumbnail.service';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { limparCacheDeCapa } from '../src/modules/panoramas/capa-do-panorama';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function jpeg(largura: number, tom: number): Promise<Buffer> {
  return sharp({
    create: { width: largura, height: largura / 2, channels: 3, background: { r: tom, g: tom, b: tom } },
  })
    .jpeg()
    .toBuffer();
}

async function tomDe(bytes: Buffer): Promise<number> {
  const { channels } = await sharp(bytes).stats();
  return Math.round(channels[0].mean);
}

describe('rotas públicas servindo do balde', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;
  let imagem: GetPanoramaImageService;
  let miniatura: GetThumbnailService;
  let tourId: string;
  let panoramaId: string;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
    limparCacheDeCapa();
    const leitor = new PanoramaImageReader(asPrismaService, balde);
    imagem = new GetPanoramaImageService(asPrismaService, leitor);
    miniatura = new GetThumbnailService(asPrismaService, leitor);

    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'PUBLISHED' },
    });
    tourId = tour.id;

    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    await balde.gravar(chaveDaCapa('panoramas/p/1/original.jpg'), await jpeg(640, 95));

    const panorama = await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: tour.id,
        initialPanorama: true,
        imageKey: 'panoramas/p/1/original.jpg',
      },
    });
    panoramaId = panorama.id;
  });

  it('sem largura, serve a imagem inteira do balde', async () => {
    const { corpo } = await imagem.execute(panoramaId);

    expect((await sharp(corpo!).metadata()).width).toBe(2048);
  });

  it('com largura, serve a capa GRAVADA e não redimensiona', async () => {
    // O tom 95 só existe na capa: se a resposta viesse de um sharp sobre a
    // original, ela sairia com 90 — e o teste pegaria o redimensionamento
    // continuando a acontecer sem ninguém perceber.
    const { corpo } = await imagem.execute(panoramaId, { largura: 292 });

    expect((await sharp(corpo!).metadata()).width).toBe(640);
    expect(await tomDe(corpo!)).toBe(95);
  });

  it('qualquer largura pedida cai na mesma capa de 640', async () => {
    // Um tamanho só: 640 cobre o card de imóvel e a faixa de cenas, e a
    // diferença de banda não paga manter duas.
    const a = await imagem.execute(panoramaId, { largura: 292 });
    const b = await imagem.execute(panoramaId, { largura: 320 });

    expect(a.etag).toBe(b.etag);
  });

  it('largura acima do teto continua servindo a original', async () => {
    const { corpo } = await imagem.execute(panoramaId, { largura: 999999 });

    expect((await sharp(corpo!).metadata()).width).toBe(2048);
  });

  it('linha ainda não migrada continua reduzindo sob demanda', async () => {
    // O caminho de queda. Sem ele, todo tour publicado ficaria sem card entre
    // o deploy e o fim do `migrar-imagens`.
    const bytes = await jpeg(2048, 200);
    const legado = await prisma.panorama.create({
      data: {
        roomName: 'Quarto',
        virtualTourId: tourId,
        order: 1,
        imageData: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      },
    });

    const { corpo } = await imagem.execute(legado.id, { largura: 292 });

    expect((await sharp(corpo!).metadata()).width).toBe(640);
    expect(await tomDe(corpo!)).toBe(200);
  });

  it('a capa do tour vem do balde, sem redimensionar', async () => {
    const { corpo } = await miniatura.execute(tourId);

    expect((await sharp(corpo!).metadata()).width).toBe(640);
    expect(await tomDe(corpo!)).toBe(95);
  });

  it('tour não publicado continua respondendo 404', async () => {
    // A rota é sem guard: é o filtro por PUBLISHED que a protege, e ele não
    // pode ter se perdido na troca de fonte dos bytes.
    const rascunho = await prisma.virtualTour.create({
      data: { propertyId: tenants.b.propertyId, status: 'DRAFT' },
    });
    const escondido = await prisma.panorama.create({
      data: { roomName: 'Sala', virtualTourId: rascunho.id, imageKey: 'panoramas/p/1/original.jpg' },
    });

    await expect(imagem.execute(escondido.id)).rejects.toThrow('Panorama not found');
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test rotas-publicas-do-balde
```

Esperado: FAIL — a resposta com largura ainda sai de um sharp sobre a original (tom 90).

- [ ] **Step 3: `larguraPedida` em `capa-do-panorama.ts`**

Acrescente:

```ts
/**
 * O que `?w=` significa agora que existe um tamanho só.
 *
 * `null` = sem reduzir. Qualquer largura abaixo do teto = a capa, seja ela 292
 * (faixa de cenas) ou 320 (sheet de cenas) — as duas cabem em 640, e servir a
 * mesma resposta para as duas é o que torna a capa gravada suficiente.
 *
 * O teto continua existindo porque `?w=` é entrada de quem chama: acima dele,
 * servir o original é mais barato que qualquer redimensionamento, e é o que o
 * pedido queria dizer de qualquer forma.
 */
export function larguraPedida(largura?: number): number | null {
  if (!largura || !Number.isFinite(largura)) return null;
  if (largura >= LARGURA_MAXIMA) return null;
  return LARGURA_DA_CAPA;
}
```

- [ ] **Step 4: `GetPanoramaImageService` serve a capa**

Troque os imports e o corpo do `execute` depois do `etag`:

```ts
import { clienteJaTem, etagDe } from '../panorama-miniatura';
import {
  LARGURA_DA_CAPA,
  chaveDeCache,
  larguraPedida,
  reduzirComCache,
} from '../capa-do-panorama';
```

```ts
    const largura = larguraPedida(opcoes.largura);
    const etag = etagDe(panorama.id, panorama.updatedAt, largura ?? 0);
    if (clienteJaTem(opcoes.etagDoCliente, etag)) return { etag };

    const tratada = panorama.treatmentStatus === 'DONE';

    // Sem `?w=` a imagem sai como está guardada. Antes isso era uma leitura de
    // TOAST de dezenas de MB; agora é uma leitura do balde, e a diferença é que
    // o processo não segura mais a coluna inteira enquanto responde.
    if (largura === null) {
      const corpo = await this.leitor.carregar(panorama.id, tratada);
      if (!corpo) throw new NotFoundException('Panorama image not available');
      return { etag, corpo };
    }

    // A capa GRAVADA: nenhum sharp, nenhuma leitura da panorâmica inteira.
    const capa = await this.leitor.carregarCapa(panorama.id, tratada);
    if (capa) return { etag, corpo: capa };

    // Queda: linha ainda não migrada. Tem prazo de validade — some quando as
    // colunas de bytes saírem. Ver docs/operacao/migracao-das-fotos.md.
    const corpo = await reduzirComCache(
      chaveDeCache(panorama.id, panorama.updatedAt, LARGURA_DA_CAPA),
      LARGURA_DA_CAPA,
      async () => {
        const original = await this.leitor.carregar(panorama.id, tratada);
        if (!original) throw new NotFoundException('Panorama image not available');
        return original;
      },
    );

    return { etag, corpo };
```

E **apague** a função `normalizarLargura` do fim do arquivo.

- [ ] **Step 5: `GetThumbnailService` serve a capa**

Mesma forma. Troque os imports e o trecho depois do `etag`:

```ts
import { clienteJaTem, etagDe } from '../../panoramas/panorama-miniatura';
import {
  LARGURA_DA_CAPA,
  chaveDeCache,
  reduzirComCache,
} from '../../panoramas/capa-do-panorama';
```

```ts
    const etag = etagDe(capa.id, capa.updatedAt, LARGURA_DA_CAPA);
    if (clienteJaTem(etagDoCliente, etag)) return { etag };

    const tratada = capa.treatmentStatus === 'DONE';

    const gravada = await this.leitor.carregarCapa(capa.id, tratada);
    if (gravada) return { etag, corpo: gravada };

    const corpo = await reduzirComCache(
      chaveDeCache(capa.id, capa.updatedAt, LARGURA_DA_CAPA),
      LARGURA_DA_CAPA,
      async () => {
        const original = await this.leitor.carregar(capa.id, tratada);
        if (!original) throw new NotFoundException('No thumbnail available');
        return original;
      },
    );

    return { etag, corpo };
```

- [ ] **Step 6: Atualize a asserção de largura que muda**

Em `test/panorama-image.spec.ts`, no caso `reduz quando se pede largura`:

```ts
  it('serve a capa de 640 quando se pede largura', async () => {
    // Um tamanho só (decisão 5 da spec): 292 e 320 caem os dois em 640. A
    // diferença de banda entre eles não paga manter duas capas.
    const { panoramaId } = await seedPanorama(tenants.a);

    const { corpo } = await imagem.execute(panoramaId, { largura: 320 });

    expect((await sharp(corpo!).metadata()).width).toBe(640);
  });
```

- [ ] **Step 7: Rode a suíte inteira**

```bash
cd server-api && yarn test
```

Esperado: tudo PASS, incluindo os 7 novos.

- [ ] **Step 8: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas src/modules/virtual-tours test/rotas-publicas-do-balde.spec.ts
git add server-api/src server-api/test
git commit -m "feat(panoramas): rotas públicas servem a capa gravada em vez de reduzir"
```

---

### Task 12: A rota de rascunho responde com desvio

**Files:**
- Modify: `server-api/src/modules/panoramas/services/get-panorama-preview.service.ts`
- Modify: `server-api/src/modules/panoramas/controllers/get-panorama-preview.controller.ts`
- Test: `server-api/test/preview-com-desvio.spec.ts`

**Interfaces:**
- Consumes: `PanoramaImageReader` (Task 7); `ARMAZENAMENTO`, `VALIDADE_DO_LINK_ASSINADO`, `chaveDaCapa` (Task 1); `chaveServida` (Task 7); `larguraPedida` (Task 11).
- Produces:
  - `new GetPanoramaPreviewService(prisma, leitor, armazenamento)`
  - `execute(...): Promise<RespostaPreview>` onde
    `type RespostaPreview = { tipo: 'desvio'; url: string } | { tipo: 'bytes'; etag: string; corpo?: Buffer }`

A regra de autorização **não sai do lugar**: continua sendo esta rota, com
guard e escopo por agência, que decide se você pode ver aquela foto. O que muda
é que os bytes deixam de passar pelo processo.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/preview-com-desvio.spec.ts`:

```ts
import sharp from 'sharp';
import { GetPanoramaPreviewService } from '../src/modules/panoramas/services/get-panorama-preview.service';
import { PanoramaImageReader } from '../src/modules/panoramas/panorama-image.reader';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function jpeg(largura: number, tom: number): Promise<Buffer> {
  return sharp({
    create: { width: largura, height: largura / 2, channels: 3, background: { r: tom, g: tom, b: tom } },
  })
    .jpeg()
    .toBuffer();
}

async function seedPanorama(propertyId: string, dados: object): Promise<string> {
  const tour = await prisma.virtualTour.create({ data: { propertyId, status: 'DRAFT' } });
  const panorama = await prisma.panorama.create({
    data: { roomName: 'Sala', virtualTourId: tour.id, ...dados },
  });
  return panorama.id;
}

describe('preview do rascunho', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  it('com balde que assina, responde desvio para o link assinado', async () => {
    // Teste 4 da spec. `ArmazenamentoEmMemoria` com base assina; sem base, não.
    const balde = new ArmazenamentoEmMemoria('https://balde.teste');
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const id = await seedPanorama(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const r = await servico.execute(id, tenants.a.admin, { variante: 'original' });

    expect(r.tipo).toBe('desvio');
    expect((r as { url: string }).url).toContain('panoramas/p/1/original.jpg');
  });

  it('com largura, o desvio aponta para a capa', async () => {
    const balde = new ArmazenamentoEmMemoria('https://balde.teste');
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    await balde.gravar(chaveDaCapa('panoramas/p/1/original.jpg'), await jpeg(640, 95));
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const id = await seedPanorama(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const r = await servico.execute(id, tenants.a.admin, {
      variante: 'original',
      largura: 320,
    });

    expect((r as { url: string }).url).toContain('panoramas/p/1/capa.jpg');
  });

  it('sem balde que assine, continua servindo os bytes', async () => {
    // Desenvolvimento e teste: o disco local não assina, e a API serve. Sem
    // esta queda, o wizard abriria em branco na máquina de quem desenvolve.
    const balde = new ArmazenamentoEmMemoria();
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const id = await seedPanorama(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const r = await servico.execute(id, tenants.a.admin, { variante: 'original' });

    expect(r.tipo).toBe('bytes');
    expect((r as { corpo?: Buffer }).corpo).toBeDefined();
  });

  it('linha não migrada continua servindo os bytes da coluna', async () => {
    const balde = new ArmazenamentoEmMemoria('https://balde.teste');
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const bytes = await jpeg(2048, 200);
    const id = await seedPanorama(tenants.a.propertyId, {
      imageData: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    });

    const r = await servico.execute(id, tenants.a.admin, { variante: 'original' });

    expect(r.tipo).toBe('bytes');
  });

  it('panorama de outra agência continua em 404, sem desvio nenhum', async () => {
    // Teste 4 da spec, segunda metade. A autorização NÃO saiu do lugar: se o
    // desvio fosse emitido antes da checagem, um uuid vazaria a foto de outra
    // imobiliária sem nem passar pelo guard.
    const balde = new ArmazenamentoEmMemoria('https://balde.teste');
    await balde.gravar('panoramas/p/1/original.jpg', await jpeg(2048, 90));
    const servico = new GetPanoramaPreviewService(
      asPrismaService,
      new PanoramaImageReader(asPrismaService, balde),
      balde,
    );
    const id = await seedPanorama(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    await expect(
      servico.execute(id, tenants.b.admin, { variante: 'original' }),
    ).rejects.toThrow('Panorama not found');
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test preview-com-desvio
```

Esperado: FAIL — o construtor não aceita três argumentos, e `r.tipo` não existe.

- [ ] **Step 3: Reescreva o serviço**

Em `server-api/src/modules/panoramas/services/get-panorama-preview.service.ts`,
troque o tipo de retorno e o corpo. O bloco de documentação que já está no
arquivo (por que esta rota existe separada da pública) fica como está; some a
este:

```ts
/**
 * Duas respostas possíveis, e a escolha é do armazenamento.
 *
 * Com um balde que assina, `desvio`: a regra de autorização já foi aplicada
 * aqui, e o que vai para o navegador é um link de validade curta. Sem ele —
 * disco local, ou linha que ainda não migrou — `bytes`, exatamente como antes.
 *
 * O ETag só existe no caminho de bytes. No desvio ele não teria o que
 * identificar: quem responde os bytes passa a ser o balde, com o cache dele.
 */
export type RespostaPreview =
  | { tipo: 'desvio'; url: string }
  | { tipo: 'bytes'; etag: string; corpo?: Buffer };
```

Construtor e `execute`:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly leitor: PanoramaImageReader,
    @Inject(ARMAZENAMENTO)
    private readonly armazenamento: ArmazenamentoDeImagens,
  ) {}

  async execute(
    panoramaId: string,
    currentUser: JwtPayload,
    opcoes: { variante: VariantePreview; largura?: number; etagDoCliente?: string },
  ): Promise<RespostaPreview> {
    // A autorização vem PRIMEIRO e não mudou: escopo por agência, e
    // `NotFoundException` em vez de 403 porque 403 confirmaria o id. Emitir um
    // link assinado antes desta linha entregaria a foto de outra imobiliária a
    // quem tivesse o uuid.
    const panorama = await this.prisma.panorama.findFirst({
      where: {
        id: panoramaId,
        virtualTour: { property: { agencyId: currentUser.agencyId } },
      },
      select: {
        id: true,
        updatedAt: true,
        treatmentStatus: true,
        imageKey: true,
        treatedImageKey: true,
      },
    });
    if (!panorama) throw new NotFoundException('Panorama not found');

    const largura = larguraPedida(opcoes.largura);
    const preferirTratada = opcoes.variante === 'treated';

    const chave = chaveServida(panorama, preferirTratada);
    if (chave) {
      const alvo = largura === null ? chave : chaveDaCapa(chave);
      const url = await this.armazenamento.enderecoAssinado(
        alvo,
        VALIDADE_DO_LINK_ASSINADO,
      );
      if (url) return { tipo: 'desvio', url };
    }

    // Queda: sem chave para esta variante, ou armazenamento que não assina.
    const etag = etagDe(
      panorama.id,
      panorama.updatedAt,
      largura ?? 0,
      opcoes.variante,
    );
    if (clienteJaTem(opcoes.etagDoCliente, etag)) return { tipo: 'bytes', etag };

    const carregar = async (): Promise<Buffer> => {
      // `treated` aceita cair na original: durante a captura o tratamento pode
      // não ter terminado, e o leitor já faz esse fallback. `original` nunca
      // cai na tratada — é justamente o que ele existe para não fazer.
      const bytes = await this.leitor.carregar(panorama.id, preferirTratada);
      if (!bytes) throw new NotFoundException('Panorama image not available');
      return bytes;
    };

    if (largura === null) return { tipo: 'bytes', etag, corpo: await carregar() };

    const capa = await this.leitor.carregarCapa(panorama.id, preferirTratada);
    if (capa) return { tipo: 'bytes', etag, corpo: capa };

    return {
      tipo: 'bytes',
      etag,
      corpo: await reduzirComCache(
        chaveDeCache(panorama.id, panorama.updatedAt, LARGURA_DA_CAPA, opcoes.variante),
        LARGURA_DA_CAPA,
        carregar,
      ),
    };
  }
```

Imports novos no topo:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ARMAZENAMENTO,
  ArmazenamentoDeImagens,
  VALIDADE_DO_LINK_ASSINADO,
  chaveDaCapa,
} from '../../../shared/armazenamento/armazenamento.port';
import { chaveServida } from '../panorama-image';
import { clienteJaTem, etagDe } from '../panorama-miniatura';
import {
  LARGURA_DA_CAPA,
  chaveDeCache,
  larguraPedida,
  reduzirComCache,
} from '../capa-do-panorama';
```

E **apague** a função `normalizarLargura` do fim do arquivo, além do
`import { RespostaImagem }` que deixa de ser usado.

- [ ] **Step 4: O controller emite o 302**

Em `server-api/src/modules/panoramas/controllers/get-panorama-preview.controller.ts`,
substitua o corpo do método depois do `await`:

```ts
    const resposta = await this.service.execute(id, user, {
      variante: query.variant,
      largura: query.w,
      etagDoCliente: ifNoneMatch,
    });

    if (resposta.tipo === 'desvio') {
      // `no-store`: o link tem validade curta, e um cache que o guardasse
      // entregaria um endereço já vencido depois. Quem cacheia a FOTO é o
      // navegador, no endereço do balde, com o cache longo que vem de lá.
      res.setHeader('Cache-Control', 'private, no-store');
      res.redirect(HttpStatus.FOUND, resposta.url);
      return;
    }

    res.setHeader('ETag', resposta.etag);
    // `private`: a resposta depende do token de quem pediu, e um cache
    // compartilhado que a guardasse a entregaria para outra imobiliária. Curto
    // porque, durante a captura, a imagem tratada substitui a original em
    // segundos — e é essa troca que o wizard existe para mostrar.
    res.setHeader('Cache-Control', 'private, max-age=60');

    if (!resposta.corpo) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.send(resposta.corpo);
```

- [ ] **Step 5: Rode a suíte inteira**

```bash
cd server-api && yarn test
```

Esperado: tudo PASS, incluindo os 5 novos. `test/rascunho-de-captura.spec.ts`
consome o preview e pode precisar ler `.corpo` através do novo tipo — como ele
usa um `ArmazenamentoEmMemoria` sem base, todas as respostas continuam sendo
`bytes`, e o ajuste é só de tipo.

- [ ] **Step 6: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas test/preview-com-desvio.spec.ts
git add server-api/src server-api/test
git commit -m "feat(panoramas): preview do rascunho responde 302 para link assinado"
```

---

### Task 13: O payload público emite o endereço absoluto

**Files:**
- Modify: `server-api/src/modules/panoramas/panorama-image.ts` (`urlDaImagem` ganha um parâmetro)
- Modify: `server-api/src/modules/virtual-tours/services/find-virtual-tour.service.ts`
- Test: `server-api/test/payload-com-endereco-publico.spec.ts`

**Interfaces:**
- Consumes: `ARMAZENAMENTO`, `ArmazenamentoDeImagens` (Task 1); `chaveServida` (Task 7).
- Produces:
  - `urlDaImagem(panoramaId: string, updatedAt: Date, enderecoPublico?: string | null): string` — o terceiro parâmetro é opcional, então nenhum chamador existente quebra.
  - `new FindVirtualTourService(prisma, armazenamento)`.

**O gatilho é a configuração, não a chave.** Sem `STORAGE_PUBLIC_URL`, o
`enderecoPublico` do armazenamento devolve `null` e o payload sai relativo —
mesmo com `imageKey` preenchido em toda linha. É isso que separa a entrega A da
B, e é o que faz a volta atrás ser apagar uma variável.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/payload-com-endereco-publico.spec.ts`:

```ts
import { FindVirtualTourService } from '../src/modules/virtual-tours/services/find-virtual-tour.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asPrismaService = prisma as unknown as PrismaService;

async function seedTour(
  propertyId: string,
  panorama: object,
): Promise<{ tourId: string; panoramaId: string }> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId, status: 'PUBLISHED' },
  });
  const criado = await prisma.panorama.create({
    data: { roomName: 'Sala', virtualTourId: tour.id, ...panorama },
  });
  return { tourId: tour.id, panoramaId: criado.id };
}

describe('endereço da foto no payload do tour', () => {
  let tenants: TwoTenants;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
  });

  it('com endereço público configurado, emite o absoluto da CDN', async () => {
    // Teste 3 da spec, primeira metade.
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const tour = await new FindVirtualTourService(asPrismaService, balde).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toBe(
      'https://fotos.teste/panoramas/p/1/original.jpg',
    );
  });

  it('com a chave preenchida mas SEM configuração, emite o relativo', async () => {
    // É a entrega A inteira: as chaves já estão no banco, o domínio ainda não
    // existe, e a API continua servindo. Se o gatilho fosse a chave, este é o
    // caso que teria derrubado a tela.
    const balde = new ArmazenamentoEmMemoria();
    const { tourId, panoramaId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const tour = await new FindVirtualTourService(asPrismaService, balde).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toMatch(
      new RegExp(`^/panoramas/${panoramaId}/image\\?v=\\d+$`),
    );
  });

  it('sem chave, emite o relativo mesmo com a CDN configurada', async () => {
    // Tour antigo e tour migrado convivem na mesma tela durante a migração.
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId, panoramaId } = await seedTour(tenants.a.propertyId, {
      imageData: 'AAAA',
    });

    const tour = await new FindVirtualTourService(asPrismaService, balde).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toMatch(
      new RegExp(`^/panoramas/${panoramaId}/image\\?v=\\d+$`),
    );
  });

  it('com tratamento pronto, aponta para a TRATADA', async () => {
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
      treatedImageKey: 'panoramas/p/2/tratada.jpg',
      treatmentStatus: 'DONE',
    });

    const tour = await new FindVirtualTourService(asPrismaService, balde).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toBe(
      'https://fotos.teste/panoramas/p/2/tratada.jpg',
    );
  });

  it('com a tratada só na coluna, volta ao relativo em vez de apontar para o original', async () => {
    // O caso que a migração cria. Apontar a CDN para `imageKey` aqui publicaria
    // o cômodo SEM tratamento, e nada na tela denunciaria.
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId, panoramaId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
      treatedImageData: 'ainda-na-coluna',
      treatmentStatus: 'DONE',
    });

    const tour = await new FindVirtualTourService(asPrismaService, balde).execute(tourId);

    expect(tour.panoramas[0].imageUrl).toMatch(
      new RegExp(`^/panoramas/${panoramaId}/image\\?v=\\d+$`),
    );
  });

  it('o payload não devolve chave nem bytes', async () => {
    // As chaves são detalhe de armazenamento; as colunas são TOAST de dezenas
    // de MB. Nenhuma das duas tem o que fazer num JSON público.
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const tour = await new FindVirtualTourService(asPrismaService, balde).execute(tourId);

    const panorama = tour.panoramas[0] as Record<string, unknown>;
    expect(panorama.imageKey).toBeUndefined();
    expect(panorama.treatedImageKey).toBeUndefined();
    expect(panorama.imageData).toBeUndefined();
    expect(panorama.treatedImageData).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test payload-com-endereco-publico
```

Esperado: FAIL — o construtor não aceita segundo argumento.

- [ ] **Step 3: `urlDaImagem` aceita o absoluto**

Em `server-api/src/modules/panoramas/panorama-image.ts`, troque a função
(mantendo todo o bloco de documentação que já está lá e acrescentando):

```ts
/**
 * ... (documentação existente sobre o relativo e o `?v=`) ...
 *
 * `enderecoPublico` é a saída da entrega B: quando há um balde com domínio
 * configurado, o endereço já é absoluto e o `?v=` deixa de fazer falta — a
 * chave carrega a versão e o arquivo é imutável. Quando não há, tudo continua
 * como antes. O cliente não precisa saber a diferença: `urlDaImagem` do
 * Angular devolve intacto qualquer endereço com esquema, e já é testado assim.
 */
export function urlDaImagem(
  panoramaId: string,
  updatedAt: Date,
  enderecoPublico?: string | null,
): string {
  return enderecoPublico ?? `/panoramas/${panoramaId}/image?v=${updatedAt.getTime()}`;
}
```

- [ ] **Step 4: `FindVirtualTourService` pergunta ao armazenamento**

Em `server-api/src/modules/virtual-tours/services/find-virtual-tour.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ARMAZENAMENTO,
  ArmazenamentoDeImagens,
} from '../../../shared/armazenamento/armazenamento.port';
import { chaveServida, urlDaImagem } from '../../panoramas/panorama-image';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARMAZENAMENTO)
    private readonly armazenamento: ArmazenamentoDeImagens,
  ) {}
```

No `select` dos panoramas, some três colunas — as três são pequenas e nenhuma
toca TOAST:

```ts
            id: true,
            roomName: true,
            updatedAt: true,
            order: true,
            initialPanorama: true,
            treatmentStatus: true,
            imageKey: true,
            treatedImageKey: true,
```

E o `return`:

```ts
    return {
      ...tour,
      panoramas: tour.panoramas.map(
        ({ updatedAt, treatmentStatus, imageKey, treatedImageKey, ...panorama }) => {
          // As três saem do objeto por desestruturação: chave é detalhe de
          // armazenamento e não tem o que fazer num JSON público.
          const chave = chaveServida(
            { imageKey, treatedImageKey },
            treatmentStatus === 'DONE',
          );
          return {
            ...panorama,
            imageUrl: urlDaImagem(
              panorama.id,
              updatedAt,
              chave && this.armazenamento.enderecoPublico(chave),
            ),
          };
        },
      ),
    };
```

- [ ] **Step 5: Rode a suíte inteira**

```bash
cd server-api && yarn test
```

Esperado: tudo PASS, incluindo os 6 novos. `test/edicao-de-tour.spec.ts` e
`test/criar-tour-hotspots.spec.ts` podem construir este serviço — passe um
`ArmazenamentoEmMemoria` sem base, e o payload deles não muda.

- [ ] **Step 6: Lint e commit**

```bash
cd server-api && npx eslint src/modules/panoramas/panorama-image.ts src/modules/virtual-tours test/payload-com-endereco-publico.spec.ts
git add server-api/src server-api/test
git commit -m "feat(virtual-tours): payload emite endereço da CDN quando há um configurado"
```

---

### Task 14: `thumbnailUrl` no payload e na faixa de cenas

**Files:**
- Modify: `server-api/src/modules/panoramas/panorama-image.ts` (acrescenta `urlDaMiniatura`)
- Modify: `server-api/src/modules/virtual-tours/services/find-virtual-tour.service.ts`
- Modify: `server-api/test/payload-com-endereco-publico.spec.ts` (acrescenta casos)
- Modify: `inner-view-client/src/app/services/virtual-tour.service.ts` (o tipo `Panorama`)
- Modify: `inner-view-client/src/app/tour-viewer/tour-viewer.model.ts`
- Test: `inner-view-client/src/app/tour-viewer/tour-viewer.model.spec.ts`

**Interfaces:**
- Consumes: `chaveServida`, `urlDaImagem` (Task 13); `chaveDaCapa` (Task 1).
- Produces: `urlDaMiniatura(panoramaId: string, updatedAt: Date, enderecoPublicoDaCapa?: string | null): string`; campo `thumbnailUrl: string` no payload de cada panorama; `Panorama.thumbnailUrl?: string` no cliente.

> **Esta é a correção 1 do topo do plano.** A faixa de cenas monta a miniatura
> com `comLargura(urlDaImagem(panorama), 292)`. Contra a API isso devolve uma
> miniatura; contra a CDN, `?w=` é parâmetro desconhecido e o R2 devolve o
> arquivo inteiro — 14 MB por cômodo para desenhar 104 px. Sem esta task, a
> entrega B troca uma vitória de banco por uma derrota de banda.

- [ ] **Step 1: Escreva o teste de servidor que falha**

Acrescente a `server-api/test/payload-com-endereco-publico.spec.ts`:

```ts
  it('emite thumbnailUrl absoluto apontando para a CAPA', async () => {
    // O endereço da miniatura precisa ser próprio: emendar `?w=` num endereço
    // de CDN devolve o arquivo inteiro, que é o defeito que a faixa de cenas
    // existe para evitar.
    const balde = new ArmazenamentoEmMemoria('https://fotos.teste');
    const { tourId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const tour = await new FindVirtualTourService(asPrismaService, balde).execute(tourId);

    expect(tour.panoramas[0].thumbnailUrl).toBe(
      'https://fotos.teste/panoramas/p/1/capa.jpg',
    );
  });

  it('sem configuração, thumbnailUrl é o relativo com w=640', async () => {
    const balde = new ArmazenamentoEmMemoria();
    const { tourId, panoramaId } = await seedTour(tenants.a.propertyId, {
      imageKey: 'panoramas/p/1/original.jpg',
    });

    const tour = await new FindVirtualTourService(asPrismaService, balde).execute(tourId);

    expect(tour.panoramas[0].thumbnailUrl).toMatch(
      new RegExp(`^/panoramas/${panoramaId}/image\\?v=\\d+&w=640$`),
    );
  });
```

Rode: `yarn test payload-com-endereco-publico` → FAIL, `thumbnailUrl` é `undefined`.

- [ ] **Step 2: `urlDaMiniatura` em `panorama-image.ts`**

```ts
/**
 * Endereço da MINIATURA de um cômodo — a capa de 640 px.
 *
 * Existe separado de `urlDaImagem` porque o cliente não pode mais derivá-lo.
 * Ele derivava: `imageUrl` mais `?w=292`. Contra a API isso funciona; contra a
 * CDN, `?w=` é parâmetro desconhecido e o balde devolve o arquivo INTEIRO — 14
 * MB por cômodo para desenhar um retângulo de 104 px. Quem sabe onde a capa
 * mora é o servidor, então é ele que responde.
 */
export function urlDaMiniatura(
  panoramaId: string,
  updatedAt: Date,
  enderecoPublicoDaCapa?: string | null,
): string {
  return (
    enderecoPublicoDaCapa ??
    `/panoramas/${panoramaId}/image?v=${updatedAt.getTime()}&w=${LARGURA_DA_CAPA}`
  );
}
```

Com `import { LARGURA_DA_CAPA } from './capa-do-panorama';` no topo.

- [ ] **Step 3: Emita o campo no payload**

No `map` de `find-virtual-tour.service.ts`, dentro do mesmo bloco da Task 13:

```ts
          const chave = chaveServida(
            { imageKey, treatedImageKey },
            treatmentStatus === 'DONE',
          );
          const publico = chave && this.armazenamento.enderecoPublico(chave);
          const publicoDaCapa =
            chave && this.armazenamento.enderecoPublico(chaveDaCapa(chave));

          return {
            ...panorama,
            imageUrl: urlDaImagem(panorama.id, updatedAt, publico),
            thumbnailUrl: urlDaMiniatura(panorama.id, updatedAt, publicoDaCapa),
          };
```

Rode: `yarn test` → tudo PASS.

- [ ] **Step 4: Escreva o teste de cliente que falha**

Em `inner-view-client/src/app/tour-viewer/tour-viewer.model.spec.ts` (crie o
arquivo se não existir), acrescente:

```ts
import { cenasDoTour } from './tour-viewer.model';
import { environment } from '../../environments/environment';

function tourCom(panorama: object) {
  return {
    id: 't1',
    panoramas: [
      { id: 'p1', roomName: 'Sala', originHotspots: [], measurements: [], ...panorama },
    ],
  } as never;
}

describe('cenasDoTour: endereço da miniatura', () => {
  it('usa o thumbnailUrl que o servidor mandou, sem emendar w=', () => {
    // Emendar `?w=292` num endereço de CDN devolve o arquivo inteiro: o
    // servidor é quem sabe onde a capa mora.
    const cenas = cenasDoTour(
      tourCom({
        imageUrl: 'https://fotos.teste/panoramas/p1/1/original.jpg',
        thumbnailUrl: 'https://fotos.teste/panoramas/p1/1/capa.jpg',
      }),
    );

    expect(cenas[0].thumbUrl).toBe('https://fotos.teste/panoramas/p1/1/capa.jpg');
  });

  it('prefixa a API quando o thumbnailUrl vem relativo', () => {
    const cenas = cenasDoTour(
      tourCom({
        imageUrl: '/panoramas/p1/image?v=1',
        thumbnailUrl: '/panoramas/p1/image?v=1&w=640',
      }),
    );

    expect(cenas[0].thumbUrl).toBe(`${environment.apiUrl}/panoramas/p1/image?v=1&w=640`);
  });

  it('sem thumbnailUrl, volta a derivar do imageUrl', () => {
    // Compatibilidade com uma API mais velha que este cliente: o campo é novo,
    // e um deploy fora de ordem não pode deixar a faixa sem miniatura.
    const cenas = cenasDoTour(tourCom({ imageUrl: '/panoramas/p1/image?v=1' }));

    expect(cenas[0].thumbUrl).toBe(`${environment.apiUrl}/panoramas/p1/image?v=1&w=292`);
  });
});
```

Rode: `cd inner-view-client && npm test -- --include='**/tour-viewer.model.spec.ts'` → FAIL.

- [ ] **Step 5: Aceite o campo no tipo do cliente**

Na interface `Panorama` de `inner-view-client/src/app/services/virtual-tour.service.ts`:

```ts
  /**
   * Endereço da capa de 640 px, quando o servidor sabe emiti-lo. Opcional por
   * compatibilidade com uma API anterior a ele.
   */
  thumbnailUrl?: string;
```

- [ ] **Step 6: Use-o em `cenasDoTour`**

Em `inner-view-client/src/app/tour-viewer/tour-viewer.model.ts`:

```ts
    thumbUrl: urlDaImagem({
      // O servidor manda o endereço da miniatura quando sabe qual é — e sabe
      // sempre que as fotos estão no balde, onde `?w=` não significa nada.
      // A derivação antiga fica como queda para uma API mais velha.
      imageUrl:
        panorama.thumbnailUrl ??
        comLargura(panorama.imageUrl, LARGURA_DA_MINIATURA),
    }),
```

- [ ] **Step 7: Rode os dois lados**

```bash
cd inner-view-client && npm test
cd ../server-api && yarn test
```

Esperado: tudo PASS.

- [ ] **Step 8: Lint e commit**

```bash
cd inner-view-client && npm run lint
cd ../server-api && npx eslint src/modules/panoramas/panorama-image.ts src/modules/virtual-tours
git add inner-view-client server-api
git commit -m "feat(tour): endereço próprio para a miniatura, em vez de emendar w= na CDN"
```

> `npm run lint` no cliente roda `tools/checa-crases.js` via `git ls-files` —
> se algum arquivo foi apagado, dê `git add` nas deleções antes.

---

### Task 15: `scripts/migrar-imagens.ts`

**Files:**
- Create: `server-api/scripts/migrar-imagens.ts`
- Modify: `server-api/package.json` (o script `migrar-imagens`)
- Test: `server-api/test/migrar-imagens.spec.ts`

**Interfaces:**
- Consumes: `ArmazenamentoDeImagens` (Task 1); `GravadorDeImagens` (Task 6) — instanciável fora do Nest, o construtor só recebe a porta; `base64Puro`.
- Produces:
  - `migrar(prisma: PrismaClient, armazenamento: ArmazenamentoDeImagens, opcoes: { limite: number; aplicar: boolean }): Promise<ResumoDaMigracao>`
  - `conferir(prisma: PrismaClient): Promise<{ panoramas: number; tratadas: number; capturas: number }>`
  - `interface ResumoDaMigracao { originais: number; tratadas: number; capturas: number; restam: number }`
  - O `main()` fica atrás de `require.main === module`, para o teste poder importar sem abrir conexão.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/migrar-imagens.spec.ts`:

```ts
import sharp from 'sharp';
import { PrismaClient } from '../generated/prisma/client';
import { conferir, migrar } from '../scripts/migrar-imagens';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asClient = prisma as unknown as PrismaClient;

async function dataUri(tom: number): Promise<string> {
  const bytes = await sharp({
    create: { width: 800, height: 400, channels: 3, background: { r: tom, g: tom, b: tom } },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

async function seedPanoramas(propertyId: string, quantos: number): Promise<string[]> {
  const tour = await prisma.virtualTour.create({
    data: { propertyId, status: 'PUBLISHED' },
  });
  const ids: string[] = [];
  for (let i = 0; i < quantos; i++) {
    const criado = await prisma.panorama.create({
      data: {
        roomName: `Cômodo ${i}`,
        order: i,
        virtualTourId: tour.id,
        imageData: await dataUri(60 + i),
      },
    });
    ids.push(criado.id);
  }
  return ids;
}

describe('migrar-imagens', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();
  });

  it('seco por padrão: conta sem gravar nada', async () => {
    // Um script que reescreve o banco não pode ter o caminho que escreve como o
    // mais fácil de digitar por engano.
    await seedPanoramas(tenants.a.propertyId, 3);

    const resumo = await migrar(asClient, balde, { limite: 100, aplicar: false });

    expect(resumo.originais).toBe(3);
    expect(balde.gravacoes).toBe(0);
    expect(await prisma.panorama.count({ where: { imageKey: { not: null } } })).toBe(0);
  });

  it('com --aplicar, sobe a imagem e a capa e grava a chave', async () => {
    const [id] = await seedPanoramas(tenants.a.propertyId, 1);

    await migrar(asClient, balde, { limite: 100, aplicar: true });

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id },
      select: { imageKey: true, imageData: true },
    });
    expect(linha.imageKey).toMatch(/^panoramas\/.+\/original\.jpg$/);
    expect(balde.tem(linha.imageKey!)).toBe(true);
    expect(balde.tem(chaveDaCapa(linha.imageKey!))).toBe(true);
    // A coluna NÃO é apagada aqui: ela é a rede de segurança até a etapa 5.
    expect(linha.imageData).toBeTruthy();
  });

  it('é idempotente: a segunda execução não sobe nada', async () => {
    // Teste 7 da spec. Sem isto, rodar o script duas vezes dobraria o balde e
    // trocaria todas as chaves — invalidando o cache de todo visitante.
    await seedPanoramas(tenants.a.propertyId, 3);
    await migrar(asClient, balde, { limite: 100, aplicar: true });
    const depoisDaPrimeira = balde.gravacoes;

    const resumo = await migrar(asClient, balde, { limite: 100, aplicar: true });

    expect(resumo.originais).toBe(0);
    expect(balde.gravacoes).toBe(depoisDaPrimeira);
  });

  it('é retomável: interrompido na metade, continua de onde parou', async () => {
    // Teste 8 da spec. O banco de produção tem 573 MB de foto e a instância
    // tem 512 MB de RAM: rodar tudo de uma vez não é opção.
    await seedPanoramas(tenants.a.propertyId, 5);

    const primeira = await migrar(asClient, balde, { limite: 2, aplicar: true });
    expect(primeira.originais).toBe(2);
    expect(primeira.restam).toBe(3);

    const segunda = await migrar(asClient, balde, { limite: 100, aplicar: true });

    expect(segunda.originais).toBe(3);
    expect(await prisma.panorama.count({ where: { imageKey: null } })).toBe(0);
  });

  it('migra a tratada e as fotos da captura também', async () => {
    const [id] = await seedPanoramas(tenants.a.propertyId, 1);
    await prisma.panorama.update({
      where: { id },
      data: { treatedImageData: await dataUri(200), treatmentStatus: 'DONE' },
    });
    await prisma.captureFrame.create({
      data: { panoramaId: id, index: 0, qx: 0, qy: 0, qz: 0, qw: 1, imageData: await dataUri(140) },
    });

    const resumo = await migrar(asClient, balde, { limite: 100, aplicar: true });

    expect(resumo.tratadas).toBe(1);
    expect(resumo.capturas).toBe(1);
    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id },
      select: { treatedImageKey: true },
    });
    expect(linha.treatedImageKey).toMatch(/tratada\.jpg$/);
    expect(balde.tem(`capturas/${id}/0.jpg`)).toBe(true);
  });

  it('a conferência acusa o que falta e zera quando termina', async () => {
    // O passo 4 da migração: é ele que autoriza seguir para o 5.
    await seedPanoramas(tenants.a.propertyId, 2);

    expect((await conferir(asClient)).panoramas).toBe(2);

    await migrar(asClient, balde, { limite: 100, aplicar: true });

    expect(await conferir(asClient)).toEqual({ panoramas: 0, tratadas: 0, capturas: 0 });
  });

  it('se o balde falhar numa linha, nenhuma chave é gravada para ela', async () => {
    const [id] = await seedPanoramas(tenants.a.propertyId, 1);
    jest.spyOn(balde, 'gravar').mockRejectedValueOnce(new Error('balde fora do ar'));

    await expect(
      migrar(asClient, balde, { limite: 100, aplicar: true }),
    ).rejects.toThrow('balde fora do ar');

    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id },
      select: { imageKey: true },
    });
    expect(linha.imageKey).toBeNull();
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test migrar-imagens
```

Esperado: FAIL — `Cannot find module '../scripts/migrar-imagens'`.

- [ ] **Step 3: Escreva o script**

Crie `server-api/scripts/migrar-imagens.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { resolve } from 'node:path';
import { PrismaClient } from '../generated/prisma/client';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';
import { base64Puro } from '../src/modules/panoramas/panorama-image';
import { ArmazenamentoLocal } from '../src/shared/armazenamento/armazenamento-local';
import { ArmazenamentoR2 } from '../src/shared/armazenamento/armazenamento-r2';
import { ArmazenamentoDeImagens } from '../src/shared/armazenamento/armazenamento.port';

/**
 * Passa as fotos que estão em coluna base64 para o balde de objetos.
 *
 *   yarn migrar-imagens                      # seco: conta o que falta
 *   yarn migrar-imagens --aplicar            # migra
 *   yarn migrar-imagens --aplicar --limite=10
 *   yarn migrar-imagens --conferir           # passo 4: o que ainda não migrou
 *
 * **Idempotente**: só olha linha com bytes e SEM chave, então rodar de novo é
 * no-op. Fosse ao contrário, a segunda execução trocaria todas as chaves e
 * invalidaria o cache de todo visitante.
 *
 * **Retomável**: `--limite` processa N linhas e para. O banco de produção tem
 * 573 MB de foto e a instância tem 512 MB de RAM — rodar tudo de uma vez não é
 * opção, e parar no meio precisa ser seguro.
 *
 * **Seco por padrão.** Um comando que reescreve o banco não pode ter o caminho
 * destrutivo como o mais fácil de digitar por engano.
 *
 * A coluna NÃO é apagada. Ela é a rede de segurança até a etapa 5 da migração
 * — ver `docs/operacao/migracao-das-fotos.md`.
 */

const LIMITE_PADRAO = 25;

export interface ResumoDaMigracao {
  originais: number;
  tratadas: number;
  capturas: number;
  /** O que ficou para a próxima execução. */
  restam: number;
}

export async function conferir(
  prisma: PrismaClient,
): Promise<{ panoramas: number; tratadas: number; capturas: number }> {
  const [panoramas, tratadas, capturas] = await Promise.all([
    prisma.panorama.count({ where: { imageKey: null, imageData: { not: null } } }),
    prisma.panorama.count({
      where: { treatedImageKey: null, treatedImageData: { not: null } },
    }),
    prisma.captureFrame.count({ where: { imageKey: null, imageData: { not: null } } }),
  ]);
  return { panoramas, tratadas, capturas };
}

export async function migrar(
  prisma: PrismaClient,
  armazenamento: ArmazenamentoDeImagens,
  opcoes: { limite: number; aplicar: boolean },
): Promise<ResumoDaMigracao> {
  const gravador = new GravadorDeImagens(armazenamento);
  const resumo: ResumoDaMigracao = { originais: 0, tratadas: 0, capturas: 0, restam: 0 };
  let orcamento = opcoes.limite;

  // Uma linha por vez, de propósito. Em paralelo, N imagens de 14 MB estariam
  // vivas ao mesmo tempo — é a mesma conta que obrigou o tratamento a ser
  // serial, e nenhuma coleta ajuda quando os buffers estão todos em uso.
  const originais = await prisma.panorama.findMany({
    where: { imageKey: null, imageData: { not: null } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: orcamento,
  });
  for (const { id } of originais) {
    if (!opcoes.aplicar) { resumo.originais++; orcamento--; continue; }
    const linha = await prisma.panorama.findUniqueOrThrow({
      where: { id },
      select: { imageData: true },
    });
    if (!linha.imageData) continue;
    // Balde primeiro, banco depois. Se o balde falhar, o `throw` sobe e a
    // linha fica intacta para a próxima execução — que é o que faz uma
    // interrupção no meio ser segura.
    const chave = await gravador.gravarPanorama(
      id,
      Buffer.from(base64Puro(linha.imageData), 'base64'),
      'original',
    );
    await prisma.panorama.update({ where: { id }, data: { imageKey: chave } });
    resumo.originais++;
    orcamento--;
  }

  if (orcamento > 0) {
    const tratadas = await prisma.panorama.findMany({
      where: { treatedImageKey: null, treatedImageData: { not: null } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: orcamento,
    });
    for (const { id } of tratadas) {
      if (!opcoes.aplicar) { resumo.tratadas++; orcamento--; continue; }
      const linha = await prisma.panorama.findUniqueOrThrow({
        where: { id },
        select: { treatedImageData: true },
      });
      if (!linha.treatedImageData) continue;
      const chave = await gravador.gravarPanorama(
        id,
        Buffer.from(base64Puro(linha.treatedImageData), 'base64'),
        'tratada',
      );
      await prisma.panorama.update({ where: { id }, data: { treatedImageKey: chave } });
      resumo.tratadas++;
      orcamento--;
    }
  }

  if (orcamento > 0) {
    const capturas = await prisma.captureFrame.findMany({
      where: { imageKey: null, imageData: { not: null } },
      select: { id: true, panoramaId: true, index: true },
      orderBy: { id: 'asc' },
      take: orcamento,
    });
    for (const frame of capturas) {
      if (!opcoes.aplicar) { resumo.capturas++; orcamento--; continue; }
      const linha = await prisma.captureFrame.findUniqueOrThrow({
        where: { id: frame.id },
        select: { imageData: true },
      });
      if (!linha.imageData) continue;
      const chave = await gravador.gravarCaptura(
        frame.panoramaId,
        frame.index,
        Buffer.from(base64Puro(linha.imageData), 'base64'),
      );
      await prisma.captureFrame.update({ where: { id: frame.id }, data: { imageKey: chave } });
      resumo.capturas++;
      orcamento--;
    }
  }

  const falta = await conferir(prisma);
  resumo.restam = falta.panoramas + falta.tratadas + falta.capturas;
  return resumo;
}

/** A mesma escolha do `ArmazenamentoModule`, fora do Nest. */
function armazenamentoDoAmbiente(): ArmazenamentoDeImagens {
  const endpoint = process.env.STORAGE_ENDPOINT;
  if (!endpoint) {
    return new ArmazenamentoLocal(resolve(process.env.STORAGE_LOCAL_DIR ?? '.armazenamento'));
  }
  return new ArmazenamentoR2({
    endpoint,
    bucket: process.env.STORAGE_BUCKET ?? '',
    chaveId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
    chaveSecreta: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
    urlPublica: process.env.STORAGE_PUBLIC_URL || null,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
  });

  try {
    if (args.includes('--conferir')) {
      const falta = await conferir(prisma);
      console.log(
        `Falta migrar: ${falta.panoramas} panorama(s), ${falta.tratadas} tratada(s), ${falta.capturas} foto(s) de captura.`,
      );
      if (falta.panoramas + falta.tratadas + falta.capturas > 0) process.exitCode = 1;
      return;
    }

    const aplicar = args.includes('--aplicar');
    const limite = Number(valorDe(args, '--limite') ?? LIMITE_PADRAO);
    if (!Number.isFinite(limite) || limite < 1) {
      throw new Error(`--limite precisa ser um inteiro positivo. Recebido: ${valorDe(args, '--limite')}`);
    }

    const resumo = await migrar(prisma, armazenamentoDoAmbiente(), { limite, aplicar });
    console.log(
      `${aplicar ? 'Migrados' : 'Migrariam'}: ${resumo.originais} original(is), ${resumo.tratadas} tratada(s), ${resumo.capturas} captura(s). Restam ${resumo.restam}.`,
    );
    if (!aplicar) console.log('\nSeco. Repita com --aplicar para gravar.');
  } finally {
    await prisma.$disconnect();
  }
}

function valorDe(args: string[], nome: string): string | undefined {
  return args.find((a) => a.startsWith(`${nome}=`))?.slice(nome.length + 1);
}

// Atrás da guarda para o teste poder importar `migrar` sem abrir conexão.
if (require.main === module) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Registre o comando**

Em `server-api/package.json`, em `scripts`:

```json
    "migrar-imagens": "ts-node -r dotenv/config -r tsconfig-paths/register scripts/migrar-imagens.ts",
```

- [ ] **Step 5: Rode e veja passar**

```bash
cd server-api && yarn test migrar-imagens
```

Esperado: PASS, 7 testes.

- [ ] **Step 6: Lint e commit**

```bash
cd server-api && npx eslint scripts/migrar-imagens.ts test/migrar-imagens.spec.ts
git add server-api
git commit -m "feat(scripts): migrar-imagens, idempotente e retomável"
```

---

### Task 16: `scripts/varrer-orfaos.ts`

**Files:**
- Create: `server-api/scripts/varrer-orfaos.ts`
- Modify: `server-api/package.json`
- Test: `server-api/test/varrer-orfaos.spec.ts`

**Interfaces:**
- Consumes: `ArmazenamentoDeImagens.listar`/`apagar`, `chaveDaCapa` (Task 1).
- Produces: `varrer(prisma: PrismaClient, armazenamento: ArmazenamentoDeImagens, opcoes: { apagar: boolean; dias: number }): Promise<{ examinados: number; orfaos: string[]; apagados: number }>`.

O órfão tem duas origens: a versão anterior de uma imagem retratada (decisão 2,
o arquivo é imutável) e a gravação que aconteceu antes de um banco que falhou
(decisão 10). As duas custam centavos, e nenhuma se resolve sozinha.

- [ ] **Step 1: Escreva o teste que falha**

Crie `server-api/test/varrer-orfaos.spec.ts`:

```ts
import { PrismaClient } from '../generated/prisma/client';
import { varrer } from '../scripts/varrer-orfaos';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { seedTwoTenants, TwoTenants } from './fixtures';
import { prisma } from './setup/prisma';

const asClient = prisma as unknown as PrismaClient;
const VIVA = 'panoramas/p/2/tratada.jpg';
const ORFA = 'panoramas/p/1/tratada.jpg';

describe('varrer-orfaos', () => {
  let tenants: TwoTenants;
  let balde: ArmazenamentoEmMemoria;

  beforeEach(async () => {
    tenants = await seedTwoTenants();
    balde = new ArmazenamentoEmMemoria();

    const tour = await prisma.virtualTour.create({
      data: { propertyId: tenants.a.propertyId, status: 'PUBLISHED' },
    });
    await prisma.panorama.create({
      data: {
        roomName: 'Sala',
        virtualTourId: tour.id,
        imageKey: 'panoramas/p/0/original.jpg',
        treatedImageKey: VIVA,
        treatmentStatus: 'DONE',
      },
    });

    for (const chave of ['panoramas/p/0/original.jpg', VIVA, ORFA]) {
      await balde.gravar(chave, Buffer.from(chave));
      await balde.gravar(chaveDaCapa(chave), Buffer.from(`capa de ${chave}`));
    }
  });

  it('acha a versão anterior e não toca na viva', async () => {
    const r = await varrer(asClient, balde, { apagar: false, dias: 0 });

    expect(r.orfaos.sort()).toEqual([ORFA, chaveDaCapa(ORFA)].sort());
  });

  it('seco por padrão: não apaga nada', async () => {
    await varrer(asClient, balde, { apagar: false, dias: 0 });

    expect(balde.tem(ORFA)).toBe(true);
  });

  it('com --apagar, some com o órfão e preserva o vivo', async () => {
    const r = await varrer(asClient, balde, { apagar: true, dias: 0 });

    expect(r.apagados).toBe(2);
    expect(balde.tem(ORFA)).toBe(false);
    expect(balde.tem(VIVA)).toBe(true);
    expect(balde.tem(chaveDaCapa(VIVA))).toBe(true);
  });

  it('não apaga objeto recém-gravado', async () => {
    // A decisão 10 grava no balde ANTES do banco: existe uma janela, de
    // milissegundos a segundos, em que um objeto legítimo ainda não tem dono.
    // Varrer sem idade de corte apagaria uma captura em curso.
    const r = await varrer(asClient, balde, { apagar: true, dias: 7 });

    expect(r.orfaos).toEqual([]);
    expect(balde.tem(ORFA)).toBe(true);
  });

  it('a foto de referência de um panorama vivo não é órfã', async () => {
    // Decisão 4: elas NÃO são apagadas depois do tratamento. Apagar continua
    // disponível para sempre; recuperar nunca fica.
    const panorama = await prisma.panorama.findFirstOrThrow({ select: { id: true } });
    await prisma.captureFrame.create({
      data: {
        panoramaId: panorama.id, index: 0, qx: 0, qy: 0, qz: 0, qw: 1,
        imageKey: `capturas/${panorama.id}/0.jpg`,
      },
    });
    await balde.gravar(`capturas/${panorama.id}/0.jpg`, Buffer.from('ref'));

    const r = await varrer(asClient, balde, { apagar: true, dias: 0 });

    expect(balde.tem(`capturas/${panorama.id}/0.jpg`)).toBe(true);
    expect(r.orfaos).not.toContain(`capturas/${panorama.id}/0.jpg`);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd server-api && yarn test varrer-orfaos
```

Esperado: FAIL — módulo não encontrado.

- [ ] **Step 3: Escreva o script**

Crie `server-api/scripts/varrer-orfaos.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { resolve } from 'node:path';
import { PrismaClient } from '../generated/prisma/client';
import { ArmazenamentoLocal } from '../src/shared/armazenamento/armazenamento-local';
import { ArmazenamentoR2 } from '../src/shared/armazenamento/armazenamento-r2';
import {
  ArmazenamentoDeImagens,
  chaveDaCapa,
} from '../src/shared/armazenamento/armazenamento.port';

/**
 * Recolhe arquivo que nenhuma linha do banco aponta.
 *
 *   yarn varrer-orfaos                  # seco: lista o que seria apagado
 *   yarn varrer-orfaos --apagar
 *   yarn varrer-orfaos --apagar --dias=1
 *
 * Duas origens, as duas previstas:
 *
 * 1. **A versão anterior** de uma imagem retratada. O arquivo é imutável de
 *    propósito (decisão 2): é isso que faz invalidação de CDN sumir como classe
 *    de problema, e o preço é a versão velha ficar para trás.
 * 2. **A gravação que precedeu um banco que falhou** (decisão 10). Gravar no
 *    balde antes é o que impede uma linha apontar para o nada; o troco é este
 *    arquivo sem dono.
 *
 * `--dias` é o que torna a varredura segura: entre a gravação no balde e o
 * `UPDATE` existe uma janela em que um objeto legítimo ainda não tem dono.
 * Apagar por lá seria apagar uma captura em curso. O padrão de 7 dias é
 * folgado de propósito — lixo custa centavos, e apagar foto viva custa a foto.
 *
 * **Seco por padrão.**
 */

const DIAS_PADRAO = 7;

export async function varrer(
  prisma: PrismaClient,
  armazenamento: ArmazenamentoDeImagens,
  opcoes: { apagar: boolean; dias: number },
): Promise<{ examinados: number; orfaos: string[]; apagados: number }> {
  const vivas = await chavesVivas(prisma);
  const corte = new Date(Date.now() - opcoes.dias * 24 * 60 * 60 * 1000);

  let examinados = 0;
  let apagados = 0;
  const orfaos: string[] = [];

  for (const prefixo of ['panoramas/', 'capturas/']) {
    for await (const objeto of armazenamento.listar(prefixo)) {
      examinados++;
      if (vivas.has(objeto.chave)) continue;
      if (objeto.modificadoEm > corte) continue;

      orfaos.push(objeto.chave);
      if (opcoes.apagar) {
        await armazenamento.apagar(objeto.chave);
        apagados++;
      }
    }
  }

  return { examinados, orfaos, apagados };
}

/**
 * Todo endereço que alguma linha ainda alcança — imagem, tratada, capa de cada
 * uma, e foto de referência.
 *
 * Em memória, e isso tem limite: são duas colunas por panorama mais uma por
 * foto de captura, o que com os 114 panoramas e as ~900 fotos de hoje é ruído.
 * Numa ordem de grandeza acima, esta varredura passa a precisar de paginação
 * por prefixo em vez do conjunto inteiro.
 */
async function chavesVivas(prisma: PrismaClient): Promise<Set<string>> {
  const vivas = new Set<string>();

  const panoramas = await prisma.panorama.findMany({
    select: { imageKey: true, treatedImageKey: true },
  });
  for (const linha of panoramas) {
    for (const chave of [linha.imageKey, linha.treatedImageKey]) {
      if (!chave) continue;
      vivas.add(chave);
      // A capa não tem coluna: ela se deduz da chave da imagem, e por isso
      // precisa ser reconstruída aqui — senão a varredura apagaria todas elas.
      vivas.add(chaveDaCapa(chave));
    }
  }

  const frames = await prisma.captureFrame.findMany({
    where: { imageKey: { not: null } },
    select: { imageKey: true },
  });
  for (const frame of frames) if (frame.imageKey) vivas.add(frame.imageKey);

  return vivas;
}

/** A mesma escolha do `ArmazenamentoModule`, fora do Nest. */
function armazenamentoDoAmbiente(): ArmazenamentoDeImagens {
  const endpoint = process.env.STORAGE_ENDPOINT;
  if (!endpoint) {
    return new ArmazenamentoLocal(resolve(process.env.STORAGE_LOCAL_DIR ?? '.armazenamento'));
  }
  return new ArmazenamentoR2({
    endpoint,
    bucket: process.env.STORAGE_BUCKET ?? '',
    chaveId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
    chaveSecreta: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
    urlPublica: process.env.STORAGE_PUBLIC_URL || null,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apagar = args.includes('--apagar');
  const dias = Number(valorDe(args, '--dias') ?? DIAS_PADRAO);
  if (!Number.isFinite(dias) || dias < 0) {
    throw new Error(`--dias precisa ser um número não-negativo. Recebido: ${valorDe(args, '--dias')}`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
  });

  try {
    const r = await varrer(prisma, armazenamentoDoAmbiente(), { apagar, dias });
    console.log(`${r.examinados} objeto(s) examinado(s), ${r.orfaos.length} órfão(s).`);
    for (const chave of r.orfaos) console.log(`  ${chave}`);
    console.log(apagar ? `\n${r.apagados} apagado(s).` : '\nSeco. Repita com --apagar.');
  } finally {
    await prisma.$disconnect();
  }
}

function valorDe(args: string[], nome: string): string | undefined {
  return args.find((a) => a.startsWith(`${nome}=`))?.slice(nome.length + 1);
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Registre o comando**

```json
    "varrer-orfaos": "ts-node -r dotenv/config -r tsconfig-paths/register scripts/varrer-orfaos.ts",
```

- [ ] **Step 5: Rode e veja passar**

```bash
cd server-api && yarn test varrer-orfaos
```

Esperado: PASS, 5 testes.

- [ ] **Step 6: Lint e commit**

```bash
cd server-api && npx eslint scripts/varrer-orfaos.ts test/varrer-orfaos.spec.ts
git add server-api
git commit -m "feat(scripts): varrer-orfaos, seco por padrão e com idade de corte"
```

---

### Task 17: O runbook da migração

**Files:**
- Create: `docs/operacao/migracao-das-fotos.md`

**Interfaces:**
- Consumes: os comandos `migrar-imagens` e `varrer-orfaos` (Tasks 15 e 16); as variáveis da Task 3.
- Produces: nada de código. É o documento que quem opera segue — e é onde moram os passos 4 e 5 da migração, que não são código e não podem ser feitos por este plano.

Não há teste automatizado. A verificação é o Step 3.

- [ ] **Step 1: Escreva o runbook**

Crie `docs/operacao/migracao-das-fotos.md`:

````markdown
# Migração das fotos para armazenamento de objetos

Spec: `docs/superpowers/specs/2026-09-15-fotos-em-armazenamento-de-objetos-design.md`

Nenhum passo derruba um tour publicado. A ordem importa, e o passo 4 é o que
autoriza o 5.

## Antes de começar — o que não é código

1. **Conta na Cloudflare, balde R2 e chave de API** com permissão de leitura e
   escrita no balde.
2. **CORS no balde.** A rota de rascunho responde `302` para um link assinado, e
   quem segue esse desvio é o `HttpClient` do Angular — uma requisição
   cross-origin. Sem uma regra de CORS no balde liberando a origem do
   aplicativo para `GET`, o navegador bloqueia a imagem e a tela abre em
   branco, sem erro visível. **Isto não estava na spec e foi achado ao ler o
   caminho do cliente.**
3. **`CSP_EXTRA_ORIGINS`** no serviço da API, com o domínio do balde.
4. **Os cabeçalhos do site estático** que serve o Angular. A CSP da API cobre as
   respostas da API, não as do aplicativo — e ela está fora deste repositório.
   Se existir uma CSP lá que não libere o domínio do balde, a imagem falha
   calada e o material fica sem mapa, que é tela branca.
5. **Domínio próprio na Cloudflare** — só para a entrega B. O `r2.dev` gratuito
   é limitado em banda e a própria Cloudflare o desaconselha para produção.

## Entrega A — o banco encolhe

### Passo 1: a migração de schema

```bash
npx prisma migrate deploy
```

As colunas de endereço nascem vazias. Sem mudança de comportamento.

### Passo 2: o deploy que escreve nos dois lugares

Ponha as quatro variáveis do balde no ambiente e faça o deploy:

```
STORAGE_ENDPOINT=https://<ID-DA-CONTA>.r2.cloudflarestorage.com
STORAGE_BUCKET=<nome>
STORAGE_ACCESS_KEY_ID=<id>
STORAGE_SECRET_ACCESS_KEY=<segredo>
```

**`STORAGE_PUBLIC_URL` fica vazia.** A API continua servindo os bytes; o que
muda é de onde ela os lê. A partir daqui, foto nova nasce no balde.

Confira no log do boot: `Fotos na R2, servidas pela API (STORAGE_PUBLIC_URL vazia).`

### Passo 3: o preenchimento

```bash
yarn migrar-imagens                        # seco: quanto falta
yarn migrar-imagens --aplicar --limite=10  # em lotes
```

Idempotente e retomável: pode parar no meio e repetir. Rode em lotes e olhe a
memória da instância entre eles — a instância tem 512 MB e cada imagem passa
por ela.

### Passo 4: a conferência

```bash
yarn migrar-imagens --conferir
```

Só siga com **zero** nas três contagens. Este passo é o que autoriza o 5.

## Entrega B — o navegador busca na CDN

Depende do domínio, e só dele.

```
STORAGE_PUBLIC_URL=https://fotos.<dominio>
```

Não precisa de deploy de código: o gatilho é a configuração. O payload do tour
passa a emitir o endereço absoluto e a API sai do caminho das fotos de tour
publicado.

**A volta atrás é apagar a variável.** Sem deploy e sem migração reversa.

Confira no log do boot: `Fotos na R2, servidas por https://fotos.<dominio>.`

## Depois, com calma

Estes não são passos deste plano — cada um é uma mudança própria, e nenhum é
urgente.

### Parar de escrever as colunas

Depois de uma janela de segurança com a entrega A estável, tire a escrita dupla
de `create-panorama.service.ts`, `update-panorama.service.ts`,
`upload-capture-frame.service.ts` e `treat-panorama.service.ts`. Só então:

```sql
ALTER TABLE "Panorama" DROP COLUMN "imageData";
ALTER TABLE "Panorama" DROP COLUMN "treatedImageData";
ALTER TABLE "CaptureFrame" DROP COLUMN "imageData";
```

**Apagar coluna no Postgres não devolve o disco.** O espaço só volta com
`VACUUM FULL` (ou `pg_repack`), que **tranca a escrita** enquanto roda. Com o
tamanho de hoje isso leva segundos, mas precisa estar no plano em vez de virar
susto.

### Apagar o caminho de queda

Com as colunas fora, some a metade de baixo de
`src/modules/panoramas/capa-do-panorama.ts` — o LRU de 64 entradas, o portão de
duas reduções simultâneas e `reduzirComCache`. Ela existia para segurar um
custo que esta entrega elimina; enquanto houver linha não migrada, ela ainda é
o que impede um tour de nove cômodos custar 113 MB de uma vez.

Fica `reduzirParaCapa`, que é a capa gravada no momento da escrita.

### Regra de validade no balde

Uma regra de ciclo de vida no R2 apagando `panoramas/*` com mais de N dias que
ninguém referencia faz o trabalho de `varrer-orfaos` sozinha. Enquanto ela não
existe:

```bash
yarn varrer-orfaos                  # seco
yarn varrer-orfaos --apagar
```

Nunca com `--dias=0` em produção: a gravação acontece antes do banco, e existe
uma janela em que um objeto legítimo ainda não tem dono.

## Riscos registrados

- **Se a R2 cair, as imagens caem.** Hoje, se o Postgres cair, elas caem igual.
  Durante a migração a coluna antiga é a rede de segurança; depois de as colunas
  saírem, ela deixa de existir.
- **Arquivo órfão.** Mitigado pela ordem (balde antes do banco) e pela
  varredura, não eliminado.
- **A CSP do aplicativo Angular** está fora deste repositório. Se não liberar o
  domínio do balde, a imagem falha calada.
- **Duas fontes de verdade durante a migração.** Entre os passos 2 e 5 uma
  imagem pode estar nos dois lugares. A precedência é a da leitura: o endereço
  primeiro, a coluna como queda, POR VARIANTE.
````

- [ ] **Step 2: Some o índice, se houver**

Se `docs/` ganhar um índice depois, aponte para este arquivo. Hoje `docs/` só
tem `superpowers/`, e `operacao/` nasce aqui.

- [ ] **Step 3: Verifique cada comando citado**

Rode, do `server-api/`, e confirme que cada um responde (o banco de
desenvolvimento serve):

```bash
yarn migrar-imagens
yarn migrar-imagens --conferir
yarn varrer-orfaos
```

Esperado: os três imprimem contagens e nenhum lança. Todo comando do runbook
tem de existir de verdade — um runbook com comando errado é pior que nenhum.

- [ ] **Step 4: Commit**

```bash
git add docs/operacao
git commit -m "docs: runbook da migração das fotos para o balde"
```

---

## Verificação final

Depois da última task, do `server-api/`:

```bash
docker compose up -d --wait db
yarn test && yarn test:scripts
npx tsc --noEmit
npx eslint src scripts test
```

E, do `inner-view-client/`:

```bash
npm test && npm run lint
```

Confira também, à mão, o que teste não pega:

1. **Sobe sem nenhuma variável de balde.** `yarn start:dev` com o `.env` de
   desenvolvimento: o log diz `Fotos em disco`, e capturar um cômodo cria
   arquivo em `server-api/.armazenamento/panoramas/…`.
2. **O wizard abre a foto.** Sem balde que assine, o preview responde bytes —
   se ele responder `302` em desenvolvimento, a queda de `enderecoAssinado`
   está errada e a tela vai abrir em branco na máquina de quem desenvolve.
3. **O tour publicado abre com o payload relativo.** Com `STORAGE_PUBLIC_URL`
   vazia, `GET /virtual-tours/:id` devolve `imageUrl` começando com `/`. É a
   entrega A inteira, e é o estado em que o sistema vai ficar até haver domínio.

---

## Auto-revisão

Feita contra a spec, como o processo pede.

**Cobertura.** As dez decisões têm task: 1 → Tasks 11 e 12; 2 → Task 1;
3 → Tasks 4 e 7; 4 → Task 9 (e a Task 16 prova que a varredura não as apaga);
5 → Tasks 5, 6 e 11; 6 → Tasks 1, 2 e 3; 7 → Task 13; 8 → Task 12;
9 → Task 13 (o gatilho) e Task 17 (a operação); 10 → Tasks 6, 8, 9, 10 e 15.
Os nove testes da spec: 1 e 2 → Task 7; 3 → Task 13; 4 → Task 12; 5 → Tasks 5
e 6; 6 → Task 8; 7 e 8 → Task 15; 9 → Task 3. Os cinco passos da migração:
1 → Task 4; 2 → Tasks 8 a 13; 3 → Task 15; 4 e 5 → Task 17, porque são
operação e não código.

**O que a spec não previa e virou trabalho.** Três coisas, todas achadas lendo
o código:

- O `thumbnailUrl` (Task 14), sem o qual a entrega B troca uma vitória de banco
  por uma derrota de banda.
- O CORS do balde (Task 17), sem o qual o `302` do preview falha calado no
  navegador.
- A sobrevida do portão de miniaturas (Task 5), sem a qual a janela de migração
  reabre o estouro de memória de 10/09.

**O que este plano deliberadamente NÃO faz.** Apagar as colunas de bytes,
apagar o caminho de queda e rodar o `VACUUM FULL`. Os três dependem de o
`--conferir` ter zerado em produção, o que nenhuma task pode verificar — estão
no runbook, com o porquê.

---

## Execução

Plano completo e salvo. Duas formas de executar:

**1. Subagent-Driven (recomendada)** — um subagente novo por task, revisão
entre elas, iteração rápida.

**2. Inline** — as tasks nesta sessão, em lotes com pontos de conferência.

Qual das duas?

---

## Registro da implementação — 17/09/2026

Executado inline na branch `feat/fotos-em-armazenamento-de-objetos`, preservando
o trabalho existente de exportação de tours. Código e documentação das Tasks
1–17 implementados; a ativação da infraestrutura não faz parte desta execução.
Não houve commit/push desta implementação, backfill em produção, remoção de
colunas nem `VACUUM FULL`.

### Resultado

- Porta de armazenamento com adaptadores local, em memória e R2/S3; seleção
  global e validação de configuração completa.
- Schema compatível com imagens legadas e novas chaves. Migration aplicada
  somente ao banco local `property-360-test`.
- Escrita de imagens e capas antes da referência no banco, mantendo escrita
  dupla. Leitura por variante prefere o objeto e usa a coluna antiga como queda.
- Capas de 640 px, preservando o cache limitado e o portão de redução para
  imagens antigas; preview autenticado com link assinado de 300 segundos.
- Payload público com `thumbnailUrl`, mantendo URLs relativas sem origem
  pública e compatibilidade do frontend com APIs anteriores.
- Backfill idempotente/retomável e varredura de órfãos, ambos secos por padrão.
- Guia operacional em `docs/operacao/migracao-das-fotos.md`.

### Ajustes encontrados durante a implementação

1. `CreateVirtualTourService` também recebia imagens em lote e não estava nas
   tasks de escrita. Foi integrado ao gravador, com uploads sequenciais antes
   da transação, preservando a resolução dos hotspots. Os uploads são associados
   pela posição no corpo, evitando colisão quando há `tempId` repetido.
2. Backfill usa atualização condicional para não substituir uma refotografia
   feita durante o upload. Capturas têm chaves mutáveis conforme o plano;
   pause seus reenvios durante os lotes de migração.
3. Versões são monotônicas no processo e panoramas usam gravação condicional,
   evitando sobrescrever objetos imutáveis. O adaptador R2 pagina a listagem e
   diferencia objeto ausente de falhas de permissão, rede ou bucket.
4. O plano de domínio público sobre um bucket único contradizia a proteção de
   rascunhos/referências. **Entrega B não deve ser ativada sobre o bucket privado
   diretamente.** Exige uma origem pública controlada ou separação/promoção
   entre buckets, implementada e validada separadamente. Mantenha
   `STORAGE_PUBLIC_URL` vazia até isso existir. Cache dos objetos privados não é
   público/imutável; capturas mutáveis usam `private, no-store`.
5. Escrita dupla não libera espaço de disco do Postgres. `--conferir` conta
   bytes sem chave, mas não comprova integridade dos objetos. O guia explicita
   backup e verificação adicional antes de qualquer etapa destrutiva futura.

### Verificações realizadas

- API: `npm test -- --runInBand --silent` — **27 suítes, 184 testes aprovados**.
- Infraestrutura/processamento: `npm run test:scripts -- --runInBand --silent`
  — **13 suítes, 125 testes aprovados**, sem credenciais ou rede R2.
- Frontend: ChromeHeadless — **1.283 testes aprovados** na repetição completa.
  A primeira execução apresentou uma falha intermitente; a repetição passou
  sem mudanças fora do escopo.
- TypeScript e builds da API e do frontend aprovados. Build Angular registra
  aviso de orçamento preexistente em `step-images.component.scss`.
- Lint do frontend e dos 55 arquivos TypeScript alterados/adicionados da API
  aprovados. Lint global da API ainda aponta 5.163 erros em 57 arquivos não
  alterados: 5.162 de formatação/CRLF e uma variável `_` não utilizada em
  `refresh.service.ts`. Não foi executado lint com `--fix` no repositório inteiro.
- Boot completo do Nest com armazenamento local aprovado.
- Smoke HTTP com banco de testes e armazenamento em memória: 401 sem token,
  404 para outra agência/rascunho público, preview 302 `private, no-store`
  assinado por 300 s, payload relativo e capa de 640 px para `?w=320`.
- CLIs em modo seco aprovados. `--conferir` retornou 1 para uma imagem legada
  deixada pela fixture, confirmando o código de saída para pendências.
- `git diff --check` aprovado.

Docker não estava disponível: os testes usaram o PostgreSQL local na porta 5432,
com `DATABASE_URL` explicitamente apontada para `property-360-test`, sem alterar
`.env.test`. Upload/leitura reais no R2, CORS/CSP e origem pública continuam
dependendo de homologação e das ações externas descritas no guia.

## Complemento de segurança — 17/09/2026

### Decisão do ambiente

A produção será um ambiente novo, sem migração dos tours antigos. Não importar
o banco legado, copiar suas fotos ou executar backfill na implantação nova.
As migrations de schema continuam necessárias. Os scripts antigos permanecem
como ferramentas opcionais, secos por padrão, não como passos do lançamento.
A escrita dupla não foi removida: fotos novas continuam também no Postgres.

### Implementação adicional

- `r2-image-gateway/`: Worker com binding de bucket privado. Domínio próprio no
  Worker; `r2.dev` e domínio público direto do bucket devem ficar desativados.
- Nova rota `POST /internal/public-images/authorize`, protegida por segredo
  exclusivo, comparado em tempo constante, sem JWT do usuário e sem cache de
  decisões. Consulta somente metadados e permite a variante atual/capa quando
  o tour está publicado.
- Autorização antes de qualquer leitura de cache, inclusive GET condicional e
  HEAD. Capturas, rascunhos, tours arquivados/apagados, variantes não exibidas e
  versões anteriores são negados. Falhas/timeout da API não liberam bytes.
- Cache de bytes interno ao Worker; respostas ao visitante com `no-store`.
  As rotas alternativas de imagem/capa na API também usam `no-store` para não
  permitir que navegador/proxy pule a checagem de publicação.
- `PUBLIC_IMAGE_GATEWAY_SECRET` na API e no Worker, nunca no cliente. Validação
  de origem HTTPS sem caminho/credenciais/query; URLs R2 diretas e segredo
  ausente/igual ao JWT são rejeitados na configuração pública.
- CORS limitado às origens configuradas, métodos de leitura e preflight mínimo.
  Segredos, cookies e tokens do visitante não são encaminhados à autorização.
- Sharp da API atualizado para 0.35.4; dependências do novo gateway ajustadas
  com overrides pontuais, sem atualização geral do projeto.
- Guia de implantação nova, configuração, rotação, rollback e homologação em
  `r2-image-gateway/README.md`; runbook operacional atualizado.

### Verificação local

- API: suíte completa com **198 testes**, mais **8 testes** das rotas
  alternativas sem cache, aprovados após a atualização do Sharp.
- Processamento/infra/configuração: **136 testes** aprovados, incluindo
  validação de segredo e origem pública.
- Gateway: **24 testes** de contrato aprovados, incluindo timeout/fail closed.
- Workerd/Miniflare: integração real de R2/Cache API aprovada, comprovando cache
  interno e revogação antes de GET/HEAD/304. A validação encontrou e corrigiu
  incompatibilidade do runtime com `redirect: error`; utiliza `manual` e aceita
  exclusivamente 204, sem seguir redirects.
- TypeScript, build Nest, build Worker em modo seco e lint dos arquivos
  TypeScript alterados/adicionados aprovados. Lint global continua com a
  pendência preexistente registrada na execução inicial.
- Auditoria das dependências do novo gateway: zero vulnerabilidades reportadas.
- Boot completo do AppModule com configuração R2/gateway e HTTP interno
  401/404 aprovado, usando apenas o banco local de testes e sem acesso ao R2.
- `git diff --check` aprovado com a configuração normal de CRLF do repositório.

Não houve deploy, criação de bucket, alteração de produção ou migração de tours.
Faltam configuração Cloudflare/API/host Angular e homologação real, não a
implementação da camada de autorização. A revogação vale para novos acessos;
não apaga cópias já carregadas/baixadas nem interrompe respostas em andamento.
