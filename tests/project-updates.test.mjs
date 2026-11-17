import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { pomarFixture } from "./helpers/pomar-fixture.mjs";
import { emptyWorkspace, newBase } from "../src/lib/domain/model.ts";
import { projectProgress } from "../src/lib/domain/project-progress.ts";
import { projectRadar } from "../src/lib/domain/project-radar.ts";
import { camelize } from "../src/lib/domain/transport.ts";
import { parseWorkspace } from "../src/lib/domain/workspace.ts";

const migration = "20261117145053_acompanhamento_de_projetos.sql";

test("avança o projeto e registra o próximo passo em uma transação, com histórico compatível e sem duplicação", async () => {
  const { db, actor, admin, other, worker, client, command, date } =
    await pomarFixture({
      skipMigrations: [migration],
    });
  const rpc = async (sql, args = []) =>
    (await db.query(sql, args)).rows[0].result;
  const read = async () =>
    parseWorkspace(
      camelize(await rpc("select pomar_workspace_project_updates() result")),
    );
  try {
    await actor();
    const area = {
      ...newBase(),
      name: "Área fictícia",
      color: "green",
      archived: false,
    };
    await command({ type: "saveArea", value: area });
    const project = {
      ...newBase(),
      name: "Projeto fictício",
      clientId: client,
      contractorId: null,
      areaId: area.id,
      status: "active",
      priority: "P2",
      startedOn: date,
      dueOn: date,
      nextAction: "Mapear requisitos",
      nextActionOn: date,
      waitingFor: "",
      notes: "",
    };
    await command({ type: "saveProject", value: project });
    await command({
      type: "addUpdate",
      projectId: project.id,
      message: "Escopo confirmado.",
    });
    await admin();
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
    await actor();
    const before = await read();
    const existing = before.projects[0];
    assert.equal(before.projectUpdatesReady, true);
    assert.equal(before.projectRemovalReady, true);
    assert.equal(projectProgress(before, existing).updateCount, 1);
    const args = [
      crypto.randomUUID(),
      project.id,
      existing.version,
      "Estrutura de páginas aprovada.",
      40,
      "Validar a versão no celular",
      date,
    ];
    const record = (input = args) =>
      rpc(
        "select pomar_record_project_update($1,$2,$3,$4,$5,$6,$7) result",
        input,
      );
    await actor(other);
    await assert.rejects(record(), /POMAR_ACCESS/);
    await assert.rejects(read(), /POMAR_ACCESS/);
    await admin();
    await db.exec("set session authorization anon");
    await assert.rejects(record(), { code: "42501" });
    await worker();
    await assert.rejects(read(), { code: "42501" });
    await actor();
    await assert.rejects(
      record(args.map((value, index) => (index === 4 ? 101 : value))),
      /POMAR_BAD_COMMAND/,
    );
    assert.deepEqual(await record(), { duplicate: false });
    assert.deepEqual(await record(), { duplicate: true });
    await assert.rejects(
      record(args.map((value, index) => (index === 4 ? 45 : value))),
      /POMAR_KEY_REUSED/,
    );
    await assert.rejects(
      record([crypto.randomUUID(), ...args.slice(1)]),
      /POMAR_CONFLICT/,
    );

    let after = await read();
    let current = after.projects[0];
    assert.equal(current.version, existing.version + 1);
    assert.equal(current.nextAction, args[5]);
    assert.equal(current.nextActionOn, date);
    assert.equal(projectProgress(after, current).percent, 40);
    assert.equal(projectProgress(after, current).updateCount, 2);
    const legacy = await rpc(
      "select pomar_workspace_expense_purposes() result",
    );
    assert.ok(
      legacy.updates.every(
        (entry) => !Object.hasOwn(entry, "progress_percent"),
      ),
    );
    assert.equal(legacy.project_updates_ready, undefined);

    await record([
      crypto.randomUUID(),
      current.id,
      current.version,
      "Retorno registrado.",
      null,
      current.nextAction,
      date,
    ]);
    after = await read();
    current = after.projects[0];
    assert.equal(projectProgress(after, current).percent, 40);
    assert.equal(projectProgress(after, current).updateCount, 3);
    await rpc("select pomar_set_project_removed($1,$2,$3,true) result", [
      crypto.randomUUID(),
      current.id,
      current.version,
    ]);
    after = await read();
    current = after.projects[0];
    assert.ok(current.removedAt);
    await assert.rejects(
      record([
        crypto.randomUUID(),
        current.id,
        current.version,
        "Atualização que deve falhar.",
        50,
        current.nextAction,
        date,
      ]),
      /POMAR_UPDATE_REMOVED/,
    );
    assert.equal((await read()).updates.length, 3);
  } finally {
    await db.close();
  }
});

test("o radar prioriza riscos concretos e mede a atividade pelos dias civis de Fortaleza", () => {
  const today = "2026-11-17";
  const now = "2026-11-17T15:00:00Z";
  const state = emptyWorkspace(now);
  const baseProject = {
    name: "Projeto fictício",
    clientId: null,
    contractorId: null,
    areaId: state.areas[0].id,
    status: "active",
    priority: "P2",
    startedOn: null,
    dueOn: null,
    nextAction: "Validar",
    nextActionOn: null,
    waitingFor: "",
    notes: "",
  };
  const overdue = { ...newBase(now), ...baseProject, dueOn: "2026-11-16" };
  const blocked = { ...newBase(now), ...baseProject };
  const upcoming = { ...newBase(now), ...baseProject, dueOn: "2026-11-24" };
  const current = { ...newBase(now), ...baseProject, priority: "P0" };
  const removed = {
    ...newBase(now),
    ...baseProject,
    dueOn: "2026-11-15",
    removedAt: now,
  };
  state.projects.push(current, removed, blocked, upcoming, overdue);
  state.tasks.push({
    ...newBase(now),
    title: "Aguardar briefing",
    projectId: blocked.id,
    status: "blocked",
    priority: "P2",
    dueOn: null,
    focusOn: null,
    description: "",
    completedAt: null,
  });
  state.updates.push(
    {
      ...newBase("2026-11-17T02:30:00Z"),
      projectId: blocked.id,
      message: "Briefing recebido.",
      progressPercent: 20,
    },
    {
      ...newBase(now),
      projectId: blocked.id,
      message: "Aguardando validação.",
    },
    {
      ...newBase(now),
      projectId: removed.id,
      message: "Registro de projeto removido.",
      progressPercent: 95,
    },
  );
  const result = projectRadar(state, today);
  assert.deepEqual(
    result.projects.map(({ project }) => project.id),
    [overdue.id, blocked.id, upcoming.id, current.id],
  );
  assert.equal(result.overdue, 1);
  assert.equal(result.dueSoon, 1);
  assert.equal(result.needingAction, 3);
  assert.equal(result.recentUpdates, 2);
  assert.deepEqual(
    result.week.map((day) => day.count),
    [0, 0, 0, 0, 0, 1, 1],
  );
  assert.equal(result.projects[1].progress.percent, 20);
  assert.equal(result.projects[1].progress.updateCount, 2);
});
