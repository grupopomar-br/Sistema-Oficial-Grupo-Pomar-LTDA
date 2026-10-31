import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyMercadoPagoSignature,
  createPreference,
  fetchVerifiedPayment,
} from "../src/lib/billing/mercadopago.ts";
import { decimalCents, isSafeCheckoutUrl } from "../src/lib/billing/safety.ts";
import { parseBillingConfig } from "../src/lib/config/billing.ts";
import { hasRecentMfa } from "../src/lib/domain/security.ts";
const ref = "abcdefghijklmnopqrst";
const env = {
  NODE_ENV: "production",
  POMAR_ENVIRONMENT: "staging",
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnop",
  NEXT_PUBLIC_APP_URL: "https://central.example.com",
  POMAR_OWNER_USER_ID: "11111111-1111-4111-8111-111111111111",
  POMAR_BILLING_ENABLED: "true",
  POMAR_PAYMENT_MODE: "test",
  POMAR_MP_ACCESS_TOKEN: "TEST-fixture-token-not-a-real-credential",
  POMAR_MP_WEBHOOK_SECRET: "webhook-fixture-secret-not-a-real-credential",
  POMAR_MP_COLLECTOR_ID: "987654321",
  POMAR_BILLING_DATABASE_URL: `postgres://pomar_billing_worker.${ref}:fixture-password@aws-0-test.pooler.supabase.com:6543/postgres`,
};
const config = parseBillingConfig(env);
test("integração começa desativada e rejeita papel administrativo, projeto errado e produção implícita", () => {
  assert.deepEqual(parseBillingConfig({}), { enabled: false });
  assert.equal(config.enabled, true);
  for (const change of [
    { POMAR_PAYMENT_MODE: "live" },
    {
      POMAR_BILLING_DATABASE_URL: `postgres://postgres.${ref}:pass@aws-0-test.pooler.supabase.com:6543/postgres`,
    },
    {
      POMAR_BILLING_DATABASE_URL: `postgres://pomar_billing_worker.outroprojeto:pass@aws-0-test.pooler.supabase.com:6543/postgres`,
    },
    {
      POMAR_BILLING_DATABASE_URL:
        env.POMAR_BILLING_DATABASE_URL + "?sslmode=disable",
    },
    { NEXT_PUBLIC_APP_URL: "http://central.example.com" },
    { POMAR_BILLING_DB_CA_BASE64: "invalid" },
  ])
    assert.throws(() => parseBillingConfig({ ...env, ...change }));
  assert.equal(
    parseBillingConfig({
      ...env,
      POMAR_ENVIRONMENT: "production",
      POMAR_PAYMENT_MODE: "live",
      POMAR_BILLING_LIVE_CONFIRMED: "yes",
    }).mode,
    "live",
  );
});
test("dinheiro do provedor é normalizado com centavos exatos e URL somente no checkout oficial", () => {
  for (const [value, expected] of [
    ["0.29", 29],
    [100.01, 10001],
    [0.1, 10],
    ["1000000000.00", 100000000000],
  ])
    assert.equal(decimalCents(value), expected);
  for (const value of [0.001, -1, NaN, "1e5", "Infinity", {}, "1000000000.01"])
    assert.throws(() => decimalCents(value));
  assert.equal(
    isSafeCheckoutUrl(
      "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=abc",
    ),
    true,
  );
  for (const value of [
    "javascript:alert(1)",
    "https://mercadopago.com.br.evil.example/checkout/?pref_id=a",
    "https://www.mercadopago.com.br:1234/checkout/?pref_id=a",
    "https://user:pass@www.mercadopago.com.br/checkout/?pref_id=a",
  ])
    assert.equal(isSafeCheckoutUrl(value), false);
});
function signed(
  id = "123",
  requestId = "request-123",
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const mac = createHmac("sha256", config.webhookSecret)
    .update(`id:${id};request-id:${requestId};ts:${timestamp};`)
    .digest("hex");
  return new Request(
    `https://central.example.com/api/webhooks/mercadopago?data.id=${id}&type=payment`,
    {
      method: "POST",
      headers: {
        "x-request-id": requestId,
        "x-signature": `ts=${timestamp},v1=${mac}`,
      },
    },
  );
}
test("assinatura HMAC vincula ID, requisição e timestamp; adulterações e ambiguidades são negadas", () => {
  const valid = signed();
  assert.equal(verifyMercadoPagoSignature(valid, config.webhookSecret), "123");
  const changed = new Request(valid.url.replace("data.id=123", "data.id=124"), {
    headers: valid.headers,
  });
  assert.throws(() =>
    verifyMercadoPagoSignature(changed, config.webhookSecret),
  );
  assert.throws(() =>
    verifyMercadoPagoSignature(
      new Request(valid.url + "&data.id=123", { headers: valid.headers }),
      config.webhookSecret,
    ),
  );
  const headers = new Headers(valid.headers);
  headers.set("x-request-id", "different");
  assert.throws(() =>
    verifyMercadoPagoSignature(
      new Request(valid.url, { headers }),
      config.webhookSecret,
    ),
  );
  assert.throws(() =>
    verifyMercadoPagoSignature(
      signed("123", "request-123", String(Math.floor(Date.now() / 1000) + 301)),
      config.webhookSecret,
    ),
  );
  // Retransmissões antigas válidas são consultadas novamente no provedor e deduplicadas no banco.
  assert.equal(
    verifyMercadoPagoSignature(
      signed("123", "request-123", "1700000000"),
      config.webhookSecret,
    ),
    "123",
  );
});
test("checkout tem valor/referência/expiração do servidor e não recebe dados de cartão", async () => {
  const charge = {
    id: "22222222-2222-4222-8222-222222222222",
    amountCents: 10001,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    mode: "test",
  };
  let payload;
  const mock = async (url, init) => {
    assert.equal(url, "https://api.mercadopago.com/checkout/preferences");
    assert.equal(init.redirect, "error");
    payload = JSON.parse(init.body);
    return Response.json({
      id: "pref-1",
      collector_id: config.collectorId,
      external_reference: charge.id,
      expires: true,
      expiration_date_to: charge.expiresAt,
      sandbox_init_point:
        "https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1",
    });
  };
  const result = await createPreference(config, charge, mock);
  assert.ok(result.checkoutUrl.includes("sandbox"));
  assert.equal(payload.items[0].unit_price, 100.01);
  assert.equal(payload.items[0].quantity, 1);
  assert.equal(payload.external_reference, charge.id);
  assert.equal(payload.expires, true);
  assert.equal(payload.payer, undefined);
  assert.equal(payload.card, undefined);
  assert.ok(
    payload.notification_url.startsWith("https://central.example.com/"),
  );
  await assert.rejects(
    createPreference(config, { ...charge, mode: "live" }, mock),
    /Ambiente/,
  );
  const evil = async () =>
    Response.json({
      id: "pref-1",
      collector_id: "different",
      external_reference: charge.id,
      expires: true,
      expiration_date_to: charge.expiresAt,
      sandbox_init_point: "https://evil.example/",
    });
  await assert.rejects(createPreference(config, charge, evil));
});
function raw(extra = {}) {
  return {
    id: 123,
    collector_id: 987654321,
    currency_id: "BRL",
    live_mode: false,
    transaction_amount: 100.01,
    transaction_amount_refunded: 0,
    date_approved: "2026-10-01T15:00:00Z",
    date_last_updated: "2026-10-02T15:00:00Z",
    status: "approved",
    external_reference: "22222222-2222-4222-8222-222222222222",
    fee_details: [{ amount: 3 }],
    payer: { email: "must-not-be-stored@example.com" },
    ...extra,
  };
}
test("consulta autenticada verifica conta, moeda, ambiente e preserva apenas os campos necessários", async () => {
  const payment = await fetchVerifiedPayment(
    config,
    "123",
    async (url, init) => {
      assert.ok(url.endsWith("/v1/payments/123"));
      assert.ok(init.headers.Authorization.startsWith("Bearer "));
      return Response.json(raw());
    },
  );
  assert.equal(payment.amountCents, 10001);
  assert.equal(payment.feeCents, 300);
  assert.equal(payment.payer, undefined);
  assert.equal(JSON.stringify(payment).includes("must-not-be-stored"), false);
  for (const change of [
    { collector_id: 1 },
    { currency_id: "USD" },
    { live_mode: true },
    { id: 124 },
    { transaction_amount: 0.001 },
  ])
    await assert.rejects(
      fetchVerifiedPayment(config, "123", async () =>
        Response.json(raw(change)),
      ),
    );
});
test("devoluções aprovadas são consultadas e somadas sem usar o conteúdo do webhook como verdade", async () => {
  const result = await fetchVerifiedPayment(config, "123", async (url) =>
    url.endsWith("/refunds")
      ? Response.json([
          {
            id: 456,
            payment_id: 123,
            amount: 20,
            status: "approved",
            date_created: "2026-10-03T01:00:00Z",
          },
        ])
      : Response.json(raw({ transaction_amount_refunded: 20 })),
  );
  assert.equal(result.refundsComplete, true);
  assert.equal(result.refunds[0].occurredOn, "2026-10-02");
  assert.equal(result.refundedCents, 2000);
});
test("segunda confirmação do autenticador tem janela limitada e não aceita timestamps futuros", () => {
  const now = Date.now(),
    ts = Math.floor(now / 1000);
  assert.equal(
    hasRecentMfa(
      { aal: "aal2", amr: [{ method: "totp", timestamp: ts }] },
      now,
    ),
    true,
  );
  for (const claims of [
    { aal: "aal1", amr: [{ method: "totp", timestamp: ts }] },
    { aal: "aal2", amr: [{ method: "password", timestamp: ts }] },
    { aal: "aal2", amr: [{ method: "totp", timestamp: ts - 301 }] },
    { aal: "aal2", amr: [{ method: "totp", timestamp: ts + 31 }] },
    { aal: "aal2", amr: "bad" },
  ])
    assert.equal(hasRecentMfa(claims, now), false);
});
