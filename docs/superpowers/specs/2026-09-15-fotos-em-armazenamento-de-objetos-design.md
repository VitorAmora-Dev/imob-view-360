# As fotos saem do Postgres para armazenamento de objetos

> Spec de desenho, validada em conversa antes de qualquer código.
> Branch: `feat/fotos-em-armazenamento-de-objetos`
> Base: `3ef0b69` (origin/main). Data: 2026-09-15.
> Escopo tocado: **`server-api/`**. O cliente Angular não muda (ver decisão 7).

## O pedido

Preparar o sistema para escalar para imobiliárias. As fotos vivem hoje dentro do
Postgres, em colunas de texto base64, e é isso que trava tudo: o banco, a
memória do processo e o tempo de resposta.

## O que existe hoje

Levantado no código contra `3ef0b69`, não suposto.

- **Quase todo o banco é foto.** Medido em produção em 15/09/2026:

  ```
  banco inteiro          573 MB
  tabela Panorama        449 MB
  tabela CaptureFrame    116 MB
  todo o resto             8 MB
  ```

  São 44 tours e 114 panoramas. Quatro dias antes o banco tinha 396 MB: cresceu
  45% numa semana de teste de uma pessoa só.

- **Base64 custa um terço a mais.** As colunas guardam texto base64, que ocupa
  33% além do arquivo. São ~100 MB de banco pagos só pela codificação.

- **Três rotas servem imagem, e todas leem TOAST.**
  `GetPanoramaImageService` (pública, filtra `PUBLISHED`),
  `GetPanoramaPreviewService` (autenticada, para o wizard, escolhe a variante) e
  `GetThumbnailService` (capa do card de imóvel). As três passam por
  `PanoramaImageReader.carregar`, que devolve `Buffer.from(base64Puro(...))`.

- **A miniatura é calculada sob demanda.** `reduzirComCache` lê a panorâmica
  inteira para produzir um retângulo de 292 ou 640 pixels, guarda o resultado
  num LRU de 64 entradas na memória do processo, e atravessa um portão que
  limita a duas reduções simultâneas. O portão existe desde 10/09/2026 porque
  abrir um tour de nove cômodos custava 113 MB de uma vez.

- **As leituras de TOAST aparecem no log como lentas.** Entre 0,6 e 6,6
  segundos por consulta, empilhadas ao abrir um tour.

- **O endereço público é relativo e versionado por `updatedAt`.**
  `urlDaImagem(panoramaId, updatedAt)` devolve
  `/panoramas/:id/image?v=<epoch>`. O comentário registra por que é relativo: o
  servidor não sabe por qual hostname está sendo acessado. O `?v=` engana o
  cache do navegador, mas o servidor relê o Postgres a cada visita.

- **O cliente já aceita endereço absoluto.** `urlDaImagem` no Angular testa
  `TEM_ESQUEMA` e devolve intacto qualquer endereço com esquema. Existe porque a
  etapa 2 e o preview da captura usam `data:` e `blob:`. **É o que permite a
  decisão 7 sem tocar no cliente.**

- **O payload de edição já não carrega imagem.** `tour-para-edicao.ts` diz em
  comentário que a ausência das colunas é regra, e aponta para
  `/panoramas/:id/preview`.

- **A CSP já tem o gancho.** `CSP_EXTRA_ORIGINS` alimenta `connect-src` e
  `img-src`, e o comentário em `env.schema.ts` diz textualmente: *"Reservado
  para o bucket de imagens (Fase 2 da migração)"*.

- **A memória do processo foi calibrada para este custo.** Entre 10 e 11/09/2026
  três correções entraram por causa dele: gravar no tamanho do modelo, coletar
  ao fim de cada montagem e o portão das miniaturas. A última deixa de ser
  necessária com esta entrega.

## Decisões

### 1. Publicado é público na CDN; rascunho continua autenticado — DECIDIDO

Mantém exatamente a regra de hoje: a rota pública já não tem guard e filtra
`PUBLISHED`, e o wizard já passa por token.

Arquivo de tour publicado fica público no balde, servido pela CDN com cache
máximo. Rascunho nunca fica público: continua atrás da rota autenticada.

Recusado "tudo assinado": devolveria a API ao caminho de toda foto e derrubaria
o aproveitamento de cache, que é o ganho principal. Recusado "tudo público":
seria perder uma garantia que hoje existe.

### 2. O endereço carrega a versão, e o arquivo é imutável — DECIDIDO

```
panoramas/{panoramaId}/{versao}/original.jpg
panoramas/{panoramaId}/{versao}/tratada.jpg
panoramas/{panoramaId}/{versao}/capa.jpg
capturas/{panoramaId}/{indice}.jpg
```

`versao` é um carimbo de tempo gerado **pela aplicação no instante da
gravação**, e não o `updatedAt` da linha.

Isso não é detalhe. `updatedAt` é `@updatedAt`: o Prisma o atribui durante a
escrita no banco, e a decisão 10 exige gravar no balde **antes** do banco.
Derivar a chave de `updatedAt` seria precisar do número antes de ele existir. O
carimbo próprio desfaz o nó, e nada o perde de vista porque a chave inteira fica
guardada na coluna.

`updatedAt` continua fazendo o que já faz: alimentar o ETag e o `?v=` da rota
antiga.

Nenhum arquivo é sobrescrito. Quando a IA trata o cômodo ou o corretor
refotografa a sala, nasce um endereço novo e o payload passa a apontar para ele.
A CDN cacheia para sempre e nunca é preciso mandar limpar nada — invalidação de
CDN é a classe de defeito que some por construção aqui.

O preço é lixo: a versão anterior continua no balde. Uma regra de validade no
balde, ou `scripts/varrer-orfaos.ts`, resolve. Lixo custa centavos;
cache errado custa suporte.

### 3. O banco guarda endereço, não bytes — DECIDIDO

`Panorama` ganha `imageKey` e `treatedImageKey`, opcionais. `CaptureFrame` ganha
`imageKey`. As colunas de bytes passam a ser opcionais e convivem com as novas
durante a migração.

A leitura prefere o endereço e cai na coluna quando ele não existe. É essa queda
que mantém os tours publicados vivos enquanto o preenchimento roda.

### 4. As fotos de referência vão junto, e não são apagadas — DECIDIDO

São 116 MB hoje, oito por cômodo, lidas só pelo tratamento. Vão para o balde
pelo mesmo mecanismo.

Não são apagadas depois do tratamento. A assimetria decide: apagar continua
disponível para sempre, inclusive por regra de validade automática; recuperar
nunca fica. E elas são o que permite retratar um cômodo com um modelo melhor
depois — numa biblioteca de imobiliária, isso é uma opção de negócio, não um
detalhe técnico.

### 5. A miniatura é gravada, não calculada — DECIDIDO

No momento em que uma imagem é gravada, uma capa de 640 pixels de largura é
gerada e gravada ao lado. As três telas que mostram miniatura passam a apontar
para ela.

Um tamanho só, e não dois. Hoje existem 640 (card de imóvel) e 292 (faixa de
cenas); 640 serve os dois, pesa uns 50 kB, e a diferença de banda não paga a
complexidade de manter duas.

Com isto somem `reduzirComCache`, o LRU de 64 entradas e o portão de duas por
vez. **O trabalho de 10/09 deixa de ser necessário**, e isso é o sinal certo: ele
existia para segurar um custo que esta entrega elimina.

### 6. Uma porta, duas implementações — DECIDIDO

Uma interface `ArmazenamentoDeImagens` com `gravar`, `ler`, `enderecoPublico`,
`enderecoAssinado` e `apagar`. Duas implementações: R2 em produção, disco local
em desenvolvimento e teste.

A suíte roda hoje sem rede e sem credencial, e precisa continuar rodando assim.
A R2 fala o protocolo da S3, então a biblioteca é `@aws-sdk/client-s3` mais
`@aws-sdk/s3-request-presigner`, e trocar de fornecedor depois é mudar de
endereço, não de código.

### 7. O payload público emite endereço absoluto — DECIDIDO

`find-virtual-tour.service.ts` passa a emitir o endereço da CDN quando **há um
endereço público configurado** e a linha tem `imageKey`. Sem a configuração, ele
emite o endereço relativo de hoje, mesmo com `imageKey` preenchido.

O gatilho é a configuração, e não a chave, de propósito: é ele que separa as duas
entregas da decisão 9. A entrega A preenche as chaves com o domínio ainda
inexistente, e a API continua servindo. A entrega B é ligar a variável.

**O cliente não muda.** `urlDaImagem` no Angular já devolve intacto qualquer
endereço com esquema, e já é testado assim. A queda para o relativo é o que faz
tour antigo e tour migrado conviverem na mesma tela.

### 8. A rota de rascunho responde com desvio — DECIDIDO

`GET /panoramas/:id/preview` continua existindo, continua autenticada e continua
sendo quem decide se você pode ver aquela foto. O que muda é a resposta: em vez
de bytes, um `302` para um link assinado de validade curta.

A regra de autorização não sai do lugar; só os bytes saem do processo.

### 9. A entrega é dividida pelo domínio — DECIDIDO

A R2 só serve arquivo público com desempenho de produção através de um domínio
próprio na Cloudflare. O `r2.dev` gratuito é limitado em banda e a própria
Cloudflare desaconselha para produção. **O domínio do ARP Vision ainda não
existe.**

Isso divide a entrega, e o corte é limpo:

| entrega | depende do domínio | o que ganha |
|---|---|---|
| **A** | não | o banco encolhe, somem as leituras de TOAST, some o portão das miniaturas, a API lê do balde e transmite em vez de acumular |
| **B** | sim | o navegador busca direto na CDN e a API sai do caminho das fotos de tour publicado |

A entrega A é a maior parte do trabalho e vale sozinha. A B é, na prática,
**definir uma variável de ambiente** com o endereço público do balde, mais a
CSP — porque o gatilho da decisão 7 é a configuração, e não o dado.

Isso também dá o caminho de volta: se algo der errado na B, apagar a variável faz
a API voltar a servir, sem deploy e sem migração reversa.

### 10. Gravar primeiro, banco depois — DECIDIDO

A ordem nunca inverte. Se o balde aceitar e o banco falhar, sobra um arquivo sem
dono, que custa centavos e um script varre. Se o banco gravasse primeiro, uma
falha deixaria uma linha apontando para o nada — e isso é tela sem imagem.

## As peças

| arquivo | mudança |
|---|---|
| `prisma/schema.prisma` | `imageKey`, `treatedImageKey`, `CaptureFrame.imageKey`, todas opcionais; as colunas de bytes passam a opcionais |
| `src/shared/armazenamento/armazenamento.port.ts` | novo: a interface |
| `src/shared/armazenamento/armazenamento-r2.ts` | novo: implementação S3/R2 |
| `src/shared/armazenamento/armazenamento-local.ts` | novo: disco, para dev e teste |
| `src/config/env.schema.ts` | credenciais e nome do balde; o endereço público só na **entrega B** |
| `panorama-image.reader.ts` | lê do balde, com queda para a coluna |
| `panorama-image.ts` | `urlDaImagem` aceita emitir o endereço da CDN |
| `services/create-panorama.service.ts` | grava no balde e gera a capa |
| `services/update-panorama.service.ts` | idem, com versão nova |
| `controllers/upload-capture-frame.*` | as referências vão para o balde |
| `services/treat-panorama.service.ts` | grava a tratada e a capa; lê as referências do balde |
| `services/get-panorama-image.service.ts` | serve do balde, sem redimensionar |
| `services/get-panorama-preview.service.ts` | `302` para link assinado |
| `services/get-thumbnail.service.ts` | serve a capa gravada |
| `panorama-miniatura.ts` | somem o cache, o portão e o redimensionamento sob demanda; ficam `etagDe` e `clienteJaTem` |
| `services/find-virtual-tour.service.ts` | emite o endereço público quando existe **(entrega B)** |
| `scripts/migrar-imagens.ts` | novo: o preenchimento |
| `scripts/varrer-orfaos.ts` | novo: lixo de versão antiga e de gravação interrompida |

## Fluxo de dados

```
captura no celular
  └─> POST /panoramas            (base64, como hoje)
        └─> grava original.jpg + capa.jpg no balde
              └─> INSERT com imageKey                    [banco: só o endereço]

tratamento pela IA
  └─> lê capturas/{id}/*.jpg do balde
        └─> grava {versao-nova}/tratada.jpg + capa.jpg
              └─> UPDATE treatedImageKey + updatedAt

visita a tour publicado
  └─> GET /virtual-tours/:id     (payload com endereço absoluto)
        └─> navegador busca na CDN            [a API não vê os bytes]

visita a rascunho (wizard)
  └─> GET /panoramas/:id/preview (autenticada)
        └─> 302 para link assinado
              └─> navegador busca no balde    [a API não vê os bytes]
```

## A migração, em cinco passos

Nenhum passo derruba um tour publicado.

1. **Migração de schema** com as colunas de endereço vazias. Sozinha, sem
   mudança de comportamento.
2. **Deploy que escreve nos dois lugares** e lê preferindo o endereço. A partir
   daqui, foto nova nasce no balde.
3. **`scripts/migrar-imagens.ts`**, um cômodo por vez. Idempotente (pula o que
   já tem endereço) e retomável (`--limite` para rodar em lotes e parar no
   meio).
4. **Conferência**: nenhuma linha pode ter coluna de bytes e não ter endereço.
5. **Deploy que para de escrever a coluna.** Depois de uma janela de segurança,
   uma migração remove as colunas.

**Apagar coluna no Postgres não devolve o disco.** O espaço só volta com
reorganização da tabela, que tranca a escrita enquanto roda. Com o tamanho de
hoje isso leva segundos, mas precisa estar no plano em vez de virar susto.

## Testes

Com injeção de defeito em cada um: o teste só entra depois de eu reintroduzir o
defeito que ele guarda e vê-lo cair.

1. A leitura **cai para a coluna** quando não há endereço. É o caso que mantém
   tour antigo vivo durante a migração.
2. A leitura **prefere o endereço** quando ele existe, e não toca na coluna.
3. O payload público emite endereço absoluto com `imageKey`, e relativo sem.
4. A rota de rascunho responde `302`, e continua respondendo `404` para tour de
   outra agência.
5. Gravar produz original e capa, e a capa tem 640 de largura.
6. Uma falha ao gravar no banco **não** deixa linha apontando para o nada
   (decisão 10).
7. `migrar-imagens` é idempotente: a segunda execução não sobe nada.
8. `migrar-imagens` é retomável: interrompido na metade, continua de onde parou.
9. Endereço assinado expira.

A porta ganha um dublê em memória, e toda a suíte de imagem existente continua
rodando sem rede e sem credencial.

## Pré-requisitos fora do código

- Conta na Cloudflare, balde R2 e chave de API.
- **Domínio do ARP Vision**, registrado e com DNS na Cloudflare. Bloqueia só a
  entrega B (decisão 9).
- `CSP_EXTRA_ORIGINS` com o domínio do balde, no serviço da Render.
- Conferir os cabeçalhos do site estático da Render, que serve o Angular: a CSP
  da API cobre as respostas da API, não as do aplicativo.

## Fora de escopo

- **Envio direto do celular para o balde.** Combinado como fase seguinte: a
  leitura é onde está o volume, e o envio mexe no fluxo de captura, que é a
  parte mais frágil do produto.
- **O worker do tratamento.** Projeto próprio, com fila no banco.
- **Apagar as fotos de referência** (decisão 4).
- **Mais de um tamanho de miniatura** (decisão 5).
- **Renomear o projeto para ARP Vision.** O balde e o domínio podem usar o nome
  novo sem o repositório mudar.

## Riscos registrados

- **Se a R2 cair, as imagens caem.** Hoje, se o Postgres cair, elas caem igual:
  é o mesmo risco num fornecedor diferente. Durante a migração a coluna antiga é
  a rede de segurança; depois do passo 5 ela deixa de existir.
- **Arquivo órfão.** Mitigado pela ordem da decisão 10 e pelo script de
  varredura, não eliminado.
- **A CSP do aplicativo Angular.** Está fora deste repositório, nos cabeçalhos
  do site estático. Se ela existir e não liberar o domínio do balde, a imagem
  falha calada e o material fica sem mapa — que é tela branca, o defeito que
  `036b4ac` já causou uma vez.
- **Duas fontes de verdade durante a migração.** Entre os passos 2 e 5, uma
  imagem pode estar nos dois lugares. O teste 1 e o teste 2 prendem a regra de
  precedência; a conferência do passo 4 é o que autoriza seguir.
