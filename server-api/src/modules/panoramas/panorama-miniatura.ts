/** Identidade de cache; o redimensionamento legado vive em capa-do-panorama.ts. */
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
