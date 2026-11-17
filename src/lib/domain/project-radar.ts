import type { Project, Workspace } from "./model.ts";
import { daysBetween, todayDate } from "./dates.ts";
import { shiftDay } from "./week.ts";
import { isActiveProject, priorityScore } from "./selectors.ts";
import { projectProgress } from "./project-progress.ts";

function followUp(
  project: Project,
  blocked: number,
  daysLeft: number | null,
  daysSinceUpdate: number,
  today: string,
  staleDays: number,
) {
  if (daysLeft !== null && daysLeft < 0)
    return {
      order: 0,
      tone: "danger",
      label: "Entrega atrasada",
      action: "Revise o prazo e confirme a próxima entrega.",
    } as const;
  if (daysLeft === 0)
    return {
      order: 1,
      tone: "danger",
      label: "Entrega hoje",
      action: "Valide o que falta para entregar.",
    } as const;
  if (blocked)
    return {
      order: 2,
      tone: "amber",
      label:
        blocked === 1 ? "1 tarefa bloqueada" : `${blocked} tarefas bloqueadas`,
      action: "Abra a ficha e destrave a execução.",
    } as const;
  if (
    project.status === "waiting" &&
    project.nextActionOn &&
    project.nextActionOn <= today
  )
    return {
      order: 3,
      tone: "amber",
      label: "Retorno pendente",
      action: project.waitingFor
        ? `Acompanhe ${project.waitingFor}.`
        : "Retome o contato e registre a resposta.",
    } as const;
  if (project.status === "paused")
    return {
      order: 8,
      tone: "neutral",
      label: "Pausado",
      action: "Revise quando o projeto deve voltar à operação.",
    } as const;
  if (daysLeft !== null && daysLeft <= 7)
    return {
      order: 4,
      tone: "amber",
      label: daysLeft === 1 ? "Entrega amanhã" : `Entrega em ${daysLeft} dias`,
      action: project.nextAction || "Defina o próximo passo da entrega.",
    } as const;
  if (
    project.nextActionOn &&
    project.nextActionOn < today &&
    project.nextAction
  )
    return {
      order: 5,
      tone: "amber",
      label: "Próxima ação atrasada",
      action: project.nextAction,
    } as const;
  if (!project.nextAction)
    return {
      order: 6,
      tone: "amber",
      label: "Sem próximo passo",
      action: "Registre a próxima ação e uma data para revisá-la.",
    } as const;
  if (daysSinceUpdate >= staleDays)
    return {
      order: 7,
      tone: "amber",
      label: `Sem atualização há ${daysSinceUpdate} ${daysSinceUpdate === 1 ? "dia" : "dias"}`,
      action: "Registre o que avançou e confirme o próximo passo.",
    } as const;
  return {
    order: 8,
    tone: "green",
    label: "Em dia",
    action: project.nextAction,
  } as const;
}

export function projectRadar(state: Workspace, today: string) {
  const clients = new Map(state.clients.map(({ id, name }) => [id, name]));
  const areas = new Map<string, number>();
  const projects = state.projects.filter(isActiveProject).map((project) => {
    const progress = projectProgress(state, project);
    const lastUpdateOn = todayDate(
      new Date(progress.latestUpdate?.createdAt ?? project.createdAt),
    );
    const daysLeft = project.dueOn ? daysBetween(today, project.dueOn) : null;
    areas.set(project.areaId, (areas.get(project.areaId) ?? 0) + 1);
    return {
      project,
      clientName: project.clientId ? clients.get(project.clientId) : undefined,
      progress,
      daysLeft,
      followUp: followUp(
        project,
        progress.blockedTasks,
        daysLeft,
        daysBetween(lastUpdateOn, today),
        today,
        state.settings.staleDays,
      ),
    };
  });
  projects.sort(
    (a, b) =>
      a.followUp.order - b.followUp.order ||
      priorityScore(a.project.priority) - priorityScore(b.project.priority) ||
      (a.project.dueOn ?? "9999").localeCompare(b.project.dueOn ?? "9999") ||
      a.project.id.localeCompare(b.project.id),
  );

  const week = Array.from({ length: 7 }, (_, i) => ({
    date: shiftDay(today, i - 6),
    count: 0,
  }));
  const byDate = new Map(week.map((day) => [day.date, day]));
  const visible = new Set(
    state.projects.filter((p) => !p.removedAt).map((p) => p.id),
  );
  for (const update of state.updates) {
    if (!visible.has(update.projectId)) continue;
    const day = byDate.get(todayDate(new Date(update.createdAt)));
    if (day) day.count += 1;
  }

  return {
    projects,
    areas,
    overdue: projects.filter((row) => row.daysLeft !== null && row.daysLeft < 0)
      .length,
    dueSoon: projects.filter(
      (row) => row.daysLeft !== null && row.daysLeft >= 0 && row.daysLeft <= 7,
    ).length,
    needingAction: projects.filter((row) => row.followUp.order < 8).length,
    week,
    recentUpdates: week.reduce((total, day) => total + day.count, 0),
  };
}
