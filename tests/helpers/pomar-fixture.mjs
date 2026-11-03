import { PGlite } from "pglite-pg17";
import { readFile, readdir } from "node:fs/promises";
import { storageFixture } from "./storage-fixture.mjs";
import { databaseCommand } from "../../src/lib/domain/transport.ts";

export async function pomarFixture() {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222",
    session = crypto.randomUUID(),
    client = crypto.randomUUID();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
      insert into auth.users values('${owner}'),('${other}');insert into auth.sessions(id,user_id) values('${session}','${owner}');`);
    await storageFixture(db);
    const migrations = new URL("../../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(migrations))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
    await db.exec(
      `insert into pomar_private.owner_registry values(true,'${owner}',true);insert into pomar_settings(owner_id,id,business_name,display_name) values('${owner}','${owner}','Empresa exemplo','Proprietário');insert into pomar_clients(id,owner_id,name,kind,status) values('${client}','${owner}','Cliente fictício','business','active');insert into pomar_private.billing_config values(true,'${owner}','987654321','live',true);`,
    );
    const admin = async () =>
      db.exec("set session authorization postgres;reset role");
    const actor = async (uid = owner) => {
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
      if (uid === owner) await db.query("select pomar_touch_session_v2()");
    };
    const worker = async (role = "pomar_billing_worker") => {
      await admin();
      await db.exec(`set session authorization ${role}`);
    };
    const command = async (value, key = crypto.randomUUID()) =>
      (
        await db.query("select pomar_command($1,$2::jsonb) r", [
          key,
          JSON.stringify(databaseCommand(value)),
        ])
      ).rows[0].r;
    const date = (
      await db.query(
        "select (now() at time zone 'America/Fortaleza')::date::text d",
      )
    ).rows[0].d;
    return { db, owner, other, client, date, admin, actor, worker, command };
  } catch (error) {
    await db.close();
    throw error;
  }
}
