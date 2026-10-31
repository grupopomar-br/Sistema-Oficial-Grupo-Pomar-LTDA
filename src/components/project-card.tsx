"use client";

import { ArrowUpRight, Calendar, CheckCircle2 } from "lucide-react";
import { Badge, PriorityBadge } from "./ui";
import { useWorkspace } from "./workspace-provider";
import { labels, type Project } from "@/lib/domain/model";
import { shortDate, daysBetween } from "@/lib/domain/dates";
import { projectProgress, isActiveProject } from "@/lib/domain/selectors";

export function ProjectCard({
  project,
  today,
  onOpen,
}: {
  project: Project;
  today: string;
  onOpen: () => void;
}) {
  const { state } = useWorkspace();
  const client = state.clients.find((item) => item.id === project.clientId);
  const area = state.areas.find((item) => item.id === project.areaId);
  const tasks = state.tasks.filter((item) => item.projectId === project.id);
  const done = tasks.filter((item) => item.status === "done").length;
  const progress = projectProgress(state, project.id);
  const remaining = project.dueOn ? daysBetween(today, project.dueOn) : null;
  return (
    <button type="button" className="project-card" onClick={onOpen}>
      <div className="project-card-top">
        <span className={`company-avatar avatar-${area?.color ?? "green"}`}>
          {(client?.name ?? project.name).slice(0, 1)}
        </span>
        <PriorityBadge value={project.priority} />
      </div>
      <h3>{project.name}</h3>
      <p className="project-client">
        {client?.name ?? "Projeto interno"}
        {client?.city ? ` · ${client.city}` : ""}
      </p>
      <div className="tag-row">
        <Badge
          tone={
            project.status === "active" || project.status === "completed"
              ? "green"
              : project.status === "waiting"
                ? "amber"
                : "neutral"
          }
        >
          {labels.project[project.status]}
        </Badge>
        <Badge tone={area?.color}>{area?.name ?? "Área"}</Badge>
      </div>
      <div className="project-progress">
        <div>
          <span>ENTREGAS EM TAREFAS</span>
          <strong>
            {done}/{tasks.length}
          </strong>
        </div>
        <div className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="project-next">
        <span className="eyebrow">
          {isActiveProject(project) ? "PRÓXIMA AÇÃO" : "ESTADO DO PROJETO"}
        </span>
        <p>
          {isActiveProject(project)
            ? project.nextAction || "Definir a próxima ação."
            : labels.project[project.status]}
        </p>
      </div>
      <div className="project-card-footer">
        <span
          className={
            remaining !== null && remaining < 0 && isActiveProject(project)
              ? "text-danger"
              : ""
          }
        >
          <Calendar size={14} />
          {project.dueOn
            ? `${shortDate(project.dueOn)}${isActiveProject(project) && remaining !== null && remaining < 0 ? " · em atraso" : ""}`
            : "Prazo a definir"}
        </span>
        <ArrowUpRight size={17} />
      </div>
    </button>
  );
}
