import { dataUriToBlob, panoramaFilename, toPanoramaDataUri } from './panorama-download.util';

describe('panorama-download.util', () => {
  describe('toPanoramaDataUri', () => {
    it('mantém um data-URI já completo', () => {
      const uri = 'data:image/jpeg;base64,AAAA';
      expect(toPanoramaDataUri(uri)).toBe(uri);
    });

    it('prefixa base64 cru como jpeg', () => {
      expect(toPanoramaDataUri('AAAA')).toBe('data:image/jpeg;base64,AAAA');
    });
  });

  describe('panoramaFilename', () => {
    it('combina imóvel e ambiente com extensão .jpg', () => {
      expect(panoramaFilename('Casa Azul', 'Sala')).toBe('Casa Azul - Sala.jpg');
    });

    it('sanitiza caracteres inválidos preservando espaços e o separador', () => {
      expect(panoramaFilename('A/B:C', 'Quarto?*')).toBe('A_B_C - Quarto_.jpg');
    });

    it('cai em panorama.jpg quando imóvel e ambiente estão vazios', () => {
      expect(panoramaFilename('', '   ')).toBe('panorama.jpg');
    });

    it('usa só o ambiente quando não há título', () => {
      expect(panoramaFilename('', 'Cozinha')).toBe('Cozinha.jpg');
    });
  });

  describe('dataUriToBlob', () => {
    it('decodifica o base64 no tamanho e tipo corretos', async () => {
      // "Hi" em base64 é "SGk="
      const blob = dataUriToBlob('data:image/jpeg;base64,SGk=');
      expect(blob.type).toBe('image/jpeg');
      expect(blob.size).toBe(2);
      expect(await blob.text()).toBe('Hi');
    });

    it('assume image/jpeg quando o mime não vem no data-URI', () => {
      const blob = dataUriToBlob('data:;base64,SGk=');
      expect(blob.type).toBe('image/jpeg');
    });
  });
});
