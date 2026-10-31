import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEnvironment,
  localModeAllowed,
  safeNext,
  hasCloudConfiguration,
} from "../src/lib/config/environment.ts";
const env = {
  NODE_ENV: "production",
  POMAR_ENVIRONMENT: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.example.com",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnop",
  NEXT_PUBLIC_APP_URL: "https://central.example.com",
  POMAR_OWNER_USER_ID: "11111111-1111-4111-8111-111111111111",
};
test("produção exige origem HTTPS, chave pública e proprietário explícito", () => {
  assert.equal(parseEnvironment(env).environment, "production");
  for (const change of [
    { NEXT_PUBLIC_APP_URL: "http://example.com" },
    { NEXT_PUBLIC_APP_URL: "https://example.com/path" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" },
    { POMAR_OWNER_USER_ID: "" },
    { POMAR_ENVIRONMENT: "development" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://user:password@example.com" },
  ])
    assert.throws(() => parseEnvironment({ ...env, ...change }));
});
test("modo local só em desenvolvimento; configuração parcial não vira fallback", () => {
  assert.equal(localModeAllowed({ NODE_ENV: "production" }), false);
  assert.equal(
    localModeAllowed({
      NODE_ENV: "development",
      POMAR_ENVIRONMENT: "production",
    }),
    false,
  );
  assert.equal(localModeAllowed({ NODE_ENV: "development" }), true);
  assert.equal(
    hasCloudConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: "https://incompleto.example.com",
    }),
    true,
  );
});
test("redirecionamentos não aceitam destino externo ou arbitrário", () => {
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/api/workspace",
    "/central?url=evil",
    null,
  ])
    assert.equal(safeNext(value), "/central");
  assert.equal(safeNext("/nova-senha"), "/nova-senha");
});
