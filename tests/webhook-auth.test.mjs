import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  ProviderError,
  WebhookAuthError,
  verifyMercadoPagoSignature,
  webhookAuthRejection,
} from "../src/lib/billing/mercadopago.ts";

const secret = "webhook-fixture-never-a-real-credential";
const id = "ORDTST01J49MMW3SSBK5PSV3DFR32959";
const now = 1793560000000;
function signed({
  resource = id,
  requestId = "fixture-request",
  timestamp = String(now / 1000),
  key = secret,
} = {}) {
  const mac = createHmac("sha256", key)
    .update(
      `id:${resource.toLowerCase()};request-id:${requestId};ts:${timestamp};`,
    )
    .digest("hex");
  return new Request(
    `https://central.example.com/api/webhooks/mercadopago?data.id=${resource}`,
    {
      method: "POST",
      headers: {
        "x-request-id": requestId,
        "x-signature": `ts=${timestamp},v1=${mac}`,
      },
    },
  );
}
function altered(request, changes = {}, url = request.url) {
  const headers = new Headers(request.headers);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return new Request(url, { method: "POST", headers });
}
test("rejeições de HMAC têm códigos fixos e continuam negando entradas ausentes, ambíguas e adulteradas", () => {
  const req = signed();
  const invalid = [
    [
      altered(req, {}, "https://central.example.com/api/webhooks/mercadopago"),
      "webhook_data_id_missing",
    ],
    [altered(req, {}, req.url + `&data.id=${id}`), "webhook_data_id_invalid"],
    [
      altered(req, {}, req.url.replace(id, "invalid")),
      "webhook_data_id_invalid",
    ],
    [altered(req, { "x-request-id": null }), "webhook_request_id_missing"],
    [
      altered(req, { "x-request-id": "invalid/id" }),
      "webhook_request_id_invalid",
    ],
    [altered(req, { "x-signature": null }), "webhook_signature_missing"],
    [
      altered(req, { "x-signature": "x".repeat(301) }),
      "webhook_signature_invalid",
    ],
    [
      altered(req, { "x-signature": "ts=123,ts=123" }),
      "webhook_signature_invalid",
    ],
    [
      altered(req, { "x-signature": "ts=invalid,v1=" + "a".repeat(64) }),
      "webhook_timestamp_invalid",
    ],
    [
      altered(req, { "x-signature": `ts=${now / 1000},v1=invalid` }),
      "webhook_signature_invalid",
    ],
    [
      signed({ timestamp: String(now / 1000 + 301) }),
      "webhook_timestamp_future",
    ],
    [signed({ key: secret + "different" }), "webhook_signature_mismatch"],
    [altered(req, { "x-request-id": "changed" }), "webhook_signature_mismatch"],
    [
      altered(req, {}, req.url.replace("959", "958")),
      "webhook_signature_mismatch",
    ],
  ];
  for (const [request, code] of invalid) {
    let caught;
    assert.throws(() => {
      try {
        verifyMercadoPagoSignature(request, secret, now);
      } catch (e) {
        caught = e;
        throw e;
      }
    });
    assert.ok(caught instanceof ProviderError);
    assert.equal(caught.definitive, true);
    assert.deepEqual(webhookAuthRejection(caught), {
      event: "billing_webhook_auth_rejected",
      stage: "authentication",
      code,
    });
  }
});
test("assinaturas válidas conservam o ID completo e aceitam timestamps em segundos, milissegundos e reentregas antigas", () => {
  for (const timestamp of [String(now / 1000), String(now), "1700000000"])
    for (const resource of [id, id.toLowerCase(), id.replace("TST", ""), "123"])
      assert.equal(
        verifyMercadoPagoSignature(
          signed({ timestamp, resource }),
          secret,
          now,
        ),
        resource.toUpperCase(),
      );
});
test("diagnóstico de autenticação não serializa credenciais, cabeçalhos, identificadores ou erros arbitrários", () => {
  const tainted = new WebhookAuthError("webhook_signature_mismatch");
  Object.defineProperty(tainted, "authCode", {
    value: "unexpected-secret-value",
  });
  for (const error of [
    new Error(secret),
    new ProviderError(secret),
    {
      authCode: "webhook_signature_mismatch",
      headers: { Authorization: secret },
    },
    tainted,
    null,
  ]) {
    const result = webhookAuthRejection(error);
    assert.deepEqual(result, {
      event: "billing_webhook_auth_rejected",
      stage: "authentication",
      code: "webhook_auth_unavailable",
    });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(result).includes(id), false);
    assert.equal(
      JSON.stringify(result).includes("unexpected-secret-value"),
      false,
    );
  }
});
