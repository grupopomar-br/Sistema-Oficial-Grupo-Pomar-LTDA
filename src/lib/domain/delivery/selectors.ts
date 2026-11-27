import type { Workspace, Task } from "../model.ts";
import { todayDate, daysBetween } from "../dates.ts";
import { isTaskClosed, type DeliveryItem } from "./schema.ts";

export function deliveryIndex(state: Workspace) {
  const cached = indexes.get(state);
  if (cached) return cached;
  const result = {
    tasks: new Map(state.tasks.map((t) => [t.id, t])),
    items: new Map(state.deliveryItems.map((i) => [i.id, i])),
    plans: new Map(state.deliveryPlans.map((p) => [p.id, p])),
    projects: new Map(state.projects.map((p) => [p.id, p])),
    clients: new Map(state.clients.map((c) => [c.id, c])),
  };
  indexes.set(state, result);
  return result;
}
const indexes = new WeakMap<
  Workspace,
  {
    tasks: Map<string, Workspace["tasks"][number]>;
    items: Map<string, Workspace["deliveryItems"][number]>;
    plans: Map<string, Workspace["deliveryPlans"][number]>;
    projects: Map<string, Workspace["projects"][number]>;
    clients: Map<string, Workspace["clients"][number]>;
  }
>();
export function isVisibleDeliveryTask(state: Workspace, task: Task) {
  const index = deliveryIndex(state),
    item = index.items.get(task.id);
  if (!item) return true;
  const plan = index.plans.get(item.planId),
    project = plan && index.projects.get(plan.projectId);
  return (
    plan?.status === "active" &&
    !!project &&
    !project.removedAt &&
    project.status !== "cancelled"
  );
}
export function deliveryProgress(state: Workspace, items: DeliveryItem[]) {
  const index = deliveryIndex(state);
  const applicable = items.filter(
    (i) => index.tasks.get(i.id)?.status !== "not_applicable",
  );
  const total = applicable.reduce((sum, i) => sum + i.weight, 0);
  const completed = applicable.filter(
    (i) => index.tasks.get(i.id)?.status === "done" && i.validatedAt !== null,
  );
  const completedWeight = completed.reduce((sum, i) => sum + i.weight, 0);
  const quantity = applicable.reduce((sum, i) => sum + i.targetQuantity, 0);
  const validatedQuantity = completed.reduce(
    (sum, i) => sum + i.targetQuantity,
    0,
  );
  return {
    percent: total ? Math.floor((completedWeight / total) * 100) : null,
    onTime: completed.filter(
      (item) =>
        item.validatedAt &&
        todayDate(new Date(item.validatedAt)) <= item.originalDueOn,
    ).length,
    completed: completed.length,
    total: applicable.length,
    excluded: items.length - applicable.length,
    quantity,
    validatedQuantity,
    reportedQuantity: applicable.reduce(
      (sum, i) => sum + i.completedQuantity,
      0,
    ),
    complete: applicable.length > 0 && completed.length === applicable.length,
  };
}
export function deliveryQueue(state: Workspace, today: string) {
  const index = deliveryIndex(state);
  const byPlan = new Map<string, DeliveryItem[]>();
  for (const item of state.deliveryItems) {
    if (item.phase !== "implementation") continue;
    const list = byPlan.get(item.planId) ?? [];
    list.push(item);
    byPlan.set(item.planId, list);
  }
  const stepOrder = new Map(
    state.servicePlaybooks.flatMap((playbook) =>
      playbook.steps.map(
        (step, order) =>
          [`${playbook.key}:${playbook.version}:${step.key}`, order] as const,
      ),
    ),
  );
  return state.deliveryItems
    .flatMap((item) => {
      const task = index.tasks.get(item.id),
        plan = index.plans.get(item.planId);
      if (!task || !plan || !isVisibleDeliveryTask(state, task)) return [];
      const project = index.projects.get(plan.projectId)!;
      const closed = isTaskClosed(task);
      const distance = daysBetween(today, item.originalDueOn);
      const dependencyCount = (byPlan.get(item.planId) ?? []).filter(
        (dependency) =>
          dependency.id !== item.id &&
          (item.finalReview || item.dependsOn.includes(dependency.stepKey)) &&
          !isTaskClosed(index.tasks.get(dependency.id)!),
      ).length;
      return [
        {
          item,
          task,
          plan,
          project,
          client: project.clientId
            ? index.clients.get(project.clientId)
            : undefined,
          late: !closed && distance < 0,
          dueSoon: !closed && distance >= 0 && distance <= 7,
          upcoming: item.periodStart !== null && item.periodStart > today,
          ready: dependencyCount === 0,
          dependencyCount,
          sequence:
            stepOrder.get(
              `${plan.playbookKey}:${plan.playbookVersion}:${item.stepKey}`,
            ) ?? 100,
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(isTaskClosed(a.task)) - Number(isTaskClosed(b.task)) ||
        a.item.originalDueOn.localeCompare(b.item.originalDueOn) ||
        Number(!a.ready) - Number(!b.ready) ||
        a.sequence - b.sequence ||
        a.task.priority.localeCompare(b.task.priority) ||
        a.task.id.localeCompare(b.task.id),
    );
}
export function recurrencePeriods(state: Workspace, planId: string) {
  const grouped = new Map<string, DeliveryItem[]>();
  for (const item of state.deliveryItems) {
    if (
      item.planId !== planId ||
      item.phase !== "recurring" ||
      !item.periodStart
    )
      continue;
    const list = grouped.get(item.periodStart) ?? [];
    list.push(item);
    grouped.set(item.periodStart, list);
  }
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, items]) => ({
      start,
      end: items[0].periodEnd!,
      items,
      progress: deliveryProgress(state, items),
    }));
}
