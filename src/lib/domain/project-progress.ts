import type { Project, Workspace } from "./model.ts";

type Update = Workspace["updates"][number];
type ProjectActivity = {
  taskCount: number;
  completedTasks: number;
  blockedTasks: number;
  updateCount: number;
  latestUpdate?: Update;
  latestMeasurement?: Update;
  latestActivityAt?: string;
};

const emptyActivity: ProjectActivity = {
  taskCount: 0,
  completedTasks: 0,
  blockedTasks: 0,
  updateCount: 0,
};
const indexes = new WeakMap<Workspace, Map<string, ProjectActivity>>();

function activities(state: Workspace) {
  const cached = indexes.get(state);
  if (cached) return cached;
  const byProject = new Map<string, ProjectActivity>(
    state.projects.map((project) => [project.id, { ...emptyActivity }]),
  );
  const deliveryTaskIds = new Set(state.deliveryItems.map((item) => item.id));
  for (const task of state.tasks) {
    const item = task.projectId ? byProject.get(task.projectId) : undefined;
    if (!item) continue;
    if (deliveryTaskIds.has(task.id)) {
      if (task.status === "blocked" || task.status === "waiting_client")
        item.blockedTasks += 1;
      continue;
    }
    item.taskCount += 1;
    if (task.status === "done") item.completedTasks += 1;
    if (task.status === "blocked") item.blockedTasks += 1;
  }
  for (const update of state.updates) {
    const item = byProject.get(update.projectId);
    if (!item) continue;
    item.updateCount += 1;
    const time = Date.parse(update.createdAt);
    if (!item.latestUpdate || time >= Date.parse(item.latestUpdate.createdAt))
      item.latestUpdate = update;
    if (!item.latestActivityAt || time >= Date.parse(item.latestActivityAt))
      item.latestActivityAt = update.createdAt;
    if (
      update.progressPercent !== undefined &&
      (!item.latestMeasurement ||
        time >= Date.parse(item.latestMeasurement.createdAt))
    )
      item.latestMeasurement = update;
  }
  const planProjects = new Map(
    state.deliveryPlans.map((plan) => [plan.id, plan.projectId]),
  );
  for (const event of state.deliveryEvents) {
    const projectId = planProjects.get(event.planId);
    const item = projectId && byProject.get(projectId);
    if (
      item &&
      (!item.latestActivityAt ||
        Date.parse(event.createdAt) >= Date.parse(item.latestActivityAt))
    )
      item.latestActivityAt = event.createdAt;
  }
  indexes.set(state, byProject);
  return byProject;
}

export function projectProgress(state: Workspace, project: Project) {
  const activity = activities(state).get(project.id) ?? emptyActivity;
  const reported = activity.latestMeasurement?.progressPercent;
  const byTasks = activity.taskCount
    ? Math.round((activity.completedTasks / activity.taskCount) * 100)
    : 0;
  return {
    ...activity,
    percent: project.status === "completed" ? 100 : (reported ?? byTasks),
    source:
      project.status === "completed"
        ? ("completed" as const)
        : reported === undefined
          ? ("tasks" as const)
          : ("reported" as const),
  };
}
