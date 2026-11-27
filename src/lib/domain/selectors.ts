import { isVisibleDeliveryTask } from "./delivery/selectors.ts";
import { isTaskClosed } from "./delivery/schema.ts";
import type { Workspace, Priority, Project } from "./model.ts";
import { daysBetween, todayDate } from "./dates.ts";
import { installmentRemaining } from "./workspace.ts";
import { cashMovement } from "./cash-movement.ts";
import { projectProgress } from "./project-progress.ts";

export const isActiveProject = (project: Project) =>
  !project.removedAt &&
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
    if (
      isVisibleDeliveryTask(state, task) &&
      !isTaskClosed(task) &&
      task.dueOn &&
      task.dueOn < today
    )
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
      project.status !== "paused" &&
      daysBetween(
        todayDate(
          new Date(
            projectProgress(state, project).latestActivityAt ??
              project.createdAt,
          ),
        ),
        today,
      ) >= state.settings.staleDays
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

export function getDailyFocus(
  state: Workspace,
  today: string,
  alerts = getAlerts(state, today),
): FocusItem[] {
  const items: FocusItem[] = [];
  const projectsById = new Map(state.projects.map((item) => [item.id, item]));
  const alertedProjects = new Set<string>();
  for (const task of state.tasks.filter(
    (item) => !isTaskClosed(item) && isVisibleDeliveryTask(state, item),
  )) {
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
  for (const alert of alerts) {
    if (alert.category === "task") continue;
    if (alert.category === "project") alertedProjects.add(alert.entityId);
    items.push({
      ...alert,
      score:
        (alert.severity === "danger" ? -35 : 10) +
        priorityScore(alert.priority) * 10,
    });
  }
  for (const project of state.projects.filter(
    (item) =>
      isActiveProject(item) &&
      item.status !== "paused" &&
      item.nextAction.trim(),
  ))
    if (
      !alertedProjects.has(project.id) &&
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
  const { received, paidExpenses, refunded, cashBalance } = cashMovement(
    state,
    [month],
  )[0];
  const activeContracts = new Set(
    state.contracts
      .filter((item) => item.status === "active")
      .map((item) => item.id),
  );
  const open = state.installments.filter(
    (item) => item.status === "open" && activeContracts.has(item.contractId),
  );
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
    cashBalance,
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
