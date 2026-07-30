/**
 * Limites de rate limiting, centralizados para que os números — e a razão de
 * cada um — fiquem visíveis num lugar só.
 *
 * `ttl` é em milissegundos (API do @nestjs/throttler v6). Os limites são por
 * IP de origem, dentro da janela `ttl`.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Teto global de toda a API.
 * Uma tela do app dispara de 5 a 10 requisições; 100/min dá cerca de 10x de
 * folga ao uso legítimo e ainda corta varredura automatizada.
 */
export const GLOBAL_THROTTLE = { ttl: MINUTE, limit: 100 };

/**
 * POST /auth/signin — alvo de força bruta de senha.
 * Um usuário legítimo erra a senha 2 ou 3 vezes; 5 tentativas a cada 5 minutos
 * inviabiliza ataque de dicionário sem punir quem só esqueceu a senha.
 */
export const SIGNIN_THROTTLE = { default: { ttl: 5 * MINUTE, limit: 5 } };

/**
 * POST /auth/signup — cria Agency + User numa transação, sem custo para o atacante.
 * Abrir conta é ação única na vida do usuário; 3 por hora cobre a pessoa que
 * errou o formulário duas vezes e inviabiliza criação de contas em massa.
 */
export const SIGNUP_THROTTLE = { default: { ttl: HOUR, limit: 3 } };

/**
 * POST /auth/refresh — força bruta contra o refresh token.
 * Com access token de 1 dia o refresh legítimo é raro, mas o interceptor do
 * cliente pode disparar vários em paralelo quando o token expira: 10/min
 * absorve essa rajada e ainda barra tentativa sistemática.
 */
export const REFRESH_THROTTLE = { default: { ttl: MINUTE, limit: 10 } };

/**
 * POST /virtual-tours/:id/views — rota anônima que grava linha no banco.
 * Uma visualização por abertura de tour; 10/min tolera recarregar a página
 * várias vezes e impede inflar métrica (ou o banco) em massa.
 */
export const RECORD_VIEW_THROTTLE = { default: { ttl: MINUTE, limit: 10 } };

/**
 * POST /virtual-tours/:id/shares — rota anônima que grava linha no banco.
 * Compartilhar é ação deliberada e rara; 5/min é generoso para uso real e
 * corta poluição de analytics.
 */
export const RECORD_SHARE_THROTTLE = { default: { ttl: MINUTE, limit: 5 } };
