# Performance do backend — o que foi medido e o que mudou

Agosto de 2026. Branch `perf/backend-imagens-e-paginacao`.

O pedido foi "paginação robusta visando performance" mais uma análise geral. A
medição mudou a ordem das prioridades, e este documento existe para que a
próxima pessoa não precise redescobrir o porquê.

## O diagnóstico

Medido no ambiente de desenvolvimento, com dados reais (49 imóveis, 40 tours,
59 panorâmicas):

| | |
|---|---|
| `CaptureFrame` (TOAST) | 314 MB |
| `Panorama` (TOAST) | 196 MB |
| Dados reais das duas tabelas (heap) | 88 kB + 24 kB |
| Pior tour publicado, `GET /virtual-tours/:id` | **58,4 MB de JSON**, 1,28 s |
| `GET /virtual-tours/:id/thumbnail` | **20,0 MB** |
| Compressão HTTP | nenhuma |

O banco tem ~510 MB e **99,9% é base64 de imagem**. Paginação não era o gargalo:
com 49 imóveis, qualquer estratégia funciona. O gargalo era o tamanho das
respostas, e ele era grande o bastante para ofuscar todo o resto.

A "miniatura" do card de imóvel era o caso mais grave, porque atinge a tela de
listagem: o `<img>` de cada card apontava para uma rota que devolvia a
panorâmica em resolução plena.

## O que mudou, com números

| | antes | depois |
|---|---|---|
| `GET /virtual-tours/:id` (pior tour) | 58.405.136 bytes | **1.910 bytes** |
| ↳ time-to-first-byte | 1,08 s | 0,37 s |
| `GET /virtual-tours/:id/thumbnail` | 20.978.713 bytes | **24.429 bytes** |
| ↳ revalidação com `If-None-Match` | não existia | **304 em 3,5 ms** |
| ↳ segunda requisição (cache de processo) | 0,59 s | 0,006 s |
| Compressão do JSON | ausente | −24,9% |

A imagem não sumiu: ela mudou de endereço. Cada panorâmica passou a ter
`GET /panoramas/:id/image`, servindo JPEG **binário** — o que já economiza os
~33% que o base64 acrescenta — com `ETag` e `Cache-Control`. O visitante baixa
o cômodo que está vendo, não os seis do tour, e a segunda visita à mesma sala
vem do cache do navegador.

## Decisões que valem explicação

**`imageUrl` é relativo à raiz da API.** O servidor não sabe por qual hostname
está sendo acessado: proxy do Angular em desenvolvimento, túnel quando se testa
no celular, outro domínio em produção. Um endereço absoluto montado no servidor
estaria errado em dois desses três casos. Quem junta as metades é
`urlDaImagem()` no cliente.

**`?v=<updatedAt>` é o que permite cache longo.** Sem uma coluna de versão, um
`Cache-Control` de um dia significaria "foto velha por um dia". `Panorama`
ganhou `updatedAt` (`@updatedAt`), que muda quando a IA grava o tratamento e
quando o corretor refotografa a sala. Renomear o cômodo também invalida, o que
é desperdício pequeno — errar para o lado de baixar de novo é barato, errar
para o outro mostra a foto errada sem nada denunciando.

**O cache de miniaturas guarda só o que é pequeno.** Imagem em tamanho original
não entra: uma panorâmica chega a 27 MB, e guardar isso em memória de processo
trocaria leitura de banco por pressão de heap. E a leitura da imagem original é
preguiçosa — num acerto de cache o blob não é lido do banco. Se ela fosse
parâmetro, o cache pouparia o `sharp` e ainda assim arrastaria os 20 MB.

**O ETag inclui a largura.** Sem isso, pedir `?w=320` depois de `?w=640`
receberia 304 e o navegador ficaria com a imagem do tamanho errado.

**O desempate da paginação é por `id`.** `createdAt` e `name` não são únicos, e
quando duas linhas empatam o Postgres não promete a mesma ordem em duas
consultas. Com `skip`/`take` por cima, um item aparece em duas páginas enquanto
outro não aparece em nenhuma. O contrato da API não mudou: `page`/`limit` e o
envelope `{ data, total, page, limit, pages }` continuam iguais.

**Os índices compostos substituíram os simples.** Um índice `(a, b)` atende
tudo o que `(a)` atendia, então manter os dois seria pagar escrita em dobro
pela mesma leitura. Com 49 imóveis o planejador ainda escolhe `Seq Scan`, e
está certo — o ganho é futuro. O que se verificou agora é que os índices são
*utilizáveis*, o que é o que poderia estar errado.

## Sobre a internacionalização

A pergunta era se remover a i18n traria ganho de performance. **Não traz, e no
backend não há o que remover**: nenhuma dependência de i18n, nenhum
`Accept-Language`, nenhum `Intl`. Toda a internacionalização é do Angular
(`@ngx-translate`, pt/en, 243 chaves com paridade completa). A decisão foi
manter.

Ficam anotados dois furos reais, que são de correção e não de performance: com
o app em inglês o preço ainda sai como `R$ 1.250.000` (formato pt-BR fixo em
dois lugares), e as mensagens de erro da API chegam sempre em português.

## O que continua em aberto

**A escrita continua em base64.** Este trabalho atacou a leitura. O `POST` de
tour ainda recebe até 50 MB de JSON, e o banco continua com 510 MB de imagem em
TOAST. Mover imagem para storage de objeto é a "Fase 2" que o
`env.schema.ts` já sinaliza, e continua sendo o destino correto.

**O cache de miniatura não tem single-flight.** Duas requisições simultâneas
para a mesma imagem fria fazem o trabalho duas vezes — observado no log de
query lenta durante o desenvolvimento. Com cards apontando para tours
diferentes isso não se acumula; se um dia acumular, o conserto é conhecido.

**`GET /virtual-tours/:id` continua sem `take` nas panorâmicas.** Deixou de
importar para o tamanho da resposta, porque não há mais imagem nela, mas o teto
real de cômodos por tour agora é o `.max(40)` do DTO de criação.

**O `npm run lint` do backend reformata 127 arquivos.** O `.eslintrc.js` estende
`plugin:prettier/recommended` com `printWidth` 80 e o código está escrito a ~100
colunas. Enquanto isso não for resolvido, ninguém consegue rodar o lint sem
sujar o diff — use `npx eslint <arquivos>` sem `--fix`.

**O banco de desenvolvimento está à frente do repositório.** `Panorama` tem
cinco colunas que o `main` não conhece (`stitchMeta`, `analysisAdvice`,
`analysisError`, `analysisStatus`, `analyzedAt`), vindas de duas migrations
aplicadas localmente — uma existe só num commit de branch não mergeada, a outra
não existe em commit nenhum. Por isso `prisma migrate dev` não roda (ele quer
resetar o banco); as migrations desta branch foram escritas à mão e aplicadas
com `migrate deploy`.

## Como reproduzir as medições

```bash
# tamanho e tempo de uma resposta
curl -s -o /dev/null -w "%{size_download} %{time_total}\n" \
  http://127.0.0.1:3000/virtual-tours/<id>

# revalidação: tem de responder 304 sem corpo
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
  -H 'If-None-Match: <etag>' http://127.0.0.1:3000/panoramas/<id>/image

# tamanho real das tabelas
psql -c "SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid))
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind='r'
         ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5;"
```

Query acima de 500 ms agora vira aviso no log do servidor, com o SQL e **sem os
parâmetros** — os parâmetros deste sistema incluem a base64 das panorâmicas.
