import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "pglite-pg17";
import { storageFixture } from "./helpers/storage-fixture.mjs";
import { newBase } from "../src/lib/domain/model.ts";
import { parseWorkspace } from "../src/lib/domain/workspace.ts";
import { camelize, databaseCommand } from "../src/lib/domain/transport.ts";

test("PostgreSQL 17 guarda metodologias e avatar com RLS, idempotência, conflitos e snapshots compatíveis", async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222",
    session = crypto.randomUUID();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key);
   create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),not_after timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
   insert into auth.users values('${owner}'),('${other}');insert into auth.sessions(id,user_id) values('${session}','${owner}');`);
    await storageFixture(db);
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(migrations))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(name, migrations), "utf8"));
    await db.exec(`insert into pomar_private.owner_registry values(true,'${owner}',true);
   insert into pomar_settings(owner_id,id,business_name,display_name) values('${owner}','${owner}','Empresa exemplo','Proprietário');`);
    async function actor(uid = owner, age = 0, aal = "aal2") {
      await db.exec("reset role");
      const time = Number(
        (await db.query("select floor(extract(epoch from now())) t")).rows[0].t,
      );
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [
          uid,
          JSON.stringify({
            sub: uid,
            aal,
            session_id: session,
            amr: [{ method: "totp", timestamp: time - age }],
          }),
        ],
      );
      await db.exec("set role authenticated");
    }
    async function rpc(command, key = crypto.randomUUID()) {
      return (
        await db.query("select pomar_command($1,$2::jsonb) r", [
          key,
          JSON.stringify(databaseCommand(command)),
        ])
      ).rows[0].r;
    }
    async function snapshot() {
      return parseWorkspace(
        camelize(
          (await db.query("select pomar_workspace_personalized() w")).rows[0].w,
        ),
      );
    }
    await actor(owner, 1200);
    const touch = (await db.query("select pomar_touch_session_v2() v")).rows[0]
      .v;
    assert.deepEqual(touch, {
      status: "granted",
      policy: { idleTimeoutMs: 3600000, sensitiveMfaSeconds: 1800 },
    });
    assert.equal(
      (await db.query("select pomar_private.recent_mfa() v")).rows[0].v,
      true,
    );
    const value = {
      ...newBase(),
      title: "Metodologia fictícia",
      service: "Exemplo",
      purpose: "Processo",
      steps: "Etapa 1\nEtapa 2",
      differentiators: "",
      deliverables: "",
      qualityCriteria: "",
      notes: "",
      archived: false,
    };
    const key = crypto.randomUUID();
    await rpc({ type: "saveMethodology", value }, key);
    assert.equal(
      (await rpc({ type: "saveMethodology", value }, key)).duplicate,
      true,
    );
    await assert.rejects(
      rpc(
        { type: "saveMethodology", value: { ...value, title: "Mudou" } },
        key,
      ),
      /POMAR_KEY_REUSED/,
    );
    let state = await snapshot();
    assert.equal(state.personalizationReady, true);
    assert.equal(state.methodologies.length, 1);
    await rpc({
      type: "saveMethodology",
      value: { ...state.methodologies[0], archived: true },
    });
    await assert.rejects(
      rpc({ type: "saveMethodology", value }),
      /POMAR_CONFLICT/,
    );
    state = await snapshot();
    assert.equal(state.methodologies[0].archived, true);
    assert.equal(state.methodologies[0].version, 2);
    await rpc({
      type: "saveMethodology",
      value: { ...state.methodologies[0], archived: false },
    });
    const path = `${owner}/${crypto.randomUUID()}.webp`;
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('pomar-profile',$1,$2)",
      [path, owner],
    );
    await rpc({ type: "saveProfile", avatarPath: path, expectedVersion: 0 });
    assert.equal((await snapshot()).profile.avatarPath, path);
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=$1 returning id",
          [path],
        )
      ).rows.length,
      0,
      "current photo is preserved",
    );
    await assert.rejects(
      rpc({ type: "saveProfile", avatarPath: "brand", expectedVersion: 0 }),
      /POMAR_CONFLICT/,
    );
    await assert.rejects(
      rpc({
        type: "saveProfile",
        avatarPath: `${other}/${crypto.randomUUID()}.webp`,
        expectedVersion: 1,
      }),
      /check constraint/,
    );
    await rpc({ type: "saveProfile", avatarPath: "brand", expectedVersion: 1 });
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=$1 returning id",
          [path],
        )
      ).rows.length,
      1,
    );
    assert.equal((await snapshot()).profile.version, 2);
    for (const name of ["pomar_workspace", "pomar_workspace_enriched"]) {
      const legacy = (await db.query(`select ${name}() w`)).rows[0].w;
      assert.equal(Object.hasOwn(legacy, "profile"), false);
      assert.equal(Object.hasOwn(legacy, "methodologies"), false);
    }
    await actor(owner, 1801);
    assert.equal(
      (await db.query("select pomar_private.recent_mfa() v")).rows[0].v,
      false,
    );
    await db.exec("reset role");
    await db.query(
      "update pomar_private.session_guard set last_activity_at=now()-interval '45 minutes' where session_id=$1",
      [session],
    );
    await actor();
    assert.equal(
      (await db.query("select pomar_touch_session_v2() v")).rows[0].v.status,
      "granted",
    );
    await actor(other);
    assert.equal(
      (await db.query("select count(*)::int n from pomar_methodologies"))
        .rows[0].n,
      0,
    );
    await assert.rejects(
      db.query("select pomar_workspace_personalized()"),
      /POMAR_ACCESS/,
    );
    await assert.rejects(
      rpc({
        type: "saveMethodology",
        value: { ...value, id: crypto.randomUUID() },
      }),
      /POMAR_ACCESS/,
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values('pomar-profile',$1)",
        [`${other}/${crypto.randomUUID()}.webp`],
      ),
      /row-level security/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select pomar_workspace_personalized()"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select pomar_touch_session_v2()"),
      /permission denied/,
    );
    await db.exec("reset role;set role pomar_billing_worker");
    for (const table of ["pomar_methodologies", "pomar_profiles"])
      await assert.rejects(
        db.query(`select * from ${table}`),
        /permission denied/,
      );
    await db.exec("reset role");
    const bucket = (
      await db.query(
        "select public,file_size_limit,allowed_mime_types from storage.buckets where id='pomar-profile'",
      )
    ).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 2097152);
    assert.deepEqual(bucket.allowed_mime_types, ["image/webp"]);
  } finally {
    await db.close();
  }
});
