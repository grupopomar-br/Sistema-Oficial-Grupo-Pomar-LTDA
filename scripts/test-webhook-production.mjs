import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { once } from "node:events";
const port = 3198;
const ref = "abcdefghijklmnopqrst";
const secret = "webhook-fixture-never-a-real-credential";
const resource = "ORDTST01J49MMW3SSBK5PSV3DFR32959";
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      POMAR_ENVIRONMENT: "staging",
      NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnop",
      NEXT_PUBLIC_APP_URL: "https://central.example.com",
      POMAR_OWNER_USER_ID: "11111111-1111-4111-8111-111111111111",
      POMAR_BILLING_ENABLED: "true",
      POMAR_PAYMENT_MODE: "test",
      POMAR_MP_ACCESS_TOKEN: "TEST-fixture-token-not-a-real-credential",
      POMAR_MP_WEBHOOK_SECRET: secret,
      POMAR_MP_COLLECTOR_ID: "987654321",
      POMAR_MP_APPLICATION_ID: "123456789",
      POMAR_BILLING_DATABASE_URL: `postgres://pomar_billing_worker.${ref}:fixture-password@aws-0-test.pooler.supabase.com:6543/postgres`,
      POMAR_BILLING_DB_CA_BASE64: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
child.stdout.on("data", (chunk) => (logs += chunk));
child.stderr.on("data", (chunk) => (logs += chunk));
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Servidor do webhook não iniciou.")),
      15000,
    );
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(logs));
    });
  });
  const cases = [
    ["", {}, "webhook_data_id_missing"],
    [
      `?data.id=${resource}`,
      { "x-request-id": "fixture-request" },
      "webhook_signature_missing",
    ],
    [
      `?data.id=${resource}`,
      {
        "x-request-id": "fixture-request",
        "x-signature": `ts=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
      },
      "webhook_signature_mismatch",
    ],
  ];
  for (const [query, headers, code] of cases) {
    const before = logs.length;
    const response = await fetch(origin + "/api/webhooks/mercadopago" + query, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: "not-json",
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { received: false });
    assert.ok(response.headers.get("cache-control").includes("no-store"));
    // Invalid authentication is rejected before parsing the body or reaching provider/database.
    const expected = {
      event: "billing_webhook_auth_rejected",
      stage: "authentication",
      code,
    };
    for (
      let attempt = 0;
      attempt < 20 && !logs.slice(before).includes(JSON.stringify(expected));
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    const records = logs
      .slice(before)
      .split("\n")
      .flatMap((line) => {
        try {
          const item = JSON.parse(line);
          return item.event === "billing_webhook_auth_rejected" ? [item] : [];
        } catch {
          return [];
        }
      });
    assert.deepEqual(records, [expected]);
    for (const record of records) {
      const serialized = JSON.stringify(record);
      assert.ok(!serialized.includes(secret));
      assert.ok(!serialized.includes(resource));
      assert.ok(!serialized.includes("not-json"));
      assert.ok(!serialized.includes("0".repeat(64)));
    }
  }
  console.log(
    "Webhook configurado: 401 público genérico, rejeição anterior ao corpo e logs com códigos fixos sem valores privados.",
  );
} finally {
  child.kill("SIGTERM");
  await once(child, "exit").catch(() => {});
}
