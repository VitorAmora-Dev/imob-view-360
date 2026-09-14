import {
  CANTO_MAXIMO_GRAUS,
  FOV_VERTICAL_PADRAO,
  LATITUDE_DA_FAIXA_GRAUS,
  cantoDoFrustum,
  fovQueCabeNaFaixa,
} from './fov-da-tela';

/**
 * O defeito relatado: "ao deitar o celular, o FOV fica escuro, deixando a
 * imagem com impressão de neblina".
 *
 * Não era escuridão nem neblina: eram teto e chão que a câmera nunca
 * fotografou entrando pelos cantos da tela. Estes casos prendem a geometria que
 * explica isso, para ninguém precisar redescobrir a conta olhando a tela.
 */
describe('fov-da-tela', () => {
  /** Um aparelho de 6,1", que é onde o defeito foi visto. */
  const EM_PE = 390 / 844;
  const DEITADO = 844 / 390;

  describe('cantoDoFrustum', () => {
    /**
     * A conta que prova o relato. Mesmo campo vertical, mesma câmera — só a
     * tela virou, e o alcance da diagonal salta 21 graus.
     */
    it('deitar a tela leva o canto de 40° para 61°, sem mudar a câmera', () => {
      expect(cantoDoFrustum(FOV_VERTICAL_PADRAO, EM_PE)).toBeCloseTo(40.2, 1);
      expect(cantoDoFrustum(FOV_VERTICAL_PADRAO, DEITADO)).toBeCloseTo(61.3, 1);
    });

    /**
     * E prova que o salto cruza a fronteira: em pé sobra folga, deitado
     * ultrapassa. É esta linha que separa foto de invenção.
     */
    it('em pé o canto fica na faixa fotografada; deitado, atravessa', () => {
      expect(cantoDoFrustum(FOV_VERTICAL_PADRAO, EM_PE)).toBeLessThan(
        LATITUDE_DA_FAIXA_GRAUS,
      );
      expect(cantoDoFrustum(FOV_VERTICAL_PADRAO, DEITADO)).toBeGreaterThan(
        LATITUDE_DA_FAIXA_GRAUS,
      );
    });

    /** O canto alcança mais longe que o eixo vertical. Daí ser ele a medida. */
    it('o canto alcança mais que meio campo vertical', () => {
      expect(cantoDoFrustum(75, DEITADO)).toBeGreaterThan(75 / 2);
    });
  });

  describe('fovQueCabeNaFaixa', () => {
    it('não mexe na tela em pé', () => {
      expect(fovQueCabeNaFaixa(EM_PE)).toBe(FOV_VERTICAL_PADRAO);
    });

    /**
     * A asserção central: qualquer proporção que uma tela possa ter, o canto
     * cai dentro da margem. Varrer a faixa inteira em vez de escolher dois
     * casos é o que impede a regra de valer só para o celular do relato.
     */
    it('nenhuma proporção de tela deixa o canto passar da margem', () => {
      for (let aspecto = 0.3; aspecto <= 3; aspecto += 0.05) {
        const fov = fovQueCabeNaFaixa(aspecto);
        const canto = cantoDoFrustum(fov, aspecto);

        expect(canto)
          .withContext(`proporção ${aspecto.toFixed(2)} deu canto ${canto.toFixed(1)}°`)
          .toBeLessThanOrEqual(CANTO_MAXIMO_GRAUS + 0.001);
      }
    });

    /**
     * O conserto não pode desfazer o motivo de o botão existir. Deitar o
     * telefone continua entregando MUITO mais largura — só para de alcançar o
     * que não é foto.
     */
    it('deitado ainda abre muito mais que em pé', () => {
      const horizontal = (aspecto: number): number => {
        const fov = fovQueCabeNaFaixa(aspecto);
        const meia = Math.tan((fov * Math.PI) / 360) * aspecto;
        return (Math.atan(meia) * 360) / Math.PI;
      };

      expect(horizontal(EM_PE)).toBeCloseTo(39.2, 0);
      // De 39° para ~105°: quase o triplo, sem tocar no borrão.
      expect(horizontal(DEITADO)).toBeGreaterThan(100);
    });

    /** Só reduz. Uma tela estreita não ganha campo que a câmera não tem. */
    it('nunca aumenta o campo além do padrão', () => {
      for (const aspecto of [0.3, 0.5, 1, 1.33, 1.78, 2.16, 3]) {
        expect(fovQueCabeNaFaixa(aspecto)).toBeLessThanOrEqual(FOV_VERTICAL_PADRAO);
      }
    });

    /**
     * Contêiner de altura zero existe: acontece entre o Angular criar o
     * elemento e o CSS lhe dar altura. `camera.fov = NaN` apaga a tela inteira
     * e não diz por quê — é dos defeitos mais caros de diagnosticar.
     */
    it('proporção inválida devolve o padrão, e nunca NaN', () => {
      for (const ruim of [0, -1, NaN, Infinity]) {
        expect(fovQueCabeNaFaixa(ruim)).toBe(FOV_VERTICAL_PADRAO);
      }
    });
  });
});
