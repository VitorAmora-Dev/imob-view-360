# Gateway público de imagens — ARP VISION

Worker que entrega imagens de tours publicados usando um **bucket R2 privado**.
O domínio público pertence ao Worker, nunca ao bucket. Esta implementação não
cria recursos Cloudflare nem publica o ambiente automaticamente.

## Contrato de segurança

1. Aceita apenas `GET`/`HEAD` de
   `panoramas/{uuid}/{versão}/{original|tratada|capa}.jpg`.
2. Antes de consultar **qualquer cache**, envia `{ "key": "..." }` por `POST`
   para `API_ORIGIN/internal/public-images/authorize`, com um segredo exclusivo.
3. A API verifica no banco se o tour está `PUBLISHED` e se a chave corresponde
   exatamente à variante atualmente exibida, ou à sua capa. Não lê imagens.
4. Somente `204` permite acesso; `404` nega; timeout de 5 s, indisponibilidade,
   redirects e demais respostas retornam `503`, sem servir cache antigo.
5. Só então o Worker consulta o Cache API ou transmite os bytes pelo binding R2.

`capturas/`, rascunhos, tours arquivados/apagados, versões antigas e originais
substituídos por fotos tratadas não são entregues. Autorizações não ficam em
cache. Cada acesso exige uma consulta pequena de metadados à API.

Os bytes imutáveis podem ficar um ano no cache **interno** do Worker; a resposta
ao visitante sempre usa `Cache-Control: no-store`. Isso impede que o cache do
navegador pule a reautorização. GET condicional e HEAD também são autorizados
antes de responder. Não configure regras externas que sobrescrevam esse header,
cacheiem respostas do Worker ou sirvam conteúdo stale em falha.

As rotas alternativas da API (`/panoramas/:id/image` e
`/virtual-tours/:id/thumbnail`) também usam `no-store`, inclusive em 304/404/HEAD,
e verificam publicação antes da entrega. O cache interno de capas permanece.

Ocultar/apagar bloqueia novos acessos após a alteração no banco, inclusive às
cópias no cache interno. Não remove imagens já carregadas/baixadas pelo usuário,
nem interrompe uma resposta já autorizada e em andamento.

## Implantação em um ambiente NOVO

Não importe os tours antigos, não copie imagens legadas e **não execute
`migrar-imagens`**. No banco novo, aplique somente as migrations do projeto.
A escrita dupla do plano inicial continua ativa: fotos novas também mantêm
bytes no banco; retirar isso é outra etapa, não parte desta proteção.

### 1. Bucket e API

- Crie um bucket privado. Desative `r2.dev` e qualquer domínio público direto.
- Crie credenciais S3 limitadas ao bucket e configure na API:
  `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`,
  `STORAGE_SECRET_ACCESS_KEY`.
- Gere um segredo aleatório exclusivo (por exemplo, 32 bytes em hex), diferente
  dos segredos JWT. Cadastre-o na API como `PUBLIC_IMAGE_GATEWAY_SECRET`.
  Nunca coloque esse segredo no Angular, Git, logs ou parâmetros da URL.
- Inicialmente deixe `STORAGE_PUBLIC_URL` vazia e implante a API.
- Libere CORS do bucket para GET/HEAD nas origens do frontend: os previews
  autenticados continuam usando URLs S3 assinadas por 300 s.

### 2. Worker

Use Node.js 22 ou superior. Em `r2-image-gateway/`:

```bash
npm ci
npm test
npm run test:runtime
npm run build
```

Configure os placeholders em `wrangler.jsonc`:

| Campo | Valor |
| --- | --- |
| `r2_buckets[0].bucket_name` | O mesmo bucket privado configurado na API |
| `vars.API_ORIGIN` | Origem HTTPS da API, sem caminho, credenciais ou query |
| `vars.CORS_ORIGINS` | Origens do frontend, separadas por vírgula, sem wildcard |
| `routes` | Domínio próprio do Worker, com `custom_domain: true` |

`workers_dev` e URLs de preview ficam desativados. Autentique o Wrangler e
publique explicitamente:

```bash
npx wrangler login
npm run deploy
npx wrangler secret put PUBLIC_IMAGE_GATEWAY_SECRET
```

No prompt, informe o mesmo segredo cadastrado na API. Antes disso, o Worker
falha fechado. O Worker usa o binding R2; **não** precisa das credenciais S3.
Restrinja quem pode modificar Worker, bucket, DNS e secrets.

### 3. Ativação e homologação

- Na API, configure `STORAGE_PUBLIC_URL=https://fotos.seu-dominio.com`, a origem
  do **Worker**, e reinicie o serviço. A validação rejeita domínio R2 direto,
  HTTP, prefixos e segredo ausente/reutilizado do JWT. Um domínio próprio que
  aponte diretamente para o bucket não pode ser detectado pela validação;
  confira a configuração na Cloudflare.
- Atualize CSP da API (`CSP_EXTRA_ORIGINS`) e do host estático Angular para
  permitir o gateway e a origem S3 usada nos previews. Configure CORS do Worker
  e do bucket separadamente.
- Em homologação, crie um tour novo, publique e abra panorama/capa/thumbnail.
  Verifique os previews com JWT da agência certa e negação para outra agência.
- Aqueça o cache, oculte o tour e confirme `404` para a mesma URL em GET, HEAD
  e com `If-None-Match`. Repita com exclusão e refotografia; confirme que a
  variante antiga, capturas e rascunhos não ficam acessíveis.
- Interrompa a comunicação com a API e confirme `503`, mesmo com bytes no cache.
  Verifique CORS no navegador, embed e download com marca d'água.
- Configure alertas para 503, latência de autorização, erros R2 e consumo.
  O endpoint interno não usa o limite global por IP (Workers compartilham IPs);
  proteja API/gateway contra abuso com limites/WAF compatíveis com o volume de
  cenas, sem cachear a autorização. CORS não é autenticação/antihotlink.

## Desenvolvimento e rotação

`npm run test:runtime` usa Workerd/Miniflare, bucket e cache locais e uma API
simulada. Não acessa Cloudflare, produção ou o banco de dados.

Para `npm run dev`, crie `.dev.vars` (ignorado pelo Git) com o segredo local e,
se necessário, `API_ORIGIN=http://127.0.0.1:3000`,
`CORS_ORIGINS=http://localhost:8100` e `ENVIRONMENT=development`.
HTTP só é aceito para loopback em desenvolvimento. Não use esse modo em produção.

Para rotacionar o segredo, atualize API e Worker em uma janela coordenada.
Enquanto os valores diferirem, a entrega falha com `503`, nunca expõe bytes.
Remover `STORAGE_PUBLIC_URL` e reiniciar a API volta à entrega pela API, mas não
desativa o domínio Worker; desative-o explicitamente se essa for a intenção.

Referências oficiais: [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/),
[binding R2](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
