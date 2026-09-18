export const SEGREDO_DO_GATEWAY = /^[A-Za-z0-9+/_=-]{32,256}$/;

/** Origem do Worker: sem credenciais/prefixos e nunca o endpoint público R2. */
export function origemDoGatewayValida(valor: string): boolean {
  try {
    const url = new URL(valor);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !/(^|\.)(r2\.dev|r2\.cloudflarestorage\.com)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
