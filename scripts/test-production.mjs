import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { once } from "node:events";
const port = 3197,
  origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  POMAR_ENVIRONMENT: "production",
  POMAR_BILLING_ENABLED: "false",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  POMAR_OWNER_USER_ID: "",
  NEXT_PUBLIC_APP_URL: "",
};
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
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
child.stdout.on("data", (chunk) => (logs += chunk));
child.stderr.on("data", (chunk) => (logs += chunk));
try {
  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error("Servidor não iniciou.")),
      15000,
    );
    const check = (chunk) => {
      if (String(chunk).includes("Ready")) {
        clearTimeout(deadline);
        resolve();
      }
    };
    child.stdout.on("data", check);
    child.on("exit", () => {
      clearTimeout(deadline);
      reject(new Error(logs));
    });
  });
  await ready;
  const root = await fetch(origin);
  assert.equal(root.status, 200);
  assert.ok((await root.text()).includes("Acesso em configuração."));
  const local = await fetch(`${origin}/local`);
  assert.equal(local.status, 404);
  const get = await fetch(`${origin}/api/workspace`);
  assert.equal(get.status, 503);
  assert.equal((await get.json()).workspace, undefined);
  const post = await fetch(`${origin}/api/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: "{}",
  });
  assert.equal(post.status, 503);
  for (const path of [
    "/api/billing/charges",
    "/api/billing/reconcile",
    "/api/session",
    "/api/webhooks/mercadopago",
  ]) {
    const response = await fetch(origin + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: "{}",
    });
    assert.equal(response.status, 503, path);
  }
  const status = await fetch(origin + "/api/billing/status");
  assert.equal(status.status, 503);
  const callback = await fetch(
    origin + "/pagamento/retorno?status=approved&payment_id=123",
  );
  assert.equal(callback.status, 200);
  assert.ok((await callback.text()).includes("não altera o estado financeiro"));
  const csp = root.headers.get("content-security-policy");
  assert.ok(csp.includes("'strict-dynamic'"));
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(root.headers.get("cache-control").includes("no-store"));
  assert.equal(root.headers.get("x-frame-options"), "DENY");
  const next = await fetch(origin);
  assert.notEqual(
    csp.match(/nonce-([^']+)/)[1],
    next.headers.get("content-security-policy").match(/nonce-([^']+)/)[1],
  );
  console.log(
    "Produção sem configuração: /local=404; APIs, cobrança e webhook sem credenciais=503; retorno não confirma pagamento; CSP com nonce único e cache privado.",
  );
} finally {
  child.kill("SIGTERM");
  await once(child, "exit").catch(() => {});
}
