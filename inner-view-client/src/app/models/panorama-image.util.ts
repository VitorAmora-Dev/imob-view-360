import { environment } from '../../environments/environment';
import { Panorama } from './virtual-tour.model';

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

  // Nem toda panorâmica veio do servidor. Na etapa 2 do wizard, o visualizador
  // mostra fotos que a pessoa acabou de escolher e que ainda não subiram —
  // elas chegam como `data:` e já são o endereço final. Prefixar a API nelas
  // produziria um endereço inválido e a etapa 2 abriria preta.
  if (endereco.startsWith('data:') || endereco.startsWith('http')) return endereco;

  return `${environment.apiUrl}${endereco}`;
}
