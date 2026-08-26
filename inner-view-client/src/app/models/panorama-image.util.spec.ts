import { environment } from '../../environments/environment';
import { urlDaImagem } from './panorama-image.util';

/**
 * Três origens de imagem convivem no mesmo componente, e é isso que estes
 * testes protegem.
 *
 * O tour publicado devolve `imageUrl` relativo à raiz da API. A etapa 2 do
 * wizard mostra o mesmo visualizador com fotos que a pessoa acabou de escolher
 * e que ainda não subiram — essas chegam como `data:` ou `blob:` e já são o
 * endereço final. Prefixar a API numa delas produz um endereço inválido, e o
 * sintoma é a etapa 2 abrindo sem imagem nenhuma.
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

  it('devolve blob: como está, sem prefixar', () => {
    // A panorâmica tratada pela IA chega ao visualizador como `blob:`: a rota
    // de preview é autenticada, então ela é baixada pelo `HttpClient` — que
    // leva o token — e entregue como objeto de memória. O `TextureLoader` não
    // passa por interceptor nenhum e não teria como se autenticar sozinho.
    //
    // Prefixar aqui produzia `/apiblob:http://localhost:4200/…`. O
    // `TextureLoader` falha calado nesse endereço, o `MeshBasicMaterial` fica
    // sem `map`, e um material sem mapa é branco — que foi exatamente o
    // sintoma: preview da captura e etapa 2 em branco depois do loading da IA.
    const tratada = 'blob:http://localhost:4200/2c1a9f3e-0b7d-4a11-9f0c-3e8a1b2c4d5e';

    expect(urlDaImagem({ imageUrl: tratada })).toBe(tratada);
  });
});
