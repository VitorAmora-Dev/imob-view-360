import { test } from "node:test";
import assert from "node:assert/strict";
import { serveImage } from "../src/index.mjs";

const KEY =
  "panoramas/11111111-1111-4111-8111-111111111111/1710000000000/tratada.jpg";
const SECRET = "gateway-teste-".repeat(4);
const APP = "https://app.arpvision.test";

function fixture() {
  const events = [];
  const entries = new Map();
  const pending = [];
  const env = {
    API_ORIGIN: "https://api.arpvision.test",
    PUBLIC_IMAGE_GATEWAY_SECRET: SECRET,
    CORS_ORIGINS: APP,
    ENVIRONMENT: "production",
    IMAGES: {
      async get(key) {
        events.push(["r2", key]);
        return {
          body: new Response("jpeg-test").body,
          size: 9,
          httpEtag: '"foto1"',
        };
      },
    },
  };
  const cache = {
    async match(key) {
      events.push(["cache", key.url]);
      const entry = entries.get(key.url);
      return entry
        ? new Response(entry.bytes, { headers: entry.headers })
        : undefined;
    },
    async put(key, response) {
      const bytes = await response.arrayBuffer();
      entries.set(key.url, { bytes, headers: new Headers(response.headers) });
    },
  };
  let status = 204;
  let failed = false;
  const fetcher = async (url, options) => {
    events.push(["authorize", String(url), options]);
    if (failed) throw new Error("offline");
    return new Response(null, { status });
  };
  const ctx = {
    waitUntil(promise) {
      pending.push(promise);
    },
  };
  const call = (path = KEY, options = {}) =>
    serveImage(
      new Request("https://fotos.arpvision.test/" + path, options),
      env,
      ctx,
      { cache, fetcher },
    );
  return {
    env,
    events,
    entries,
    cache,
    call,
    setStatus(value) {
      status = value;
    },
    setFailed() {
      failed = true;
    },
    async settle() {
      await Promise.all(pending);
    },
  };
}

test("bytes saem do R2 e cache interno, sempre depois de autorizar", async () => {
  const f = fixture();
  const first = await f.call();
  assert.equal(first.status, 200);
  assert.equal(await first.text(), "jpeg-test");
  await f.settle();
  const second = await f.call();
  assert.equal(await second.text(), "jpeg-test");
  assert.deepEqual(
    f.events.map((event) => event[0]),
    ["authorize", "cache", "r2", "authorize", "cache"],
  );
  const options = f.events[0][2];
  assert.equal(options.headers.Authorization, "Bearer " + SECRET);
  assert.equal(options.redirect, "manual");
  assert.equal(options.cache, "no-store");
  assert.deepEqual(JSON.parse(options.body), { key: KEY });
  assert.equal(second.headers.get("Cache-Control"), "no-store");
  assert.equal(second.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(
    f.entries.values().next().value.headers.get("Cache-Control"),
    /immutable/,
  );
});

test("tour oculto/apagado nega até imagem já cacheada e If-None-Match", async () => {
  const f = fixture();
  await (await f.call()).text();
  await f.settle();
  f.events.length = 0;
  f.setStatus(404);
  for (const method of ["GET", "HEAD"]) {
    const denied = await f.call(KEY, {
      method,
      headers: { "If-None-Match": '"foto1"' },
    });
    assert.equal(denied.status, 404);
    assert.equal(denied.headers.get("Cache-Control"), "no-store");
  }
  assert.deepEqual(
    f.events.map((event) => event[0]),
    ["authorize", "authorize"],
  );
});

for (const status of [200, 401, 403, 429, 500, 302]) {
  test(
    "autorização inesperada " + status + " falha fechada, mesmo com cache",
    async () => {
      const f = fixture();
      f.entries.set(
        "https://fotos.arpvision.test/" + KEY,
        new Response("privado"),
      );
      f.setStatus(status);
      assert.equal((await f.call()).status, 503);
      assert.deepEqual(
        f.events.map((event) => event[0]),
        ["authorize"],
      );
    },
  );
}

test("API offline não libera o cache antigo", async () => {
  const f = fixture();
  f.setFailed();
  assert.equal((await f.call()).status, 503);
  assert.deepEqual(
    f.events.map((event) => event[0]),
    ["authorize"],
  );
});

test(
  "timeout aborta autorização sem consultar cache ou R2",
  { timeout: 10000 },
  async () => {
    const f = fixture();
    let aborted = false;
    const fetcher = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true },
        );
      });
    const result = await serveImage(
      new Request("https://fotos.arpvision.test/" + KEY),
      f.env,
      { waitUntil() {} },
      { cache: f.cache, fetcher },
    );
    assert.equal(result.status, 503);
    assert.equal(aborted, true);
    assert.deepEqual(f.events, []);
  },
);

for (const key of [
  "capturas/11111111-1111-4111-8111-111111111111/0.jpg",
  KEY.replace("1710000000000", "%31"),
  KEY.replace("tratada.jpg", "qualquer.png"),
  KEY.replace("panoramas/", "panoramas//"),
  KEY.replace("tratada.jpg", "%2ftratada.jpg"),
  "segredos.txt",
]) {
  test("nega referência/path inválido sem consultar API: " + key, async () => {
    const f = fixture();
    assert.equal((await f.call(key)).status, 404);
    assert.deepEqual(f.events, []);
  });
}

test("não confunde variantes/capas e ignora query strings na chave do cache", async () => {
  const f = fixture();
  const cover = KEY.replace("tratada.jpg", "capa.jpg");
  await (await f.call(cover + "?v=1")).text();
  await f.settle();
  await (await f.call(cover + "?v=2")).text();
  assert.equal(f.events.filter((event) => event[0] === "r2").length, 1);
  assert.deepEqual(JSON.parse(f.events[0][2].body), { key: cover });
});

test("GET condicional e HEAD continuam autorizados, sem corpo", async () => {
  const f = fixture();
  await (await f.call()).text();
  await f.settle();
  const conditional = await f.call(KEY, {
    headers: { "If-None-Match": 'W/"foto1", "outra"' },
  });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
  const head = await f.call(KEY, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("Content-Length"), "9");
  await f.settle();
});

test("CORS é reaplicado por resposta, sem cookie/token do visitante na API", async () => {
  const f = fixture();
  const response = await f.call(KEY, {
    headers: {
      Origin: APP,
      Cookie: "session=privado",
      Authorization: "Bearer usuario",
    },
  });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), APP);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(f.events[0][2].headers.Cookie, undefined);
  assert.equal(f.events[0][2].headers.Authorization, "Bearer " + SECRET);
  await response.text();
  await f.settle();
  const other = await f.call();
  assert.equal(other.headers.get("Access-Control-Allow-Origin"), null);
  await other.text();
  assert.equal(
    (await f.call(KEY, { headers: { Origin: "https://outro.test" } })).status,
    403,
  );
});

test("OPTIONS permite só GET/HEAD e If-None-Match nas origens configuradas", async () => {
  const f = fixture();
  const preflight = (method) =>
    f.call(KEY, {
      method: "OPTIONS",
      headers: { Origin: APP, "Access-Control-Request-Method": method },
    });
  assert.equal((await preflight("GET")).status, 204);
  assert.equal((await preflight("POST")).status, 405);
  assert.equal(
    (
      await f.call(KEY, {
        method: "OPTIONS",
        headers: {
          Origin: "https://outro.test",
          "Access-Control-Request-Method": "GET",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(KEY, {
        method: "OPTIONS",
        headers: {
          Origin: APP,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Authorization",
        },
      })
    ).status,
    403,
  );
  assert.deepEqual(f.events, []);
});

test("métodos de escrita não acessam bucket nem API", async () => {
  const f = fixture();
  for (const method of ["POST", "PUT", "DELETE", "PATCH"])
    assert.equal((await f.call(KEY, { method })).status, 405);
  assert.deepEqual(f.events, []);
});

test("configuração ausente/insegura falha fechada; HTTP só em desenvolvimento local", async () => {
  for (const api of [
    "http://api.test",
    "https://usuario:senha@api.test",
    "https://api.test/prefixo",
    "inválido",
  ]) {
    const f = fixture();
    f.env.API_ORIGIN = api;
    assert.equal((await f.call()).status, 503);
    assert.deepEqual(f.events, []);
  }
  const missing = fixture();
  missing.env.PUBLIC_IMAGE_GATEWAY_SECRET = "";
  assert.equal((await missing.call()).status, 503);
  assert.deepEqual(missing.events, []);
  const dev = fixture();
  dev.env.API_ORIGIN = "http://127.0.0.1:3000";
  dev.env.ENVIRONMENT = "development";
  const result = await dev.call();
  assert.equal(result.status, 200);
  await result.text();
  await dev.settle();
});

test("objeto ausente ou falha do bucket não vaza detalhes", async () => {
  const f = fixture();
  f.env.IMAGES.get = async () => null;
  assert.equal((await f.call()).status, 404);
  f.env.IMAGES.get = async () => {
    throw new Error("segredo-do-provider");
  };
  const error = await f.call();
  assert.equal(error.status, 503);
  assert.equal(await error.text(), "");
});

test("falha do cache não impede leitura autorizada do bucket", async () => {
  const f = fixture();
  f.cache.match = async () => {
    throw new Error("cache");
  };
  f.cache.put = async () => {
    throw new Error("cache");
  };
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "jpeg-test");
  await f.settle();
});
