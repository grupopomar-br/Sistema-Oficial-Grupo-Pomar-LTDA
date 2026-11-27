import assert from "node:assert/strict";
import { test } from "node:test";
import { pomarFixture } from "./helpers/pomar-fixture.mjs";
import { newBase } from "../src/lib/domain/model.ts";
import { databaseCommand, camelize } from "../src/lib/domain/transport.ts";
import { parseWorkspace } from "../src/lib/domain/workspace.ts";
import {
  deliveryProgress,
  deliveryQueue,
  recurrencePeriods,
} from "../src/lib/domain/delivery/selectors.ts";
import { deliveryEdit } from "./helpers/delivery-fixture.mjs";

const migration = "20261127111115_central_de_entregas.sql";
test("PostgreSQL 17 protege entregas, transações, evidências, recorrência, reabertura e retorno de versão", async () => {
  const f = await pomarFixture();
  const { db, actor, admin, command, client, other, worker } = f;
  const send = async (c, key = crypto.randomUUID()) =>
    (
      await db.query("select pomar_delivery_command($1,$2::jsonb) result", [
        key,
        JSON.stringify(databaseCommand(c)),
      ])
    ).rows[0].result;
  const read = async () =>
    parseWorkspace(
      camelize(
        (await db.query("select pomar_workspace_deliveries() result")).rows[0]
          .result,
      ),
    );
  try {
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
      name: "Projeto de homologação",
      clientId: client,
      contractorId: null,
      areaId: area.id,
      status: "active",
      priority: "P1",
      startedOn: "2026-01-31",
      dueOn: "2026-07-30",
      nextAction: "Conferir o escopo",
      nextActionOn: "2026-01-31",
      waitingFor: "",
      notes: "",
    };
    await command({ type: "saveProject", value: project });
    const contract = {
      ...newBase(),
      title: "Contrato fictício",
      clientId: client,
      projectId: project.id,
      totalCents: 60001,
      signedOn: "2026-01-30",
      status: "active",
      notes: "Duas publicações por competência.",
    };
    await command({
      type: "createContract",
      value: contract,
      count: 3,
      firstDueOn: "2026-01-31",
    });
    const before = await read();
    const create = {
      type: "createDeliveryPlan",
      id: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectVersion: 1,
      contractId: contract.id,
      expectedContractVersion: 1,
      methodologyId: null,
      playbookKey: "google-business-profile",
      playbookVersion: 1,
      scopeReference: "Contrato de homologação, vigência e escopo conferidos.",
      startsOn: "2026-01-31",
      endsOn: "2026-07-30",
      implementationDueOn: "2026-02-03",
    };
    const key = crypto.randomUUID();
    await send(create, key);
    assert.equal((await send(create, key)).duplicate, true);
    await assert.rejects(
      () => send({ ...create, scopeReference: "Outro escopo de teste." }, key),
      /POMAR_KEY_REUSED/,
    );
    await assert.rejects(
      () => send({ ...create, id: crypto.randomUUID() }),
      /duplicate key/,
    );
    let state = await read();
    assert.equal(state.deliveryItems.length, 26);
    const scope = state.deliveryItems.find((i) => i.stepKey === "scope");
    await assert.rejects(
      () =>
        command({
          type: "setTaskStatus",
          id: scope.id,
          expectedVersion: 1,
          status: "done",
        }),
      /POMAR_DELIVERY_TASK/,
    );
    await assert.rejects(
      () =>
        db.query("update pomar_tasks set title='Nome adulterado' where id=$1", [
          scope.id,
        ]),
      /POMAR_DELIVERY_TASK/,
    );
    await assert.rejects(
      () => send(deliveryEdit(state, scope, { status: "done" })),
      /POMAR_DELIVERY_ACCEPTANCE/,
    );
    await assert.rejects(
      () =>
        send(
          deliveryEdit(state, scope, {
            status: "not_applicable",
            reason: "Tentativa de dispensar item obrigatório.",
          }),
        ),
      /POMAR_DELIVERY_EXCLUDE/,
    );
    await assert.rejects(
      () => send(deliveryEdit(state, scope, { status: "waiting_client" })),
      /POMAR_DELIVERY_DEPENDENCY/,
    );
    await assert.rejects(
      () =>
        send(
          deliveryEdit(state, scope, {
            status: "review",
            completedQuantity: 1,
          }),
        ),
      /POMAR_DELIVERY_EVIDENCE/,
    );
    await send(
      deliveryEdit(state, scope, {
        status: "review",
        completedQuantity: 1,
        acceptedCriteria: scope.criteria,
        evidenceReference: "https://example.com/escopo-ficticio",
        performedOn: "2026-01-31",
      }),
    );
    state = await read();
    await assert.rejects(
      () =>
        send(
          deliveryEdit(
            state,
            state.deliveryItems.find((i) => i.id === scope.id),
            { status: "done", acceptedCriteria: [] },
          ),
        ),
      /POMAR_DELIVERY_ACCEPTANCE/,
    );
    const old = state.tasks.find((t) => t.id === scope.id);
    const finish = deliveryEdit(
      state,
      state.deliveryItems.find((i) => i.id === scope.id),
      { status: "done" },
    );
    await send(finish);
    await assert.rejects(
      () => send({ ...finish, status: "doing" }),
      /POMAR_CONFLICT/,
    );
    state = await read();
    assert.equal(
      state.tasks.find((t) => t.id === scope.id).version,
      old.version + 1,
    );
    const focusTask = state.tasks.find((t) => t.id === scope.id);
    await command({
      type: "saveTask",
      value: { ...focusTask, focusOn: "2026-02-01" },
    });
    state = await read();
    const access = state.deliveryItems.find(
      (i) => i.stepKey === "authorization",
    );
    await send(
      deliveryEdit(state, access, {
        status: "waiting_client",
        dependency: "Cliente deve aprovar o acesso solicitado.",
        nextAction: "Solicitar confirmação por telefone.",
      }),
    );
    const legacy = camelize(
      (await db.query("select pomar_workspace_project_updates() result"))
        .rows[0].result,
    );
    assert.equal(
      legacy.tasks.find((t) => t.id === access.id).status,
      "blocked",
    );
    const plan = state.deliveryPlans[0];
    const rules = [
      {
        key: crypto.randomUUID(),
        title: "Publicações contratadas",
        targetQuantity: 2,
        criteria: ["Publicação autorizada e visível no perfil."],
        dueOffset: null,
      },
    ];
    await send({
      type: "scheduleDeliveryRecurrence",
      planId: plan.id,
      expectedVersion: plan.version,
      rules,
    });
    state = await read();
    assert.equal(recurrencePeriods(state, plan.id).length, 6);
    await send({
      type: "scheduleDeliveryRecurrence",
      planId: plan.id,
      expectedVersion: state.deliveryPlans[0].version,
      rules,
    });
    state = await read();
    assert.equal(
      state.deliveryItems.filter((i) => i.phase === "recurring").length,
      6,
    );
    await assert.rejects(
      () =>
        send({
          type: "scheduleDeliveryRecurrence",
          planId: plan.id,
          expectedVersion: state.deliveryPlans[0].version,
          rules: [{ ...rules[0], targetQuantity: 3 }],
        }),
      /POMAR_DELIVERY_SCHEDULE/,
    );
    const recurring = state.deliveryItems.find((i) => i.phase === "recurring");
    await send(
      deliveryEdit(state, recurring, {
        status: "doing",
        completedQuantity: 1,
        evidenceReference: "https://example.com/publicacao-1",
        performedOn: "2026-02-01",
      }),
    );
    state = await read();
    assert.equal(
      state.deliveryItems.find((i) => i.id === recurring.id).completedQuantity,
      1,
    );
    assert.equal(
      deliveryProgress(
        state,
        state.deliveryItems.filter((i) => i.phase === "recurring"),
      ).percent,
      0,
    );
    await send(
      deliveryEdit(
        state,
        state.deliveryItems.find((i) => i.id === recurring.id),
        {
          status: "review",
          completedQuantity: 2,
          acceptedCriteria: recurring.criteria,
          evidenceReference: "https://example.com/publicacao-2",
          performedOn: "2026-02-02",
        },
      ),
    );
    state = await read();
    await send(
      deliveryEdit(
        state,
        state.deliveryItems.find((i) => i.id === recurring.id),
        { status: "done" },
      ),
    );
    state = await read();
    assert.equal(
      deliveryProgress(
        state,
        state.deliveryItems.filter((i) => i.phase === "recurring"),
      ).validatedQuantity,
      2,
    );
    const handover = state.deliveryItems.find((i) => i.stepKey === "handover");
    await send(
      deliveryEdit(state, handover, {
        status: "review",
        completedQuantity: 1,
        acceptedCriteria: handover.criteria,
        evidenceReference: "Arquivo privado de entrega fictícia",
        performedOn: "2026-02-03",
      }),
    );
    state = await read();
    await assert.rejects(
      () =>
        send(
          deliveryEdit(
            state,
            state.deliveryItems.find((i) => i.id === handover.id),
            { status: "done" },
          ),
        ),
      /POMAR_DELIVERY_DEPENDENCY/,
    );
    for (const step of state.servicePlaybooks[0].steps) {
      state = await read();
      const item = state.deliveryItems.find(
        (i) => i.phase === "implementation" && i.stepKey === step.key,
      );
      const task = state.tasks.find((t) => t.id === item.id);
      if (task.status === "done") continue;
      if (!item.required) {
        await send(
          deliveryEdit(state, item, {
            status: "not_applicable",
            reason: "Serviço fora do escopo de homologação.",
          }),
        );
        continue;
      }
      if (task.status !== "review")
        await send(
          deliveryEdit(state, item, {
            status: "review",
            completedQuantity: 1,
            acceptedCriteria: item.criteria,
            evidenceReference: "Registro privado de conferência " + step.key,
            performedOn: "2026-02-03",
          }),
        );
      state = await read();
      await send(
        deliveryEdit(
          state,
          state.deliveryItems.find((i) => i.id === item.id),
          { status: "done" },
        ),
      );
    }
    state = await read();
    assert.equal(
      deliveryProgress(
        state,
        state.deliveryItems.filter((i) => i.phase === "implementation"),
      ).percent,
      100,
    );
    assert.equal(state.projects[0].status, "active");
    assert.equal(state.contracts[0].status, "active");
    assert(
      deliveryQueue(state, "2026-11-27").some(
        (r) => r.item.phase === "recurring" && r.late,
      ),
    );
    await send(
      deliveryEdit(
        state,
        state.deliveryItems.find((i) => i.id === scope.id),
        {
          status: "pending",
          reason: "Cliente corrigiu o escopo e exige revalidação.",
        },
      ),
    );
    state = await read();
    assert.equal(
      state.tasks.find((t) => t.id === handover.id).status,
      "review",
    );
    assert(
      deliveryProgress(
        state,
        state.deliveryItems.filter((i) => i.phase === "implementation"),
      ).percent < 100,
    );
    assert(
      state.deliveryEvents.some(
        (e) => e.operation === "reopen" && e.itemId === handover.id,
      ),
    );
    for (const entity of [
      "contracts",
      "installments",
      "receipts",
      "allocations",
      "charges",
      "providerPayments",
      "refunds",
      "expenses",
    ])
      assert.deepEqual(state[entity], before[entity]);
    await actor(other);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from pomar_private.delivery_items",
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      () => db.query("select pomar_workspace_deliveries()"),
      /POMAR_ACCESS/,
    );
    await assert.rejects(() => send(create), /POMAR_ACCESS/);
    await worker();
    await assert.rejects(
      () =>
        db.query("select pomar_delivery_command($1,$2)", [
          crypto.randomUUID(),
          {},
        ]),
      /permission denied/,
    );
    await admin();
    await db.exec("set role anon");
    await assert.rejects(
      () => db.query("select pomar_workspace_deliveries()"),
      /permission denied/,
    );
    await admin();
    await assert.rejects(
      () =>
        db.query("update pomar_private.service_playbooks set definition='{}'"),
      /POMAR_IMMUTABLE/,
    );
    await assert.rejects(
      () => db.query("delete from pomar_private.delivery_evidence"),
      /POMAR_IMMUTABLE/,
    );
  } finally {
    await db.close();
  }
});
