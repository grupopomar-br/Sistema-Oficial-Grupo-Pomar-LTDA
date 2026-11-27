import { emptyWorkspace, newBase } from "../../src/lib/domain/model.ts";
import { applyCommand } from "../../src/lib/domain/workspace.ts";

export function deliveryExample(now = "2026-11-27T12:00:00Z") {
  let state = emptyWorkspace(now);
  const send = (command) =>
    (state = applyCommand(
      state,
      { commandId: crypto.randomUUID(), command },
      now,
    ));
  const client = {
    ...newBase(now),
    name: "Cliente de homologação",
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
  send({ type: "saveClient", value: client });
  const project = {
    ...newBase(now),
    name: "Implantação de exemplo",
    clientId: client.id,
    contractorId: null,
    areaId: state.areas[0].id,
    status: "active",
    priority: "P2",
    startedOn: "2026-01-31",
    dueOn: "2026-07-30",
    nextAction: "Validar o escopo",
    nextActionOn: "2026-01-31",
    waitingFor: "",
    notes: "",
  };
  send({ type: "saveProject", value: project });
  const contract = {
    ...newBase(now),
    title: "Escopo fictício de seis meses",
    clientId: client.id,
    projectId: project.id,
    totalCents: 60000,
    signedOn: "2026-01-30",
    status: "active",
    notes: "Duas publicações por competência.",
  };
  send({
    type: "createContract",
    value: contract,
    count: 3,
    firstDueOn: "2026-01-31",
  });
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
    scopeReference: "Contrato fictício e escopo de homologação conferidos.",
    startsOn: "2026-01-31",
    endsOn: "2026-07-30",
    implementationDueOn: "2026-02-03",
  };
  const rules = [
    {
      key: crypto.randomUUID(),
      title: "Publicações previstas no escopo",
      targetQuantity: 2,
      criteria: ["Conteúdo autorizado e visível no perfil."],
      dueOffset: null,
    },
  ];
  return {
    get state() {
      return state;
    },
    send,
    project,
    contract,
    create,
    rules,
    now,
  };
}
export function deliveryEdit(state, item, changes = {}) {
  const task = state.tasks.find((t) => t.id === item.id);
  return {
    type: "recordDeliveryTask",
    id: item.id,
    expectedVersion: task.version,
    status: task.status,
    dueOn: task.dueOn,
    completedQuantity: item.completedQuantity,
    acceptedCriteria: item.acceptedCriteria,
    nextAction: item.nextAction,
    dependency: item.dependency,
    reason: "",
    evidenceReference: "",
    performedOn: null,
    ...changes,
  };
}
