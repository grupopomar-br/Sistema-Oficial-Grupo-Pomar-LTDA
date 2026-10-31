import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, newBase } from "../src/lib/domain/model.ts";
import {
  applyCommand,
  parseWorkspace,
  installmentRemaining,
} from "../src/lib/domain/workspace.ts";
import {
  collectionRows,
  collectionSummary,
  contractGate,
  reminderDraft,
} from "../src/lib/domain/collections.ts";
const now = "2026-10-29T15:00:00Z",
  today = "2026-10-29";
const run = (state, command) =>
  applyCommand(state, { commandId: crypto.randomUUID(), command }, now);
function fixture() {
  let state = emptyWorkspace(now);
  const client = {
    ...newBase(now),
    name: "Cliente de exemplo",
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
  state = run(state, { type: "saveClient", value: client });
  const project = {
    ...newBase(now),
    name: "Projeto exemplo",
    clientId: client.id,
    contractorId: null,
    areaId: state.areas[0].id,
    status: "planning",
    priority: "P2",
    startedOn: null,
    dueOn: null,
    nextAction: "Definir início",
    nextActionOn: null,
    waitingFor: "",
    notes: "",
  };
  state = run(state, { type: "saveProject", value: project });
  const contract = {
    ...newBase(now),
    title: "Contrato exemplo",
    clientId: client.id,
    projectId: project.id,
    totalCents: 10000,
    signedOn: "2026-10-01",
    status: "active",
    notes: "",
  };
  state = run(state, {
    type: "createContract",
    value: contract,
    count: 1,
    firstDueOn: "2026-10-01",
  });
  return { state, client, project, contract, part: state.installments[0] };
}
test("condições propostas não viram aceite e entrada aceita protege o início do projeto", () => {
  let { state, contract, project, part } = fixture();
  let agreement = {
    ...newBase(now),
    contractId: contract.id,
    initialCents: 5000,
    gate: "initial",
    graceDays: 0,
    acceptedOn: null,
    termsReference: "",
    notes: "",
  };
  state = run(state, { type: "saveCollectionAgreement", value: agreement });
  assert.equal(contractGate(state, contract.id).state, "proposed");
  agreement = {
    ...state.collectionAgreements[0],
    acceptedOn: "2026-10-01",
    termsReference: "Aceite de teste",
  };
  state = run(state, { type: "saveCollectionAgreement", value: agreement });
  assert.throws(
    () =>
      run(state, {
        type: "saveProject",
        value: { ...project, status: "active" },
      }),
    /condição de pagamento/,
  );
  state = run(state, {
    type: "postReceipt",
    installmentId: part.id,
    amountCents: 5000,
    receivedOn: "2026-10-01",
  });
  assert.equal(contractGate(state, contract.id).state, "released");
  state = run(state, {
    type: "saveProject",
    value: { ...project, status: "active" },
  });
  assert.equal(state.projects[0].status, "active");
});
test("cobrança mostra saldo e atraso reais; promessa vencida não inventa encargos", () => {
  let { state, part } = fixture();
  state = run(state, {
    type: "postReceipt",
    installmentId: part.id,
    amountCents: 2500,
    receivedOn: "2026-10-01",
  });
  state = run(state, {
    type: "addCollectionAction",
    value: {
      ...newBase(now),
      installmentId: part.id,
      kind: "promise",
      channel: "phone",
      note: "Cliente informou previsão no contato de teste.",
      promiseOn: "2026-10-20",
    },
  });
  const summary = collectionSummary(state, today);
  assert.equal(summary.overdue, 7500);
  assert.equal(summary.rows[0].age, 28);
  assert.equal(summary.brokenPromises, 1);
  assert.equal(summary.rows[0].bucket, "16_30");
});
test("rascunho nunca oferece sandbox ou link com valor antigo ao cliente", () => {
  const { state, part } = fixture();
  state.charges.push({
    ...newBase(now),
    installmentId: part.id,
    provider: "mercadopago",
    status: "ready",
    mode: "test",
    amountCents: 10000,
    expiresAt: "2099-01-01T00:00:00Z",
    checkoutUrl:
      "https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=test",
    preferenceId: "test",
  });
  let row = collectionRows(state, today)[0];
  assert.equal(
    reminderDraft(row, "Empresa exemplo", today).includes("sandbox"),
    false,
  );
  state.charges[0].mode = "live";
  state.charges[0].checkoutUrl =
    "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test";
  row = collectionRows(state, today)[0];
  assert.ok(
    reminderDraft(row, "Empresa exemplo", today).includes(
      "https://www.mercadopago",
    ),
  );
  state.charges[0].amountCents = 9999;
  row = collectionRows(state, today)[0];
  assert.equal(
    reminderDraft(row, "Empresa exemplo", today).includes(
      "https://www.mercadopago",
    ),
    false,
  );
});
test("backup recusa devolução que excede a alocação original", () => {
  let { state, part, contract } = fixture();
  state = run(state, {
    type: "postReceipt",
    installmentId: part.id,
    amountCents: 10000,
    receivedOn: "2026-10-01",
  });
  const receipt = state.receipts[0];
  const payment = {
    ...newBase(now),
    provider: "mercadopago",
    providerPaymentId: "1234",
    chargeId: null,
    receiptId: receipt.id,
    amountCents: 10000,
    feeCents: null,
    refundedCents: 1000,
    currency: "BRL",
    status: "approved",
    mode: "live",
    paidOn: "2026-10-01",
    providerUpdatedAt: now,
    reviewReason: "",
  };
  state.providerPayments.push(payment);
  state.refunds.push({
    ...newBase(now),
    receiptId: receipt.id,
    installmentId: part.id,
    providerPaymentId: payment.id,
    providerRefundId: "1",
    amountCents: 1000,
    occurredOn: "2026-10-02",
    reason: "refund",
  });
  state = parseWorkspace(state);
  assert.equal(installmentRemaining(state, part.id), 1000);
  const invalid = structuredClone(state);
  invalid.refunds[0].amountCents = 10001;
  assert.throws(() => parseWorkspace(invalid), /Devoluç/);
});
