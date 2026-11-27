import assert from "node:assert/strict";
import { test } from "node:test";
import { newBase } from "../src/lib/domain/model.ts";
import { applyCommand, parseWorkspace } from "../src/lib/domain/workspace.ts";
import { contractPeriods } from "../src/lib/domain/delivery/operations.ts";
import {
  deliveryProgress,
  deliveryQueue,
  recurrencePeriods,
} from "../src/lib/domain/delivery/selectors.ts";
import { projectProgress } from "../src/lib/domain/project-progress.ts";
import { exportBackup, importBackup } from "../src/lib/domain/backup.ts";

import { deliveryExample, deliveryEdit } from "./helpers/delivery-fixture.mjs";

test("competências usam aniversário mensal, final inclusivo, ano bissexto e prazo parcial", () => {
  const periods = contractPeriods("2026-01-31", "2026-07-30");
  assert.equal(periods.length, 6);
  assert.deepEqual(periods.slice(0, 3), [
    { start: "2026-01-31", end: "2026-02-27" },
    { start: "2026-02-28", end: "2026-03-30" },
    { start: "2026-03-31", end: "2026-04-29" },
  ]);
  assert.deepEqual(contractPeriods("2028-01-31", "2028-02-29")[1], {
    start: "2028-02-29",
    end: "2028-02-29",
  });
  assert.deepEqual(contractPeriods("2026-12-20", "2027-01-08"), [
    { start: "2026-12-20", end: "2027-01-08" },
  ]);
  assert.deepEqual(contractPeriods("9999-12-01", "9999-12-31"), [
    { start: "9999-12-01", end: "9999-12-31" },
  ]);
  assert.throws(() => contractPeriods("2026-02-01", "2026-01-01"));
  assert.throws(() => contractPeriods("2026-01-01", "2036-01-01"));
});

test("implantação valida critérios e evidências, preserva avanço manual e programa o contrato sem usar parcelas", () => {
  const example = deliveryExample();
  example.send(example.create);
  const items = example.state.deliveryItems;
  assert.equal(items.length, 26);
  assert.equal(
    deliveryQueue(example.state, "2026-11-27")[0].item.stepKey,
    "scope",
  );
  assert.equal(
    deliveryQueue(example.state, "2026-11-27").filter((row) => row.ready)
      .length,
    1,
  );
  assert.equal(deliveryProgress(example.state, items).percent, 0);
  const scope = items.find((i) => i.stepKey === "scope");
  assert.throws(
    () => example.send(deliveryEdit(example.state, scope, { status: "done" })),
    /validação/,
  );
  assert.throws(
    () =>
      example.send({
        type: "setTaskStatus",
        id: scope.id,
        expectedVersion: 1,
        status: "done",
      }),
    /entrega/,
  );
  example.send(
    deliveryEdit(example.state, scope, {
      status: "review",
      completedQuantity: 1,
      acceptedCriteria: scope.criteria,
      evidenceReference: "Arquivo privado de escopo fictício",
      performedOn: "2026-01-31",
    }),
  );
  example.send(
    deliveryEdit(
      example.state,
      example.state.deliveryItems.find((i) => i.id === scope.id),
      { status: "done" },
    ),
  );
  assert(
    deliveryProgress(example.state, example.state.deliveryItems).percent > 0,
  );
  assert.equal(
    projectProgress(example.state, example.state.projects[0]).percent,
    0,
  );
  example.send({
    type: "recordProjectUpdate",
    projectId: example.project.id,
    expectedVersion: example.state.projects[0].version,
    message: "Avanço geral informado na homologação.",
    progressPercent: 37,
    nextAction: "Conferir a autorização",
    nextActionOn: "2026-11-27",
  });
  assert.equal(
    projectProgress(example.state, example.state.projects[0]).percent,
    37,
  );
  const conditional = example.state.deliveryItems.find(
    (i) => i.stepKey === "website",
  );
  example.send(
    deliveryEdit(example.state, conditional, {
      status: "not_applicable",
      reason: "Serviço de site fora do escopo contratado.",
    }),
  );
  assert.equal(
    deliveryProgress(example.state, example.state.deliveryItems).excluded,
    1,
  );
  const plan = example.state.deliveryPlans[0];
  example.send({
    type: "scheduleDeliveryRecurrence",
    planId: plan.id,
    expectedVersion: plan.version,
    rules: example.rules,
  });
  assert.equal(recurrencePeriods(example.state, plan.id).length, 6);
  assert.equal(example.state.installments.length, 3);
  const fresh = example.state.deliveryPlans[0];
  example.send({
    type: "scheduleDeliveryRecurrence",
    planId: plan.id,
    expectedVersion: fresh.version,
    rules: example.rules,
  });
  assert.equal(
    example.state.deliveryItems.filter((i) => i.phase === "recurring").length,
    6,
  );
  const stale = structuredClone(example.state);
  delete stale.deliveryReady;
  delete stale.deliveryItems;
  delete stale.deliveryPlans;
  delete stale.deliveryEvidence;
  delete stale.deliveryEvents;
  delete stale.servicePlaybooks;
  stale.tasks = stale.tasks.filter(
    (t) => !example.state.deliveryItems.some((i) => i.id === t.id),
  );
  assert.equal(parseWorkspace(stale).deliveryReady, false);
  assert.deepEqual(
    importBackup(exportBackup(example.state)).deliveryItems,
    example.state.deliveryItems,
  );
  const recurrent = example.state.deliveryItems.find(
    (i) => i.phase === "recurring",
  );
  example.send(
    deliveryEdit(example.state, recurrent, {
      status: "doing",
      dueOn: "2026-12-01",
      reason: "Novo prazo confirmado com o cliente.",
    }),
  );
  assert(
    deliveryQueue(example.state, "2026-11-27").find(
      (r) => r.item.id === recurrent.id,
    ).late,
  );
  assert.equal(
    example.state.deliveryItems.find((i) => i.id === recurrent.id)
      .originalDueOn,
    "2026-02-27",
  );
  assert.equal(
    projectProgress(example.state, example.state.projects[0]).percent,
    37,
  );
  const changedCriteria = structuredClone(example.state);
  changedCriteria.deliveryItems[0].criteria = [
    "Critério sem vínculo com a metodologia.",
  ];
  assert.throws(() => parseWorkspace(changedCriteria), /divergem/);
  const corrupted = structuredClone(example.state);
  corrupted.deliveryItems[0].planId = crypto.randomUUID();
  assert.throws(() => parseWorkspace(corrupted), /etapas ausentes/);
});

test("plano de parceria aceita o contratante cadastrado e preserva o cliente atendido", () => {
  const example = deliveryExample();
  const workspace = structuredClone(example.state);
  const partner = {
    ...workspace.clients[0],
    ...newBase(example.now),
    name: "Parceiro de homologação",
  };
  workspace.clients.push(partner);
  workspace.projects[0].contractorId = partner.id;
  workspace.contracts[0].clientId = partner.id;
  const result = applyCommand(
    workspace,
    { commandId: crypto.randomUUID(), command: example.create },
    example.now,
  );
  assert.equal(result.deliveryPlans[0].contractId, workspace.contracts[0].id);
  assert.equal(result.projects[0].clientId, workspace.projects[0].clientId);
  assert.equal(result.clients.length, workspace.clients.length);
});
