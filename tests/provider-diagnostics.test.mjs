import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../src/lib/billing/mercadopago.ts";
import {
  createPixOrder,
  fetchVerifiedOrder,
} from "../src/lib/billing/orders.ts";
import {
  inspectProviderAccount,
  providerErrorDetails,
} from "../src/lib/billing/provider-diagnostics.ts";

const config = {
  enabled: true,
  mode: "test",
  collectorId: "987654321",
  applicationId: "123456789",
  accessToken: "APP_USR-fixture-not-a-credential",
};
const account = { id: 987654321, site_id: "MLB", tags: ["test_user"] };
const privateValue = "FIXTURE_PRIVATE_PROFILE_AND_DRIVER_DATA";

test("diagnóstico de conta usa somente GET e distingue conta, país e ambiente sem perfil privado", async () => {
  const cases = [
    [null, "provider_account_invalid"],
    [{ ...account, id: 1 }, "provider_collector_mismatch"],
    [{ ...account, site_id: "MLA" }, "provider_country_mismatch"],
    [{ ...account, tags: null }, "provider_environment_unverified"],
    [{ ...account, tags: [null] }, "provider_environment_unverified"],
    [{ ...account, tags: [] }, "provider_environment_mismatch"],
    [account, "provider_ready"],
  ];
  for (const [profile, code] of cases) {
    const calls = [];
    const result = await inspectProviderAccount(config, async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      return Response.json(
        profile && { ...profile, email: privateValue, extra: privateValue },
      );
    });
    assert.deepEqual(calls, [
      {
        url: "https://api.mercadopago.com/users/me",
        method: "GET",
        body: undefined,
      },
    ]);
    assert.equal(result.code, code);
    assert.equal(result.enabled, code === "provider_ready");
    assert.equal(result.mode, "test");
    assert.equal(JSON.stringify(result).includes(privateValue), false);
    assert.equal(JSON.stringify(result).includes(config.accessToken), false);
    assert.equal(JSON.stringify(result).includes(config.collectorId), false);
  }
});

test("diagnóstico HTTP preserva rejeição e resultado incerto sem ler o corpo do erro", async () => {
  for (const [status, definitive] of [
    [401, true],
    [403, true],
    [408, false],
    [429, false],
    [500, false],
  ]) {
    const result = await inspectProviderAccount(config, async () =>
      Response.json({ message: privateValue }, { status }),
    );
    assert.equal(result.status, status);
    assert.equal(result.definitive, definitive);
    assert.equal(
      result.code,
      definitive ? "provider_http_rejected" : "provider_http_unavailable",
    );
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
  const result = await inspectProviderAccount(config, async () => {
    throw new Error(privateValue);
  });
  assert.equal(result.code, "provider_unavailable");
  assert.equal(result.definitive, false);
  assert.equal(result.status, undefined);
});

test("projeção de erro aceita somente códigos estáveis e status HTTP válidos", () => {
  for (const code of [
    privateValue,
    "__proto__",
    "constructor",
    "provider_ready",
  ]) {
    const error = new ProviderError(privateValue, true, 999);
    error.code = code;
    error.query = privateValue;
    error.parameters = [privateValue];
    assert.deepEqual(providerErrorDetails(error), {
      code: "provider_unavailable",
      definitive: true,
    });
  }
  assert.deepEqual(providerErrorDetails(new Error(privateValue)), {
    code: "provider_unavailable",
  });
});

test("validação anterior ao POST e conferência da order mantêm bloqueio com razão específica", async () => {
  const charge = {
    id: "11111111-1111-4111-8111-111111111111",
    mode: "test",
    amountCents: 5000,
    expirationSeconds: 86300,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const payer = {
    name: "Pessoa Exemplo",
    email: "test_payer@example.com",
    document: "12345678909",
  };
  let requests = 0;
  await assert.rejects(
    createPixOrder(config, { ...charge, amountCents: 0 }, payer, async () => {
      requests++;
      return Response.json(account);
    }),
    (e) => e.code === "provider_charge_invalid",
  );
  assert.equal(requests, 0);
  await assert.rejects(
    createPixOrder(config, charge, payer, async (url, init) => {
      requests++;
      assert.equal(init.method, "GET");
      assert.ok(url.endsWith("/users/me"));
      return Response.json({ ...account, id: 1 });
    }),
    (e) => e.code === "provider_collector_mismatch",
  );
  assert.equal(requests, 1);
  const id = "ORD01J49MMW3SSBK5PSV3DFR32959";
  const base = {
    id,
    user_id: config.collectorId,
    integration_data: { application_id: config.applicationId },
    country_code: "BRA",
    type: "online",
    processing_mode: "automatic",
  };
  for (const [extra, code] of [
    [{ id: "bad" }, "provider_order_id_invalid"],
    [{ user_id: "1" }, "provider_order_collector_mismatch"],
    [{ integration_data: {} }, "provider_application_mismatch"],
    [{ country_code: "ARG" }, "provider_order_country_mismatch"],
    [{ currency: "USD" }, "provider_order_currency_mismatch"],
    [{ live_mode: true }, "provider_order_environment_mismatch"],
    [{ processing_mode: "manual" }, "provider_order_type_mismatch"],
  ]) {
    await assert.rejects(
      fetchVerifiedOrder(config, id, async (url) =>
        Response.json(
          url.endsWith("/users/me")
            ? account
            : { ...base, ...extra, payer: privateValue },
        ),
      ),
      (e) => e.code === code && e.definitive === true,
    );
  }
});
