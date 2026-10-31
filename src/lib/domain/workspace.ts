import { newId } from "./id.ts";
import {
  envelopeSchema,
  workspaceSchema,
  newBase,
  type Workspace,
  type Envelope,
  type AuditEntry,
} from "./model.ts";
import { addMonthsClamped, todayDate } from "./dates.ts";

export class BusinessError extends Error {
  code: string;
  constructor(message: string, code = "VALIDATION") {
    super(message);
    this.name = "BusinessError";
    this.code = code;
  }
}

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BusinessError(message);
}

type FinancialIndex = {
  paid: Map<string, number>;
  installments: Map<string, Workspace["installments"][number]>;
  contractTotals: Map<string, number>;
  receiptTotals: Map<string, number>;
};
const indexes = new WeakMap<Workspace, FinancialIndex>();
function financialIndex(state: Workspace): FinancialIndex {
  const cached = indexes.get(state);
  if (cached) return cached;
  const active = new Set(
    state.receipts
      .filter((receipt) => receipt.status === "confirmed")
      .map((receipt) => receipt.id),
  );
  const result: FinancialIndex = {
    paid: new Map(),
    installments: new Map(),
    contractTotals: new Map(),
    receiptTotals: new Map(),
  };
  for (const item of state.installments) {
    result.installments.set(item.id, item);
    result.contractTotals.set(
      item.contractId,
      (result.contractTotals.get(item.contractId) ?? 0) + item.amountCents,
    );
  }
  for (const item of state.allocations) {
    result.receiptTotals.set(
      item.receiptId,
      (result.receiptTotals.get(item.receiptId) ?? 0) + item.amountCents,
    );
    if (active.has(item.receiptId))
      result.paid.set(
        item.installmentId,
        (result.paid.get(item.installmentId) ?? 0) + item.amountCents,
      );
  }
  for (const refund of state.refunds)
    result.paid.set(
      refund.installmentId,
      (result.paid.get(refund.installmentId) ?? 0) - refund.amountCents,
    );
  indexes.set(state, result);
  return result;
}
export function installmentPaid(
  state: Workspace,
  installmentId: string,
): number {
  return financialIndex(state).paid.get(installmentId) ?? 0;
}
export function installmentRemaining(
  state: Workspace,
  installmentId: string,
): number {
  const index = financialIndex(state),
    installment = index.installments.get(installmentId);
  if (!installment || installment.status === "cancelled") return 0;
  return Math.max(
    0,
    installment.amountCents - (index.paid.get(installmentId) ?? 0),
  );
}

export function validateRelations(state: Workspace): void {
  const sets = Object.fromEntries(
    [
      "clients",
      "areas",
      "projects",
      "tasks",
      "contracts",
      "installments",
      "receipts",
      "allocations",
      "expenses",
      "opportunities",
      "updates",
      "ideas",
      "collectionAgreements",
      "collectionActions",
      "charges",
      "providerPayments",
      "refunds",
    ].map((key) => {
      const list = state[key as "clients"] as { id: string }[];
      const ids = new Set(list.map((item) => item.id));
      required(ids.size === list.length, "O arquivo contém IDs duplicados.");
      return [key, ids];
    }),
  ) as Record<string, Set<string>>;
  const exists = (key: string, id: string | null) =>
    id === null || sets[key].has(id);
  const installmentsByContract = new Map<string, Workspace["installments"]>();
  for (const item of state.installments) {
    const list = installmentsByContract.get(item.contractId) ?? [];
    list.push(item);
    installmentsByContract.set(item.contractId, list);
  }
  const receiptsById = new Map(state.receipts.map((item) => [item.id, item]));
  const installmentsById = financialIndex(state).installments;

  for (const project of state.projects)
    required(
      exists("clients", project.clientId) &&
        exists("clients", project.contractorId) &&
        exists("areas", project.areaId),
      "Projeto possui cliente ou área inexistente.",
    );
  for (const task of state.tasks) {
    required(
      exists("projects", task.projectId),
      "Tarefa possui projeto inexistente.",
    );
    required(
      (task.status === "done") === (task.completedAt !== null),
      "A data de conclusão da tarefa está inconsistente.",
    );
  }
  for (const contract of state.contracts) {
    required(
      exists("clients", contract.clientId) &&
        exists("projects", contract.projectId),
      "Contrato possui vínculo inexistente.",
    );
    const installments = installmentsByContract.get(contract.id) ?? [];
    required(
      financialIndex(state).contractTotals.get(contract.id) ===
        contract.totalCents,
      "Parcelas não correspondem ao valor do contrato.",
    );
    required(
      new Set(installments.map((item) => item.sequence)).size ===
        installments.length,
      "Existem números de parcela duplicados no contrato.",
    );
    required(
      contract.status !== "cancelled" ||
        installments.every((item) => item.status === "cancelled"),
      "Contrato cancelado possui parcelas abertas.",
    );
  }
  for (const installment of state.installments) {
    required(
      exists("contracts", installment.contractId),
      "Parcela sem contrato.",
    );
    required(
      installmentPaid(state, installment.id) <= installment.amountCents,
      "Recebimentos excedem o valor da parcela.",
    );
  }
  for (const receipt of state.receipts) {
    required(
      exists("contracts", receipt.contractId),
      "Recebimento sem contrato.",
    );
    required(
      financialIndex(state).receiptTotals.get(receipt.id) ===
        receipt.amountCents,
      "Alocações não correspondem ao recebimento.",
    );
    required(
      receipt.status !== "voided" || receipt.voidReason.trim().length >= 5,
      "Estorno sem motivo.",
    );
  }
  for (const allocation of state.allocations) {
    const receipt = receiptsById.get(allocation.receiptId);
    const installment = installmentsById.get(allocation.installmentId);
    required(
      receipt && installment && receipt.contractId === installment.contractId,
      "Alocação financeira cruza contratos ou vínculos inválidos.",
    );
  }
  for (const expense of state.expenses)
    required(
      exists("projects", expense.projectId),
      "Despesa possui projeto inexistente.",
    );
  for (const update of state.updates)
    required(
      exists("projects", update.projectId),
      "Atualização possui projeto inexistente.",
    );
  for (const opportunity of state.opportunities)
    required(
      exists("clients", opportunity.clientId) &&
        exists("projects", opportunity.projectId),
      "Oportunidade possui vínculo inexistente.",
    );
  const byReceipt = new Map(state.receipts.map((item) => [item.id, item]));
  const refundTotals = new Map<string, number>();
  const refundAllocTotals = new Map<string, number>();
  const providerById = new Map(state.providerPayments.map((p) => [p.id, p]));
  for (const refund of state.refunds) {
    const receipt = byReceipt.get(refund.receiptId);
    const allocation = state.allocations.find(
      (item) =>
        item.receiptId === refund.receiptId &&
        item.installmentId === refund.installmentId,
    );
    required(
      receipt?.status === "confirmed" &&
        allocation &&
        providerById.get(refund.providerPaymentId)?.receiptId === receipt.id,
      "Devolução sem recebimento e alocação válidos.",
    );
    const allocationKey = refund.receiptId + ":" + refund.installmentId;
    refundAllocTotals.set(
      allocationKey,
      (refundAllocTotals.get(allocationKey) ?? 0) + refund.amountCents,
    );
    required(
      refundAllocTotals.get(allocationKey)! <= allocation.amountCents,
      "Devolução excede a alocação da parcela.",
    );
    refundTotals.set(
      refund.receiptId,
      (refundTotals.get(refund.receiptId) ?? 0) + refund.amountCents,
    );
    required(
      refundTotals.get(refund.receiptId)! <= receipt.amountCents,
      "Devoluções excedem o recebimento.",
    );
  }
  required(
    new Set(state.collectionAgreements.map((x) => x.contractId)).size ===
      state.collectionAgreements.length,
    "Há condições de cobrança duplicadas para o contrato.",
  );
  for (const item of state.collectionAgreements) {
    const contract = state.contracts.find((c) => c.id === item.contractId);
    required(
      contract && item.initialCents <= contract.totalCents,
      "Condição de entrada inválida para o contrato.",
    );
  }
  for (const item of state.collectionActions)
    required(
      exists("installments", item.installmentId),
      "Acompanhamento sem parcela.",
    );
  for (const item of state.charges)
    required(
      exists("installments", item.installmentId),
      "Cobrança sem parcela.",
    );
  for (const item of state.providerPayments) {
    required(
      exists("charges", item.chargeId) && exists("receipts", item.receiptId),
      "Pagamento do provedor possui vínculo inválido.",
    );
    required(
      item.refundedCents <= item.amountCents,
      "Devolução do provedor excede o pagamento.",
    );
  }
  for (const item of state.ideas)
    required(exists("tasks", item.taskId), "Ideia possui tarefa inexistente.");
}

export function parseWorkspace(value: unknown): Workspace {
  const state = workspaceSchema.parse(value);
  validateRelations(state);
  return state;
}

export function applyCommand(
  current: Workspace,
  envelope: Envelope,
  now = new Date().toISOString(),
): Workspace {
  envelope = envelopeSchema.parse(envelope);
  const command = envelope.command;
  if (current.processedCommands.includes(envelope.commandId)) return current;
  const state = structuredClone(current);
  const log = (
    entityType: string,
    entityId: string,
    action: string,
    summary: string,
  ) => {
    const entry: AuditEntry = {
      id: newId(),
      entityType,
      entityId,
      action,
      summary: summary.slice(0, 500),
      createdAt: now,
    };
    state.history = [entry, ...state.history].slice(0, 1000);
  };
  const save = <
    T extends {
      id: string;
      version: number;
      createdAt: string;
      updatedAt: string;
    },
  >(
    list: T[],
    value: T,
  ): T => {
    const index = list.findIndex((item) => item.id === value.id);
    if (index < 0) {
      const created = { ...value, version: 1, createdAt: now, updatedAt: now };
      list.push(created);
      return created;
    }
    const original = list[index];
    if (original.version !== value.version)
      throw new BusinessError(
        "Este registro foi alterado. Atualize a página e revise antes de salvar.",
        "CONFLICT",
      );
    const updated = {
      ...value,
      createdAt: original.createdAt,
      updatedAt: now,
      version: original.version + 1,
    };
    list[index] = updated;
    return updated;
  };
  switch (command.type) {
    case "saveIdea":
      save(state.ideas, command.value);
      log(
        "idea",
        command.value.id,
        "save",
        `Ideia registrada: ${command.value.title}`,
      );
      break;
    case "saveCollectionAgreement":
      required(
        !command.value.acceptedOn ||
          command.value.acceptedOn <= todayDate(new Date(now)),
        "O aceite não pode estar no futuro.",
      );
      save(state.collectionAgreements, command.value);
      log(
        "contract",
        command.value.contractId,
        "collection_terms",
        "Condições de cobrança registradas.",
      );
      break;
    case "addCollectionAction":
      required(
        !state.collectionActions.some((x) => x.id === command.value.id),
        "Este acompanhamento já foi registrado.",
      );
      save(state.collectionActions, command.value);
      log(
        "installment",
        command.value.installmentId,
        "collection_contact",
        command.value.note,
      );
      break;
    case "convertIdeaToTask": {
      const idea = state.ideas.find((x) => x.id === command.id);
      required(idea, "Ideia não encontrada.");
      if (idea.taskId) return current;
      save(state.tasks, {
        ...newBase(now),
        id: command.taskId,
        title: idea.title,
        projectId: command.projectId,
        priority: idea.priority,
        status: "pending",
        dueOn: null,
        focusOn: todayDate(new Date(now)),
        description: idea.detail,
        completedAt: null,
      });
      save(state.ideas, { ...idea, taskId: command.taskId, stage: "planned" });
      log("idea", idea.id, "convert", "Ideia transformada em tarefa.");
      break;
    }

    case "saveClient":
      save(state.clients, command.value);
      log(
        "client",
        command.value.id,
        "save",
        `Cliente atualizado: ${command.value.name}`,
      );
      break;
    case "saveArea":
      save(state.areas, command.value);
      log(
        "area",
        command.value.id,
        "save",
        `Área atualizada: ${command.value.name}`,
      );
      break;
    case "saveProject":
      const before = state.projects.find((p) => p.id === command.value.id);
      if (
        before?.status !== command.value.status &&
        ["active", "completed"].includes(command.value.status)
      ) {
        for (const contract of state.contracts.filter(
          (c) => c.projectId === command.value.id && c.status === "active",
        )) {
          const agreement = state.collectionAgreements.find(
            (a) => a.contractId === contract.id,
          );
          if (!agreement?.acceptedOn) continue;
          const paid = state.installments
            .filter((i) => i.contractId === contract.id)
            .reduce((sum, i) => sum + installmentPaid(state, i.id), 0);
          const initialGate =
            command.value.status === "active" && agreement.gate === "initial";
          const finalGate =
            command.value.status === "completed" && agreement.gate === "full";
          required(
            !(initialGate && paid < agreement.initialCents) &&
              !(finalGate && paid < contract.totalCents),
            "A condição de pagamento aceita ainda não foi atendida. Confira Cobranças antes de alterar a etapa.",
          );
        }
      }
      save(state.projects, command.value);
      log(
        "project",
        command.value.id,
        "save",
        `Projeto atualizado: ${command.value.name}`,
      );
      break;
    case "saveTask": {
      const value = {
        ...command.value,
        completedAt:
          command.value.status === "done"
            ? (command.value.completedAt ?? now)
            : null,
      };
      save(state.tasks, value);
      log("task", value.id, "save", `Tarefa atualizada: ${value.title}`);
      break;
    }
    case "saveExpense":
      required(
        !command.value.paidOn ||
          command.value.paidOn <= todayDate(new Date(now)),
        "A data do pagamento não pode estar no futuro.",
      );
      save(state.expenses, command.value);
      log(
        "expense",
        command.value.id,
        "save",
        `Despesa atualizada: ${command.value.title}`,
      );
      break;
    case "saveOpportunity":
      save(state.opportunities, command.value);
      log(
        "opportunity",
        command.value.id,
        "save",
        `Oportunidade atualizada: ${command.value.title}`,
      );
      break;
    case "saveSettings": {
      if (command.expectedRevision !== current.revision)
        throw new BusinessError(
          "Os dados mudaram. Atualize a página antes de salvar as preferências.",
          "CONFLICT",
        );
      state.settings = command.value;
      log(
        "settings",
        envelope.commandId,
        "save",
        "Preferências da operação atualizadas.",
      );
      break;
    }
    case "setTaskStatus": {
      const task = state.tasks.find((item) => item.id === command.id);
      required(task, "Tarefa não encontrada.");
      if (task.status === command.status) return current;
      if (task.version !== command.expectedVersion)
        throw new BusinessError(
          "A tarefa mudou em outra sessão. Atualize e tente novamente.",
          "CONFLICT",
        );
      save(state.tasks, {
        ...task,
        status: command.status,
        completedAt: command.status === "done" ? now : null,
      });
      log(
        "task",
        task.id,
        command.status === "done" ? "complete" : "status",
        `${command.status === "done" ? "Tarefa concluída" : "Estado da tarefa alterado"}: ${task.title}`,
      );
      break;
    }
    case "createContract": {
      required(
        !state.contracts.some((item) => item.id === command.value.id),
        "Este contrato já foi cadastrado.",
      );
      required(
        command.value.totalCents >= command.count,
        "O número de parcelas não pode exceder o valor em centavos.",
      );
      save(state.contracts, command.value);
      const basic = Math.floor(command.value.totalCents / command.count);
      const remainder = command.value.totalCents % command.count;
      for (let index = 0; index < command.count; index++)
        state.installments.push({
          ...newBase(now),
          contractId: command.value.id,
          sequence: index + 1,
          dueOn: addMonthsClamped(command.firstDueOn, index),
          amountCents: basic + (index < remainder ? 1 : 0),
          status: "open",
        });
      log(
        "contract",
        command.value.id,
        "create",
        `Contrato registrado: ${command.value.title}`,
      );
      break;
    }
    case "postReceipt": {
      required(
        command.receivedOn === null ||
          command.receivedOn <= todayDate(new Date(now)),
        "A data do recebimento não pode estar no futuro.",
      );
      const installment = state.installments.find(
        (item) => item.id === command.installmentId,
      );
      required(
        installment && installment.status === "open",
        "Parcela indisponível para recebimento.",
      );
      const contract = state.contracts.find(
        (item) => item.id === installment.contractId,
      );
      required(
        contract?.status === "active",
        "Somente contratos ativos podem receber pagamentos.",
      );
      required(
        command.amountCents <= installmentRemaining(state, installment.id),
        "O recebimento supera o saldo desta parcela.",
      );
      required(
        !state.receipts.some((item) => item.id === envelope.commandId),
        "Este recebimento já foi registrado.",
      );
      state.receipts.push({
        ...newBase(now),
        id: envelope.commandId,
        contractId: installment.contractId,
        amountCents: command.amountCents,
        receivedOn: command.receivedOn,
        status: "confirmed",
        voidReason: "",
      });
      state.allocations.push({
        ...newBase(now),
        receiptId: envelope.commandId,
        installmentId: installment.id,
        amountCents: command.amountCents,
      });
      log(
        "receipt",
        envelope.commandId,
        "receive",
        `Recebimento registrado na parcela ${installment.sequence}.`,
      );
      break;
    }
    case "dateReceipt": {
      required(
        command.receivedOn <= todayDate(new Date(now)),
        "A data do recebimento não pode estar no futuro.",
      );
      const receipt = state.receipts.find((item) => item.id === command.id);
      required(
        receipt &&
          receipt.status === "confirmed" &&
          receipt.receivedOn === null,
        "Somente recebimentos confirmados sem data podem ser conciliados.",
      );
      save(state.receipts, { ...receipt, receivedOn: command.receivedOn });
      log(
        "receipt",
        receipt.id,
        "reconcile",
        "Data de recebimento conciliada, sem gerar nova entrada de caixa.",
      );
      break;
    }
    case "voidReceipt": {
      const receipt = state.receipts.find((item) => item.id === command.id);
      required(receipt, "Recebimento não encontrado.");
      required(
        !state.providerPayments.some((p) => p.receiptId === receipt.id),
        "Este recebimento é confirmado pelo provedor. Registre a devolução no provedor e concilie o evento.",
      );
      if (receipt.status === "voided") return current;
      save(state.receipts, {
        ...receipt,
        status: "voided",
        voidReason: command.reason,
      });
      log(
        "receipt",
        receipt.id,
        "void",
        `Recebimento estornado. Motivo: ${command.reason}`,
      );
      break;
    }
    case "cancelContract": {
      const contract = state.contracts.find((item) => item.id === command.id);
      required(contract, "Contrato não encontrado.");
      if (contract.status === "cancelled") return current;
      save(state.contracts, {
        ...contract,
        status: "cancelled",
        notes: `${contract.notes}\nCancelamento: ${command.reason}`
          .trim()
          .slice(0, 5000),
      });
      for (const installment of [
        ...state.installments.filter((item) => item.contractId === contract.id),
      ])
        save(state.installments, { ...installment, status: "cancelled" });
      log(
        "contract",
        contract.id,
        "cancel",
        `Contrato cancelado; recebimentos preservados. Motivo: ${command.reason}`,
      );
      break;
    }
    case "addUpdate": {
      required(
        state.projects.some((item) => item.id === command.projectId),
        "Projeto não encontrado.",
      );
      state.updates.push({
        ...newBase(now),
        id: envelope.commandId,
        projectId: command.projectId,
        message: command.message,
      });
      const project = state.projects.find(
        (item) => item.id === command.projectId,
      )!;
      save(state.projects, { ...project });
      log("project", command.projectId, "note", command.message);
      break;
    }
    case "convertOpportunity": {
      const opportunity = state.opportunities.find(
        (item) => item.id === command.id,
      );
      required(opportunity, "Oportunidade não encontrada.");
      if (opportunity.projectId) return current;
      required(
        opportunity.stage !== "lost",
        "Reabra a oportunidade antes de convertê-la.",
      );
      save(state.projects, {
        ...newBase(now),
        id: command.projectId,
        name: opportunity.title,
        clientId: opportunity.clientId,
        contractorId: null,
        areaId: command.areaId,
        status: "planning",
        priority: "P2",
        startedOn: todayDate(new Date(now)),
        dueOn: command.dueOn,
        nextAction: "Definir escopo e próximos passos.",
        nextActionOn: null,
        waitingFor: "",
        notes: opportunity.notes,
      });
      save(state.opportunities, {
        ...opportunity,
        stage: "won",
        projectId: command.projectId,
      });
      log(
        "opportunity",
        opportunity.id,
        "convert",
        "Oportunidade convertida em projeto. Nenhum contrato ou recebimento foi criado automaticamente.",
      );
      break;
    }
  }
  indexes.delete(state);
  validateRelations(state);
  state.revision = current.revision + 1;
  state.processedCommands = [
    ...state.processedCommands,
    envelope.commandId,
  ].slice(-500);
  return parseWorkspace(state);
}
