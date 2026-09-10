import sharp from 'sharp';

/**
 * Redimensionamento das panorâmicas para quando o consumidor não precisa da
 * imagem inteira — hoje, a capa do card de imóvel.
 *
 * O motivo de existir está medido: a rota de thumbnail devolvia a panorâmica em
 * resolução plena. Uma "miniatura" pesava 20,0 MB, e uma lista de imóveis com
 * tour baixava isso por card. O `<img>` do card tem uns 320 CSS px de largura.
 *
 * Vive fora do serviço porque a rota de imagem por panorâmica usa o mesmo
 * caminho com `?w=`, e duas implementações do mesmo redimensionamento
 * divergiriam na qualidade sem ninguém perceber.
 */

/** Cobre um card de ~320 CSS px em tela 2x. */
export const LARGURA_MINIATURA = 640;

/** Teto de `?w=`: acima disso serve a imagem original, sem custo de sharp. */
export const LARGURA_MAXIMA = 2048;

/**
 * O redimensionamento é caro (decodifica um JPEG de dezenas de MB) e o
 * resultado é imutável para um dado `updatedAt`, então vale guardar.
 *
 * `Map` mantém ordem de inserção, o que dá o LRU de graça: reinserir no acesso
 * move a chave para o fim, e o descarte tira sempre a primeira. O teto é de
 * entradas e não de bytes porque toda entrada aqui já é uma imagem pequena —
 * 64 × ~50 kB é uns 3 MB no pior caso.
 *
 * É cache de processo. Com mais de uma réplica, cada uma paga o seu primeiro
 * redimensionamento; é aceitável enquanto o custo for um sharp por imagem por
 * réplica, e vira coluna no banco se a medição mostrar o contrário.
 */
const MAX_ENTRADAS = 64;
const cache = new Map<string, Buffer>();

/**
 * `variante` separa a imagem tratada da original no cache. Sem ela, as duas
 * pedidas na mesma largura colidem numa chave só, e o wizard — que alterna
 * entre as duas para mostrar o antes e depois — recebe a que chegou primeiro
 * nas duas vezes. Opcional para não mover as chaves de quem só tem uma imagem
 * por panorama, que é o caso da rota pública.
 */
export function chaveDeCache(
  panoramaId: string,
  updatedAt: Date,
  largura: number,
  variante?: string,
): string {
  const sufixo = variante ? `:${variante}` : '';
  return `${panoramaId}:${updatedAt.getTime()}:${largura}${sufixo}`;
}

function doCache(chave: string): Buffer | undefined {
  const achado = cache.get(chave);
  if (achado) {
    cache.delete(chave);
    cache.set(chave, achado);
  }
  return achado;
}

function guardar(chave: string, bytes: Buffer): void {
  cache.set(chave, bytes);
  while (cache.size > MAX_ENTRADAS) {
    const maisAntiga = cache.keys().next().value;
    if (maisAntiga === undefined) break;
    cache.delete(maisAntiga);
  }
}

/** Só para teste: o cache é global ao processo e vaza entre casos. */
export function limparCacheDeMiniatura(): void {
  cache.clear();
}

/**
 * Quantas reduções o processo faz ao mesmo tempo.
 *
 * Abrir um tour pede uma miniatura por cômodo, TODAS de uma vez — a faixa de
 * cenas do visualizador, o sheet de cenas e a lista de rascunhos fazem os três
 * a mesma coisa, cada um com o seu laço. E miniatura sai da panorâmica
 * inteira: cada uma na fila carrega a coluna do banco antes de reduzir.
 *
 * O custo é linear e foi medido, ~12,5 MB por redução simultânea:
 *
 * ```
 *  N=1     0 MB        N=6    64 MB
 *  N=2     9 MB        N=9   105 MB
 *  N=3    21 MB        N=20  249 MB
 * ```
 *
 * Em 10/09/2026 um tour de 9 cômodos custou 113 MB de uma vez na instância de
 * produção — bate com a bancada — e foram eles que deixaram o processo perto
 * demais do teto de 512 MB para aguentar as duas montagens seguintes. Com 20
 * cômodos, os 249 MB derrubariam a instância sozinhos, e nenhuma coleta
 * ajudaria: aqui as imagens estão todas VIVAS ao mesmo tempo, e é por isso que
 * este arquivo precisa de um portão e não de uma limpeza.
 *
 * Duas, e não mais: 9 MB de pico é ruído, e ninguém espera mais por isso. O
 * paralelismo de hoje não deixa a faixa pronta antes — deixa tudo lento junto.
 * No log daquele dia as leituras foram de 0,6 s para 6,6 s conforme se
 * empilhavam; em fila, cada uma custa o que custa e a faixa preenche na ordem.
 */
const SIMULTANEAS = 2;

let rodando = 0;
const esperando: Array<() => void> = [];

/**
 * A vaga é TRANSFERIDA a quem espera, em vez de devolvida e disputada.
 *
 * A forma comum — `rodando--` e o próximo que reconfira — foi medida contra
 * esta numa rajada de nove com um pedido chegando no meio, e as duas se
 * comportaram igual: pico 2, mesma ordem. A escolha não corrige defeito
 * observado nenhum.
 *
 * O que ela muda é de quê o limite depende. Devolvendo, entre acordar quem
 * esperava e a continuação dele rodar existe uma janela de microtask; que nada
 * chegue ali é verdade porque requisição vem de I/O, e é uma invariante que não
 * aparece no código — quem devolve precisa de um `while` para se defender dela.
 * Transferindo, quem acorda já tem a vaga e não há o que reconferir: o `if`
 * abaixo basta por construção, e não por sorte de agendamento.
 */
async function naVez<T>(trabalho: () => Promise<T>): Promise<T> {
  if (rodando >= SIMULTANEAS) {
    await new Promise<void>((seguir) => esperando.push(seguir));
    // Sem `rodando++`: quem terminou não decrementou, passou a vaga adiante.
  } else {
    rodando++;
  }

  try {
    return await trabalho();
  } finally {
    // No `finally` porque uma redução que falha precisa soltar a vaga do mesmo
    // jeito. Sem isto, `SIMULTANEAS` falhas travariam a rota para sempre.
    const proximo = esperando.shift();
    if (proximo) proximo();
    else rodando--;
  }
}

/**
 * Reduz o JPEG para a largura pedida, mantendo a proporção 2:1 da
 * equirretangular. `withoutEnlargement` porque esticar uma foto pequena só
 * gastaria bytes.
 *
 * Qualidade 78 e `progressive`: a capa aparece borrada e vai nitidando em vez
 * de descer de cima para baixo, que é o que se quer numa lista.
 */
export async function reduzir(
  original: Buffer,
  largura: number,
): Promise<Buffer> {
  return sharp(original)
    .resize({ width: largura, withoutEnlargement: true })
    .jpeg({ quality: 78, progressive: true })
    .toBuffer();
}

/**
 * `carregar` é preguiçoso de propósito: num acerto de cache a imagem original
 * nunca é lida do banco. Se ela fosse parâmetro, o cache pouparia o sharp e
 * ainda assim arrastaria 20 MB de TOAST por requisição — que é o custo que este
 * arquivo existe para eliminar.
 */
export async function reduzirComCache(
  chave: string,
  largura: number,
  carregar: () => Promise<Buffer>,
): Promise<Buffer> {
  // ANTES do portão: um acerto de cache não custa memória nenhuma, e fazê-lo
  // esperar por reduções alheias transformaria a proteção em lentidão. É
  // também o que mantém barata a segunda visita ao mesmo tour.
  const guardado = doCache(chave);
  if (guardado) return guardado;

  return naVez(async () => {
    // De novo, agora com a vez na mão: quem esperou pode ter esperado
    // justamente por quem estava produzindo ESTA chave. Sem esta linha, dois
    // visitantes no mesmo tour pagariam a mesma redução duas vezes.
    const chegouEnquanto = doCache(chave);
    if (chegouEnquanto) return chegouEnquanto;

    const reduzido = await reduzir(await carregar(), largura);
    guardar(chave, reduzido);
    return reduzido;
  });
}

/**
 * ETag fraco porque os bytes são derivados: uma versão nova do sharp pode
 * comprimir o mesmo pixel de forma diferente, e um ETag forte estaria mentindo
 * sobre igualdade byte a byte. Para revalidação de cache, "é a mesma imagem"
 * basta.
 *
 * `updatedAt` é o que muda quando a IA retrata a panorâmica ou o corretor
 * refotografa a sala — é ele que invalida o cache do navegador.
 *
 * `variante` entra pelo mesmo motivo que entra na chave de cache: original e
 * tratada compartilham id, `updatedAt` e largura, e sem distinguir as duas o
 * 304 responderia "você já tem essa" para a imagem errada.
 */
export function etagDe(
  panoramaId: string,
  updatedAt: Date,
  largura: number,
  variante?: string,
): string {
  const sufixo = variante ? `-${variante}` : '';
  return `W/"${panoramaId}-${updatedAt.getTime()}-${largura}${sufixo}"`;
}

/**
 * `If-None-Match` pode chegar como lista (`a, b`) ou como `*`. Comparação por
 * igualdade da string inteira: o ETag aqui é opaco, então não há forma fraca e
 * forte do mesmo valor para reconciliar.
 */
export function clienteJaTem(
  cabecalho: string | undefined,
  etag: string,
): boolean {
  if (!cabecalho) return false;
  return cabecalho
    .split(',')
    .map((parte) => parte.trim())
    .some((parte) => parte === '*' || parte === etag);
}
