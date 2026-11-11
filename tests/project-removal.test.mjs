import { test } from "node:test";
import assert from "node:assert/strict";
import { pomarFixture } from "./helpers/pomar-fixture.mjs";
import { newBase } from "../src/lib/domain/model.ts";
import {
  getAlerts,
  getFinanceSummary,
  isActiveProject,
} from "../src/lib/domain/selectors.ts";
import { camelize } from "../src/lib/domain/transport.ts";
import { weekPlan, weekStart } from "../src/lib/domain/week.ts";
import { parseWorkspace } from "../src/lib/domain/workspace.ts";

async function projectFixture(options) {
  const fixture = await pomarFixture(options);
  const { db, actor, client, command, date } = fixture;
  const rpc = async (sql, args = []) =>
    (await db.query(sql, args)).rows[0].value;
  const read = async () => {
    const base = parseWorkspace(
      camelize(await rpc("select pomar_workspace_expense_purposes() value")),
    );
    const dates = await rpc("select pomar_project_removal_dates() value");
    return parseWorkspace({
      ...base,
      projects: base.projects.map((p) => ({ ...p, removedAt: dates[p.id] })),
    });
  };
  const create = async (status = "active") => {
    await actor();
    const area = {
      ...newBase(),
      name: "Operação de teste",
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
      status,
      priority: "P2",
      startedOn: date,
      dueOn: date,
      nextAction: "Preparar entrega",
      nextActionOn: date,
      waitingFor: "",
      notes: "Registro original",
    };
    await command({ type: "saveProject", value: project });
    return project.id;
  };
  const setRemoved = (project, removed, key = crypto.randomUUID()) =>
    rpc("select pomar_set_project_removed($1,$2,$3,$4) value", [
      key,
      project.id,
      project.version,
      removed,
    ]);
  return { ...fixture, rpc, read, create, setRemoved };
}

test("remoção retira o projeto do planejamento, preserva os vínculos e revoga convites VIP", async () => {
  const {
    db,
    actor,
    admin,
    worker,
    client,
    command,
    date,
    other,
    rpc,
    read,
    create,
    setRemoved,
  } = await projectFixture();
  try {
    const id = await create();
    await command({
      type: "saveTask",
      value: {
        ...newBase(),
        title: "Tarefa vinculada",
        projectId: id,
        priority: "P2",
        status: "pending",
        dueOn: date,
        focusOn: null,
        description: "",
        completedAt: null,
      },
    });
    await command({
      type: "addUpdate",
      projectId: id,
      message: "Atualização de teste",
    });
    await command({
      type: "createContract",
      value: {
        ...newBase(),
        title: "Contrato fictício",
        clientId: client,
        projectId: id,
        totalCents: 10000,
        signedOn: date,
        status: "active",
        notes: "",
      },
      count: 1,
      firstDueOn: date,
    });
    await command({
      type: "postReceipt",
      installmentId: (await read()).installments[0].id,
      amountCents: 1000,
      receivedOn: date,
    });
    const hash = "a".repeat(64);
    const newHash = "b".repeat(64);
    const uploadId = crypto.randomUUID();
    const issue = (token) =>
      rpc("select pomar_media_set_link($1,$2) value", [id, token]);
    const status = (token) =>
      rpc("select pomar_private.media_link_status($1) value", [token]);
    await issue(hash);
    await worker("pomar_media_worker");
    await rpc(
      "select pomar_private.media_reserve($1,$2,'ficticia.png','image/png',1234) value",
      [hash, uploadId],
    );
    await rpc("select pomar_private.media_check($1,$2) value", [
      hash,
      uploadId,
    ]);
    assert.equal(
      await rpc("select pomar_private.media_confirm($1,$2) value", [
        hash,
        uploadId,
      ]),
      true,
    );
    await actor();
    const before = await read();
    const original = before.projects[0];
    assert.ok(isActiveProject(original));
    const monday = weekStart(date);
    assert.ok(
      weekPlan(before, monday).some((day) => day.projects.length === 1),
    );
    const later = "2099-01-01";
    assert.ok(
      getAlerts(before, later).some((alert) => alert.category === "project"),
    );
    await actor(other);
    await assert.rejects(setRemoved(original, true), /POMAR_ACCESS/);
    await admin();
    await db.exec("set session authorization anon");
    await assert.rejects(setRemoved(original, true), { code: "42501" });
    await worker();
    await assert.rejects(setRemoved(original, true), { code: "42501" });
    await actor();
    const key = crypto.randomUUID();
    assert.deepEqual(await setRemoved(original, true, key), {
      duplicate: false,
    });
    assert.deepEqual(await setRemoved(original, true, key), {
      duplicate: true,
    });
    await assert.rejects(setRemoved(original, false, key), /POMAR_KEY_REUSED/);
    await assert.rejects(setRemoved(original, false), /POMAR_CONFLICT/);
    await assert.rejects(issue(newHash), /POMAR_PROJECT_REMOVED/);
    const after = await read();
    const removed = after.projects[0];
    assert.ok(removed.removedAt);
    assert.equal(removed.version, original.version + 1);
    assert.equal(removed.status, original.status);
    assert.equal(removed.notes, original.notes);
    assert.equal(isActiveProject(removed), false);
    assert.ok(
      weekPlan(after, monday).every((day) => day.projects.length === 0),
    );
    assert.ok(
      getAlerts(after, later).every((alert) => alert.category !== "project"),
    );
    for (const key of [
      "tasks",
      "updates",
      "contracts",
      "installments",
      "receipts",
      "allocations",
    ])
      assert.deepEqual(after[key], before[key]);
    const month = date.slice(0, 7);
    assert.deepEqual(
      getFinanceSummary(after, month),
      getFinanceSummary(before, month),
    );
    assert.equal(
      after.history.filter(
        (entry) => entry.action === "remove" && entry.entityId === id,
      ).length,
      1,
    );
    const media = await rpc("select pomar_media_project($1) value", [id]);
    assert.equal(media.expires_at, null);
    assert.equal(media.files[0].id, uploadId);
    await worker("pomar_media_worker");
    assert.equal(await status(hash), null);
    await actor();
    await setRemoved(removed, false);
    assert.ok(isActiveProject((await read()).projects[0]));
    assert.ok((await issue(newHash)).expires_at);
    await worker("pomar_media_worker");
    assert.equal(await status(hash), null);
    assert.ok(await status(newHash));
  } finally {
    await db.close();
  }
});

test("remover e restaurar conserva a conclusão original sem depender da Área VIP", async () => {
  const { db, create, read, setRemoved } = await projectFixture({
    skipMigrations: [
      "20261109015528_portal_vip_midias.sql",
      "20261109173118_remover_midias_vip.sql",
    ],
  });
  try {
    await create("completed");
    const original = (await read()).projects[0];
    assert.ok(original.completedOn);
    await setRemoved(original, true);
    await setRemoved((await read()).projects[0], false);
    const restored = (await read()).projects[0];
    assert.equal(restored.status, "completed");
    assert.equal(restored.completedOn, original.completedOn);
    assert.equal(restored.removedAt, undefined);
  } finally {
    await db.close();
  }
});
