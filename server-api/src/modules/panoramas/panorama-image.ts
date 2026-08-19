/**
 * Aceita tanto `data:image/jpeg;base64,…` quanto base64 puro.
 *
 * Havia duas versões desta regra no código, uma exigindo o prefixo `data:` e
 * outra cortando em qualquer vírgula. A segunda mutila um base64 que
 * legitimamente contenha vírgula.
 */
export function base64Puro(imageData: string): string {
  const virgula = imageData.indexOf(',');
  return imageData.startsWith('data:') && virgula > 0
    ? imageData.slice(virgula + 1)
    : imageData;
}

/**
 * Endereço da imagem de um panorama, como o tour público a entrega.
 *
 * **Relativo à raiz da API, de propósito.** O servidor não sabe por qual
 * hostname está sendo acessado: em desenvolvimento é `localhost:3000` atrás do
 * proxy do Angular, num teste em celular é um túnel, em produção é outro
 * domínio ainda. Um endereço absoluto montado aqui estaria errado em dois
 * desses três casos, e o cliente já sabe onde a API mora.
 *
 * O `?v=` é o que permite `Cache-Control` longo sem servir foto velha: quando a
 * IA retrata a panorâmica ou o corretor refotografa a sala, `updatedAt` muda e
 * o endereço muda junto. O servidor não lê esse parâmetro — ele existe para o
 * cache do navegador.
 */
export function urlDaImagem(panoramaId: string, updatedAt: Date): string {
  return `/panoramas/${panoramaId}/image?v=${updatedAt.getTime()}`;
}
