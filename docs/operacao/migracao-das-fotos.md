# Migração das fotos para armazenamento de objetos

Spec: `docs/superpowers/specs/2026-09-15-fotos-em-armazenamento-de-objetos-design.md`

**Decisão atual (17/09/2026): a produção será um ambiente novo. Os tours antigos
não serão migrados para o R2.** Não importe o banco antigo nem execute backfill
nesse ambiente. Os passos de preenchimento/conferência abaixo ficam como opção
histórica para ambientes que realmente tenham imagens legadas.

## Caminho recomendado para a produção nova

1. Crie o banco novo e aplique as migrations com `npx prisma migrate deploy`.
2. Configure bucket **privado**, credenciais e CORS dos previews na API.
3. Configure o segredo exclusivo `PUBLIC_IMAGE_GATEWAY_SECRET` na API e no
   novo Worker de `r2-image-gateway/`; implante API e Worker.
4. Configure `STORAGE_PUBLIC_URL` com a origem HTTPS do **Worker**, nunca do
   bucket. Ajuste CSP/CORS, reinicie a API e faça a homologação de segurança.
5. Crie os tours novos normalmente. Não execute `migrar-imagens`, não copie
   tours antigos e não remova colunas de bytes nesta etapa.

Configuração, comandos, contrato de autorização e checklist completo:
[gateway público de imagens](../../r2-image-gateway/README.md).

Nenhum recurso ou deploy de produção foi realizado por esta implementação.

**Escopo desta entrega:** escrita dupla e preferência pelo armazenamento de
objetos. Nenhuma coluna de bytes é apagada e o disco do Postgres ainda não
encolhe. A remoção dos bytes e a reorganização da tabela são uma etapa futura.

Os nomes de chave e a integração `thumbnailUrl` seguem o plano de implementação,
que corrige a spec original. O tipo `Panorama` do cliente vive atualmente em
`inner-view-client/src/app/models/virtual-tour.model.ts`.

## Antes de começar — o que não é código

1. **Conta na Cloudflare, balde R2 PRIVADO e chave de API** com permissões no
   bucket. Desative `r2.dev` e não conecte um domínio público diretamente a ele:
   contém rascunhos, originais e fotos de referência. O 302 não protege um
   arquivo se o mesmo objeto estiver disponível por outro endereço público.
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
5. **Domínio próprio na Cloudflare, ligado ao Worker** — para a entrega B.
   Configure API_ORIGIN, CORS_ORIGINS, binding do bucket e segredo exclusivo.
   Nunca ligue o domínio público diretamente ao bucket.

## Entrega A — leituras desacopladas do banco

### Passo 1: a migração de schema

```bash
npx prisma migrate deploy
```

As colunas de endereço nascem vazias. Sem mudança de comportamento.

Execute os comandos deste guia em `server-api/`, com o `DATABASE_URL` e as
credenciais do ambiente alvo previamente conferidos. Nunca use produção para
rodar a suíte Jest: ela limpa o banco de testes entre os casos.

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

O preview autenticado é a exceção: ele já redireciona para um link assinado
válido por cinco minutos, mesmo sem URL pública. A checagem da agência ocorre
antes da assinatura. Em desenvolvimento local ele continua respondendo bytes.

Confira no log do boot: `Fotos na R2, servidas pela API (STORAGE_PUBLIC_URL vazia).`

### Passo 3: o preenchimento

**Não necessário na produção nova.** Use apenas se decidir migrar um ambiente
legado no futuro, com autorização e backup específicos.

```bash
yarn migrar-imagens                        # seco: quanto falta
yarn migrar-imagens --aplicar --limite=10  # em lotes
```

Idempotente e retomável: pode parar no meio e repetir. Rode em lotes e olhe a
memória da instância entre eles — a instância tem 512 MB e cada imagem passa
por ela.

Pause reenvios/edições de capturas antigas durante cada lote: suas chaves são
mutáveis, por decisão do plano. As chaves dos panoramas usam atualização
condicional para não substituir uma refotografia ocorrida durante o upload.
Não rode backfill e varredura destrutiva ao mesmo tempo.

### Passo 4: a conferência

```bash
yarn migrar-imagens --conferir
```

Só siga com **zero** nas três contagens. Este passo é o que autoriza o 5.

Essa conferência detecta bytes sem chave, NÃO comprova a integridade dos
objetos. Antes de qualquer remoção de bytes, confirme imagens e capas no
bucket, abra tours antigos e novos e faça backup. Saída 1 significa pendências;
não é erro do comando. Saída 0 indica as três contagens zeradas.

## Entrega B — o navegador busca na CDN

**A camada de proteção foi implementada em `r2-image-gateway/`.** O Worker
consulta a nova rota interna da API, protegida por segredo exclusivo, antes de
ler qualquer cache. Só libera a variante atual/capa de um tour publicado;
rascunhos, capturas, versões antigas e tours ocultos/apagados são negados.
Falhas da API bloqueiam a entrega, mesmo com imagem em cache. Headers ao
navegador usam `no-store`; o cache de bytes é interno ao Worker.

Ainda é necessário configurar e implantar os recursos externos e homologar
CORS/CSP e as revogações em ambiente real, conforme o README do gateway.
Registrar um domínio direto no bucket **não** oferece essa proteção.

[Documentação de buckets públicos do R2](https://developers.cloudflare.com/r2/buckets/public-buckets/).

Até implantar e validar o Worker, mantenha `STORAGE_PUBLIC_URL` vazia.
Após validá-lo, com `PUBLIC_IMAGE_GATEWAY_SECRET` igual na API e no Worker:

```
STORAGE_PUBLIC_URL=https://fotos.<dominio-do-worker>
```

Na aplicação já preparada, o gatilho é a configuração. Reinicie/reimplante o
processo após alterar variáveis: o armazenamento é selecionado no boot. O payload do tour
passa a emitir o endereço absoluto. Bytes não atravessam a API, mas uma consulta
de autorização de metadados ocorre em cada acesso, antes do cache.

**A volta atrás é apagar a variável e reiniciar o processo.** Sem migração
reversa. Isso não revoga automaticamente URLs/cache da origem pública; a
Worker também precisa ser desativado se necessário. Ocultar/apagar revoga novos
acessos, não cópias já carregadas ou baixadas pelo visitante.

Confira no log do boot: `Fotos na R2, servidas por https://fotos.<dominio>.`

## Depois, com calma

Estes não são passos deste plano — cada um é uma mudança própria, e nenhum é
urgente.

### Parar de escrever as colunas

Depois de uma janela de segurança com a entrega A estável, tire a escrita dupla
de `create-virtual-tour.service.ts`, `create-panorama.service.ts`, `update-panorama.service.ts`,
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
ninguém referencia **não existe automaticamente**: R2 não consulta o banco.
Nunca configure expiração genérica por idade sobre `panoramas/` ou `capturas/`,
pois apagaria inclusive fotos vivas. Use a varredura que verifica referências:

```bash
yarn varrer-orfaos                  # seco
yarn varrer-orfaos --apagar
```

Nunca com `--dias=0` em produção: a gravação acontece antes do banco, e existe
uma janela em que um objeto legítimo ainda não tem dono.

## Riscos registrados

- **Se a R2 cair, as imagens caem.** Hoje, se o Postgres cair, elas caem igual.
  Durante a migração a coluna antiga atende linhas sem chave e objetos ausentes;
  erros de rede, permissão ou configuração não são ocultados pelo fallback.
  Depois de as colunas saírem, essa rede de segurança deixa de existir.
- **Arquivo órfão.** Mitigado pela ordem (balde antes do banco) e pela
  varredura, não eliminado.
- **A CSP do aplicativo Angular** está fora deste repositório. Se não liberar o
  domínio do balde, a imagem falha calada.
- **Duas fontes de verdade durante a migração.** Entre os passos 2 e 5 uma
  imagem pode estar nos dois lugares. A precedência é a da leitura: o endereço
  primeiro, a coluna como queda, POR VARIANTE.

## Desenvolvimento e verificação local

Sem variáveis S3, o boot informa `Fotos em disco`. Não configure `STORAGE_PUBLIC_URL`
nesse modo. `.armazenamento/` é ignorada pelo Git; conserve a pasta para as
imagens novas. O preview responde bytes, sem redirecionamento.

```bash
npm run test:scripts -- --runInBand
npm test -- --runInBand
npm exec -- tsc --noEmit
npm run build
```

A suíte com banco usa exclusivamente `property-360-test`; se o Postgres local
estiver na porta 5432, sobreponha `DATABASE_URL` SOMENTE para esses comandos.
Não altere `.env.test` nem use credenciais reais nos testes. No R2 de homologação,
valide também CORS, CSP, link assinado e upload/leitura real antes de produção.
