import { test } from "node:test";
import assert from "node:assert/strict";
import { projectDurationLabel } from "../src/lib/domain/dates.ts";
import { databaseCommand } from "../src/lib/domain/transport.ts";
import { emptyWorkspace, newBase } from "../src/lib/domain/model.ts";
import { applyCommand } from "../src/lib/domain/workspace.ts";
import { fetchWorkspaceSnapshot } from "../src/lib/domain/workspace-snapshot.ts";

test("contagem de projeto usa dias civis e distingue o início futuro", () => {
  const project = { startedOn: "2024-02-28", status: "active" };
  assert.equal(
    projectDurationLabel(project, "2024-03-01"),
    "2 dias corridos desde o início",
  );
  assert.equal(projectDurationLabel(project, "2024-02-28"), "Início hoje");
  assert.equal(projectDurationLabel(project, "2024-02-27"), "Início em 1 dia");
  assert.equal(
    projectDurationLabel({ ...project, status: "paused" }, "2024-03-01"),
    "2 dias corridos desde o início",
  );
});

test("conclusão usa a data efetiva e não inventa data para registros antigos", () => {
  const project = { startedOn: "2026-01-01", status: "completed" };
  assert.equal(
    projectDurationLabel(project, "2026-03-01"),
    "Conclusão sem data registrada",
  );
  assert.equal(
    projectDurationLabel(
      { ...project, completedOn: "2026-01-03" },
      "2026-03-01",
    ),
    "2 dias corridos até a conclusão",
  );
  assert.equal(
    projectDurationLabel(
      { ...project, completedOn: "2026-01-01" },
      "2026-03-01",
    ),
    "Concluído no mesmo dia",
  );
  assert.equal(
    projectDurationLabel(
      { ...project, completedOn: "2025-12-31" },
      "2026-03-01",
    ),
    "Datas do projeto inconsistentes",
  );
  assert.equal(
    projectDurationLabel({ ...project, startedOn: null }, "2026-03-01"),
    "Início não informado",
  );
  assert.equal(
    projectDurationLabel({ ...project, status: "cancelled" }, "2026-03-01"),
    "Projeto cancelado",
  );
});

test("comandos de projeto não enviam uma data de conclusão controlada pelo cliente", () => {
  const command = {
    type: "saveProject",
    value: {
      id: "fixture",
      completedOn: "2026-01-03",
      startedOn: "2026-01-01",
    },
  };
  assert.deepEqual(databaseCommand(command), {
    type: "saveProject",
    value: { id: "fixture", started_on: "2026-01-01" },
  });
  assert.equal(command.value.completedOn, "2026-01-03");
  assert.deepEqual(databaseCommand({ ownerConfirmedBy: "fixture" }), {
    owner_confirmed_by: "fixture",
  });
});

test("modo local registra conclusão no fuso da operação e limpa ao reabrir", () => {
  const now = "2026-10-28T12:00:00Z";
  let state = emptyWorkspace(now);
  const project = {
    ...newBase(now),
    name: "Projeto fictício",
    clientId: null,
    contractorId: null,
    areaId: state.areas[0].id,
    status: "active",
    priority: "P2",
    startedOn: "2026-10-01",
    dueOn: null,
    nextAction: "",
    nextActionOn: null,
    waitingFor: "",
    notes: "",
  };
  const save = (value, at) => {
    state = applyCommand(
      state,
      {
        commandId: crypto.randomUUID(),
        command: { type: "saveProject", value },
      },
      at,
    );
  };
  save(project, now);
  save({ ...state.projects[0], status: "completed" }, "2026-10-29T01:00:00Z");
  assert.equal(state.projects[0].completedOn, "2026-10-28");
  save({ ...state.projects[0], name: "Nome alterado" }, "2026-11-01T12:00:00Z");
  assert.equal(state.projects[0].completedOn, "2026-10-28");
  save({ ...state.projects[0], status: "active" }, "2026-11-01T12:00:00Z");
  assert.equal(state.projects[0].completedOn, null);
});

test("snapshot novo recua apenas quando a função ainda não está no cache do PostgREST", async () => {
  const calls = [];
  const result = await fetchWorkspaceSnapshot(async (name) => {
    calls.push(name);
    return name === "pomar_workspace_enriched"
      ? { data: null, error: { code: "PGRST202" } }
      : { data: { projects: [] }, error: null };
  });
  assert.deepEqual(calls, ["pomar_workspace_enriched", "pomar_workspace"]);
  assert.deepEqual(result.data, { projects: [] });
  for (const code of ["42501", "PGRST000", "P0001"]) {
    let count = 0;
    const rejected = await fetchWorkspaceSnapshot(async () => {
      count++;
      return { data: null, error: { code } };
    });
    assert.equal(count, 1);
    assert.equal(rejected.error.code, code);
  }
});
