import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createPixOrder,
  fetchVerifiedOrder,
  fetchVerifiedTransaction,
  verifyOrderAccount,
  fetchOrderForCharge,
} from "../src/lib/billing/orders.ts";
import { verifyMercadoPagoSignature } from "../src/lib/billing/mercadopago.ts";
import {
  isOrderIdForMode,
  providerIdPattern,
} from "../src/lib/billing/provider-ids.ts";
const config = {
  enabled: true,
  mode: "test",
  collectorId: "987654321",
  applicationId: "123456789",
  accessToken: "APP_USR-fixture-not-a-credential",
  appUrl: "https://central.example.com",
};
const id = "ORD01J49MMW3SSBK5PSV3DFR32959",
  pid = "PAY01J67CQQH5904WDBVZEM4JMEP3";
const charge = {
  id: "11111111-1111-4111-8111-111111111111",
  mode: "test",
  amountCents: 10001,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  expirationSeconds: 86300,
  createdAt: new Date().toISOString(),
};
const payer = {
  name: "Pessoa Exemplo",
  email: "pagador@example.com",
  document: "19119119100",
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const code = "000201010212EXEMPLOAPENASPARATESTESNAOPAGAVEL";
const account = { id: 987654321, site_id: "MLB", tags: ["test_user"] };
function raw(extra = {}) {
  return {
    id,
    user_id: "987654321",
    integration_data: { application_id: "123456789" },
    country_code: "BRA",
    type: "online",
    processing_mode: "automatic",
    total_amount: "100.01",
    external_reference: charge.id,
    last_updated_date: "2026-10-03T15:00:00Z",
    status: "action_required",
    status_detail: "waiting_transfer",
    total_paid_amount: "0.00",
    transactions: {
      payments: [
        {
          id: pid,
          amount: "100.01",
          paid_amount: "0.00",
          status: "action_required",
          status_detail: "waiting_transfer",
          date_of_expiration: charge.expiresAt,
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            qr_code: code,
            qr_code_base64: png,
          },
        },
      ],
    },
    ...extra,
  };
}
const fetcherFor =
  (order, user = account) =>
  async (url) =>
    Response.json(url.endsWith("/users/me") ? user : order);
const approved = (extra = {}) => {
  const o = raw();
  return {
    ...o,
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: "100.01",
    transactions: {
      payments: [
        {
          ...o.transactions.payments[0],
          status: "processed",
          status_detail: "accredited",
          paid_amount: "100.01",
        },
      ],
    },
    ...extra,
  };
};

test("namespace ORDTST é preservado em criação, GET e HMAC sem aceitar formato arbitrário ou ambiente live", async () => {
  const testId = `ORDTST${id.slice(3)}`;
  assert.equal(testId.length, 32);
  assert.equal(isOrderIdForMode(testId, "test"), true);
  assert.equal(isOrderIdForMode(testId, "live"), false);
  for (const invalid of [
    `${testId}A`,
    testId.slice(0, -1),
    testId.replace("TST", "FAKE"),
    "ORDTST" + "I".repeat(26),
    testId.toLowerCase(),
    123,
  ])
    assert.equal(isOrderIdForMode(invalid, "test"), false);
  assert.equal(providerIdPattern.test("123456"), true);
  const methods = [];
  const f = async (url, init) => {
    methods.push(init.method);
    return Response.json(url.endsWith("/users/me") ? account : { id: testId });
  };
  assert.deepEqual(await createPixOrder(config, charge, payer, f), {
    orderId: testId,
  });
  assert.deepEqual(methods, ["GET", "POST"]);
  const order = raw({ id: testId });
  assert.equal(
    (await fetchVerifiedOrder(config, testId, fetcherFor(order))).payment
      .providerPaymentId,
    testId,
  );
  assert.equal(
    (await fetchVerifiedTransaction(config, testId, fetcherFor(order)))
      .providerPaymentId,
    testId,
  );
  let called = false;
  await assert.rejects(
    fetchVerifiedOrder({ ...config, mode: "live" }, testId, async () => {
      called = true;
      throw Error();
    }),
  );
  assert.equal(called, false);
  const ts = String(Math.floor(Date.now() / 1000)),
    secret = "s".repeat(40),
    requestId = "req-sandbox-order";
  const mac = createHmac("sha256", secret)
    .update(`id:${testId.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  for (const value of [testId, testId.toLowerCase()]) {
    const req = new Request(
      `https://central.example.com/api/webhooks/mercadopago?data.id=${value}`,
      {
        headers: {
          "x-signature": `ts=${ts},v1=${mac}`,
          "x-request-id": requestId,
        },
      },
    );
    assert.equal(verifyMercadoPagoSignature(req, secret), testId);
    assert.throws(() =>
      verifyMercadoPagoSignature(
        new Request(req.url.replace(/tst/i, ""), { headers: req.headers }),
        secret,
      ),
    );
  }
});

test("recuperação da order conhecida usa somente GET e exige referência, valor, conta, aplicação e ambiente", async () => {
  const testId = `ORDTST${id.slice(3)}`;
  const calls = [];
  const order = raw({
    id: testId,
    status: "processing",
    status_detail: "in_process",
    transactions: { payments: [] },
  });
  const f = async (url, init) => {
    calls.push([url, init.method]);
    return Response.json(url.endsWith("/users/me") ? account : order);
  };
  const result = await fetchOrderForCharge(config, testId, charge, f);
  assert.equal(result.payment.status, "in_process");
  assert.equal(result.qr, null);
  assert.deepEqual(
    calls.map((c) => c[1]),
    ["GET", "GET"],
  );
  assert.equal(calls[1][0], `https://api.mercadopago.com/v1/orders/${testId}`);
  for (const change of [
    { id: "22222222-2222-4222-8222-222222222222" },
    { amountCents: 9999 },
  ])
    await assert.rejects(
      fetchOrderForCharge(config, testId, { ...charge, ...change }, f),
    );
  for (const change of [
    { user_id: "123" },
    { integration_data: { application_id: "999" } },
    { live_mode: true },
    { country_code: "ARG" },
  ])
    await assert.rejects(
      fetchOrderForCharge(
        config,
        testId,
        charge,
        fetcherFor({ ...order, ...change }),
      ),
    );
});

test("Orders cria somente Pix, usa valor em string e repete exatamente o corpo/chave", async () => {
  const posts = [];
  const f = async (url, init) => {
    if (url.endsWith("/users/me")) return Response.json(account);
    assert.equal(url, "https://api.mercadopago.com/v1/orders");
    assert.equal(init.method, "POST");
    posts.push(init);
    return Response.json({ id, status: "processing" });
  };
  assert.deepEqual(await createPixOrder(config, charge, payer, f), {
    orderId: id,
  });
  await createPixOrder(config, charge, payer, f);
  assert.equal(posts[0].body, posts[1].body);
  assert.equal(
    posts[0].headers["X-Idempotency-Key"],
    posts[1].headers["X-Idempotency-Key"],
  );
  const body = JSON.parse(posts[0].body);
  assert.equal(body.total_amount, "100.01");
  assert.equal(body.transactions.payments[0].expiration_time, "PT86300S");
  assert.equal(body.expiration_time, undefined);
  assert.deepEqual(body.transactions.payments[0].payment_method, {
    id: "pix",
    type: "bank_transfer",
  });
  assert.equal(body.external_reference, charge.id);
  assert.equal(body.notification_url, undefined);
  for (const change of [
    { amountCents: 0 },
    { mode: "live" },
    { expirationSeconds: 1799 },
    { expirationSeconds: 2592001 },
  ])
    await assert.rejects(
      createPixOrder(config, { ...charge, ...change }, payer, f),
    );
});
test("Orders recusa credencial de outra conta/país/ambiente antes de criar cobrança", async () => {
  for (const user of [
    { ...account, id: 1 },
    { ...account, site_id: "MLA" },
    { ...account, tags: [] },
    { ...account, tags: undefined },
  ]) {
    let posted = false;
    await assert.rejects(
      createPixOrder(config, charge, payer, async (u) => {
        if (!u.endsWith("/users/me")) posted = true;
        return Response.json(user);
      }),
    );
    assert.equal(posted, false);
  }
  await verifyOrderAccount(
    { ...config, mode: "live" },
    fetcherFor({}, { ...account, tags: [] }),
  );
});
test("consulta Orders confere conta, aplicação, método, moeda e projeção sem dados do pagador", async () => {
  const result = await fetchVerifiedOrder(
    config,
    id,
    fetcherFor(raw({ payer: { email: payer.email } })),
  );
  assert.equal(result.payment.amountCents, 10001);
  assert.equal(result.payment.providerPaymentId, id);
  assert.equal(result.payment.mode, "test");
  assert.equal(result.qr.qrCode, code);
  assert.equal(JSON.stringify(result).includes(payer.email), false);
  for (const change of [
    { user_id: "1" },
    { id: id.replace("59", "58") },
    { integration_data: { application_id: "1" } },
    { country_code: "ARG" },
    { currency: "USD" },
    { live_mode: true },
    { total_amount: "100.001" },
    {
      transactions: {
        payments: [
          raw().transactions.payments[0],
          raw().transactions.payments[0],
        ],
      },
    },
    {
      transactions: {
        payments: [
          {
            ...raw().transactions.payments[0],
            payment_method: { id: "visa", type: "credit_card" },
          },
        ],
      },
    },
  ])
    await assert.rejects(
      fetchVerifiedOrder(config, id, fetcherFor(raw(change))),
    );
});
test("Orders assíncrona não exige QR no POST e mantém consulta da mesma order", async () => {
  const result = await fetchVerifiedOrder(
    config,
    id,
    fetcherFor(raw({ status: "processing", transactions: {} })),
  );
  assert.equal(result.payment.status, "in_process");
  assert.equal(result.qr, null);
  const noImage = raw();
  noImage.transactions.payments[0].payment_method.qr_code_base64 = "";
  assert.equal(
    (await fetchVerifiedOrder(config, id, fetcherFor(noImage))).qr.qrBase64,
    null,
  );
});
test("data de atualização não vira aprovação e devolução sem data fica incompleta", async () => {
  const r = await fetchVerifiedOrder(config, id, fetcherFor(approved()));
  assert.equal(r.payment.status, "approved");
  assert.equal(r.payment.paidOn, null);
  assert.equal(r.payment.feeCents, null);
  const o = approved();
  o.status_detail = "partially_refunded";
  o.transactions.refunds = [
    {
      id: "REF01J67CQQH5904WDBVZEM4JMEP3",
      transaction_id: pid,
      amount: "20.00",
      status: "processed",
    },
  ];
  const refund = await fetchVerifiedOrder(config, id, fetcherFor(o));
  assert.equal(refund.payment.refundedCents, 2000);
  assert.equal(refund.payment.refundsComplete, false);
  assert.deepEqual(refund.payment.refunds, []);
  o.transactions.refunds[0].created_date = "2026-10-03T01:00:00Z";
  const dated = await fetchVerifiedOrder(config, id, fetcherFor(o));
  assert.equal(dated.payment.refundsComplete, true);
  assert.equal(dated.payment.refunds[0].occurredOn, "2026-10-02");
  o.transactions.refunds.push(o.transactions.refunds[0]);
  await assert.rejects(fetchVerifiedOrder(config, id, fetcherFor(o)));
});
test("assinatura Orders usa id minúsculo no manifest; corpo/URL não provam aprovação", async () => {
  const ts = String(Math.floor(Date.now() / 1000)),
    secret = "s".repeat(40),
    requestId = "req-order-1";
  const signature = createHmac("sha256", secret)
    .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  const req = new Request(
    `https://central.example.com/api/webhooks/mercadopago?data.id=${id}&type=order`,
    {
      headers: {
        "x-signature": `ts=${ts},v1=${signature}`,
        "x-request-id": requestId,
      },
    },
  );
  assert.equal(verifyMercadoPagoSignature(req, secret), id);
  assert.throws(() =>
    verifyMercadoPagoSignature(
      new Request(req.url.replace("59", "58"), { headers: req.headers }),
      secret,
    ),
  );
  assert.throws(() =>
    verifyMercadoPagoSignature(
      new Request(req.url + "&data.id=" + id, { headers: req.headers }),
      secret,
    ),
  );
});
test("reconciliação legada continua buscando Payments somente para id numérico", async () => {
  let called = "";
  await assert.rejects(
    fetchVerifiedTransaction(config, "123", async (u) => {
      called = u;
      return Response.json({});
    }),
  );
  assert.equal(called, "https://api.mercadopago.com/v1/payments/123");
});

test("409 e timeout recuperam a order única por referência sem trocar a chave", async () => {
  for (const scenario of ["conflict", "timeout"]) {
    const methods = [];
    const f = async (url, init) => {
      methods.push(init.method);
      if (url.endsWith("/users/me")) return Response.json(account);
      if (url.includes("/search?")) {
        const q = new URL(url).searchParams;
        assert.equal(q.get("external_reference"), charge.id);
        assert.ok(q.get("begin_date"));
        return Response.json({ data: [{ id }], paging: { total: "1" } });
      }
      if (url.endsWith(`/v1/orders/${id}`)) return Response.json(raw());
      if (scenario === "timeout") throw new Error("network failure");
      return Response.json(
        { error: "idempotency_key_already_used" },
        { status: 409 },
      );
    };
    assert.deepEqual(await createPixOrder(config, charge, payer, f), {
      orderId: id,
    });
    assert.equal(methods.filter((m) => m === "POST").length, 1);
  }
  await assert.rejects(
    createPixOrder(config, charge, payer, async (url, init) => {
      if (url.endsWith("/users/me")) return Response.json(account);
      if (init.method === "POST") return Response.json({}, { status: 409 });
      return Response.json({ data: [{ id }, { id }], paging: { total: "2" } });
    }),
  );
});
