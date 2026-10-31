import { newId } from "./id.ts";
import {
  emptyWorkspace,
  newBase,
  type Workspace,
  type Command,
} from "./model.ts";
import { applyCommand } from "./workspace.ts";
import { addMonthsClamped, todayDate } from "./dates.ts";

// Somente exemplos fictícios, carregados por ação explícita no modo local vazio.
export function demonstrationWorkspace(at = new Date()): Workspace {
  const now = at.toISOString();
  let state = emptyWorkspace(now);
  const today = todayDate(at);
  const changeDay = (offset: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const dispatch = (command: Command) => {
    state = applyCommand(state, { commandId: newId(), command }, now);
  };
  const a = {
    ...newBase(now),
    name: "Horizonte Oficina · exemplo",
    kind: "business" as const,
    city: "Cidade Exemplo",
    segment: "Automotivo",
    contactName: "Contato de exemplo",
    email: "contato@example.com",
    phone: "",
    website: "",
    notes: "Registro fictício para conhecer o sistema.",
    status: "active" as const,
  };
  const b = {
    ...a,
    ...newBase(now),
    name: "Aurora Clínica · exemplo",
    segment: "Saúde e bem-estar",
  };
  dispatch({ type: "saveClient", value: a });
  dispatch({ type: "saveClient", value: b });
  const project = {
    ...newBase(now),
    name: "Presença local · exemplo",
    clientId: a.id,
    contractorId: null,
    areaId: state.areas[0].id,
    status: "active" as const,
    priority: "P1" as const,
    startedOn: changeDay(-14),
    dueOn: changeDay(15),
    nextAction: "Revisar os pontos de contato antes da entrega.",
    nextActionOn: today,
    waitingFor: "",
    notes:
      "Projeto fictício. Os dados não representam a operação do Grupo Pomar.",
  };
  const waiting = {
    ...project,
    ...newBase(now),
    name: "Site profissional · exemplo",
    clientId: b.id,
    areaId: state.areas[2].id,
    priority: "P2" as const,
    status: "waiting" as const,
    dueOn: changeDay(28),
    nextAction: "Conferir o envio dos materiais.",
    nextActionOn: today,
    waitingFor: "Fotos e textos de exemplo",
  };
  dispatch({ type: "saveProject", value: project });
  dispatch({ type: "saveProject", value: waiting });
  for (const [index, title] of [
    "Concluir revisão dos serviços",
    "Validar jornada de contato",
    "Organizar evidências da entrega",
    "Conferir materiais recebidos",
  ].entries())
    dispatch({
      type: "saveTask",
      value: {
        ...newBase(now),
        title,
        projectId: index === 3 ? waiting.id : project.id,
        priority: index < 2 ? "P1" : "P2",
        status: index === 2 ? "done" : index === 0 ? "doing" : "pending",
        dueOn: changeDay(index - 1),
        focusOn: index < 2 ? today : null,
        description: "Tarefa fictícia de demonstração.",
        completedAt: index === 2 ? now : null,
      },
    });
  const contract = {
    ...newBase(now),
    title: "Contrato de exemplo",
    clientId: a.id,
    projectId: project.id,
    totalCents: 300000,
    signedOn: today,
    status: "active" as const,
    notes: "Valor fictício de demonstração.",
  };
  dispatch({
    type: "createContract",
    value: contract,
    count: 3,
    firstDueOn: changeDay(-5),
  });
  dispatch({
    type: "postReceipt",
    installmentId: state.installments[0].id,
    amountCents: 60000,
    receivedOn: today,
  });
  dispatch({
    type: "saveOpportunity",
    value: {
      ...newBase(now),
      title: "Diagnóstico local · exemplo",
      clientId: b.id,
      stage: "proposal",
      valueCents: 200000,
      nextAction: "Retomar a conversa sobre o diagnóstico.",
      nextContactOn: today,
      notes: "Oportunidade fictícia.",
      lostReason: "",
      projectId: null,
    },
  });
  dispatch({
    type: "saveExpense",
    value: {
      ...newBase(now),
      title: "Ferramenta de exemplo",
      category: "infrastructure",
      projectId: null,
      amountCents: 9900,
      dueOn: today,
      paidOn: today,
      status: "paid",
      notes: "Despesa fictícia.",
    },
  });
  return state;
}
