import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { databaseCommand } from "../src/lib/domain/transport.ts";

test("conclusão registra data real, mantém históricos antigos e respeita acesso do proprietário", async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const area = "44444444-4444-4444-8444-444444444444";
  const legacy = crypto.randomUUID();
  const id = crypto.randomUUID();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key,email text);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
      insert into auth.users values('${owner}','owner@example.com'),('${other}','other@example.com');
      insert into auth.sessions values('${session}','${owner}');`);
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    await db.exec(
      await readFile(
        new URL("20261028225524_central_operacional_v1.sql", migrations),
        "utf8",
      ),
    );
    await db.exec(`insert into pomar_private.owner_registry values(true,'${owner}',true);
      insert into pomar_settings(owner_id,id,business_name,display_name) values('${owner}','${owner}','Empresa exemplo','Proprietário');
      insert into pomar_areas(id,owner_id,name,color) values('${area}','${owner}','Operação','green');
      insert into pomar_projects(id,owner_id,name,area_id,status,priority,started_on) values('${legacy}','${owner}','Projeto antigo','${area}','completed','P2',current_date-10);`);
    const matches = (await readdir(migrations)).filter((f) =>
      f.endsWith("_project_completion_date.sql"),
    );
    assert.equal(matches.length, 1);
    await db.exec(await readFile(new URL(matches[0], migrations), "utf8"));
    assert.equal(
      (
        await db.query("select completed_on from pomar_projects where id=$1", [
          legacy,
        ])
      ).rows[0].completed_on,
      null,
    );
    const clock = (
      await db.query(
        "select to_char((now() at time zone 'America/Fortaleza')::date,'YYYY-MM-DD') today,to_char((now() at time zone 'America/Fortaleza')::date - 1,'YYYY-MM-DD') started",
      )
    ).rows[0];
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [owner, JSON.stringify({ sub: owner, aal: "aal2", session_id: session })],
    );
    await db.exec("set role authenticated");
    const oldSnapshot = (await db.query("select public.pomar_workspace() v"))
      .rows[0].v;
    const newSnapshot = (
      await db.query("select public.pomar_workspace_enriched() v")
    ).rows[0].v;
    const oldProject = oldSnapshot.projects.find(
      (project) => project.id === legacy,
    );
    const newProject = newSnapshot.projects.find(
      (project) => project.id === legacy,
    );
    assert.equal(Object.hasOwn(oldProject, "completed_on"), false);
    assert.equal(newProject.completed_on, null);
    const value = {
      id,
      version: 1,
      name: "Projeto fictício",
      clientId: null,
      contractorId: null,
      areaId: area,
      status: "active",
      priority: "P2",
      startedOn: clock.started,
      dueOn: null,
      nextAction: "",
      nextActionOn: null,
      waitingFor: "",
      notes: "",
      completedOn: "2000-01-01",
    };
    async function save(v) {
      await db.query("select public.pomar_command($1::uuid,$2::jsonb)", [
        crypto.randomUUID(),
        JSON.stringify(databaseCommand({ type: "saveProject", value: v })),
      ]);
    }
    async function row() {
      return (
        await db.query(
          "select version,to_char(completed_on,'YYYY-MM-DD') completed_on from pomar_projects where id=$1",
          [id],
        )
      ).rows[0];
    }
    await save(value);
    assert.equal((await row()).completed_on, null);
    let current = await row();
    await save({ ...value, version: current.version, status: "completed" });
    current = await row();
    assert.equal(current.completed_on, clock.today);
    const compatible = (
      await db.query("select public.pomar_workspace() v")
    ).rows[0].v.projects.find((project) => project.id === id);
    const enriched = (
      await db.query("select public.pomar_workspace_enriched() v")
    ).rows[0].v.projects.find((project) => project.id === id);
    assert.equal(Object.hasOwn(compatible, "completed_on"), false);
    assert.equal(enriched.completed_on, clock.today);
    await save({
      ...value,
      version: current.version,
      status: "completed",
      name: "Nome alterado",
    });
    current = await row();
    assert.equal(current.completed_on, clock.today);
    await db.query(
      "update pomar_projects set completed_on='2000-01-01' where id=$1",
      [id],
    );
    current = await row();
    assert.equal(current.completed_on, clock.today);
    await save({ ...value, version: current.version, status: "active" });
    assert.equal((await row()).completed_on, null);
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [other, JSON.stringify({ sub: other, aal: "aal2", session_id: session })],
    );
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select count(*)::int n from pomar_projects")).rows[0].n,
      0,
    );
    await assert.rejects(
      db.query("select public.pomar_workspace_enriched()"),
      /POMAR_ACCESS/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select public.pomar_workspace_enriched()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
