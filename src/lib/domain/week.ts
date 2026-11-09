import type { Project, Task, Workspace } from "./model.ts";
import { meetingLocalTime, type Meeting } from "./meetings.ts";

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekStart(day: string, planAhead = false): string {
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return shiftDay(day, (planAhead && weekday >= 5 ? 7 : 0) - weekday);
}

type DayPlan = {
  day: string;
  tasks: Task[];
  deadlines: Task[];
  projects: Project[];
  meetings: { meeting: Meeting; time: string }[];
};

export function weekPlan(
  {
    tasks,
    projects,
    meetings,
  }: Pick<Workspace, "tasks" | "projects" | "meetings">,
  monday: string,
) {
  const days = Array.from({ length: 7 }, (_, i): DayPlan => ({
    day: shiftDay(monday, i),
    tasks: [],
    deadlines: [],
    projects: [],
    meetings: [],
  }));
  const byDate = new Map(days.map((day) => [day.day, day]));
  for (const task of tasks) {
    const planned = task.focusOn ?? task.dueOn;
    if (planned) byDate.get(planned)?.tasks.push(task);
    if (task.dueOn && task.dueOn !== planned && task.status !== "done")
      byDate.get(task.dueOn)?.deadlines.push(task);
  }
  for (const project of projects) {
    if (
      project.dueOn &&
      project.status !== "completed" &&
      project.status !== "cancelled"
    )
      byDate.get(project.dueOn)?.projects.push(project);
  }
  for (const meeting of meetings) {
    if (meeting.status === "cancelled") continue;
    const local = meetingLocalTime(meeting.startsAt);
    byDate
      .get(local.slice(0, 10))
      ?.meetings.push({ meeting, time: local.slice(11) });
  }
  for (const day of days) {
    day.tasks.sort(
      (a, b) =>
        Number(a.status === "done") - Number(b.status === "done") ||
        a.priority.localeCompare(b.priority) ||
        a.title.localeCompare(b.title, "pt-BR"),
    );
    day.meetings.sort((a, b) => a.time.localeCompare(b.time));
  }
  return days;
}
