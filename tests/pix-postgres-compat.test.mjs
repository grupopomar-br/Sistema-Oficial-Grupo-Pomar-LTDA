import { storageFixture } from "./helpers/storage-fixture.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "pglite-pg17";
import { camelize } from "../src/lib/domain/transport.ts";
import { applyPaymentEvent } from "../src/lib/billing/worker-queries.ts";
import { withPostgresClient } from "./helpers/postgres-wire.mjs";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const fix = "20261102150605_corrigir_conciliacao_pix.sql";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const client = "33333333-3333-4333-8333-333333333333";
const contract = "44444444-4444-4444-8444-444444444444";
const installment = "55555555-5555-4555-8555-555555555555";
const charge = "66666666-6666-4666-8666-666666666666";
const order = "ORD01J49MMW3SSBK5PSV3DFR32959";

async function useWindowsLineEndings(db, beforeHash, afterHash) {
  const source = (
    await db.query(`select prosrc,md5(prosrc) hash,pg_get_functiondef(oid) definition
      from pg_proc where oid=to_regprocedure('public.pomar_billing_apply_payment(jsonb)')`)
  ).rows[0];
  assert.equal(source.hash, beforeHash);
  assert.equal(source.definition.split(source.prosrc).length, 2);
  await db.exec(
    source.definition.replace(source.prosrc, () =>
      source.prosrc.replaceAll("\n", "\r\n"),
    ),
  );
  assert.equal(
    (
      await db.query(
        "select md5(prosrc) hash from pg_proc where oid=to_regprocedure('public.pomar_billing_apply_payment(jsonb)')",
      )
    ).rows[0].hash,
    afterHash,
  );
}

test("PostgreSQL 17 concilia order confirmada sem ampliar permissões nem duplicar caixa", async () => {
  const db = new PGlite();
  try {
    assert.match(
      (await db.query("select version() v")).rows[0].v,
      /PostgreSQL 17/,
    );
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
      insert into auth.users values('${owner}'),('${other}');`);
    await storageFixture(db);
    for (const file of (await readdir(migrations))
      // Reproduce the historical deployment before the targeted repair. New
      // wrappers deliberately have another source; current migrations are also
      // exercised by the full-chain card and notification database fixtures.
      .filter((f) => f.endsWith(".sql") && f < fix)
      .sort())
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
    // SQL pasted from Windows must match the exact same source, including strings.
    await useWindowsLineEndings(
      db,
      "24733c96f5688ff4d22f277029c8a532",
      "4d94e9be2a3d85a2d08e9a9dd1ac0a84",
    );
    await db.exec(`insert into pomar_private.owner_registry values(true,'${owner}',true);
      insert into pomar_settings(owner_id,id,business_name,display_name) values('${owner}','${owner}','Exemplo','Proprietário');
      begin;
      insert into pomar_clients(id,owner_id,name,kind,status) values('${client}','${owner}','Cliente fictício','business','active');
      insert into pomar_contracts(id,owner_id,title,client_id,total_cents,signed_on,status) values('${contract}','${owner}','Contrato fictício','${client}',100,current_date,'active');
      insert into pomar_installments(id,owner_id,contract_id,sequence,amount_cents,due_on) values('${installment}','${owner}','${contract}',1,100,current_date);
      commit;
      insert into pomar_private.billing_config values(true,'${owner}','987654321','live',true);
      insert into pomar_charges(id,owner_id,installment_id,status,mode,amount_cents,expires_at) values('${charge}','${owner}','${installment}','ready','live',100,now()+interval '1 day');`);
    const today = (
      await db.query(
        "select (now() at time zone 'America/Fortaleza')::date::text v",
      )
    ).rows[0].v;
    const event = {
      provider_payment_id: order,
      external_reference: charge,
      collector_id: "987654321",
      mode: "live",
      amount_cents: 100,
      fee_cents: null,
      refunded_cents: 0,
      currency: "BRL",
      status: "approved",
      paid_on: null,
      provider_updated_at: new Date().toISOString(),
      refunds: [],
      refunds_complete: true,
    };
    await db.exec("set session authorization pomar_billing_worker");
    assert.equal(
      (
        await db.query("select pomar_billing_apply_payment($1::jsonb) v", [
          JSON.stringify(event),
        ])
      ).rows[0].v.review,
      true,
    );
    const confirmed = { ...event, paid_on: today, owner_confirmed_by: owner };
    await withPostgresClient(db, async (sql) => {
      await assert.rejects(
        applyPaymentEvent(sql, camelize(confirmed)),
        (error) =>
          error.code === "42501" &&
          error.where?.includes("check_financial_totals"),
      );
    });
    await db.exec("set session authorization postgres;reset role");
    assert.equal(
      (await db.query("select count(*)::integer n from pomar_receipts")).rows[0]
        .n,
      0,
    );
    assert.equal(
      (await db.query("select review_reason from pomar_provider_payments"))
        .rows[0].review_reason,
      "Data de aprovação não confirmada.",
    );

    const preflight = await readFile(
      new URL(
        "../supabase/04_diagnostico_conciliacao_pix.sql",
        import.meta.url,
      ),
      "utf8",
    );
    assert.deepEqual((await db.query(preflight)).rows[0], {
      versao_postgres: 17,
      funcao: "original",
      gatilhos_conferem: true,
      acesso_restrito: true,
    });
    const migration = await readFile(new URL(fix, migrations), "utf8");
    await db.exec(migration);
    await useWindowsLineEndings(
      db,
      "25e638e51f1439a3af98b7c6f7b540c8",
      "940aff9e9fb909936b58b92880ef9a33",
    );
    assert.equal((await db.query(preflight)).rows[0].funcao, "atualizada");
    await db.exec(migration); // repeated installation must be safe
    assert.deepEqual((await db.query(preflight)).rows[0], {
      versao_postgres: 17,
      funcao: "atualizada",
      gatilhos_conferem: true,
      acesso_restrito: true,
    });
    const grants = (
      await db.query(`select
      has_table_privilege('pomar_billing_worker','public.pomar_receipts','select') as worker_select,
      has_table_privilege('pomar_billing_worker','public.pomar_allocations','insert') as worker_insert,
      has_function_privilege('pomar_billing_worker','public.pomar_billing_apply_payment(jsonb)','execute') as worker_execute,
      has_function_privilege('anon','public.pomar_billing_apply_payment(jsonb)','execute') as anon_execute,
      has_function_privilege('authenticated','public.pomar_billing_apply_payment(jsonb)','execute') as authenticated_execute`)
    ).rows[0];
    assert.deepEqual(grants, {
      worker_select: false,
      worker_insert: false,
      worker_execute: true,
      anon_execute: false,
      authenticated_execute: false,
    });
    await db.exec("set session authorization pomar_billing_worker");
    await assert.rejects(
      db.query("select * from pomar_receipts"),
      (error) => error.code === "42501",
    );
    await assert.rejects(
      db.query("select pomar_billing_apply_payment($1::jsonb)", [
        JSON.stringify({ ...confirmed, owner_confirmed_by: other }),
      ]),
      /POMAR_DATE_CONFIRMATION/,
    );
    await withPostgresClient(db, async (sql) => {
      assert.deepEqual(await applyPaymentEvent(sql, camelize(confirmed)), {
        duplicate: false,
        review: false,
      });
      assert.deepEqual(await applyPaymentEvent(sql, camelize(confirmed)), {
        duplicate: true,
      });
    });
    await db.exec("set session authorization postgres;reset role");
    const result = (
      await db.query(
        `select count(*)::integer as receipts,
      coalesce(sum(a.amount_cents),0)::integer as cents,
      bool_and(r.received_on=$2::date) as date_matches
      from pomar_allocations a join pomar_receipts r on r.id=a.receipt_id and r.owner_id=a.owner_id
      where a.installment_id=$1 and r.status='confirmed'`,
        [installment, today],
      )
    ).rows[0];
    assert.deepEqual(result, { receipts: 1, cents: 100, date_matches: true });
    assert.equal(
      (await db.query("select review_reason from pomar_provider_payments"))
        .rows[0].review_reason,
      "",
    );

    // Deferred financial invariants still reject an incomplete receipt.
    await assert.rejects(
      db.exec(`begin;
      insert into pomar_receipts(id,owner_id,contract_id,amount_cents,received_on)
      values(gen_random_uuid(),'${owner}','${contract}',1,'${today}');commit;`),
      /POMAR_RECEIPT_TOTAL/,
    );
    await db.exec("rollback");
    assert.equal(
      (await db.query("select count(*)::integer n from pomar_receipts")).rows[0]
        .n,
      1,
    );

    // Ignoring whitespace alone is unsafe: a changed literal can normalize to
    // the same hash. The exact source guard must still refuse the migration.
    const source = (
      await db.query(`select prosrc,pg_get_functiondef(oid) definition,
        md5(regexp_replace(prosrc,'[[:space:]]+','','g')) normalized
        from pg_proc where oid=to_regprocedure('public.pomar_billing_apply_payment(jsonb)')`)
    ).rows[0];
    const changed = source.definition.replace(
      "'Data de aprovação não confirmada.'",
      "'Datade aprovação não confirmada.'",
    );
    assert.notEqual(changed, source.definition);
    await db.exec(changed);
    assert.equal(
      (
        await db.query(`select md5(regexp_replace(prosrc,'[[:space:]]+','','g')) normalized
          from pg_proc where oid=to_regprocedure('public.pomar_billing_apply_payment(jsonb)')`)
      ).rows[0].normalized,
      source.normalized,
    );
    await assert.rejects(
      db.exec(migration),
      /POMAR_UNEXPECTED_BILLING_FUNCTION/,
    );
    await db.exec("rollback");
    const preserved = (
      await db.query(
        "select prosrc from pg_proc where oid=to_regprocedure('public.pomar_billing_apply_payment(jsonb)')",
      )
    ).rows[0].prosrc;
    assert.match(preserved, /Datade aprovação não confirmada/);
  } finally {
    await db.close();
  }
});
