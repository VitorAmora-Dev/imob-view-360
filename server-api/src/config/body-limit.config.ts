import { json, RequestHandler, urlencoded } from 'express';

/** Teto para toda a API. Nenhum DTO legítimo fora de imagem chega perto disso. */
export const DEFAULT_BODY_LIMIT = '1mb';

/** Panorâmica 360° em base64 pesa de 7 a 27 MB por cômodo. */
export const IMAGE_BODY_LIMIT = '50mb';

/**
 * As rotas cujo DTO aceita `imageData`. Confirmado pelos schemas:
 * create-virtual-tour.dto.ts, create-panorama.dto.ts, update-panorama.dto.ts e
 * upload-capture-frame.dto.ts.
 * Qualquer rota nova que receba imagem precisa entrar aqui.
 *
 * A rota de frames aparece antes da de atualização porque a de atualização
 * casaria `/panoramas/:id` mas não `/panoramas/:id/frames` — a ordem não muda
 * o resultado, mas deixa a diferença visível.
 */
const IMAGE_UPLOAD_ROUTES: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'POST', path: /^\/virtual-tours\/?$/ },
  { method: 'POST', path: /^\/panoramas\/?$/ },
  { method: 'POST', path: /^\/panoramas\/[^/]+\/frames\/?$/ },
  { method: 'PATCH', path: /^\/panoramas\/[^/]+\/?$/ },
];

/**
 * Um único middleware decide qual parser usar. Precisa rodar antes do roteador
 * do Nest — daí o `bodyParser: false` na criação da aplicação: o body-parser
 * marca `req._body` depois de consumir o corpo, então o primeiro parser a rodar
 * é o que vale, e um limite global de 1mb registrado antes venceria o de 50mb.
 */
export function bodyLimitMiddleware(): RequestHandler {
  const imageJson = json({ limit: IMAGE_BODY_LIMIT });
  const defaultJson = json({ limit: DEFAULT_BODY_LIMIT });

  return (req, res, next) => {
    const isImageUpload = IMAGE_UPLOAD_ROUTES.some(
      (route) => route.method === req.method && route.path.test(req.path),
    );
    return isImageUpload
      ? imageJson(req, res, next)
      : defaultJson(req, res, next);
  };
}

/** Reposto porque `bodyParser: false` remove também o urlencoded padrão do Nest. */
export function urlencodedMiddleware(): RequestHandler {
  return urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT });
}
