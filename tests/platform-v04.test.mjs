import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  parseWorkspace,
  installmentRemaining,
} from "../src/lib/domain/workspace.ts";
import { camelize, databaseCommand } from "../src/lib/domain/transport.ts";
import { getFinanceSummary } from "../src/lib/domain/selectors.ts";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  area = "33333333-3333-4333-8333-333333333333",
  client = "44444444-4444-4444-8444-444444444444",
  contract = "55555555-5555-4555-8555-555555555555";
let session = crypto.randomUUID(),
  db,
  installment,
  chargeId,
  receiptId;
const uuid = () => crypto.randomUUID();
async function admin() {
  await db.exec("set session authorization postgres;reset role");
}
async function actor(
  uid = owner,
  aal = "aal2",
  mfa = Math.floor(Date.now() / 1000),
  sid = session,
) {
  await admin();
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [
      uid,
      JSON.stringify({
        sub: uid,
        aal,
        session_id: sid,
        amr: [{ method: "totp", timestamp: mfa }],
      }),
    ],
  );
  await db.exec("set role authenticated");
}
async function worker() {
  await admin();
  await db.query(
    "select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)",
  );
  await db.exec("set session authorization pomar_billing_worker");
}
async function rpc(cmd, key = uuid()) {
  return (
    await db.query("select pomar_command($1,$2::jsonb) value", [
      key,
      JSON.stringify(databaseCommand(cmd)),
    ])
  ).rows[0].value;
}
async function observe(event) {
  return (
    await db.query("select pomar_billing_apply_payment($1::jsonb) value", [
      JSON.stringify(databaseCommand(event)),
    ])
  ).rows[0].value;
}
const event = (extra = {}) => ({
  providerPaymentId: "123456789",
  externalReference: chargeId,
  collectorId: "987654321",
  mode: "live",
  amountCents: 10001,
  feeCents: 300,
  refundedCents: 0,
  currency: "BRL",
  status: "approved",
  paidOn: "2026-10-01",
  providerUpdatedAt: "2026-10-01T15:00:00Z",
  refunds: [],
  refundsComplete: true,
  ...extra,
});
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),not_after timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;insert into auth.users values('${owner}'),('${other}');insert into auth.sessions(id,user_id) values('${session}','${owner}');`);
  for (const file of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(
      new URL("../supabase/migrations/" + file, import.meta.url),
      "utf8",
    );
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(
        file +
          " line " +
          sql.slice(0, Number(e.position)).split("\n").length +
          ": " +
          e.message,
      );
    }
  }
  await db.exec(
    `insert into pomar_private.owner_registry values(true,'${owner}',true);insert into pomar_settings(owner_id,id,business_name,display_name) values('${owner}','${owner}','Empresa exemplo','Proprietário');insert into pomar_areas(id,owner_id,name,color) values('${area}','${owner}','Operação','green');insert into pomar_private.billing_config values(true,'${owner}','987654321','live',true);`,
  );
});
after(async () => await db?.close());
test("sessão exige MFA recente para iniciar e expira no banco por tempo/inatividade", async () => {
  await actor(owner, "aal2", Math.floor(Date.now() / 1000) - 301);
  assert.equal(
    (await db.query("select pomar_touch_session() s")).rows[0].s,
    "needs_mfa",
  );
  assert.equal((await db.query("select pomar_access() ok")).rows[0].ok, false);
  await actor();
  assert.equal(
    (await db.query("select pomar_touch_session() s")).rows[0].s,
    "granted",
  );
  assert.equal((await db.query("select pomar_access() ok")).rows[0].ok, true);
  await admin();
  await db.query(
    "update pomar_private.session_guard set last_activity_at=now()-interval '16 minutes' where session_id=$1",
    [session],
  );
  await actor();
  assert.equal(
    (await db.query("select pomar_touch_session() s")).rows[0].s,
    "denied",
  );
  assert.equal((await db.query("select pomar_access() ok")).rows[0].ok, false);
  session = uuid();
  await admin();
  await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
    session,
    owner,
  ]);
  await actor();
  assert.equal(
    (await db.query("select pomar_touch_session() s")).rows[0].s,
    "granted",
  );
  const old = uuid();
  await admin();
  await db.query(
    "insert into auth.sessions(id,user_id,created_at) values($1,$2,now()-interval '9 hours')",
    [old, owner],
  );
  await actor(owner, "aal2", Math.floor(Date.now() / 1000), old);
  assert.equal(
    (await db.query("select pomar_touch_session() s")).rows[0].s,
    "denied",
  );
  const providerExpired = uuid();
  await admin();
  await db.query(
    "insert into auth.sessions(id,user_id,not_after) values($1,$2,now()-interval '1 minute')",
    [providerExpired, owner],
  );
  await actor(owner, "aal2", Math.floor(Date.now() / 1000), providerExpired);
  assert.equal(
    (await db.query("select pomar_touch_session() s")).rows[0].s,
    "denied",
  );
  await actor();
});
test("ideias viram uma tarefa uma única vez e outro usuário continua sem acesso", async () => {
  const id = uuid(),
    now = new Date().toISOString(),
    taskId = uuid();
  await rpc({
    type: "saveIdea",
    value: {
      id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      title: "Melhorar o processo",
      detail: "Capturar a próxima melhoria.",
      category: "operations",
      priority: "P2",
      stage: "inbox",
      taskId: null,
    },
  });
  await rpc({ type: "convertIdeaToTask", id, taskId, projectId: null });
  await rpc({ type: "convertIdeaToTask", id, taskId: uuid(), projectId: null });
  assert.equal(
    (await db.query("select count(*) n from pomar_tasks")).rows[0].n,
    1,
  );
  await actor(other);
  assert.equal(
    (await db.query("select count(*) n from pomar_ideas")).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("select pomar_touch_session() s")).rows[0].s,
    "denied",
  );
  await actor();
});
test("checkout usa saldo do banco, chave idempotente e bloqueia link simultâneo", async () => {
  const now = new Date().toISOString();
  await rpc({
    type: "saveClient",
    value: {
      id: client,
      version: 1,
      createdAt: now,
      updatedAt: now,
      name: "Cliente teste",
      kind: "business",
      city: "",
      segment: "",
      contactName: "",
      email: "",
      phone: "",
      website: "",
      notes: "",
      status: "active",
    },
  });
  await rpc({
    type: "createContract",
    value: {
      id: contract,
      version: 1,
      createdAt: now,
      updatedAt: now,
      title: "Contrato teste",
      clientId: client,
      projectId: null,
      totalCents: 10001,
      signedOn: "2026-10-01",
      status: "active",
      notes: "",
    },
    count: 1,
    firstDueOn: "2026-10-01",
  });
  installment = (await db.query("select id from pomar_installments")).rows[0]
    .id;
  chargeId = uuid();
  const first = (
    await db.query("select pomar_prepare_charge($1,$2,24) v", [
      chargeId,
      installment,
    ])
  ).rows[0].v;
  assert.equal(first.created, true);
  assert.equal(first.charge.amount_cents, 10001);
  assert.equal(
    (
      await db.query("select pomar_prepare_charge($1,$2,24) v", [
        chargeId,
        installment,
      ])
    ).rows[0].v.created,
    false,
  );
  await assert.rejects(
    db.query("select pomar_prepare_charge($1,$2,24)", [uuid(), installment]),
    /POMAR_ACTIVE_CHARGE/,
  );
  await assert.rejects(observe(event()), /permission denied/);
  await assert.rejects(
    db.exec("delete from pomar_charges"),
    /permission denied/,
  );
});
test("worker é limitado e o pagamento repetido nunca duplica o caixa", async () => {
  await worker();
  await assert.rejects(
    db.query("select * from pomar_clients"),
    /permission denied/,
  );
  await assert.rejects(db.exec("set role authenticated"), /permission denied/);
  await db.query("select pomar_billing_attach($1,$2,$3,$4,$5)", [
    chargeId,
    "pref-test",
    "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-test",
    "987654321",
    "live",
  ]);
  assert.equal((await observe(event())).duplicate, false);
  assert.equal((await observe(event())).duplicate, true);
  await actor();
  const raw = (await db.query("select pomar_workspace() v")).rows[0].v;
  const state = parseWorkspace(camelize(raw));
  assert.equal(state.receipts.length, 1);
  receiptId = state.receipts[0].id;
  assert.equal(getFinanceSummary(state, "2026-10").received, 10001);
  assert.equal(installmentRemaining(state, installment), 0);
  await assert.rejects(
    rpc({
      type: "voidReceipt",
      id: receiptId,
      reason: "Não pode alterar provedor",
    }),
    /POMAR_PROVIDER_RECEIPT/,
  );
});
test("devolução parcial tem evento próprio e não reescreve o recebimento", async () => {
  await worker();
  const refund = {
    providerRefundId: "98765",
    amountCents: 2000,
    occurredOn: "2026-10-02",
  };
  await observe(
    event({
      refundedCents: 2000,
      providerUpdatedAt: "2026-10-02T15:00:00Z",
      refunds: [refund],
    }),
  );
  await observe(
    event({
      refundedCents: 2000,
      providerUpdatedAt: "2026-10-02T15:00:00Z",
      refunds: [refund],
    }),
  );
  await actor();
  const state = parseWorkspace(
    camelize((await db.query("select pomar_workspace() v")).rows[0].v),
  );
  assert.equal(state.refunds.length, 1);
  assert.equal(state.receipts[0].amountCents, 10001);
  assert.equal(installmentRemaining(state, installment), 2000);
  assert.equal(getFinanceSummary(state, "2026-10").cashBalance, 8001);
});
test("pagamento divergente fica em revisão e evento antigo não desfaz baixa", async () => {
  await worker();
  await observe(
    event({
      providerPaymentId: "77777",
      amountCents: 500,
      status: "approved",
      providerUpdatedAt: "2026-10-03T15:00:00Z",
    }),
  );
  await observe(
    event({ status: "pending", providerUpdatedAt: "2026-09-30T15:00:00Z" }),
  );
  await actor();
  const state = parseWorkspace(
    camelize((await db.query("select pomar_workspace() v")).rows[0].v),
  );
  assert.equal(state.receipts.length, 1);
  assert.ok(
    state.providerPayments.find((p) => p.providerPaymentId === "77777")
      .reviewReason,
  );
  assert.equal(
    state.providerPayments.find((p) => p.providerPaymentId === "123456789")
      .status,
    "approved",
  );
});

test("condição aceita impede iniciar e concluir projeto até a etapa financeira correspondente", async () => {
  await actor();
  const now = new Date().toISOString(),
    project = uuid(),
    contract2 = uuid(),
    agreement = uuid();
  await rpc({
    type: "saveProject",
    value: {
      id: project,
      version: 1,
      createdAt: now,
      updatedAt: now,
      name: "Entrega com entrada",
      clientId: client,
      contractorId: null,
      areaId: area,
      status: "planning",
      priority: "P2",
      startedOn: null,
      dueOn: null,
      nextAction: "Aguardar entrada",
      nextActionOn: null,
      waitingFor: "",
      notes: "",
    },
  });
  await rpc({
    type: "createContract",
    value: {
      id: contract2,
      version: 1,
      createdAt: now,
      updatedAt: now,
      title: "Contrato com condição",
      clientId: client,
      projectId: project,
      totalCents: 10000,
      signedOn: "2026-10-01",
      status: "active",
      notes: "",
    },
    count: 1,
    firstDueOn: "2026-10-01",
  });
  await rpc({
    type: "saveCollectionAgreement",
    value: {
      id: agreement,
      version: 1,
      createdAt: now,
      updatedAt: now,
      contractId: contract2,
      initialCents: 5000,
      gate: "initial",
      graceDays: 0,
      acceptedOn: "2026-10-01",
      termsReference: "Contrato de teste aceito",
      notes: "",
    },
  });

  // PostgreSQL direct UPDATE and the application command both respect the same gate.
  await assert.rejects(
    db.query("update pomar_projects set status='active' where id=$1", [
      project,
    ]),
    /POMAR_PAYMENT_GATE/,
  );
  const part = (
    await db.query("select id from pomar_installments where contract_id=$1", [
      contract2,
    ])
  ).rows[0].id;
  await rpc({
    type: "postReceipt",
    installmentId: part,
    amountCents: 5000,
    receivedOn: "2026-10-01",
  });
  await db.query("update pomar_projects set status='active' where id=$1", [
    project,
  ]);
  const existing = (
    await db.query("select * from pomar_collection_agreements where id=$1", [
      agreement,
    ])
  ).rows[0];
  await rpc({
    type: "saveCollectionAgreement",
    value: {
      id: agreement,
      version: existing.version,
      createdAt: existing.created_at.toISOString(),
      updatedAt: existing.updated_at.toISOString(),
      contractId: contract2,
      initialCents: 5000,
      gate: "full",
      graceDays: 0,
      acceptedOn: "2026-10-01",
      termsReference: "Contrato de teste aceito",
      notes: "",
    },
  });
  await assert.rejects(
    db.query("update pomar_projects set status='completed' where id=$1", [
      project,
    ]),
    /POMAR_PAYMENT_GATE/,
  );
  await rpc({
    type: "postReceipt",
    installmentId: part,
    amountCents: 5000,
    receivedOn: "2026-10-01",
  });
  await db.query("update pomar_projects set status='completed' where id=$1", [
    project,
  ]);
});
test("simulação não gera recebimento real e referência alheia à Central é ignorada", async () => {
  await actor();
  const before = (await db.query("select count(*) n from pomar_receipts"))
    .rows[0].n;
  await admin();
  await db.exec("update pomar_private.billing_config set mode='test'");
  await actor();
  const now = new Date().toISOString(),
    id = uuid();
  await rpc({
    type: "createContract",
    value: {
      id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      title: "Somente simulação",
      clientId: client,
      projectId: null,
      totalCents: 10001,
      signedOn: "2026-10-01",
      status: "active",
      notes: "",
    },
    count: 1,
    firstDueOn: "2026-10-01",
  });
  const part = (
      await db.query("select id from pomar_installments where contract_id=$1", [
        id,
      ])
    ).rows[0].id,
    charge = uuid();
  await db.query("select pomar_prepare_charge($1,$2,24)", [charge, part]);
  await worker();
  await observe(
    event({
      providerPaymentId: "88888888",
      externalReference: charge,
      mode: "test",
    }),
  );
  assert.equal(
    (
      await observe(
        event({
          providerPaymentId: "99999999",
          externalReference: uuid(),
          mode: "test",
        }),
      )
    ).ignored,
    true,
  );
  await actor();
  assert.equal(
    (await db.query("select count(*) n from pomar_receipts")).rows[0].n,
    before,
  );
  const state = parseWorkspace(
    camelize((await db.query("select pomar_workspace() v")).rows[0].v),
  );
  assert.equal(installmentRemaining(state, part), 10001);
});
