import type { Workspace, Task } from "../model.ts";
import { newBase } from "../model.ts";
import { newId } from "../id.ts";
import { addMonthsClamped, daysBetween, todayDate } from "../dates.ts";
import { shiftDay } from "../week.ts";
import {
  isTaskClosed,
  type DeliveryCommand,
  type DeliveryItem,
  type DeliveryPlan,
  type DeliveryEvent,
  type RecurrenceRule,
} from "./schema.ts";

export function deliveryAssert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
export function contractPeriods(startsOn: string, endsOn: string) {
  deliveryAssert(
    endsOn >= startsOn && daysBetween(startsOn, endsOn) <= 3660,
    "A vigência deve ter início e encerramento válidos, com até dez anos.",
  );
  const periods: { start: string; end: string }[] = [];
  const monthSpan =
    (Number(endsOn.slice(0, 4)) - Number(startsOn.slice(0, 4))) * 12 +
    Number(endsOn.slice(5, 7)) -
    Number(startsOn.slice(5, 7));
  for (let month = 0; month <= Math.min(monthSpan, 120); month++) {
    const start = addMonthsClamped(startsOn, month);
    if (start > endsOn) break;
    const end =
      month === monthSpan
        ? endsOn
        : [
            shiftDay(addMonthsClamped(startsOn, month + 1), -1),
            endsOn,
          ].sort()[0];
    periods.push({ start, end });
  }
  deliveryAssert(
    periods.length <= 120,
    "A programação suporta até 120 competências.",
  );
  return periods;
}
export function recurrenceDue(
  period: { start: string; end: string },
  rule: RecurrenceRule,
) {
  return rule.dueOffset === null
    ? period.end
    : [shiftDay(period.start, rule.dueOffset), period.end].sort()[0];
}
export function eventState(task: Task, item: DeliveryItem) {
  return {
    status: task.status,
    dueOn: task.dueOn,
    completedQuantity: item.completedQuantity,
    acceptedCriteria: [...item.acceptedCriteria],
    nextAction: item.nextAction,
    dependency: item.dependency,
  };
}
function appendEvent(
  state: Workspace,
  event: Omit<DeliveryEvent, "id" | "createdAt">,
  now: string,
) {
  state.deliveryEvents.push({ ...event, id: newId(), createdAt: now });
  state.history.unshift({
    id: newId(),
    entityType: "project",
    entityId: state.deliveryPlans.find((p) => p.id === event.planId)!.projectId,
    action: "delivery_" + event.operation,
    summary: event.summary,
    createdAt: now,
  });
}
function writableProject(state: Workspace, plan: DeliveryPlan) {
  const project = state.projects.find((p) => p.id === plan.projectId);
  deliveryAssert(
    project && !project.removedAt && project.status !== "cancelled",
    "Restaure ou reabra o projeto para executar entregas.",
  );
  deliveryAssert(
    plan.status === "active",
    "Retome o plano antes de executar entregas.",
  );
}
function createItem(
  state: Workspace,
  plan: DeliveryPlan,
  item: Omit<DeliveryItem, "id">,
  title: string,
  now: string,
) {
  const project = state.projects.find((p) => p.id === plan.projectId)!;
  const task: Task = {
    ...newBase(now),
    title,
    projectId: plan.projectId,
    priority: project.priority,
    status: "pending",
    dueOn: item.originalDueOn,
    focusOn: null,
    description: item.criteria.join("\n"),
    completedAt: null,
  };
  state.tasks.push(task);
  state.deliveryItems.push({ ...item, id: task.id });
}
function reopenDependents(state: Workspace, source: DeliveryItem, now: string) {
  const reopened = new Set([source.stepKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of state.deliveryItems.filter(
      (i) => i.planId === source.planId && i.phase === "implementation",
    )) {
      const task = state.tasks.find((t) => t.id === item.id)!;
      if (
        task.status !== "done" ||
        (!item.finalReview && !item.dependsOn.some((key) => reopened.has(key)))
      )
        continue;
      const beforeState = eventState(task, item);
      task.status = "review";
      task.completedAt = null;
      task.version += 1;
      task.updatedAt = now;
      item.validatedAt = null;
      reopened.add(item.stepKey);
      changed = true;
      appendEvent(
        state,
        {
          planId: item.planId,
          itemId: item.id,
          operation: "reopen",
          summary: `Revalidar ${task.title}`,
          reason: "Uma entrega necessária foi reaberta.",
          beforeState,
          afterState: eventState(task, item),
        },
        now,
      );
    }
  }
}
export function applyDeliveryCommand(
  state: Workspace,
  command: DeliveryCommand,
  now: string,
) {
  deliveryAssert(
    state.deliveryReady,
    "Ative a Central de Entregas no ambiente de homologação.",
  );
  if (command.type === "createDeliveryPlan") {
    const project = state.projects.find((p) => p.id === command.projectId);
    const contract = state.contracts.find((c) => c.id === command.contractId);
    deliveryAssert(
      project &&
        !project.removedAt &&
        !["completed", "cancelled"].includes(project.status),
      "Escolha um projeto em aberto.",
    );
    deliveryAssert(
      contract &&
        contract.status === "active" &&
        contract.projectId === project.id &&
        [project.clientId, project.contractorId].includes(contract.clientId),
      "Selecione um contrato ativo vinculado a este projeto e cliente.",
    );
    deliveryAssert(
      project.version === command.expectedProjectVersion &&
        contract.version === command.expectedContractVersion,
      "O projeto ou contrato mudou. Atualize antes de criar o plano.",
    );
    deliveryAssert(
      !state.deliveryPlans.some(
        (p) =>
          p.id === command.id ||
          (p.projectId === project.id &&
            p.playbookKey === command.playbookKey &&
            p.status !== "archived"),
      ),
      "Já existe um plano dessa metodologia neste projeto.",
    );
    const playbook = state.servicePlaybooks.find(
      (p) =>
        p.key === command.playbookKey && p.version === command.playbookVersion,
    );
    deliveryAssert(
      playbook,
      "A versão selecionada da metodologia não está disponível.",
    );
    deliveryAssert(
      !command.methodologyId ||
        state.methodologies.some(
          (m) => m.id === command.methodologyId && !m.archived,
        ),
      "A metodologia de referência não está disponível.",
    );
    contractPeriods(command.startsOn, command.endsOn);
    deliveryAssert(
      command.implementationDueOn >= command.startsOn &&
        command.implementationDueOn <= command.endsOn,
      "A implantação deve vencer dentro da vigência confirmada.",
    );
    const plan: DeliveryPlan = {
      ...newBase(now),
      id: command.id,
      projectId: project.id,
      contractId: contract.id,
      methodologyId: command.methodologyId,
      playbookKey: playbook.key,
      playbookVersion: playbook.version,
      scopeReference: command.scopeReference,
      startsOn: command.startsOn,
      endsOn: command.endsOn,
      implementationDueOn: command.implementationDueOn,
      status: "active",
      recurrenceRules: [],
    };
    state.deliveryPlans.push(plan);
    for (const step of playbook.steps)
      createItem(
        state,
        plan,
        {
          planId: plan.id,
          phase: "implementation",
          stepKey: step.key,
          groupKey: step.groupKey,
          groupTitle: step.groupTitle,
          criteria: [...step.criteria],
          required: step.required,
          critical: step.critical,
          weight: step.weight,
          dependsOn: [...step.dependsOn],
          finalReview: step.finalReview,
          periodStart: null,
          periodEnd: null,
          targetQuantity: 1,
          completedQuantity: 0,
          acceptedCriteria: [],
          nextAction: step.title,
          dependency: "",
          reason: "",
          originalDueOn: plan.implementationDueOn,
          validatedAt: null,
        },
        step.title,
        now,
      );
    appendEvent(
      state,
      {
        planId: plan.id,
        itemId: null,
        operation: "create",
        summary: "Plano de implantação criado a partir do escopo confirmado.",
        reason: plan.scopeReference,
        beforeState: null,
        afterState: null,
      },
      now,
    );
    return;
  }
  const planId =
    command.type === "recordDeliveryTask"
      ? state.deliveryItems.find((i) => i.id === command.id)?.planId
      : command.type === "scheduleDeliveryRecurrence"
        ? command.planId
        : command.id;
  const plan = state.deliveryPlans.find((p) => p.id === planId);
  deliveryAssert(plan, "Plano de entrega não encontrado.");
  if (command.type === "setDeliveryPlanStatus") {
    deliveryAssert(
      plan.version === command.expectedVersion,
      "O plano mudou. Atualize antes de salvar.",
    );
    plan.status = command.status;
    plan.version += 1;
    plan.updatedAt = now;
    appendEvent(
      state,
      {
        planId: plan.id,
        itemId: null,
        operation: "status",
        summary: `Plano ${command.status === "active" ? "retomado" : command.status === "paused" ? "pausado" : "arquivado"}.`,
        reason: command.reason,
        beforeState: null,
        afterState: null,
      },
      now,
    );
    return;
  }
  writableProject(state, plan);
  if (command.type === "scheduleDeliveryRecurrence") {
    deliveryAssert(
      plan.version === command.expectedVersion,
      "O plano mudou. Atualize antes de programar.",
    );
    deliveryAssert(
      state.contracts.find((c) => c.id === plan.contractId)?.status ===
        "active",
      "O contrato deve estar ativo para gerar obrigações.",
    );
    deliveryAssert(
      new Set(command.rules.map((r) => r.key)).size === command.rules.length,
      "As regras de recorrência estão duplicadas.",
    );
    deliveryAssert(
      !plan.recurrenceRules.length ||
        JSON.stringify(plan.recurrenceRules) === JSON.stringify(command.rules),
      "A programação já foi confirmada. Preserve o escopo registrado.",
    );
    for (const rule of command.rules)
      deliveryAssert(
        new Set(rule.criteria).size === rule.criteria.length,
        "Revise os critérios duplicados da recorrência.",
      );
    const periods = contractPeriods(plan.startsOn, plan.endsOn);
    deliveryAssert(
      periods.length * command.rules.length <= 2000,
      "Divida a programação para respeitar o limite de tarefas da Central.",
    );
    let created = 0;
    for (const period of periods)
      for (const rule of command.rules) {
        if (
          state.deliveryItems.some(
            (i) =>
              i.planId === plan.id &&
              i.stepKey === rule.key &&
              i.periodStart === period.start,
          )
        )
          continue;
        createItem(
          state,
          plan,
          {
            planId: plan.id,
            phase: "recurring",
            stepKey: rule.key,
            groupKey: "recurring",
            groupTitle: "Operação recorrente",
            criteria: [...rule.criteria],
            required: true,
            critical: true,
            weight: 1,
            dependsOn: [],
            finalReview: false,
            periodStart: period.start,
            periodEnd: period.end,
            targetQuantity: rule.targetQuantity,
            completedQuantity: 0,
            acceptedCriteria: [],
            nextAction: rule.title,
            dependency: "",
            reason: "",
            originalDueOn: recurrenceDue(period, rule),
            validatedAt: null,
          },
          rule.title,
          now,
        );
        created += 1;
      }
    if (!created) return;
    plan.recurrenceRules = structuredClone(command.rules);
    plan.version += 1;
    plan.updatedAt = now;
    appendEvent(
      state,
      {
        planId: plan.id,
        itemId: null,
        operation: "schedule",
        summary: `${created} obrigações contratuais programadas.`,
        reason: plan.scopeReference,
        beforeState: null,
        afterState: null,
      },
      now,
    );
    return;
  }
  const item = state.deliveryItems.find((i) => i.id === command.id)!;
  const task = state.tasks.find((t) => t.id === item.id)!;
  deliveryAssert(
    task.version === command.expectedVersion,
    "A entrega mudou. Atualize antes de salvar.",
  );
  const closed = isTaskClosed(task);
  deliveryAssert(
    !closed || !isTaskClosed(command),
    "Reabra a entrega para revisar uma conclusão.",
  );
  deliveryAssert(
    !closed || command.reason.length >= 5,
    "Informe o motivo da reabertura.",
  );
  deliveryAssert(
    command.completedQuantity <= item.targetQuantity,
    "A quantidade realizada supera a contratada.",
  );
  deliveryAssert(
    new Set(command.acceptedCriteria).size ===
      command.acceptedCriteria.length &&
      command.acceptedCriteria.every((c) => item.criteria.includes(c)),
    "Os critérios informados não pertencem a esta entrega.",
  );
  if (command.status === "not_applicable")
    deliveryAssert(
      !item.required &&
        command.reason.length >= 5 &&
        command.completedQuantity === 0,
      "A dispensa exige item condicional, justificativa e quantidade zero.",
    );
  if (command.status === "blocked" || command.status === "waiting_client")
    deliveryAssert(
      command.dependency.length >= 5 && command.nextAction.length >= 3,
      "Identifique a dependência e a próxima ação para acompanhar.",
    );
  if (
    task.dueOn !== command.dueOn ||
    command.completedQuantity < item.completedQuantity
  )
    deliveryAssert(
      command.reason.length >= 5,
      "Justifique a mudança do prazo ou da quantidade realizada.",
    );
  if (command.evidenceReference)
    deliveryAssert(
      command.evidenceReference.length >= 5 &&
        command.performedOn &&
        command.performedOn <= todayDate(new Date(now)),
      "Identifique a evidência e uma data de execução até hoje.",
    );
  deliveryAssert(
    command.completedQuantity <= item.completedQuantity ||
      command.evidenceReference.length >= 5,
    "Acrescente evidência para registrar a nova quantidade realizada.",
  );
  if (command.status === "done") {
    deliveryAssert(
      task.status === "review",
      "Encaminhe para validação antes de concluir a entrega.",
    );
    deliveryAssert(
      command.completedQuantity === item.targetQuantity &&
        command.acceptedCriteria.length === item.criteria.length,
      "Confirme a quantidade e todos os critérios de aceite.",
    );
    deliveryAssert(
      !!command.evidenceReference ||
        state.deliveryEvidence.some((e) => e.itemId === item.id),
      "Inclua evidência verificável antes de validar.",
    );
    const dependencies = state.deliveryItems.filter(
      (i) =>
        i.planId === plan.id &&
        i.id !== item.id &&
        i.phase === "implementation" &&
        (item.finalReview || item.dependsOn.includes(i.stepKey)),
    );
    deliveryAssert(
      dependencies.every((i) =>
        isTaskClosed(state.tasks.find((t) => t.id === i.id)!),
      ),
      "Conclua ou justifique as dependências antes de validar esta entrega.",
    );
  }
  const beforeState = eventState(task, item);
  if (command.evidenceReference)
    state.deliveryEvidence.push({
      id: newId(),
      itemId: item.id,
      reference: command.evidenceReference,
      performedOn: command.performedOn!,
      quantity: Math.max(0, command.completedQuantity - item.completedQuantity),
      createdAt: now,
    });
  Object.assign(item, {
    completedQuantity: command.completedQuantity,
    acceptedCriteria: command.acceptedCriteria,
    nextAction: command.nextAction,
    dependency: command.dependency,
    reason: command.reason,
    validatedAt: command.status === "done" ? now : null,
  });
  task.status = command.status;
  task.dueOn = command.dueOn;
  task.completedAt = isTaskClosed(task) ? now : null;
  task.updatedAt = now;
  task.version += 1;
  appendEvent(
    state,
    {
      planId: plan.id,
      itemId: item.id,
      operation: closed
        ? "reopen"
        : task.status === "done"
          ? "validate"
          : task.status === "not_applicable"
            ? "exclude"
            : "update",
      summary: `${task.title} · ${task.status === "done" ? "entrega validada" : task.status === "not_applicable" ? "dispensa justificada" : "acompanhamento atualizado"}`,
      reason: command.reason,
      beforeState,
      afterState: eventState(task, item),
    },
    now,
  );
  if (closed && item.phase === "implementation")
    reopenDependents(state, item, now);
}
