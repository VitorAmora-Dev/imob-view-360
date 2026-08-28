import { environment } from '../../environments/environment';
import { Panorama } from './virtual-tour.model';

/**
 * Um endereço que já se basta: tem esquema (`data:`, `blob:`, `https:`).
 *
 * A regra é o esquema, e não uma lista de casos conhecidos. A lista já custou
 * uma vez: ela cobria `data:` e `http`, o `blob:` da panorâmica tratada chegou
 * depois e caiu no `else`, virando `/apiblob:http://…`.
 *
 * Um caminho relativo devolvido pela API sempre começa com `/`, então nunca
 * casa aqui.
 */
const TEM_ESQUEMA = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Endereço final da foto de um cômodo.
 *
 * O servidor devolve `imageUrl` relativo à raiz da API (`/panoramas/:id/image?v=…`)
 * porque não sabe por qual hostname está sendo acessado: proxy do Angular em
 * desenvolvimento, túnel quando se testa no celular, outro domínio em produção.
 * Juntar as duas metades é trabalho de quem conhece o `environment`.
 *
 * É função pura, e não método de serviço, porque o `panoramic-viewer` é
 * componente de apresentação — recebe panorâmicas por `@Input` e não injeta
 * nada. Dar a ele uma dependência de serviço de HTTP só para montar uma string
 * seria pagar acoplamento por concatenação.
 */
export function urlDaImagem(panorama: Pick<Panorama, 'imageUrl'>): string {
  const endereco = panorama.imageUrl;

  // Nem toda panorâmica veio da rota pública da API. A etapa 2 do wizard e o
  // preview da captura mostram fotos que ainda não são públicas: a costura
  // local chega como `data:`, e a tratada pela IA como `blob:`, porque a rota
  // de preview é autenticada e precisa do `HttpClient` para levar o token — o
  // `TextureLoader` não passa por interceptor nenhum.
  //
  // Prefixar a API numa dessas produz um endereço inválido. O carregamento
  // falha calado, o material fica sem `map`, e material sem mapa é branco.
  if (TEM_ESQUEMA.test(endereco)) return endereco;

  return `${environment.apiUrl}${endereco}`;
}
