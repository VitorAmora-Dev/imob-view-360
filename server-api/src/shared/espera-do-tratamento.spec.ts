import { linhaDeEspera } from './espera-do-tratamento';

/**
 * O que estes casos prendem não é o texto bonito: é que a ESPERA NA FILA
 * apareça. O log antigo media só a chamada ao modelo, e por isso dizia que o
 * servidor estava rápido justamente quando dois corretores capturavam ao mesmo
 * tempo e o produto parecia lento.
 */
describe('linhaDeEspera', () => {
  const base = {
    panoramaId: 'pano-1',
    pedidoEm: 1_000_000,
    comecouEm: 1_000_000,
    terminouEm: 1_060_000,
    desfecho: 'DONE',
  };

  it('mede do PEDIDO até o fim, e não do início da execução', () => {
    // Vinte segundos parado na fila, quarenta montando.
    const linha = linhaDeEspera({ ...base, comecouEm: 1_020_000 });

    expect(linha).toBe('pano-1: espera total 60.0s · fila 20.0s · DONE');
  });

  it('sem concorrência a fila é zero, e o total é só a montagem', () => {
    expect(linhaDeEspera(base)).toBe(
      'pano-1: espera total 60.0s · fila 0.0s · DONE',
    );
  });

  /**
   * A linha antiga só saía no sucesso. Um tratamento que demora e desiste é
   * justamente o que precisa aparecer na média, senão o gráfico fica otimista
   * exatamente nos casos ruins.
   */
  it('sai nos três desfechos, não só no sucesso', () => {
    for (const desfecho of ['DONE', 'FAILED', 'SKIPPED', 'ERRO']) {
      expect(linhaDeEspera({ ...base, desfecho })).toContain(`· ${desfecho}`);
    }
  });

  it('relógio que anda para trás não vira espera negativa', () => {
    // `Date.now()` pode recuar num ajuste de NTP no meio da montagem.
    const linha = linhaDeEspera({ ...base, terminouEm: base.pedidoEm - 5000 });

    // Zero, e não "-5.0s". Afirmar o valor inteiro prova o piso sem precisar
    // procurar sinal de menos numa linha cujo próprio id já tem hífen.
    expect(linha).toBe('pano-1: espera total 0.0s · fila 0.0s · DONE');
  });

  it('a fila nunca é maior que o total', () => {
    const linha = linhaDeEspera({
      ...base,
      comecouEm: 1_090_000,
      terminouEm: 1_060_000,
    });

    expect(linha).toBe('pano-1: espera total 60.0s · fila 60.0s · DONE');
  });
});
