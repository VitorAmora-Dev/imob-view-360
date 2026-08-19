import { environment } from '../../environments/environment';
import { urlDaImagem } from './panorama-image.util';

/**
 * Duas origens de imagem convivem no mesmo componente, e é isso que estes
 * testes protegem.
 *
 * O tour publicado devolve `imageUrl` relativo à raiz da API. A etapa 2 do
 * wizard mostra o mesmo visualizador com fotos que a pessoa acabou de escolher
 * e que ainda não subiram — essas chegam como `data:` e já são o endereço
 * final. Prefixar a API numa delas produz um endereço inválido, e o sintoma é
 * a etapa 2 abrindo preta.
 */
describe('urlDaImagem', () => {
  it('prefixa a API no caminho relativo que o tour devolve', () => {
    const url = urlDaImagem({ imageUrl: '/panoramas/p1/image?v=123' });

    expect(url).toBe(`${environment.apiUrl}/panoramas/p1/image?v=123`);
  });

  it('devolve data-URI como está, sem prefixar', () => {
    const foto = 'data:image/jpeg;base64,SGk=';

    expect(urlDaImagem({ imageUrl: foto })).toBe(foto);
  });

  it('devolve endereço absoluto como está', () => {
    // Deixa a porta aberta para a imagem sair de um bucket um dia, sem que o
    // cliente precise saber a diferença.
    const externa = 'https://cdn.exemplo.com/p1.jpg';

    expect(urlDaImagem({ imageUrl: externa })).toBe(externa);
  });
});
