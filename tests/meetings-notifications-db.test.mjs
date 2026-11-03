import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "pglite-pg17";
import { storageFixture } from "./helpers/storage-fixture.mjs";
import { newBase } from "../src/lib/domain/model.ts";
import { databaseCommand } from "../src/lib/domain/transport.ts";
test("PostgreSQL 17: reuniões, lembretes, vendas verificadas e entregas têm isolamento, deduplicação e lease", async () => {
  const db = new PGlite(),
    owner = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222",
    session = crypto.randomUUID(),
    client = crypto.randomUUID(),
    contract = crypto.randomUUID(),
    part = crypto.randomUUID(),
    charge = crypto.randomUUID();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),not_after timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
   insert into auth.users values('${owner}'),('${other}');insert into auth.sessions(id,user_id) values('${session}','${owner}');`);
    await storageFixture(db);
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    let agendaMigration = "";
    const laterMigrations = [];
    for (const file of (await readdir(migrations))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(new URL(file, migrations), "utf8");
      if (file.includes("reunioes_e_notificacoes")) agendaMigration = sql;
      else if (agendaMigration) laterMigrations.push(sql);
      else await db.exec(sql);
    }
    await db.exec(`insert into pomar_private.owner_registry values(true,'${owner}',true);insert into pomar_settings(owner_id,id,business_name,display_name) values('${owner}','${owner}','Empresa exemplo','Proprietário');
   begin;insert into pomar_clients(id,owner_id,name,kind,status) values('${client}','${owner}','Cliente fictício','business','active');
   insert into pomar_contracts(id,owner_id,title,client_id,total_cents,signed_on,status) values('${contract}','${owner}','Contrato fictício','${client}',10000,current_date,'active');
   insert into pomar_installments(id,owner_id,contract_id,sequence,amount_cents,due_on) values('${part}','${owner}','${contract}',1,10000,current_date);commit;
   insert into pomar_private.billing_config values(true,'${owner}','987654321','live',true);`);
    const oldCharge = crypto.randomUUID();
    await db.query(
      "insert into pomar_charges(id,owner_id,installment_id,mode,amount_cents,expires_at,status) values($1,$2,$3,'live',10000,now()-interval '1 day','ready')",
      [oldCharge, owner, part],
    );
    await db.query(
      "insert into pomar_provider_payments(owner_id,provider_payment_id,charge_id,amount_cents,currency,status,mode,provider_updated_at) values($1,'7777777',$2,10000,'BRL','approved','live',now())",
      [owner, oldCharge],
    );
    await db.exec(agendaMigration);
    for (const migration of laterMigrations) await db.exec(migration);
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
    async function worker(role = "pomar_notification_worker") {
      await admin();
      await db.exec(`set session authorization ${role}`);
    }
    async function rpc(cmd, key = crypto.randomUUID()) {
      return (
        await db.query("select pomar_command($1,$2::jsonb) r", [
          key,
          JSON.stringify(databaseCommand(cmd)),
        ])
      ).rows[0].r;
    }
    async function list() {
      return (await db.query("select pomar_notifications_list() v")).rows[0].v;
    }
    const endpoint = "https://fcm.googleapis.com/fcm/send/fake-device",
      sub = {
        endpoint,
        keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) },
      };
    await actor();
    await db.query("select pomar_touch_session_v2()");
    const report = {
      ...newBase(),
      clientId: client,
      profileName: "Perfil fictício",
      profileUrl: "https://maps.google.com/",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      collectedOn: "2026-10-01",
      interactions: 80,
      calls: 0,
      bookings: null,
      directions: 30,
      websiteClicks: 50,
      profileViews: 1200,
      notes: "Conferido em um exemplo de teste.",
      verified: true,
      archived: false,
    };
    const reportKey = crypto.randomUUID();
    await rpc({ type: "saveGoogleResult", value: report }, reportKey);
    assert.equal(
      (await rpc({ type: "saveGoogleResult", value: report }, reportKey))
        .duplicate,
      true,
    );
    const reportRow = async () =>
      (
        await db.query("select * from pomar_google_results where id=$1", [
          report.id,
        ])
      ).rows[0];
    assert.equal(Number((await reportRow()).calls), 0);
    assert.equal((await reportRow()).bookings, null, "ausência não vira zero");
    await assert.rejects(
      rpc({
        type: "saveGoogleResult",
        value: {
          ...report,
          id: crypto.randomUUID(),
          profileName: "  perfil fictício  ",
        },
      }),
      /duplicate key/,
    );
    await assert.rejects(
      rpc({ type: "saveGoogleResult", value: { ...report, calls: 1.5 } }),
      /POMAR_BAD_COMMAND/,
    );
    await assert.rejects(
      rpc({
        type: "saveGoogleResult",
        value: {
          ...report,
          periodEnd: "2099-01-01",
          collectedOn: "2099-01-02",
        },
      }),
      /check constraint/,
    );
    await rpc({ type: "saveGoogleResult", value: { ...report, calls: 10 } });
    await assert.rejects(
      rpc({ type: "saveGoogleResult", value: report }),
      /POMAR_CONFLICT/,
    );
    const resultsSnapshot = (
      await db.query("select pomar_workspace_results() w")
    ).rows[0].w;
    assert.equal(resultsSnapshot.google_results_ready, true);
    assert.equal(resultsSnapshot.google_results.length, 1);
    assert.equal(resultsSnapshot.google_results[0].version, 2);
    await db.query("select pomar_push_device($1::jsonb,true)", [
      JSON.stringify(sub),
    ]);
    let value = {
      ...newBase(),
      title: "Reunião fictícia",
      clientId: client,
      projectId: null,
      startsAt: new Date(Date.now() + 90 * 60000).toISOString(),
      endsAt: new Date(Date.now() + 120 * 60000).toISOString(),
      status: "scheduled",
      location: "",
      meetingUrl: "",
      participants: "",
      agenda: "",
      outcome: "",
      reminderMinutes: 120,
      reminderVersion: 99,
    };
    const key = crypto.randomUUID();
    await rpc({ type: "saveMeeting", value }, key);
    assert.equal(
      (await rpc({ type: "saveMeeting", value }, key)).duplicate,
      true,
    );
    const row = async () =>
      (await db.query("select * from pomar_meetings where id=$1", [value.id]))
        .rows[0];
    assert.equal(
      (await row()).reminder_version,
      1,
      "revisão do lembrete vem do banco",
    );
    assert.equal((await list()).items.length, 1);
    assert.equal((await list()).items.length, 1);
    await rpc({
      type: "saveMeeting",
      value: {
        ...value,
        version: (await row()).version,
        agenda: "Pauta alterada",
      },
    });
    assert.equal((await row()).reminder_version, 1);
    assert.equal((await list()).items.length, 1);
    await assert.rejects(rpc({ type: "saveMeeting", value }), /POMAR_CONFLICT/);
    await db.query("select pomar_prepare_charge($1,$2,24)", [charge, part]);
    await worker("pomar_billing_worker");
    const event = {
      providerPaymentId: "123456789",
      externalReference: charge,
      collectorId: "987654321",
      mode: "live",
      amountCents: 10000,
      feeCents: 0,
      refundedCents: 0,
      currency: "BRL",
      status: "approved",
      paidOn: new Date().toISOString().slice(0, 10),
      providerUpdatedAt: new Date().toISOString(),
      refunds: [],
      refundsComplete: true,
    };
    await db.query("select pomar_billing_apply_payment($1::jsonb)", [
      JSON.stringify(databaseCommand(event)),
    ]);
    await db.query("select pomar_billing_apply_payment($1::jsonb)", [
      JSON.stringify(databaseCommand(event)),
    ]);
    await actor();
    let feed = await list();
    assert.equal(feed.items.filter((n) => n.kind === "sale").length, 1);
    assert.equal(feed.unread, 2);
    await admin();
    await db.query(
      "insert into pomar_provider_payments(owner_id,provider_payment_id,amount_cents,currency,status,mode,provider_updated_at) values($1,'99999',5000,'BRL','approved','test',now())",
      [owner],
    );
    await actor();
    assert.equal(
      (await list()).items.filter((n) => n.kind === "sale").length,
      1,
      "sandbox não notifica venda",
    );
    await assert.rejects(
      db.query(
        "insert into pomar_notifications(owner_id,dedupe_key,kind,source_id,title,message,expires_at) values($1,'fake','sale',$2,'fake','fake',now())",
        [owner, crypto.randomUUID()],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select pomar_notifications_claim(10)"),
      /permission denied/,
    );
    await worker();
    for (const table of [
      "pomar_meetings",
      "pomar_provider_payments",
      "pomar_notifications",
      "pomar_google_results",
    ])
      await assert.rejects(
        db.query(`select * from ${table}`),
        /permission denied/,
      );
    let jobs = (
      await db.query("select pomar_notifications_claim_personalized(10) jobs")
    ).rows[0].jobs;
    assert.equal(jobs.length, 2);
    assert.equal(
      (await db.query("select pomar_notifications_claim(10) jobs")).rows[0].jobs
        .length,
      0,
      "lease impede envio concorrente",
    );
    const meetingJob = jobs.find((j) => j.kind === "meeting"),
      saleJob = jobs.find((j) => j.kind === "sale");
    assert.equal(saleJob.amountCents, 10000);
    assert.equal(
      Date.parse(meetingJob.meetingStartsAt),
      Date.parse(value.startsAt),
    );
    assert.equal(Object.hasOwn(saleJob, "client"), false);
    assert.equal(
      (
        await db.query("select pomar_notification_delivery_valid($1,$2) v", [
          meetingJob.id,
          meetingJob.lease,
        ])
      ).rows[0].v,
      true,
    );
    await actor();
    await rpc({
      type: "saveMeeting",
      value: { ...value, version: (await row()).version, status: "cancelled" },
    });
    await worker();
    assert.equal(
      (
        await db.query("select pomar_notification_delivery_valid($1,$2) v", [
          meetingJob.id,
          meetingJob.lease,
        ])
      ).rows[0].v,
      false,
      "cancelamento invalida envio mesmo antes do próximo tick",
    );
    await db.query("select pomar_notification_ack($1,$2,'sent')", [
      saleJob.id,
      crypto.randomUUID(),
    ]);
    assert.equal(
      (
        await db.query("select pomar_notification_delivery_valid($1,$2) v", [
          saleJob.id,
          saleJob.lease,
        ])
      ).rows[0].v,
      true,
      "lease errado não confirma entrega",
    );
    await db.query("select pomar_notification_ack($1,$2,'retry')", [
      saleJob.id,
      saleJob.lease,
    ]);
    await admin();
    await db.query(
      "update pomar_private.push_deliveries set available_at=now()-interval '1 second' where id=$1",
      [saleJob.id],
    );
    await worker();
    const retried = (
      await db.query("select pomar_notifications_claim(10) jobs")
    ).rows[0].jobs;
    assert.equal(retried.length, 1);
    assert.notEqual(retried[0].lease, saleJob.lease);
    await db.query("select pomar_notification_ack($1,$2,'gone')", [
      retried[0].id,
      retried[0].lease,
    ]);
    await actor();
    feed = await list();
    assert.equal(feed.items.filter((n) => n.kind === "meeting").length, 0);
    const notice = feed.items[0];
    await db.query("update pomar_notifications set read_at=now() where id=$1", [
      notice.id,
    ]);
    assert.equal((await list()).unread, 0);
    await assert.rejects(
      db.query("update pomar_notifications set title='fake' where id=$1", [
        notice.id,
      ]),
      /permission denied/,
    );
    const old = (await db.query("select pomar_workspace_personalized() w"))
      .rows[0].w;
    assert.equal(Object.hasOwn(old, "meetings"), false);
    const latest = (await db.query("select pomar_workspace_scheduled() w"))
      .rows[0].w;
    assert.equal(latest.meetings_ready, true);
    assert.equal(latest.meetings.length, 1);
    await actor(other);
    assert.equal(
      (await db.query("select count(*)::int n from pomar_google_results"))
        .rows[0].n,
      0,
    );
    await assert.rejects(
      rpc({
        type: "saveGoogleResult",
        value: { ...report, id: crypto.randomUUID() },
      }),
      /POMAR_ACCESS/,
    );
    await assert.rejects(
      db.query("select pomar_notifications_list_personalized()"),
      /POMAR_ACCESS/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from pomar_meetings")).rows[0].n,
      0,
    );
    await assert.rejects(
      db.query("select pomar_notifications_list()"),
      /POMAR_ACCESS/,
    );
    await assert.rejects(
      rpc({
        type: "saveMeeting",
        value: { ...value, id: crypto.randomUUID() },
      }),
      /POMAR_ACCESS/,
    );
    await admin();
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select pomar_notifications_list()"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select pomar_workspace_scheduled()"),
      /permission denied/,
    );
    await admin();
    await assert.rejects(
      db.exec(
        await readFile(
          new URL(
            "../supabase/06a_habilitar_worker_notificacoes.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
      /Use uma senha privada forte/,
    );
    await db.exec(`create schema cron;create schema vault;create schema net;
      create table cron.job(jobid bigserial primary key,name text unique,schedule text,command text);
      create function cron.schedule(n text,s text,c text) returns bigint language sql as $$insert into cron.job(name,schedule,command) values(n,s,c) on conflict(name) do update set schedule=excluded.schedule,command=excluded.command returning jobid$$;
      create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
      insert into vault.decrypted_secrets values('pomar_notifications_app_url','https://example.com'),('pomar_notifications_cron_secret',repeat('A',43));
      create table net.http_request_queue(id bigserial primary key,url text,headers jsonb,body jsonb,timeout integer);
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.http_request_queue(url,headers,body,timeout) values(url,headers,body,timeout_milliseconds) returning id$$;
      grant usage on schema net to public;grant select on net.http_request_queue to public;
    `);
    const schedule = await readFile(
      new URL(
        "../supabase/06_configurar_agendador_notificacoes.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(schedule);
    await db.exec(schedule);
    const cron = (await db.query("select command from cron.job")).rows;
    assert.equal(cron.length, 1, "repetir instalação atualiza o mesmo job");
    await db.exec(cron[0].command);
    assert.equal(
      (await db.query("select url from net.http_request_queue")).rows[0].url,
      "https://example.com/api/notifications/dispatch",
    );
    await actor();
    await assert.rejects(
      db.query("select * from net.http_request_queue"),
      /permission denied/,
    );
    await worker();
    await assert.rejects(
      db.query("select * from net.http_request_queue"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
