import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createPixPayment } from "../src/lib/billing/mercadopago.ts";
import { pixPayerSchema, validTaxId } from "../src/lib/billing/pix-contract.ts";
import { isSafePomarCheckoutUrl } from "../src/lib/billing/safety.ts";
import { parseWorkspace } from "../src/lib/domain/workspace.ts";
import { camelize } from "../src/lib/domain/transport.ts";
import { todayDate } from "../src/lib/domain/dates.ts";

const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const session = crypto.randomUUID(),
  client = crypto.randomUUID(),
  contract = crypto.randomUUID(),
  part = crypto.randomUUID();
const chargeId = crypto.randomUUID(),
  token = randomBytes(32).toString("base64url"),
  hash = createHash("sha256").update(token).digest("hex");
const url = `https://central.example.com/pagar/${token}`;
const config = {
  enabled: true,
  mode: "test",
  collectorId: "987654321",
  accessToken: "TEST-fixture-not-real",
  appUrl: "https://central.example.com",
};
const payer = {
  name: "Pessoa Exemplo",
  email: "pagador@example.com",
  document: "19119119100",
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const pixCode = "000201010212EXEMPLOAPENASPARATESTESNAOPAGAVEL";
let db;
async function admin() {
  await db.exec("set session authorization postgres;reset role");
}
async function actor(uid = owner) {
  await admin();
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [
      uid,
      JSON.stringify({
        sub: uid,
        aal: "aal2",
        session_id: session,
        amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }],
      }),
    ],
  );
  await db.exec("set role authenticated");
}
async function worker() {
  await admin();
  await db.exec(
    "select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false);set session authorization pomar_billing_worker",
  );
}
async function read() {
  return (
    await db.query("select pomar_private.pix_checkout_read($1) v", [hash])
  ).rows[0].v;
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),not_after timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
  insert into auth.users values('${owner}'),('${other}');insert into auth.sessions(id,user_id) values('${session}','${owner}');`);
  for (const f of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(`insert into pomar_private.owner_registry values(true,'${owner}',true);insert into pomar_settings(owner_id,id,business_name,display_name) values('${owner}','${owner}','Exemplo','Proprietário');
  begin;insert into pomar_clients(id,owner_id,name,kind,status) values('${client}','${owner}','Cliente privado','business','active');
  insert into pomar_contracts(id,owner_id,title,client_id,total_cents,signed_on,status) values('${contract}','${owner}','Contrato privado','${client}',10001,current_date,'active');
  insert into pomar_installments(id,owner_id,contract_id,sequence,amount_cents,due_on) values('${part}','${owner}','${contract}',1,10001,current_date);commit;
  insert into pomar_private.billing_config values(true,'${owner}','987654321','test',true);`);
});
after(async () => await db?.close());

test("pagador valida CPF/CNPJ sem aceitar valores monetários ou documentos inválidos", () => {
  assert.ok(validTaxId("191.191.191-00"));
  assert.ok(validTaxId("11.222.333/0001-81"));
  for (const value of [
    "11111111111",
    "00000000000000",
    "19119119101",
    "abc19119119100",
  ])
    assert.equal(validTaxId(value), false);
  assert.deepEqual(
    pixPayerSchema.parse({
      ...payer,
      document: "191.191.191-00",
      email: "  PAGADOR@example.com ",
    }),
    payer,
  );
  assert.throws(() => pixPayerSchema.parse({ ...payer, amountCents: 1 }));
  assert.equal(isSafePomarCheckoutUrl(url, config.appUrl), true);
  for (const u of [
    url + "?amount=1",
    url + "#a",
    url.replace("central.example.com", "evil.example"),
    url.replace("https:", "http:"),
  ])
    assert.equal(isSafePomarCheckoutUrl(u, config.appUrl), false);
});
test("Pix usa centavos, referência e validade do servidor; repetições mantêm a mesma chave", async () => {
  const charge = {
    id: chargeId,
    mode: "test",
    amountCents: 10001,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const requests = [];
  const raw = {
    id: 123,
    collector_id: 987654321,
    live_mode: false,
    currency_id: "BRL",
    payment_method_id: "pix",
    external_reference: chargeId,
    transaction_amount: 100.01,
    date_of_expiration: charge.expiresAt,
    point_of_interaction: {
      transaction_data: { qr_code: pixCode, qr_code_base64: png },
    },
  };
  const fetcher = async (u, init) => {
    assert.equal(u, "https://api.mercadopago.com/v1/payments");
    requests.push(init);
    return Response.json(raw);
  };
  await createPixPayment(config, charge, payer, fetcher);
  await createPixPayment(config, charge, payer, fetcher);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(
    requests[0].headers["X-Idempotency-Key"],
    `pomar-pix-${chargeId}`,
  );
  const body = JSON.parse(requests[0].body);
  assert.equal(body.transaction_amount, 100.01);
  assert.equal(body.external_reference, chargeId);
  assert.equal(body.payment_method_id, "pix");
  assert.equal(body.payer.identification.type, "CPF");
  for (const change of [
    { collector_id: 1 },
    { live_mode: true },
    { transaction_amount: 100 },
    { external_reference: crypto.randomUUID() },
    { payment_method_id: "credit_card" },
    {
      point_of_interaction: {
        transaction_data: {
          qr_code: pixCode,
          qr_code_base64: "data:image/svg+xml,<svg>",
        },
      },
    },
  ])
    await assert.rejects(
      createPixPayment(config, charge, payer, async () =>
        Response.json({ ...raw, ...change }),
      ),
    );
  await assert.rejects(
    createPixPayment(
      config,
      { ...charge, expiresAt: new Date(Date.now() + 60000).toISOString() },
      payer,
      fetcher,
    ),
  );
});
test("checkout privado não concede leitura nem RPCs públicos a anon ou outro usuário", async () => {
  await actor();
  assert.equal(
    (await db.query("select pomar_touch_session() s")).rows[0].s,
    "granted",
  );
  await db.query("select pomar_prepare_charge($1,$2,24)", [chargeId, part]);
  for (const role of ["anon", "authenticated"]) {
    await admin();
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select pomar_private.pix_checkout_read($1)", [hash]),
      /permission denied|POMAR_WORKER_ACCESS/,
    );
    await assert.rejects(
      db.exec("select * from pomar_private.pix_checkouts"),
      /permission denied/,
    );
  }
  await worker();
  await assert.rejects(
    db.exec("select * from public.pomar_clients"),
    /permission denied/,
  );
  await assert.rejects(
    db.query(
      "select pomar_private.pix_checkout_create($1,$2,$3,'987654321','live')",
      [chargeId, hash, url],
    ),
    /POMAR_WORKER_ACCESS/,
  );
  await db.query(
    "select pomar_private.pix_checkout_create($1,$2,$3,'987654321','test')",
    [chargeId, hash, url],
  );
  const view = await read();
  assert.equal(view.status, "ready");
  assert.equal(view.amount_cents, 10001);
  assert.equal(view.qr_code, null);
  assert.equal(JSON.stringify(view).includes("Cliente privado"), false);
  assert.equal(JSON.stringify(view).includes("Contrato privado"), false);
  assert.equal(view.payer, undefined);
  assert.equal(
    (
      await db.query("select pomar_private.pix_checkout_read($1) v", [
        "f".repeat(64),
      ])
    ).rows[0].v,
    null,
  );
  await actor(other);
  assert.equal(
    (await db.query("select count(*) n from pomar_charges")).rows[0].n,
    0,
  );
});
test("tentativa incerta mantém o pagador original e limita repetições antes de gerar outro Pix", async () => {
  await worker();
  let v = (
    await db.query("select pomar_private.pix_checkout_begin($1,$2::jsonb) v", [
      hash,
      JSON.stringify(payer),
    ])
  ).rows[0].v;
  assert.equal(v.create, true);
  assert.equal(v.payer.email, payer.email);
  await assert.rejects(
    db.query("select pomar_private.pix_checkout_begin($1,$2::jsonb)", [
      hash,
      JSON.stringify(payer),
    ]),
    /POMAR_PIX_BUSY/,
  );
  await admin();
  await db.query(
    "update pomar_private.pix_checkouts set next_attempt_at=now()-interval '1 minute' where token_hash=$1",
    [hash],
  );
  await worker();
  v = (
    await db.query("select pomar_private.pix_checkout_begin($1,$2::jsonb) v", [
      hash,
      JSON.stringify({ ...payer, email: "alterado@example.com" }),
    ])
  ).rows[0].v;
  assert.equal(v.payer.email, payer.email);
  await db.query(
    "select pomar_private.pix_checkout_attach($1,'123',$2,$3,$4)",
    [hash, pixCode, png, v.expires_at],
  );
  assert.equal((await read()).status, "pending");
  await admin();
  assert.equal(
    (
      await db.query(
        "select payer from pomar_private.pix_checkouts where token_hash=$1",
        [hash],
      )
    ).rows[0].payer,
    null,
  );
  await worker();
  assert.equal(
    (
      await db.query(
        "select pomar_private.pix_checkout_begin($1,$2::jsonb) v",
        [hash, JSON.stringify(payer)],
      )
    ).rows[0].v.create,
    false,
  );
  assert.equal(
    (await db.query("select pomar_private.pix_checkout_refresh($1) v", [hash]))
      .rows[0].v,
    "123",
  );
  assert.equal(
    (await db.query("select pomar_private.pix_checkout_refresh($1) v", [hash]))
      .rows[0].v,
    null,
  );
});
test("Pix de teste aprovado não entra no caixa; repetição e retorno do cliente não criam recibo", async () => {
  const event = {
    provider_payment_id: "123",
    external_reference: chargeId,
    collector_id: "987654321",
    mode: "test",
    amount_cents: 10001,
    refunded_cents: 0,
    currency: "BRL",
    status: "approved",
    paid_on: todayDate(),
    provider_updated_at: new Date().toISOString(),
    refunds: [],
    refunds_complete: true,
  };
  await worker();
  await db.query("select pomar_billing_apply_payment($1::jsonb)", [
    JSON.stringify(event),
  ]);
  await db.query("select pomar_billing_apply_payment($1::jsonb)", [
    JSON.stringify(event),
  ]);
  assert.equal((await read()).status, "paid");
  assert.equal((await read()).qr_code, null);
  await actor();
  const snapshot = parseWorkspace(
    camelize((await db.query("select pomar_workspace() v")).rows[0].v),
  );
  assert.equal(snapshot.receipts.length, 0);
  assert.equal(snapshot.charges[0].checkoutUrl, url);
  await admin();
  await db.exec("update pomar_private.billing_config set enabled=false");
  await worker();
  assert.equal(await read(), null);
});

test("Pix live confirmado gera uma baixa única e o link pago nunca volta a oferecer QR", async () => {
  const c = crypto.randomUUID(),
    i = crypto.randomUUID(),
    charge = crypto.randomUUID(),
    t = randomBytes(32).toString("base64url"),
    h = createHash("sha256").update(t).digest("hex");
  await admin();
  await db.exec(`update pomar_private.billing_config set enabled=true,mode='live';begin;
 insert into pomar_contracts(id,owner_id,title,client_id,total_cents,signed_on,status) values('${c}','${owner}','Outro contrato privado','${client}',10001,current_date,'active');
 insert into pomar_installments(id,owner_id,contract_id,sequence,amount_cents,due_on) values('${i}','${owner}','${c}',1,10001,current_date);commit;`);
  await actor();
  await db.query("select pomar_prepare_charge($1,$2,24)", [charge, i]);
  await worker();
  await db.query(
    "select pomar_private.pix_checkout_create($1,$2,$3,'987654321','live')",
    [charge, h, `https://central.example.com/pagar/${t}`],
  );
  const begin = (
    await db.query("select pomar_private.pix_checkout_begin($1,$2::jsonb) v", [
      h,
      JSON.stringify(payer),
    ])
  ).rows[0].v;
  await db.query(
    "select pomar_private.pix_checkout_attach($1,'456',$2,$3,$4)",
    [h, pixCode, png, begin.expires_at],
  );
  assert.equal(
    (await db.query("select pomar_private.pix_checkout_read($1) v", [h]))
      .rows[0].v.status,
    "pending",
  );
  const event = {
    provider_payment_id: "456",
    external_reference: charge,
    collector_id: "987654321",
    mode: "live",
    amount_cents: 10001,
    refunded_cents: 0,
    currency: "BRL",
    status: "approved",
    paid_on: todayDate(),
    provider_updated_at: new Date().toISOString(),
    refunds: [],
    refunds_complete: true,
  };
  await db.query("select pomar_billing_apply_payment($1::jsonb)", [
    JSON.stringify(event),
  ]);
  await db.query("select pomar_billing_apply_payment($1::jsonb)", [
    JSON.stringify(event),
  ]);
  const view = (
    await db.query("select pomar_private.pix_checkout_read($1) v", [h])
  ).rows[0].v;
  assert.equal(view.status, "paid");
  assert.equal(view.qr_code, null);
  await actor();
  const state = parseWorkspace(
    camelize((await db.query("select pomar_workspace() v")).rows[0].v),
  );
  assert.equal(state.receipts.length, 1);
  assert.equal(state.receipts[0].amountCents, 10001);
});

test("Orders conserva ID antes do QR, retoma a mesma order e exige data confirmada para o caixa", async () => {
  const c = crypto.randomUUID(),
    i = crypto.randomUUID(),
    charge = crypto.randomUUID();
  const t = randomBytes(32).toString("base64url"),
    h = createHash("sha256").update(t).digest("hex");
  const oid = "ORD01J49MMW3SSBK5PSV3DFR32959";
  await admin();
  await db.exec(`begin;
 insert into pomar_contracts(id,owner_id,title,client_id,total_cents,signed_on,status) values('${c}','${owner}','Contrato Orders de teste','${client}',10001,current_date,'active');
 insert into pomar_installments(id,owner_id,contract_id,sequence,amount_cents,due_on) values('${i}','${owner}','${c}',1,10001,current_date);commit;`);
  await actor();
  await db.query("select pomar_prepare_charge($1,$2,24)", [charge, i]);
  await worker();
  assert.equal(
    (await db.query("select pomar_private.pix_checkout_capabilities() v"))
      .rows[0].v,
    2,
  );
  await db.query(
    "select pomar_private.pix_checkout_create($1,$2,$3,'987654321','live')",
    [charge, h, `https://central.example.com/pagar/${t}`],
  );
  const begin = (
    await db.query("select pomar_private.pix_checkout_begin($1,$2::jsonb) v", [
      h,
      JSON.stringify(payer),
    ])
  ).rows[0].v;
  assert.ok(begin.expiration_seconds >= 1800);
  await admin();
  await db.query(
    "update pomar_private.pix_checkouts set next_attempt_at=now()-interval '1 minute' where token_hash=$1",
    [h],
  );
  await worker();
  const again = (
    await db.query("select pomar_private.pix_checkout_begin($1,$2::jsonb) v", [
      h,
      JSON.stringify({ ...payer, email: "changed@example.com" }),
    ])
  ).rows[0].v;
  assert.equal(again.expiration_seconds, begin.expiration_seconds);
  assert.equal(again.payer.email, payer.email);
  await db.query("select pomar_private.pix_checkout_order($1,$2)", [h, oid]);
  let v = (await db.query("select pomar_private.pix_checkout_read($1) v", [h]))
    .rows[0].v;
  assert.equal(v.status, "processing");
  assert.equal(
    (
      await db.query(
        "select pomar_private.pix_checkout_begin($1,$2::jsonb) v",
        [h, JSON.stringify(payer)],
      )
    ).rows[0].v.create,
    false,
  );
  await assert.rejects(
    db.query("select pomar_private.pix_checkout_order($1,$2)", [
      h,
      "ORD01J49MMW3SSBK5PSV3DFR32958",
    ]),
    /POMAR_BAD_COMMAND/,
  );
  await db.query(
    "select pomar_private.pix_checkout_order_qr($1,$2,$3,null,$4)",
    [h, oid, pixCode, begin.expires_at],
  );
  assert.equal(
    (await db.query("select pomar_private.pix_checkout_read($1) v", [h]))
      .rows[0].v.status,
    "pending",
  );
  const event = {
    provider_payment_id: oid,
    external_reference: charge,
    collector_id: "987654321",
    mode: "live",
    amount_cents: 10001,
    refunded_cents: 0,
    currency: "BRL",
    status: "approved",
    paid_on: null,
    provider_updated_at: new Date().toISOString(),
    refunds: [],
    refunds_complete: true,
  };
  let r = (
    await db.query("select pomar_billing_apply_payment($1::jsonb) v", [
      JSON.stringify(event),
    ])
  ).rows[0].v;
  assert.equal(r.review, true);
  v = (await db.query("select pomar_private.pix_checkout_read($1) v", [h]))
    .rows[0].v;
  assert.equal(v.status, "paid");
  assert.equal(v.qr_code, null);
  await actor();
  let state = parseWorkspace(
    camelize((await db.query("select pomar_workspace() v")).rows[0].v),
  );
  assert.equal(state.receipts.length, 1); // only the previous legacy test receipt
  assert.equal(
    state.providerPayments.find((p) => p.providerPaymentId === oid).receiptId,
    null,
  );
  await worker();
  const confirmed = {
    ...event,
    paid_on: todayDate(),
    owner_confirmed_by: owner,
  };
  await assert.rejects(
    db.query("select pomar_billing_apply_payment($1::jsonb)", [
      JSON.stringify({ ...confirmed, owner_confirmed_by: other }),
    ]),
    /POMAR_DATE_CONFIRMATION/,
  );
  await assert.rejects(
    db.query("select pomar_billing_apply_payment($1::jsonb)", [
      JSON.stringify({ ...confirmed, paid_on: "2000-01-01" }),
    ]),
    /POMAR_DATE_CONFIRMATION/,
  );
  await db.query("select pomar_billing_apply_payment($1::jsonb)", [
    JSON.stringify(confirmed),
  ]);
  await db.query("select pomar_billing_apply_payment($1::jsonb)", [
    JSON.stringify(confirmed),
  ]);
  await actor();
  state = parseWorkspace(
    camelize((await db.query("select pomar_workspace() v")).rows[0].v),
  );
  assert.equal(state.receipts.length, 2);
  const paid = state.providerPayments.find((p) => p.providerPaymentId === oid);
  assert.ok(paid.receiptId);
  assert.equal(paid.paidOn, todayDate());
  // A later refund snapshot without approval dates preserves the original day.
  await worker();
  await db.query("select pomar_billing_apply_payment($1::jsonb)", [
    JSON.stringify({
      ...event,
      refunded_cents: 2000,
      provider_updated_at: new Date(Date.now() + 1000).toISOString(),
      refunds_complete: false,
    }),
  ]);
  await actor();
  state = parseWorkspace(
    camelize((await db.query("select pomar_workspace() v")).rows[0].v),
  );
  assert.equal(
    state.providerPayments.find((p) => p.providerPaymentId === oid).paidOn,
    todayDate(),
  );
  assert.match(
    state.providerPayments.find((p) => p.providerPaymentId === oid)
      .reviewReason,
    /Devolução/,
  );
  assert.equal(state.refunds.length, 0);
});
