import { devolverMemoria, emMB } from './memoria';

/**
 * Estes casos medem memória de verdade, e por isso são mais barulhentos que a
 * média da suíte. Vale o barulho: o defeito que este módulo existe para corrigir
 * é invisível em qualquer asserção sobre estado — o código roda igual, entrega o
 * mesmo resultado, e a instância morre trinta minutos depois.
 *
 * A grandeza observada é `arrayBuffers`, e não `rss`: é onde `Buffer` mora, é o
 * que a montagem enche, e é a única que o sistema operacional não pode adiar. O
 * `rss` depende de o alocador devolver as páginas, o que varia com a plataforma.
 */
describe('devolverMemoria', () => {
  const MB = 1024 * 1024;

  it('devolve os buffers que ninguém alcança mais', () => {
    const partida = process.memoryUsage().arrayBuffers;

    let lixo: Buffer[] | null = [];
    for (let i = 0; i < 40; i++) lixo.push(Buffer.allocUnsafe(4 * MB));
    expect(process.memoryUsage().arrayBuffers - partida).toBeGreaterThan(
      150 * MB,
    );

    // O que a montagem faz ao terminar: solta tudo e sai de cena.
    lixo = null;
    devolverMemoria();

    expect(process.memoryUsage().arrayBuffers - partida).toBeLessThan(16 * MB);
  });

  it('não toca no que ainda está vivo', () => {
    const vivos: Buffer[] = [];
    for (let i = 0; i < 10; i++) vivos.push(Buffer.alloc(4 * MB, i));

    devolverMemoria();

    // Uma coleta que levasse isto junto seria muito pior que o vazamento.
    expect(vivos).toHaveLength(10);
    expect(vivos[7][0]).toBe(7);
  });

  it('mede antes e depois', () => {
    const { antes, depois } = devolverMemoria();

    expect(antes).toBeGreaterThan(0);
    expect(depois).toBeGreaterThan(0);
  });

  /**
   * Chamada várias vezes seguidas — que é o caso de um tour de seis cômodos —
   * sem acumular contexto nem re-expor `gc` no global deste processo.
   */
  it('pode ser chamada a cada montagem sem publicar gc no global', () => {
    for (let i = 0; i < 5; i++) devolverMemoria();

    expect((globalThis as { gc?: unknown }).gc).toBeUndefined();
  });
});

describe('emMB', () => {
  it('escreve a queda do jeito que entra no log', () => {
    const mb = (n: number) => n * 1024 * 1024;

    expect(emMB({ antes: mb(368), depois: mb(180) })).toBe('368→180 MB');
  });

  it('mostra os dois números iguais quando não houve o que devolver', () => {
    const mb = (n: number) => n * 1024 * 1024;

    expect(emMB({ antes: mb(200), depois: mb(200) })).toBe('200→200 MB');
  });
});
