import { resolve } from 'node:path';
import { ArmazenamentoLocal } from './armazenamento-local';
import { ArmazenamentoR2 } from './armazenamento-r2';
import { ArmazenamentoDeImagens } from './armazenamento.port';
import {
  origemDoGatewayValida,
  SEGREDO_DO_GATEWAY,
} from './configuracao-do-gateway';

/** Mesma seleção para os comandos operacionais; nunca aceita meia configuração. */
export function armazenamentoDoAmbiente(
  env: NodeJS.ProcessEnv = process.env,
): ArmazenamentoDeImagens {
  const campos = [
    'STORAGE_ENDPOINT',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_SECRET_ACCESS_KEY',
  ];
  const preenchidos = campos.filter((campo) => Boolean(env[campo]));
  if (
    env.STORAGE_PUBLIC_URL &&
    (!origemDoGatewayValida(env.STORAGE_PUBLIC_URL) ||
      !SEGREDO_DO_GATEWAY.test(env.PUBLIC_IMAGE_GATEWAY_SECRET ?? ''))
  ) {
    throw new Error(
      'STORAGE_PUBLIC_URL requer origem HTTPS do Worker e PUBLIC_IMAGE_GATEWAY_SECRET válido',
    );
  }
  if (preenchidos.length && preenchidos.length !== campos.length) {
    throw new Error(`${campos.join(', ')} devem ser definidas juntas`);
  }
  if (!env.STORAGE_ENDPOINT) {
    if (env.STORAGE_PUBLIC_URL)
      throw new Error('STORAGE_PUBLIC_URL requer STORAGE_ENDPOINT');
    return new ArmazenamentoLocal(
      resolve(env.STORAGE_LOCAL_DIR || '.armazenamento'),
    );
  }
  return new ArmazenamentoR2({
    endpoint: env.STORAGE_ENDPOINT,
    bucket: env.STORAGE_BUCKET!,
    chaveId: env.STORAGE_ACCESS_KEY_ID!,
    chaveSecreta: env.STORAGE_SECRET_ACCESS_KEY!,
    urlPublica: env.STORAGE_PUBLIC_URL || null,
  });
}
