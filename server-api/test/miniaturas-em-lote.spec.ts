import sharp from 'sharp';
import {
  limparCacheDeMiniatura,
  reduzirComCache,
} from '../src/modules/panoramas/panorama-miniatura';

/**
 * O que acontece quando um tour inteiro pede miniatura de uma vez.
 *
 * Abrir um tour dispara uma requisição por cômodo, todas juntas, e cada uma
 * carrega a panorâmica inteira do banco antes de reduzir. Em 10/09/2026 um tour
 * de 9 cômodos custou 113 MB de uma vez em produção; medido na bancada, o custo
 * é linear em ~12,5 MB por redução simultânea, e 20 cômodos dariam 249 MB.
 *
 * Nenhuma coleta ajuda nesse caso: as imagens estão todas VIVAS ao mesmo tempo.
 * O que resolve é não deixar todas rodarem juntas — e é isso que estes casos
 * travam.
 *
 * `carregar` é o instrumento: como ele é do chamador, dá para contar de fora
 * quantas reduções o processo aceitou ao mesmo tempo, sem expor estado interno.
 */
describe('miniaturas pedidas em lote', () => {
  beforeEach(() => limparCacheDeMiniatura());

  /** Uma equirretangular de verdade: o sharp vai decodificá-la. */
  async function panoramica(tom: number): Promise<Buffer> {
    return sharp({
      create: {
        width: 1024,
        height: 512,
        channels: 3,
        background: { r: tom, g: tom, b: tom },
      },
    })
      .jpeg()
      .toBuffer();
  }

  const respirar = () => new Promise((resolve) => setTimeout(resolve, 5));

  it('não deixa um tour inteiro reduzir de uma vez', async () => {
    let agora = 0;
    let maximo = 0;

    const carregar = async (tom: number) => {
      agora++;
      maximo = Math.max(maximo, agora);
      await respirar();
      const bytes = await panoramica(tom);
      agora--;
      return bytes;
    };

    // Nove cômodos, que é o tour real do dia do incidente.
    const miniaturas = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        reduzirComCache(`comodo-${i}`, 292, () => carregar(i * 20)),
      ),
    );

    expect(maximo).toBeLessThanOrEqual(2);
    expect(miniaturas).toHaveLength(9);
    for (const bytes of miniaturas) expect(bytes.length).toBeGreaterThan(0);
  });

  it('entrega as nove, e cada uma é a sua', async () => {
    // Enfileirar não pode trocar as imagens de lugar: seria um defeito pior
    // que o consumo de memória, e invisível — a faixa mostraria a sala certa
    // com a foto do banheiro.
    const tons = [10, 60, 110, 160, 210];

    const miniaturas = await Promise.all(
      tons.map((tom, i) =>
        reduzirComCache(`cena-${i}`, 64, () => panoramica(tom)),
      ),
    );

    for (const [i, bytes] of miniaturas.entries()) {
      const { data } = await sharp(bytes).raw().toBuffer({
        resolveWithObject: true,
      });
      // JPEG não devolve o tom exato; a distância entre eles é de 50.
      expect(Math.abs(data[0] - tons[i])).toBeLessThan(10);
    }
  });

  /**
   * O modo de falha que trava a rota inteira: uma redução que estoura sem
   * soltar a vaga. Duas falhas bastariam para nenhuma miniatura mais ser
   * servida até o próximo deploy.
   */
  it('uma redução que falha devolve a vaga', async () => {
    const quebradas = Array.from({ length: 4 }, (_, i) =>
      reduzirComCache(`ruim-${i}`, 292, () =>
        Promise.reject(new Error('coluna sumiu')),
      ).catch(() => null),
    );
    expect(await Promise.all(quebradas)).toEqual([null, null, null, null]);

    const boa = await reduzirComCache('boa', 292, () => panoramica(120));

    expect(boa.length).toBeGreaterThan(0);
  });

  /**
   * O acerto de cache não custa memória, então não pode pagar a fila. Se este
   * caso passasse a esperar, ele não falharia com uma asserção — ele estouraria
   * o tempo do teste, que é exatamente o sintoma que teríamos em produção.
   */
  it('quem já está no cache não espera a fila', async () => {
    await reduzirComCache('ja-tenho', 292, () => panoramica(200));

    let soltar!: () => void;
    const presa = new Promise<void>((resolve) => (soltar = resolve));
    const ocupando = Array.from({ length: 2 }, (_, i) =>
      reduzirComCache(`lenta-${i}`, 292, async () => {
        await presa;
        return panoramica(50);
      }),
    );
    await respirar();

    // Com as duas vagas ocupadas por reduções que não terminam.
    const doCache = await reduzirComCache('ja-tenho', 292, () => {
      throw new Error('não deveria recarregar o que está no cache');
    });
    expect(doCache.length).toBeGreaterThan(0);

    soltar();
    await Promise.all(ocupando);
  });

  /**
   * Dois visitantes no mesmo tour pedem as mesmas miniaturas. Quem espera na
   * fila reconsulta o cache ao chegar a sua vez, e encontra o que o outro
   * acabou de produzir.
   */
  it('quem esperou pela mesma miniatura não a produz de novo', async () => {
    let carregamentos = 0;
    const carregar = async () => {
      carregamentos++;
      await respirar();
      return panoramica(90);
    };

    const quatro = await Promise.all(
      Array.from({ length: 4 }, () =>
        reduzirComCache('mesma-cena', 292, carregar),
      ),
    );

    expect(quatro).toHaveLength(4);
    // As duas primeiras entram juntas e as duas seguintes acham pronto. Sem a
    // reconsulta seriam quatro leituras da mesma coluna.
    expect(carregamentos).toBe(2);
  });
});
