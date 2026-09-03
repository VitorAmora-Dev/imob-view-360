import { panoramaFilename } from './panorama-download.util';

describe('panoramaFilename', () => {
  it('combina o nome do imóvel e do ambiente', () => {
    expect(panoramaFilename('Casa Azul', 'Sala')).toBe('Casa Azul - Sala.jpg');
  });

  it('remove caracteres inválidos para nomes de arquivo', () => {
    expect(panoramaFilename('A/B:C', 'Quarto?*')).toBe('A_B_C - Quarto_.jpg');
  });

  it('usa um nome neutro quando não há rótulos', () => {
    expect(panoramaFilename('', '   ')).toBe('panorama.jpg');
  });
});
