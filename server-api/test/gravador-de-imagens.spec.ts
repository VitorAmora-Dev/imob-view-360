import sharp from 'sharp';
import { ArmazenamentoEmMemoria } from '../src/shared/armazenamento/armazenamento-em-memoria';
import { chaveDaCapa } from '../src/shared/armazenamento/armazenamento.port';
import { GravadorDeImagens } from '../src/modules/panoramas/gravador-de-imagens.service';

async function panoramica(): Promise<Buffer> {
  return sharp({
    create: {
      width: 4096,
      height: 2048,
      channels: 3,
      background: { r: 90, g: 90, b: 90 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('GravadorDeImagens', () => {
  let balde: ArmazenamentoEmMemoria;
  let gravador: GravadorDeImagens;

  beforeEach(() => {
    balde = new ArmazenamentoEmMemoria();
    gravador = new GravadorDeImagens(balde);
  });

  it('grava a imagem e a capa, na mesma versão', async () => {
    const chave = await gravador.gravarPanorama(
      'p1',
      await panoramica(),
      'original',
    );

    expect(chave).toMatch(/^panoramas\/p1\/\d+\/original\.jpg$/);
    expect(balde.tem(chave)).toBe(true);
    expect(balde.tem(chaveDaCapa(chave))).toBe(true);
  });

  it('a capa gravada tem 640 de largura', async () => {
    const chave = await gravador.gravarPanorama(
      'p1',
      await panoramica(),
      'tratada',
    );

    const capa = await balde.ler(chaveDaCapa(chave));
    expect((await sharp(capa!).metadata()).width).toBe(640);
  });

  it('duas gravações do mesmo panorama não se sobrescrevem', async () => {
    // A imutabilidade é o que faz invalidação de CDN sumir. Se a segunda
    // gravação reusasse a chave, um visitante com a primeira em cache ficaria
    // com a foto velha para sempre.
    const primeira = await gravador.gravarPanorama(
      'p1',
      await panoramica(),
      'tratada',
    );
    await new Promise((seguir) => setTimeout(seguir, 2));
    const segunda = await gravador.gravarPanorama(
      'p1',
      await panoramica(),
      'tratada',
    );

    expect(primeira).not.toBe(segunda);
    expect(balde.tem(primeira)).toBe(true);
    expect(balde.tem(segunda)).toBe(true);
  });

  it('a foto da captura vai sem capa e sem versão', async () => {
    // Referência para o modelo, nunca mostrada em tela: capa seria trabalho e
    // bytes para nada. Sem versão porque o reenvio precisa REPOR a mesma foto.
    const chave = await gravador.gravarCaptura('p1', 7, Buffer.from('foto'));

    expect(chave).toBe('capturas/p1/7.jpg');
    expect(balde.chaves()).toEqual(['capturas/p1/7.jpg']);
  });

  it('o reenvio da mesma foto da captura repõe, em vez de acumular', async () => {
    await gravador.gravarCaptura('p1', 7, Buffer.from('primeira'));
    await gravador.gravarCaptura('p1', 7, Buffer.from('segunda'));

    expect(balde.chaves()).toEqual(['capturas/p1/7.jpg']);
    expect((await balde.ler('capturas/p1/7.jpg'))?.toString()).toBe('segunda');
  });

  it('se a capa falhar, nada é dado por gravado', async () => {
    // A ordem da decisão 10 vale para dentro: quem chama só recebe a chave
    // quando as DUAS existem. Devolver a chave com a capa faltando produziria
    // um card de imóvel sem imagem, e nada denunciando.
    const balde = new ArmazenamentoEmMemoria();
    jest
      .spyOn(balde, 'gravar')
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw new Error('balde recusou a capa');
      });

    await expect(
      new GravadorDeImagens(balde).gravarPanorama(
        'p1',
        await panoramica(),
        'original',
      ),
    ).rejects.toThrow('balde recusou a capa');
  });
});
