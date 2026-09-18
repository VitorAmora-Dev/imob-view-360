import { validateEnv } from './env.schema';

const MINIMO = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

const R2 = {
  STORAGE_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
  STORAGE_BUCKET: 'imob360',
  STORAGE_ACCESS_KEY_ID: 'id',
  STORAGE_SECRET_ACCESS_KEY: 'segredo',
};

describe('configuração do armazenamento', () => {
  it('origem pública só liga com segredo exclusivo do gateway', () => {
    expect(() =>
      validateEnv({
        ...MINIMO,
        ...R2,
        STORAGE_PUBLIC_URL: 'https://fotos.teste',
      }),
    ).toThrow(/PUBLIC_IMAGE_GATEWAY_SECRET/);
    expect(
      validateEnv({
        ...MINIMO,
        ...R2,
        STORAGE_PUBLIC_URL: 'https://fotos.teste',
        PUBLIC_IMAGE_GATEWAY_SECRET: 'c'.repeat(64),
      }).STORAGE_PUBLIC_URL,
    ).toBe('https://fotos.teste');
    expect(() =>
      validateEnv({
        ...MINIMO,
        PUBLIC_IMAGE_GATEWAY_SECRET: MINIMO.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/diferente/);
  });

  it.each([
    'http://fotos.teste',
    'https://bucket.r2.dev',
    R2.STORAGE_ENDPOINT,
    'https://fotos.teste/prefixo',
    'https://fotos.teste?token=x',
    'https://usuario:senha@fotos.teste',
    'inválida',
  ])('recusa origem pública insegura: %s', (STORAGE_PUBLIC_URL) => {
    expect(() =>
      validateEnv({
        ...MINIMO,
        ...R2,
        STORAGE_PUBLIC_URL,
        PUBLIC_IMAGE_GATEWAY_SECRET: 'c'.repeat(64),
      }),
    ).toThrow();
  });

  it.each(['curto', ' '.repeat(64), 'x'.repeat(257)])(
    'recusa segredo inválido do gateway',
    (PUBLIC_IMAGE_GATEWAY_SECRET) => {
      expect(() =>
        validateEnv({ ...MINIMO, PUBLIC_IMAGE_GATEWAY_SECRET }),
      ).toThrow(/PUBLIC_IMAGE_GATEWAY_SECRET/);
    },
  );
  it('recusa credencial ou URL pública sem endpoint', () => {
    expect(() => validateEnv({ ...MINIMO, STORAGE_BUCKET: 'bucket' })).toThrow(
      /STORAGE_ENDPOINT/,
    );
    expect(() =>
      validateEnv({ ...MINIMO, STORAGE_PUBLIC_URL: 'https://fotos.teste' }),
    ).toThrow(/STORAGE_ENDPOINT/);
  });

  it('sobe sem nenhuma variável de storage: o disco local atende', () => {
    // Desenvolvimento e a suíte de teste NÃO podem exigir bucket.
    const env = validateEnv(MINIMO);

    expect(env.STORAGE_ENDPOINT).toBe('');
    expect(env.STORAGE_LOCAL_DIR).toBe('.armazenamento');
  });

  it('recusa configuração pela metade em vez de cair no disco calado', () => {
    // Uma produção com endpoint e sem credencial gravaria no disco efêmero do
    // container, e a foto sumiria no próximo deploy sem nada denunciando.
    expect(() =>
      validateEnv({
        ...MINIMO,
        STORAGE_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
      }),
    ).toThrow(/STORAGE_BUCKET/);
  });

  it('aceita a configuração completa da R2', () => {
    const env = validateEnv({
      ...MINIMO,
      STORAGE_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
      STORAGE_BUCKET: 'imob360',
      STORAGE_ACCESS_KEY_ID: 'id',
      STORAGE_SECRET_ACCESS_KEY: 'segredo',
    });

    expect(env.STORAGE_BUCKET).toBe('imob360');
    // A entrega B é ligar ESTA variável. Vazia por padrão, de propósito.
    expect(env.STORAGE_PUBLIC_URL).toBe('');
  });
});
