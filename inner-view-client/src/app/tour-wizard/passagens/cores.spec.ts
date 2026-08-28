import { corDoAmbiente } from './cores';

describe('corDoAmbiente', () => {
  it('devolve um token do tema, nunca hex', () => {
    expect(corDoAmbiente(0)).toBe('var(--app-room-1)');
    expect(corDoAmbiente(5)).toBe('var(--app-room-6)');
  });

  it('cicla depois do sexto', () => {
    expect(corDoAmbiente(6)).toBe(corDoAmbiente(0));
    expect(corDoAmbiente(13)).toBe(corDoAmbiente(1));
  });

  it('indice negativo nao quebra', () => {
    expect(corDoAmbiente(-1)).toBe('var(--app-room-6)');
  });
});
