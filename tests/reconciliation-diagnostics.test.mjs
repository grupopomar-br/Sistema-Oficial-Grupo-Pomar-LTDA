import { test } from "node:test";
import assert from "node:assert/strict";
import { reconciliationStorageFailure } from "../src/lib/billing/reconciliation-diagnostics.ts";

test("conciliação distingue recusa da data e preserva o diagnóstico SQLSTATE", () => {
  const result = reconciliationStorageFailure({
    message: "POMAR_DATE_CONFIRMATION",
    code: "42501",
  });
  assert.equal(result.code, "reconciliation_date_rejected");
  assert.equal(result.status, 409);
  assert.equal(result.database_code, "42501");
});

test("diagnóstico de conciliação não divulga mensagens, parâmetros ou credenciais", () => {
  const secret = "fixture-private-connection-and-payer";
  const result = reconciliationStorageFailure({
    message: secret,
    code: "23514",
    query: secret,
    parameters: [secret],
    detail: secret,
    cause: new Error(secret),
  });
  assert.equal(result.code, "reconciliation_storage_failed");
  assert.equal(result.status, 503);
  assert.equal(result.database_code, "23514");
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(Object.keys(result).sort(), [
    "code",
    "database_code",
    "message",
    "status",
  ]);
});

test("razões conhecidas exigem correspondência exata e códigos desconhecidos são omitidos", () => {
  for (const message of [
    "POMAR_DATE_CONFIRMATION: private",
    "toString",
    "__proto__",
  ]) {
    const result = reconciliationStorageFailure({
      message,
      code: "private-code",
    });
    assert.equal(result.code, "reconciliation_storage_failed");
    assert.equal(Object.hasOwn(result, "database_code"), false);
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
  for (const error of [null, undefined, "private-error", 42])
    assert.equal(reconciliationStorageFailure(error).status, 503);
});

test("alteração de pagamento e configuração recusada não são confundidas com MFA", () => {
  assert.equal(
    reconciliationStorageFailure({ message: "POMAR_PAYMENT_CHANGED" }).status,
    409,
  );
  assert.equal(
    reconciliationStorageFailure({ message: "POMAR_WORKER_ACCESS" }).status,
    503,
  );
  assert.equal(
    reconciliationStorageFailure({ message: "POMAR_BAD_COMMAND" }).status,
    400,
  );
});
