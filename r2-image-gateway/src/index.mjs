const KEY_PATTERN =
  /^panoramas\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9]{1,16}\/(?:original|tratada|capa)\.jpg$/;
const SECRET_PATTERN = /^[A-Za-z0-9+/_=-]{32,256}$/;

/**
 * Bucket privado, bytes em cache na borda, autorização antes de TODO acesso.
 * As dependências explícitas permitem testar sem conta Cloudflare.
 */
export async function serveImage(
  request,
  env,
  context,
  { cache, fetcher = fetch },
) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const response = (body, status, extra = {}) => {
    const headers = new Headers(extra);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    headers.set("Vary", "Origin");
    if (origin && allowedOrigins.includes(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Expose-Headers", "ETag, Content-Length");
    }
    return new Response(request.method === "HEAD" ? null : body, {
      status,
      headers,
    });
  };
  const url = new URL(request.url);
  // Não decodifique a chave: encoding, captures, barras extras e traversal não
  // podem virar aliases de um objeto válido.
  const key = url.pathname.slice(1);
  if (!KEY_PATTERN.test(key)) return response(null, 404);
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.includes(origin)) return response(null, 403);
    const method = request.headers.get("Access-Control-Request-Method");
    if (!["GET", "HEAD"].includes(method)) return response(null, 405);
    const requestedHeaders = (
      request.headers.get("Access-Control-Request-Headers") ?? ""
    )
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (requestedHeaders.some((value) => value !== "if-none-match"))
      return response(null, 403);
    return response(null, 204, {
      "Access-Control-Allow-Methods": "GET, HEAD",
      "Access-Control-Allow-Headers": "If-None-Match",
    });
  }
  if (!["GET", "HEAD"].includes(request.method))
    return response(null, 405, { Allow: "GET, HEAD, OPTIONS" });
  if (origin && !allowedOrigins.includes(origin)) return response(null, 403);
  if (!SECRET_PATTERN.test(env.PUBLIC_IMAGE_GATEWAY_SECRET ?? ""))
    return response(null, 503);

  let api;
  try {
    api = new URL(env.API_ORIGIN);
    const local =
      env.ENVIRONMENT === "development" &&
      api.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname);
    if (
      (!local && api.protocol !== "https:") ||
      api.username ||
      api.password ||
      api.pathname !== "/" ||
      api.search ||
      api.hash
    )
      return response(null, 503);
  } catch {
    return response(null, 503);
  }

  // Não se segue redirects da API nem se envia qualquer header/cookie do
  // visitante para ela. Não há cache de decisões nem fallback em falha.
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5000);
  try {
    const authorization = await fetcher(
      new URL("/internal/public-images/authorize", api),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.PUBLIC_IMAGE_GATEWAY_SECRET,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify({ key }),
        // Workers não implementa redirect:error; manual + status exclusivo 204
        // rejeita redirects sem reenviar o segredo para outro destino.
        redirect: "manual",
        cache: "no-store",
        signal: abort.signal,
      },
    );
    if (authorization.status === 404) return response(null, 404);
    if (authorization.status !== 204) return response(null, 503);
  } catch {
    return response(null, 503);
  } finally {
    clearTimeout(timeout);
  }

  // Busca no cache SOMENTE depois da autorização. Query strings e headers do
  // visitante não geram novas cópias do mesmo arquivo nem afetam a origem.
  const cacheUrl = new URL(url.origin + "/" + key);
  const cacheKey = new Request(cacheUrl, { method: "GET" });
  let image;
  try {
    image = await cache.match(cacheKey);
  } catch {
    /* cache é otimização */
  }
  try {
    if (!image) {
      const object = await env.IMAGES.get(key);
      if (!object) return response(null, 404);
      image = new Response(object.body, {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(object.size),
          ETag: object.httpEtag,
          // Este header existe SOMENTE na cópia interna; nunca sai ao navegador.
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
      const cachedCopy = image.clone();
      context.waitUntil(
        cache
          .put(cacheKey, cachedCopy)
          .catch(() => cachedCopy.body?.cancel().catch(() => {})),
      );
    }
    const headers = {
      "Content-Type": "image/jpeg",
      ETag: image.headers.get("ETag"),
    };
    const length = image.headers.get("Content-Length");
    if (length) headers["Content-Length"] = length;
    const tags = (request.headers.get("If-None-Match") ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^W\//, ""));
    if (tags.includes("*") || (headers.ETag && tags.includes(headers.ETag))) {
      if (image.body) context.waitUntil(image.body.cancel().catch(() => {}));
      return response(null, 304, { ETag: headers.ETag });
    }
    if (request.method === "HEAD" && image.body)
      context.waitUntil(image.body.cancel().catch(() => {}));
    return response(image.body, 200, headers);
  } catch {
    return response(null, 503);
  }
}

export default {
  fetch(request, env, context) {
    return serveImage(request, env, context, { cache: caches.default });
  },
};
