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

export function chaveDeCache(
  panoramaId: string,
  updatedAt: Date,
  largura: number,
): string {
  return `${panoramaId}:${updatedAt.getTime()}:${largura}`;
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
  const guardado = doCache(chave);
  if (guardado) return guardado;

  const reduzido = await reduzir(await carregar(), largura);
  guardar(chave, reduzido);
  return reduzido;
}

/**
 * ETag fraco porque os bytes são derivados: uma versão nova do sharp pode
 * comprimir o mesmo pixel de forma diferente, e um ETag forte estaria mentindo
 * sobre igualdade byte a byte. Para revalidação de cache, "é a mesma imagem"
 * basta.
 *
 * `updatedAt` é o que muda quando a IA retrata a panorâmica ou o corretor
 * refotografa a sala — é ele que invalida o cache do navegador.
 */
export function etagDe(
  panoramaId: string,
  updatedAt: Date,
  largura: number,
): string {
  return `W/"${panoramaId}-${updatedAt.getTime()}-${largura}"`;
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
