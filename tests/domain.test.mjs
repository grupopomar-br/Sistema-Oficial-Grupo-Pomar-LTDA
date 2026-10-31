import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, newBase } from "../src/lib/domain/model.ts";
import {
  applyCommand,
  parseWorkspace,
  installmentRemaining,
} from "../src/lib/domain/workspace.ts";
import { parseBRL, summarizeReceipts } from "../src/lib/domain/finance.ts";
import {
  todayDate,
  addMonthsClamped,
  fullDate,
  isDateOnly,
} from "../src/lib/domain/dates.ts";
import {
  getFinanceSummary,
  getDailyFocus,
  getAlerts,
} from "../src/lib/domain/selectors.ts";
import { exportBackup, importBackup, toCsv } from "../src/lib/domain/backup.ts";
import { demonstrationWorkspace } from "../src/lib/domain/demo.ts";
const now = "2026-10-28T15:00:00Z",
  uuid = () => crypto.randomUUID();
function setup() {
  let state = emptyWorkspace(now);
  const client = {
    ...newBase(now),
    name: "Cliente exemplo",
    kind: "business",
    city: "",
    segment: "",
    contactName: "",
    email: "",
    phone: "",
    website: "",
    notes: "",
    status: "active",
  };
  state = applyCommand(
    state,
    { commandId: uuid(), command: { type: "saveClient", value: client } },
    now,
  );
  return { state, client };
}
function run(s, c, key = uuid()) {
  return applyCommand(s, { commandId: key, command: c }, now);
}
function financed(total = 10001, count = 3) {
  let { state, client } = setup();
  const contract = {
    ...newBase(now),
    title: "Serviço exemplo",
    clientId: client.id,
    projectId: null,
    totalCents: total,
    signedOn: "2026-10-01",
    status: "active",
    notes: "",
  };
  state = run(state, {
    type: "createContract",
    value: contract,
    count,
    firstDueOn: "2026-10-31",
  });
  return { state, contract };
}
test("valores BRL são exatos e recusam notação ambígua, negativa e excesso", () => {
  for (const [input, expected] of [
    ["1.234,56", 123456],
    ["R$ 0,01", 1],
    ["100", 10000],
    ["0,00", 0],
  ])
    assert.equal(parseBRL(input), expected);
  for (const input of [
    "1.23",
    "1,2",
    "-10,00",
    "1e6",
    "1.23,45",
    "Infinity",
    "90071992547409,92",
  ])
    assert.throws(() => parseBRL(input));
});
test("datas usam o fuso da operação e parcelas mantêm o dia quando possível", () => {
  assert.equal(todayDate(new Date("2026-10-29T01:00:00Z")), "2026-10-28");
  assert.equal(fullDate("2026-10-29T01:00:00Z"), "28/10/2026");
  assert.equal(fullDate("2026-10-29"), "29/10/2026");
  assert.equal(addMonthsClamped("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonthsClamped("2026-01-31", 2), "2026-03-31");
  assert.equal(isDateOnly("2026-02-29"), false);
  assert.equal(isDateOnly("0000-01-01"), false);
});
test("contratos não viram caixa; centavos se distribuem sem arredondamento acumulado", () => {
  for (let count = 1; count <= 120; count++) {
    const { state, contract } = financed(10001, count);
    assert.equal(
      state.installments.reduce((s, i) => s + i.amountCents, 0),
      contract.totalCents,
    );
    assert.equal(state.installments.length, count);
    assert.equal(getFinanceSummary(state, "2026-10").received, 0);
  }
});
test("pagamentos parciais são idempotentes e sobrepagamento não modifica o original", () => {
  const initial = financed();
  const part = initial.state.installments[0];
  const key = uuid(),
    command = {
      type: "postReceipt",
      installmentId: part.id,
      amountCents: 1000,
      receivedOn: "2026-10-20",
    };
  const state = run(initial.state, command, key);
  assert.equal(installmentRemaining(state, part.id), 2334);
  assert.equal(getFinanceSummary(state, "2026-10").received, 1000);
  assert.equal(run(state, command, key), state);
  assert.equal(initial.state.receipts.length, 0);
  assert.throws(() => run(state, { ...command, amountCents: 2335 }), /supera/);
  assert.equal(state.receipts.length, 1);
  assert.throws(
    () => run(state, { ...command, receivedOn: "2026-10-29" }),
    /futuro/,
  );
});
test("conciliação muda o mês, estorno reabre saldo e cancelamento preserva fatos", () => {
  let { state, contract } = financed();
  const part = state.installments[0],
    key = uuid();
  state = run(
    state,
    {
      type: "postReceipt",
      installmentId: part.id,
      amountCents: 1000,
      receivedOn: null,
    },
    key,
  );
  assert.equal(getFinanceSummary(state, "2026-10").received, 0);
  assert.equal(getFinanceSummary(state, "2026-10").undated, 1000);
  state = run(state, {
    type: "dateReceipt",
    id: key,
    receivedOn: "2026-10-01",
  });
  assert.equal(state.receipts.length, 1);
  assert.equal(getFinanceSummary(state, "2026-10").received, 1000);
  assert.throws(() =>
    run(state, { type: "dateReceipt", id: key, receivedOn: "2026-10-02" }),
  );
  state = run(state, {
    type: "voidReceipt",
    id: key,
    reason: "Correção de registro",
  });
  assert.equal(installmentRemaining(state, part.id), 3334);
  assert.equal(getFinanceSummary(state, "2026-10").received, 0);
  state = run(state, {
    type: "cancelContract",
    id: contract.id,
    reason: "Cancelamento solicitado",
  });
  assert.equal(state.receipts.length, 1);
  assert.equal(getFinanceSummary(state, "2026-10").contractBalance, 0);
  assert.throws(() =>
    run(state, {
      type: "postReceipt",
      installmentId: part.id,
      amountCents: 1,
      receivedOn: null,
    }),
  );
});
test("versões recusam edição concorrente e notas longas permanecem completas", () => {
  let { state } = setup();
  const project = {
    ...newBase(now),
    name: "Projeto exemplo",
    clientId: null,
    contractorId: null,
    areaId: state.areas[0].id,
    status: "active",
    priority: "P1",
    startedOn: null,
    dueOn: null,
    nextAction: "Entregar escopo",
    nextActionOn: null,
    waitingFor: "",
    notes: "",
  };
  state = run(state, { type: "saveProject", value: project });
  state = run(state, {
    type: "saveProject",
    value: { ...project, name: "Nome novo" },
  });
  assert.throws(
    () => run(state, { type: "saveProject", value: project }),
    /alterado/,
  );
  const message = "Uma decisão com detalhes. ".repeat(100);
  state = run(state, { type: "addUpdate", projectId: project.id, message });
  assert.equal(state.updates[0].message, message.trim());
  assert.equal(state.history[0].summary.length, 500);
  assert.equal(state.projects[0].version, 3);
  assert.throws(
    () =>
      run(state, {
        type: "saveSettings",
        value: state.settings,
        expectedRevision: 0,
      }),
    /mudaram/,
  );
});
test("backup valida dinheiro, vínculos e duplicações; CSV neutraliza fórmulas", () => {
  const { state } = financed();
  assert.deepEqual(importBackup(exportBackup(state)), state);
  const invalid = structuredClone(state);
  invalid.installments[0].amountCents += 1;
  assert.throws(() => importBackup(exportBackup(invalid)), /Parcelas/);
  const invalid2 = structuredClone(state);
  invalid2.contracts[0].clientId = uuid();
  assert.throws(() => parseWorkspace(invalid2), /vínculo/);
  assert.throws(() => importBackup("x".repeat(5 * 1024 * 1024 + 1)), /limite/);
  const csv = toCsv(["Nome"], [["=1+1"], ["  @SUM(A1)"], ['a;"b']]);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'  @SUM(A1)"'));
  assert.ok(csv.includes('"a;""b"'));
});
test("foco tem limite, tarefas concluídas saem de alertas e a conversão não duplica projeto", () => {
  let state = demonstrationWorkspace(new Date(now));
  assert.equal(getDailyFocus(state, "2026-10-28").length <= 5, true);
  const task = state.tasks.find(
    (t) => t.dueOn < "2026-10-28" && t.status !== "done",
  );
  assert.ok(task);
  assert.ok(getAlerts(state, "2026-10-28").some((a) => a.entityId === task.id));
  state = run(state, {
    type: "setTaskStatus",
    id: task.id,
    status: "done",
    expectedVersion: task.version,
  });
  assert.equal(
    getAlerts(state, "2026-10-28").some((a) => a.entityId === task.id),
    false,
  );
  const opp = state.opportunities[0];
  const command = {
    type: "convertOpportunity",
    id: opp.id,
    projectId: uuid(),
    areaId: state.areas[0].id,
    dueOn: null,
  };
  state = run(state, command);
  const count = state.projects.length;
  state = run(state, { ...command, projectId: uuid() });
  assert.equal(state.projects.length, count);
});
test("resumos recusam recebimentos duplicados e datas civis inexistentes", () => {
  const r = {
    id: "exemplo",
    amountCents: 1,
    receivedOn: null,
    status: "confirmed",
  };
  assert.equal(summarizeReceipts([r], "2026-10").undatedReceivedCents, 1);
  assert.throws(() => summarizeReceipts([r, r], "2026-10"));
  assert.throws(() =>
    summarizeReceipts([{ ...r, receivedOn: "2026-02-30" }], "2026-10"),
  );
});
