import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingConfigurationFailure,
  inspectBillingReadiness,
} from "../src/lib/billing/readiness.ts";

const configured = () => ({
  ownerStatus: async () => ({
    data: { configured: true, mode: "test" },
    error: null,
  }),
  workerReady: async () => true,
  pixReady: async () => true,
});

test("prontidão exige cadastro, ambiente, worker e versão Pix conferidos", async () => {
  const status = await inspectBillingReadiness("test", configured());
  assert.equal(status.enabled, true);
  assert.equal(status.mode, "test");
  assert.equal(status.code, "ready");
  for (const [checks, expected] of [
    [{ workerReady: async () => false }, "worker_configuration_mismatch"],
    [{ pixReady: async () => false }, "pix_migration_pending"],
  ]) {
    const result = await inspectBillingReadiness("test", {
      ...configured(),
      ...checks,
    });
    assert.equal(result.enabled, false);
    assert.equal(result.code, expected);
  }
});

test("cadastro ou ambiente inválido impede acessar o worker", async () => {
  for (const [data, error, expected] of [
    [null, { message: "privado" }, "database_status_unavailable"],
    [null, null, "database_configuration_pending"],
    [{ configured: true, mode: "live" }, null, "payment_mode_mismatch"],
    [
      { configured: "true", mode: "test" },
      null,
      "database_configuration_pending",
    ],
  ]) {
    const status = await inspectBillingReadiness("test", {
      ownerStatus: async () => ({ data, error }),
      workerReady: () => assert.fail("worker não deve ser consultado"),
      pixReady: () => assert.fail("Pix não deve ser consultado"),
    });
    assert.equal(status.enabled, false);
    assert.equal(status.code, expected);
  }
});

test("falhas de certificado, autenticação, permissão e rede têm diagnóstico sem segredos", async () => {
  const privateValue = "SENSITIVE_CONNECTION_VALUE_MUST_NOT_APPEAR";
  for (const [driverCode, expected] of [
    ["SELF_SIGNED_CERT_IN_CHAIN", "worker_certificate_untrusted"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "worker_certificate_untrusted"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "worker_certificate_invalid"],
    ["CERT_HAS_EXPIRED", "worker_certificate_invalid"],
    ["28P01", "worker_authentication_failed"],
    ["28000", "worker_authentication_failed"],
    ["42501", "worker_permission_denied"],
    ["42883", "worker_schema_missing"],
    ["ENOTFOUND", "worker_network_unavailable"],
    ["CONNECT_TIMEOUT", "worker_network_unavailable"],
    [privateValue, "worker_unavailable"],
    ["toString", "worker_unavailable"],
  ]) {
    const status = await inspectBillingReadiness("test", {
      ...configured(),
      workerReady: async () => {
        throw {
          code: driverCode,
          message: privateValue,
          detail: privateValue,
          query: privateValue,
          connection: { password: privateValue },
        };
      },
      pixReady: () => assert.fail("Pix não deve ser consultado após falha"),
    });
    assert.equal(status.enabled, false);
    assert.equal(status.code, expected);
    assert.ok(!JSON.stringify(status).includes(privateValue));
  }
});

test("causa encadeada é reconhecida e causa cíclica permanece limitada", async () => {
  const cause = { code: "DEPTH_ZERO_SELF_SIGNED_CERT" };
  const status = await inspectBillingReadiness("test", {
    ...configured(),
    workerReady: async () => {
      throw new Error("texto privado", { cause });
    },
  });
  assert.equal(status.code, "worker_certificate_untrusted");
  const cycle = { message: "texto privado" };
  cycle.cause = cycle;
  const unknown = await inspectBillingReadiness("test", {
    ...configured(),
    workerReady: async () => {
      throw cycle;
    },
  });
  assert.equal(unknown.code, "worker_unavailable");
  assert.ok(!JSON.stringify(unknown).includes("texto privado"));
});

test("falha da sessão e falha das funções Pix não viram conexão pronta", async () => {
  const owner = await inspectBillingReadiness("test", {
    ...configured(),
    ownerStatus: async () => {
      throw new Error("detalhe privado");
    },
    workerReady: () => assert.fail("worker não deve ser consultado"),
  });
  assert.equal(owner.code, "database_status_unavailable");
  const pix = await inspectBillingReadiness("test", {
    ...configured(),
    pixReady: async () => {
      throw { code: "42501", message: "detalhe privado" };
    },
  });
  assert.equal(pix.code, "worker_permission_denied");
  assert.equal(pix.enabled, false);
});

test("configuração projeta somente nomes conhecidos, nunca valores", () => {
  const result = billingConfigurationFailure([
    "POMAR_BILLING_DATABASE_URL",
    "POMAR_MP_WEBHOOK_SECRET",
    "POMAR_BILLING_DATABASE_URL",
    "PRIVATE_VALUE_MUST_NOT_APPEAR",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]);
  assert.deepEqual(result.fields, [
    "POMAR_BILLING_DATABASE_URL",
    "POMAR_MP_WEBHOOK_SECRET",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]);
  assert.equal(result.enabled, false);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_VALUE_MUST_NOT_APPEAR"));
});
