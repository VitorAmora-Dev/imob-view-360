import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

test("runtime Workers/R2/Cache: autorização precede cache e revogação bloqueia GET/HEAD/304", async () => {
  const key =
    "panoramas/11111111-1111-4111-8111-111111111111/1710000000000/tratada.jpg";
  const secret = "segredo-gateway-local-".repeat(3);
  let allowed = true;
  let calls = 0;
  const oracleErrors = [];
  const mf = new Miniflare({
    r2Persist: false,
    cachePersist: false,
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.mjs", import.meta.url)),
    compatibilityDate: "2026-08-06",
    bindings: {
      API_ORIGIN: "https://api.arpvision.test",
      PUBLIC_IMAGE_GATEWAY_SECRET: secret,
      CORS_ORIGINS: "https://app.arpvision.test",
      ENVIRONMENT: "production",
    },
    r2Buckets: ["IMAGES"],
    outboundService: async (request) => {
      calls++;
      try {
        assert.equal(
          request.url,
          "https://api.arpvision.test/internal/public-images/authorize",
        );
        assert.equal(request.method, "POST");
        assert.equal(request.headers.get("Authorization"), "Bearer " + secret);
        assert.deepEqual(await request.json(), { key });
        return new Response(null, { status: allowed ? 204 : 404 });
      } catch (error) {
        oracleErrors.push(String(error));
        throw error;
      }
    },
  });
  try {
    const bucket = await mf.getR2Bucket("IMAGES");
    await bucket.put(key, "jpeg-runtime");
    const get = (options) =>
      mf.dispatchFetch("https://fotos.arpvision.test/" + key, options);
    const first = await get();
    assert.equal(first.status, 200, JSON.stringify({ calls, oracleErrors }));
    assert.equal(first.headers.get("Cache-Control"), "no-store");
    const etag = first.headers.get("ETag");
    assert.equal(await first.text(), "jpeg-runtime");
    // Mesmo sem a cópia no bucket, o cache funciona para um tour autorizado.
    const cache = await mf.getCaches();
    const cached = await cache.default.match(
      "https://fotos.arpvision.test/" + key,
    );
    assert.ok(cached);
    await bucket.delete(key);
    assert.equal(await (await get()).text(), "jpeg-runtime");
    assert.equal(calls, 2);
    assert.equal(
      (await get({ headers: { "If-None-Match": etag } })).status,
      304,
    );
    allowed = false;
    assert.equal((await get()).status, 404);
    assert.equal((await get({ method: "HEAD" })).status, 404);
    assert.equal(
      (await get({ headers: { "If-None-Match": etag } })).status,
      404,
    );
    assert.equal(
      (
        await mf.dispatchFetch(
          "https://fotos.arpvision.test/capturas/11111111-1111-4111-8111-111111111111/0.jpg",
        )
      ).status,
      404,
    );
    assert.equal(calls, 6);
  } finally {
    await mf.dispose();
  }
});
