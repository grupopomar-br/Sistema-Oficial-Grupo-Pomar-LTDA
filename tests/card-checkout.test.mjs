import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardCheckoutEnabled,
  createCardPreference,
  findCardPayments,
} from "../src/lib/billing/card.ts";
import { fetchVerifiedPayment } from "../src/lib/billing/mercadopago.ts";
import { todayDate } from "../src/lib/domain/dates.ts";
const config = {
  enabled: true,
  mode: "test",
  accessToken: "fixture-not-a-real-token",
  collectorId: "987654321",
  applicationId: "123456789",
  appUrl: "https://central.example.com",
  webhookSecret: "fixture-not-a-real-secret",
  databaseUrl: "postgres://fixture",
};
const charge = {
  id: "11111111-1111-4111-8111-111111111111",
  amountCents: 120000,
  mode: "test",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  createdAt: new Date(Date.now() - 60000).toISOString(),
};
const token = "A".repeat(43);
const paymentRaw = (extra = {}) => ({
  id: 123456789,
  collector_id: config.collectorId,
  currency_id: "BRL",
  live_mode: false,
  external_reference: charge.id,
  transaction_amount: 1200,
  transaction_amount_refunded: 0,
  status: "approved",
  date_approved: "2026-10-01T15:00:00Z",
  date_last_updated: "2026-10-01T15:01:00Z",
  payment_type_id: "credit_card",
  money_release_status: "pending",
  money_release_date: "2026-10-15T15:00:00Z",
  fee_details: [{ amount: 30 }],
  ...extra,
});
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
test("cartão começa desligado e requer confirmação específica em produção", () => {
  assert.equal(cardCheckoutEnabled({}, "test"), false);
  assert.equal(
    cardCheckoutEnabled({ POMAR_CARD_CHECKOUT_ENABLED: "true" }, "test"),
    true,
  );
  assert.equal(
    cardCheckoutEnabled({ POMAR_CARD_CHECKOUT_ENABLED: "true" }, "live"),
    false,
  );
  assert.equal(
    cardCheckoutEnabled(
      { POMAR_CARD_CHECKOUT_ENABLED: "true", POMAR_CARD_LIVE_CONFIRMED: "yes" },
      "live",
    ),
    true,
  );
});
test("preferência usa o valor armazenado, limita a 12 parcelas e valida conta, aplicação, moeda, validade e retorno", async () => {
  let posts = 0;
  const fetcher =
    (tamper = {}) =>
    async (url, options) => {
      if (url.endsWith("/users/me"))
        return json({
          id: config.collectorId,
          site_id: "MLB",
          tags: ["test_user"],
        });
      if (url.endsWith("/v1/payment_methods"))
        return json([
          { id: "visa", payment_type_id: "credit_card" },
          { id: "pix", payment_type_id: "bank_transfer" },
          { id: "boleto", payment_type_id: "ticket" },
        ]);
      assert.equal(url, "https://api.mercadopago.com/checkout/preferences");
      assert.equal(options.method, "POST");
      posts++;
      const body = JSON.parse(options.body);
      assert.equal(body.items[0].unit_price, 1200);
      assert.equal(body.payment_methods.installments, 12);
      assert.equal(
        body.payment_methods.excluded_payment_types.some(
          (t) => t.id === "credit_card",
        ),
        false,
      );
      assert.equal(
        Object.hasOwn(body, "payer"),
        false,
        "dados do cartão e do pagador são preenchidos no provedor",
      );
      return json({
        ...body,
        id: "fixture-pref",
        collector_id: config.collectorId,
        client_id: config.applicationId,
        sandbox_init_point:
          "https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=fixture-pref",
        ...tamper,
      });
    };
  const result = await createCardPreference(config, charge, token, fetcher());
  assert.equal(result.maxInstallments, 12);
  for (const tamper of [
    { collector_id: "1" },
    { client_id: "1" },
    { external_reference: crypto.randomUUID() },
    { payment_methods: { installments: 36, excluded_payment_types: [] } },
    { sandbox_init_point: "https://evil.example/?pref_id=fixture-pref" },
    { expires: false },
    {
      items: [
        { id: charge.id, unit_price: 1, quantity: 1, currency_id: "BRL" },
      ],
    },
  ])
    await assert.rejects(
      createCardPreference(config, charge, token, fetcher(tamper)),
    );
  const before = posts;
  await assert.rejects(
    createCardPreference(config, { ...charge, mode: "live" }, token, fetcher()),
  );
  assert.equal(posts, before);
});
test("cartão aprovado não vira caixa com data de aprovação ou previsão de liberação", async () => {
  for (const extra of [
    {},
    { money_release_status: null },
    {
      money_release_status: "released",
      money_release_date: new Date(Date.now() + 86400000).toISOString(),
    },
    { money_release_status: "released", money_release_date: "invalid" },
  ]) {
    const p = await fetchVerifiedPayment(config, "123456789", async () =>
      json(paymentRaw(extra)),
    );
    assert.equal(p.status, "approved");
    assert.equal(p.paidOn, null);
  }
  const p = await fetchVerifiedPayment(config, "123456789", async () =>
    json(paymentRaw({ money_release_status: "released" })),
  );
  assert.equal(p.paidOn, todayDate(new Date("2026-10-15T15:00:00Z")));
  assert.equal(p.fundsAvailable, true);
  assert.equal(p.feeCents, 3000);
});
test("retorno do cartão recupera só pagamentos da referência e não aceita busca incompleta ou valor divergente", async () => {
  const fetcher =
    (raw = paymentRaw(), total = 1) =>
    async (url) =>
      url.includes("/v1/payments/search?")
        ? json({
            paging: { total },
            results: [{ id: 123456789, external_reference: charge.id }],
          })
        : json(raw);
  assert.equal((await findCardPayments(config, charge, fetcher())).length, 1);
  await assert.rejects(
    findCardPayments(
      config,
      charge,
      fetcher(paymentRaw({ transaction_amount: 1 })),
    ),
  );
  await assert.rejects(
    findCardPayments(
      config,
      charge,
      fetcher(paymentRaw({ external_reference: crypto.randomUUID() })),
    ),
  );
  await assert.rejects(
    findCardPayments(config, charge, fetcher(paymentRaw(), 11)),
  );
});
