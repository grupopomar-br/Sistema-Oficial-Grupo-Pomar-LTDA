import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseWorkspace } from "../src/lib/domain/workspace.ts";
import { camelize, databaseCommand } from "../src/lib/domain/transport.ts";
import { newBase } from "../src/lib/domain/model.ts";
import { PGlite } from "@electric-sql/pglite";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const client = "33333333-3333-4333-8333-333333333333";
const area = "44444444-4444-4444-8444-444444444444";
const contract = "55555555-5555-4555-8555-555555555555";
let db;
const uuid = () => crypto.randomUUID();
async function rpc(command, key = uuid()) {
  return (
    await db.query("select public.pomar_command($1::uuid,$2::jsonb) result", [
      key,
      JSON.stringify(command),
    ])
  ).rows[0].result;
}
async function asUser(uid = owner, aal = "aal2", sid = session) {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [uid, JSON.stringify({ sub: uid, aal, session_id: sid })],
  );
  await db.exec("set role authenticated");
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text); create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 grant usage on schema auth to anon,authenticated; grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
 insert into auth.users values('${owner}','owner@example.com'),('${other}','other@example.com'); insert into auth.sessions values('${session}','${owner}');`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261028225524_central_operacional_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`insert into pomar_private.owner_registry values(true,'${owner}',true);
 insert into public.pomar_settings(owner_id,id,business_name,display_name) values('${owner}','${owner}','Exemplo Operações','Proprietário');
 insert into public.pomar_areas(id,owner_id,name,color) values('${area}','${owner}','Operação','green');`);
  await asUser();
});
after(async () => {
  await db?.close();
});
test("RLS: somente proprietário com MFA e sessão ativa pode ler", async () => {
  assert.equal((await db.query("select pomar_access() ok")).rows[0].ok, true);
  await asUser(other);
  assert.equal(
    (await db.query("select count(*) n from pomar_settings")).rows[0].n,
    0,
  );
  await assert.rejects(
    rpc({ type: "saveSettings", value: {} }),
    /POMAR_ACCESS/,
  );
  await asUser(owner, "aal1");
  assert.equal((await db.query("select pomar_access() ok")).rows[0].ok, false);
  await asUser(owner, "aal2", uuid());
  assert.equal((await db.query("select pomar_access() ok")).rows[0].ok, false);
  await db.exec("reset role;set role anon");
  await assert.rejects(
    db.query("select * from pomar_clients"),
    /permission denied/,
  );
  await asUser();
});
test("comandos salvam, auditam, rejeitam conflito e repetem sem duplicar", async () => {
  const cmd = {
    type: "saveClient",
    value: {
      id: client,
      version: 1,
      name: "Empresa exemplo",
      kind: "business",
      city: "",
      segment: "",
      contact_name: "",
      email: "",
      phone: "",
      website: "",
      notes: "",
      status: "active",
    },
  };
  const key = uuid();
  assert.equal((await rpc(cmd, key)).duplicate, false);
  assert.equal((await rpc(cmd, key)).duplicate, true);
  await assert.rejects(
    rpc({ ...cmd, value: { ...cmd.value, name: "Outro nome" } }, key),
    /POMAR_KEY_REUSED/,
  );
  await rpc({ ...cmd, value: { ...cmd.value, name: "Empresa atualizada" } });
  await assert.rejects(rpc(cmd), /POMAR_CONFLICT/);
  const audit = await db.query(
    "select * from pomar_audit_events where entity_id=$1",
    [client],
  );
  assert.equal(audit.rows.length, 2);
  await assert.rejects(
    db.exec("delete from pomar_audit_events"),
    /permission denied/,
  );
  await assert.rejects(
    db.exec(
      "insert into pomar_audit_events(owner_id,entity_type,entity_id,action,summary) values('" +
        owner +
        "','client','" +
        client +
        "','fake','fake')",
    ),
    /permission denied/,
  );
});
test("contrato transacional distribui centavos e preserva vencimento mensal", async () => {
  await rpc({
    type: "createContract",
    value: {
      id: contract,
      version: 1,
      title: "Contrato exemplo",
      client_id: client,
      project_id: null,
      total_cents: 10001,
      signed_on: "2026-01-01",
      status: "active",
      notes: "",
    },
    count: 3,
    first_due_on: "2026-01-31",
  });
  const parts = (
    await db.query(
      "select id,amount_cents,due_on from pomar_installments where contract_id=$1 order by sequence",
      [contract],
    )
  ).rows;
  assert.deepEqual(
    parts.map((x) => x.amount_cents),
    [3334, 3334, 3333],
  );
  assert.deepEqual(
    parts.map((x) => x.due_on.toISOString().slice(0, 10)),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.equal(
    (await db.query("select count(*) n from pomar_receipts")).rows[0].n,
    0,
  );
  await assert.rejects(
    db.query(
      "insert into pomar_contracts(id,owner_id,title,client_id,total_cents,signed_on) values($1,$2,$3,$4,100,$5)",
      [uuid(), owner, "Sem parcelas", client, "2026-01-01"],
    ),
    /POMAR_CONTRACT_TOTAL/,
  );
});
test("recebimento parcial, repetição e excesso são atômicos", async () => {
  const iid = (
    await db.query(
      "select id from pomar_installments where contract_id=$1 and sequence=1",
      [contract],
    )
  ).rows[0].id;
  const key = uuid(),
    cmd = {
      type: "postReceipt",
      installment_id: iid,
      amount_cents: 1000,
      received_on: null,
    };
  await rpc(cmd, key);
  await rpc(cmd, key);
  assert.equal(
    (await db.query("select count(*) n from pomar_receipts")).rows[0].n,
    1,
  );
  await assert.rejects(
    rpc({ ...cmd, amount_cents: 2335 }),
    /POMAR_OVERPAYMENT/,
  );
  assert.equal(
    (await db.query("select count(*) n from pomar_receipts")).rows[0].n,
    1,
  );
  await rpc({ type: "dateReceipt", id: key, received_on: "2026-01-05" });
  assert.equal(
    Number(
      (await db.query("select sum(amount_cents) n from pomar_receipts")).rows[0]
        .n,
    ),
    1000,
  );
  await assert.rejects(
    rpc({ type: "dateReceipt", id: key, received_on: "2026-01-06" }),
    /POMAR_ALREADY_DATED/,
  );
  await assert.rejects(
    db.query("update pomar_receipts set amount_cents=999 where id=$1", [key]),
    /POMAR_IMMUTABLE/,
  );
  await rpc({ type: "voidReceipt", id: key, reason: "Correção de lançamento" });
  assert.equal(
    (await db.query("select status from pomar_receipts where id=$1", [key]))
      .rows[0].status,
    "voided",
  );
  await rpc({ ...cmd, amount_cents: 3334, received_on: "2026-01-10" });
  await assert.rejects(rpc({ ...cmd, amount_cents: 1 }), /POMAR_OVERPAYMENT/);
});
test("cancelamento preserva recebimentos, cancela parcelas e bloqueia nova entrada", async () => {
  const iid = (
    await db.query(
      "select id from pomar_installments where contract_id=$1 and sequence=2",
      [contract],
    )
  ).rows[0].id;
  await rpc({
    type: "cancelContract",
    id: contract,
    reason: "Encerrado por solicitação",
  });
  assert.equal(
    (
      await db.query(
        "select count(*) n from pomar_installments where status='open'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("select count(*) n from pomar_receipts")).rows[0].n,
    2,
  );
  await assert.rejects(
    rpc({
      type: "postReceipt",
      installment_id: iid,
      amount_cents: 100,
      received_on: null,
    }),
    /POMAR_NOT_ACTIVE/,
  );
  const ws = (await db.query("select pomar_workspace() value")).rows[0].value;
  assert.equal(ws.contracts.length, 1);
  assert.equal(ws.history.length > 0, true);
  assert.equal(ws.clients[0].owner_id, undefined);
});
test("DTO completo cruza aplicação, RPC e snapshot; notas e versões permanecem consistentes", async () => {
  const projectId = uuid();
  const now = new Date().toISOString();
  const project = {
    ...newBase(now),
    id: projectId,
    name: "Projeto de teste",
    clientId: client,
    contractorId: null,
    areaId: area,
    status: "active",
    priority: "P1",
    startedOn: null,
    dueOn: null,
    nextAction: "Validar integração",
    nextActionOn: null,
    waitingFor: "",
    notes: "",
  };
  await rpc(databaseCommand({ type: "saveProject", value: project }));
  const task = {
    ...newBase(now),
    title: "Concluir teste",
    projectId,
    priority: "P2",
    status: "pending",
    dueOn: null,
    focusOn: null,
    description: "",
    completedAt: null,
  };
  await rpc(databaseCommand({ type: "saveTask", value: task }));
  await rpc(
    databaseCommand({
      type: "setTaskStatus",
      id: task.id,
      expectedVersion: 1,
      status: "done",
    }),
  );
  await assert.rejects(
    rpc(
      databaseCommand({
        type: "setTaskStatus",
        id: task.id,
        expectedVersion: 1,
        status: "pending",
      }),
    ),
    /POMAR_CONFLICT/,
  );
  const message = "Contexto completo de uma decisão. ".repeat(70).trim();
  await rpc(databaseCommand({ type: "addUpdate", projectId, message }));
  const raw = (await db.query("select pomar_workspace() value")).rows[0].value;
  const state = parseWorkspace(camelize(raw));
  assert.equal(state.updates[0].message, message);
  assert.equal(state.tasks[0].status, "done");
  assert.ok(state.tasks[0].completedAt);
  assert.ok(state.revision > 1);
  await rpc(
    databaseCommand({
      type: "saveSettings",
      value: { ...state.settings, dailyFocusLimit: 3 },
      expectedRevision: state.revision,
    }),
  );
  await assert.rejects(
    rpc(
      databaseCommand({
        type: "saveSettings",
        value: state.settings,
        expectedRevision: state.revision,
      }),
    ),
    /POMAR_CONFLICT/,
  );
});
test("RLS também bloqueia escrita de outro usuário e campos administrativos", async () => {
  await asUser(other);
  await assert.rejects(
    db.query(
      "insert into pomar_clients(id,owner_id,name,kind,status) values($1,$2,'Invasão','business','active')",
      [uuid(), owner],
    ),
    /row-level security/,
  );
  await assert.rejects(
    db.query("select * from pomar_private.owner_registry"),
    /permission denied/,
  );
  await asUser();
  await assert.rejects(
    db.query("select pomar_private.save_entity('clients',$1::jsonb,1)", [
      JSON.stringify({ id: uuid(), owner_id: other }),
    ]),
    /POMAR_BAD_COMMAND/,
  );
});
test("sessão removida é negada mesmo com JWT ainda representado no teste", async () => {
  await db.exec("reset role");
  await db.query("delete from auth.sessions where id=$1", [session]);
  await asUser();
  assert.equal((await db.query("select pomar_access() ok")).rows[0].ok, false);
  assert.equal(
    (await db.query("select count(*) n from pomar_clients")).rows[0].n,
    0,
  );
});
