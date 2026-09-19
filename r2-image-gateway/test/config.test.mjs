import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// O arquivo usa somente comentários de linha isolados e vírgulas finais.
const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1"),
);

test("workers.dev é habilitado somente na homologação, sem previews", () => {
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.env.homolog.workers_dev, true);
  assert.equal(config.env.homolog.preview_urls, false);
  assert.notEqual(config.env.homolog.name, config.name);
  assert.equal(config.env.homolog.routes, undefined);
});

test("homologação usa bucket privado e origens explícitas, sem secrets no config", () => {
  const homolog = config.env.homolog;
  assert.equal(homolog.account_id, "8b2c2ff1b041be08a4dcd68d3725a66a");
  assert.deepEqual(homolog.r2_buckets, [
    { binding: "IMAGES", bucket_name: "arp-vision-fotos-homolog" },
  ]);
  assert.deepEqual(homolog.vars, {
    API_ORIGIN: "https://imob360-api.onrender.com",
    CORS_ORIGINS: "https://imob360-u1ge.onrender.com",
    ENVIRONMENT: "production",
  });
  assert.equal(homolog.observability.enabled, true);
  for (const env of [config, ...Object.values(config.env)]) {
    for (const name of Object.keys(env.vars)) {
      assert.doesNotMatch(name, /SECRET|ACCESS_KEY|TOKEN/);
    }
  }
});
