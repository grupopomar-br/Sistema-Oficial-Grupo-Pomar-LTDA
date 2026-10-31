import type { Workspace, Priority, Project } from "./model.ts";
import { daysBetween, todayDate } from "./dates.ts";
import { installmentRemaining } from "./workspace.ts";

export const isActiveProject = (project: Project) =>
  ["planning", "active", "waiting", "paused"].includes(project.status);
export const priorityScore = (priority: Priority) =>
  ({ P0: 0, P1: 1, P2: 2, P3: 3 })[priority];
export type AlertItem = {
  id: string;
  title: string;
  detail: string;
  severity: "danger" | "warning" | "info";
  category: "task" | "finance" | "project" | "opportunity" | "billing";
  entityId: string;
  priority: Priority;
  dueOn: string | null;
};
export type FocusItem = {
  id: string;
  title: string;
  detail: string;
  category: "task" | "finance" | "project" | "opportunity" | "billing";
  entityId: string;
  priority: Priority;
  dueOn: string | null;
  score: number;
};

export function getAlerts(state: Workspace, today: string): AlertItem[] {
  const alerts: AlertItem[] = [];
  const contractsById = new Map(state.contracts.map((item) => [item.id, item]));
  for (const task of state.tasks)
    if (task.status !== "done" && task.dueOn && task.dueOn < today)
      alerts.push({
        id: `task:${task.id}`,
        title: task.title,
        detail: "Tarefa com prazo vencido",
        severity: "danger",
        category: "task",
        entityId: task.id,
        priority: task.priority,
        dueOn: task.dueOn,
      });
  for (const installment of state.installments)
    if (
      installment.status === "open" &&
      installment.dueOn < today &&
      installmentRemaining(state, installment.id) > 0
    ) {
      const contract = contractsById.get(installment.contractId);
      if (contract?.status === "active")
        alerts.push({
          id: `installment:${installment.id}`,
          title: contract.title,
          detail: `Conferir cobrança da parcela ${installment.sequence}`,
          severity: "danger",
          category: "finance",
          entityId: installment.id,
          priority: "P1",
          dueOn: installment.dueOn,
        });
    }
  for (const project of state.projects.filter(isActiveProject)) {
    if (project.dueOn && project.dueOn < today)
      alerts.push({
        id: `deadline:${project.id}`,
        title: project.name,
        detail: "Prazo de entrega vencido",
        severity: "danger",
        category: "project",
        entityId: project.id,
        priority: project.priority,
        dueOn: project.dueOn,
      });
    else if (
      project.status === "waiting" &&
      project.nextActionOn &&
      project.nextActionOn <= today
    )
      alerts.push({
        id: `waiting:${project.id}`,
        title: project.name,
        detail: `Reavaliar espera: ${project.waitingFor || "dependência externa"}`,
        severity: "warning",
        category: "project",
        entityId: project.id,
        priority: project.priority,
        dueOn: project.nextActionOn,
      });
    else if (
      daysBetween(todayDate(new Date(project.updatedAt)), today) >=
      state.settings.staleDays
    )
      alerts.push({
        id: `stale:${project.id}`,
        title: project.name,
        detail: "Projeto sem atualização recente",
        severity: "warning",
        category: "project",
        entityId: project.id,
        priority: project.priority,
        dueOn: null,
      });
  }
  for (const opportunity of state.opportunities)
    if (
      !["won", "lost"].includes(opportunity.stage) &&
      opportunity.nextContactOn &&
      opportunity.nextContactOn <= today
    )
      alerts.push({
        id: `followup:${opportunity.id}`,
        title: opportunity.title,
        detail: "Acompanhamento comercial previsto",
        severity: "info",
        category: "opportunity",
        entityId: opportunity.id,
        priority: "P2",
        dueOn: opportunity.nextContactOn,
      });
  for (const payment of state.providerPayments)
    if (payment.mode === "live" && payment.reviewReason) {
      const charge = state.charges.find((c) => c.id === payment.chargeId);
      alerts.push({
        id: `payment:${payment.id}`,
        title: `Conferir pagamento #${payment.providerPaymentId}`,
        detail: payment.reviewReason,
        severity: "warning",
        category: "billing",
        entityId: charge?.installmentId ?? payment.id,
        priority: "P1",
        dueOn: payment.paidOn,
      });
    }
  return alerts.sort(
    (a, b) =>
      ({ danger: 0, warning: 1, info: 2 })[a.severity] -
        { danger: 0, warning: 1, info: 2 }[b.severity] ||
      priorityScore(a.priority) - priorityScore(b.priority) ||
      (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"),
  );
}

export function getDailyFocus(state: Workspace, today: string): FocusItem[] {
  const items: FocusItem[] = [];
  const projectsById = new Map(state.projects.map((item) => [item.id, item]));
  for (const task of state.tasks.filter((item) => item.status !== "done")) {
    const due = !!task.dueOn && task.dueOn <= today;
    const pinned = task.focusOn === today;
    if (due || pinned || ["P0", "P1"].includes(task.priority))
      items.push({
        id: `task:${task.id}`,
        title: task.title,
        detail:
          projectsById.get(task.projectId ?? "")?.name ?? "Tarefa da operação",
        category: "task",
        entityId: task.id,
        priority: task.priority,
        dueOn: task.dueOn,
        score:
          (pinned ? -100 : 0) +
          (due ? -40 : 0) +
          priorityScore(task.priority) * 10,
      });
  }
  for (const alert of getAlerts(state, today).filter(
    (item) => item.category !== "task",
  ))
    items.push({
      ...alert,
      score:
        (alert.severity === "danger" ? -35 : 10) +
        priorityScore(alert.priority) * 10,
    });
  for (const project of state.projects.filter(
    (item) =>
      isActiveProject(item) &&
      item.status !== "paused" &&
      item.nextAction.trim(),
  ))
    if (
      !items.some(
        (item) => item.category === "project" && item.entityId === project.id,
      ) &&
      (!project.nextActionOn || project.nextActionOn <= today)
    )
      items.push({
        id: `project:${project.id}`,
        title: project.nextAction,
        detail: project.name,
        category: "project",
        entityId: project.id,
        priority: project.priority,
        dueOn: project.nextActionOn,
        score: 25 + priorityScore(project.priority) * 10,
      });
  return items
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
        a.id.localeCompare(b.id),
    )
    .slice(0, state.settings.dailyFocusLimit);
}

export function getFinanceSummary(state: Workspace, month: string) {
  const confirmed = state.receipts.filter(
    (item) => item.status === "confirmed",
  );
  const received = confirmed
    .filter((item) => item.receivedOn?.startsWith(month))
    .reduce((sum, item) => sum + item.amountCents, 0);
  const paidExpenses = state.expenses
    .filter((item) => item.status === "paid" && item.paidOn?.startsWith(month))
    .reduce((sum, item) => sum + item.amountCents, 0);
  const activeContracts = new Set(
    state.contracts
      .filter((item) => item.status === "active")
      .map((item) => item.id),
  );
  const open = state.installments.filter(
    (item) => item.status === "open" && activeContracts.has(item.contractId),
  );
  const refunded = state.refunds
    .filter((item) => item.occurredOn.startsWith(month))
    .reduce((sum, item) => sum + item.amountCents, 0);
  return {
    refunded,
    signed: state.contracts
      .filter(
        (item) =>
          item.status !== "cancelled" && item.signedOn.startsWith(month),
      )
      .reduce((sum, item) => sum + item.totalCents, 0),
    received,
    paidExpenses,
    cashBalance: received - paidExpenses - refunded,
    expected: open
      .filter((item) => item.dueOn.startsWith(month))
      .reduce((sum, item) => sum + installmentRemaining(state, item.id), 0),
    contractBalance: open.reduce(
      (sum, item) => sum + installmentRemaining(state, item.id),
      0,
    ),
    undated: confirmed
      .filter((item) => item.receivedOn === null)
      .reduce((sum, item) => sum + item.amountCents, 0),
    unpaidExpenses: state.expenses
      .filter(
        (item) => item.status === "pending" && item.dueOn?.startsWith(month),
      )
      .reduce((sum, item) => sum + item.amountCents, 0),
  };
}

export function projectProgress(state: Workspace, id: string): number {
  const project = state.projects.find((item) => item.id === id);
  if (project?.status === "completed") return 100;
  const tasks = state.tasks.filter((item) => item.projectId === id);
  return tasks.length
    ? Math.round(
        (tasks.filter((item) => item.status === "done").length / tasks.length) *
          100,
      )
    : 0;
}

export function relatedProjectId(
  state: Workspace,
  entityType: string,
  id: string,
): string | null {
  if (entityType === "project") return id;
  if (entityType === "task")
    return state.tasks.find((item) => item.id === id)?.projectId ?? null;
  if (entityType === "contract")
    return state.contracts.find((item) => item.id === id)?.projectId ?? null;
  if (entityType === "receipt")
    return (
      state.contracts.find(
        (item) =>
          item.id ===
          state.receipts.find((receipt) => receipt.id === id)?.contractId,
      )?.projectId ?? null
    );
  return null;
}
