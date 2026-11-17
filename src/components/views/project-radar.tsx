import { Activity, ArrowUpRight, Plus } from "lucide-react";
import type { projectRadar } from "@/lib/domain/project-radar";
import { labels } from "@/lib/domain/model";
import { fullDate, shortDate } from "@/lib/domain/dates";
import { ProjectMeter, updateCountLabel } from "../project-meter";
import type { ViewProps } from "../types";
import { Badge, Button, PriorityBadge } from "../ui";
import styles from "./project-radar.module.css";

type RadarData = ReturnType<typeof projectRadar>;

export function ProjectRadar({
  data,
  open,
  navigate,
  tracking,
}: {
  data: RadarData;
  tracking: boolean;
} & Pick<ViewProps, "open" | "navigate">) {
  const max = Math.max(1, ...data.week.map((day) => day.count));
  return (
    <section className={styles.radar} aria-labelledby="project-radar-title">
      <div className={styles.summary}>
        <div>
          <div className={styles.title}>
            <Activity size={24} aria-hidden />
            <h2 id="project-radar-title">Radar de projetos</h2>
          </div>
          <dl className={styles.indicators}>
            <div>
              <dt>Pedem ação</dt>
              <dd>{data.needingAction}</dd>
            </div>
            <div>
              <dt>Entregas em atraso</dt>
              <dd>{data.overdue}</dd>
            </div>
            <div>
              <dt>Vencem em até 7 dias</dt>
              <dd>{data.dueSoon}</dd>
            </div>
          </dl>
        </div>
        <figure className={styles.chart}>
          <figcaption>
            <strong>{updateCountLabel(data.recentUpdates)}</strong>
            <span>Últimos 7 dias</span>
          </figcaption>
          <ol aria-label="Atualizações registradas por dia">
            {data.week.map((day) => (
              <li
                key={day.date}
                aria-label={`${fullDate(day.date)} · ${updateCountLabel(day.count)}`}
              >
                <strong aria-hidden>{day.count}</strong>
                <span className={styles.barTrack} aria-hidden>
                  <i style={{ height: `${(day.count / max) * 100}%` }} />
                </span>
                <small aria-hidden>{day.date.slice(-2)}</small>
              </li>
            ))}
          </ol>
        </figure>
      </div>
      {data.projects.length > 0 ? (
        <ul
          className={styles.list}
          aria-label="Projetos por prioridade de acompanhamento"
        >
          {data.projects
            .slice(0, 4)
            .map(({ project, clientName, progress, followUp }) => (
              <li key={project.id} className={styles.row}>
                <div className={styles.project}>
                  <button
                    className={styles.projectName}
                    type="button"
                    onClick={() =>
                      open({ kind: "projectDetail", id: project.id })
                    }
                  >
                    {project.name}
                    <ArrowUpRight size={14} aria-hidden />
                  </button>
                  <span>
                    {clientName ?? "Projeto interno"} ·{" "}
                    {labels.project[project.status]}
                  </span>
                  <div className={styles.badges}>
                    <PriorityBadge value={project.priority} />
                    <Badge tone={followUp.tone}>{followUp.label}</Badge>
                  </div>
                </div>
                <div className={styles.action}>
                  <strong>
                    {project.nextAction ? "Próxima ação" : "Ação sugerida"}
                  </strong>
                  <p>{project.nextAction || followUp.action}</p>
                  {project.nextAction && project.nextActionOn && (
                    <small>
                      Acompanhar em {shortDate(project.nextActionOn)}
                    </small>
                  )}
                  {project.dueOn && (
                    <small>Entrega {shortDate(project.dueOn)}</small>
                  )}
                </div>
                <div className={styles.tracking}>
                  <ProjectMeter percent={progress.percent} />
                  <small>
                    {updateCountLabel(progress.updateCount)}
                    {progress.latestUpdate &&
                      ` · ${shortDate(progress.latestUpdate.createdAt)}`}
                  </small>
                </div>
                <Button
                  className={styles.update}
                  aria-label={`${tracking ? "Registrar avanço de" : "Atualizar"} ${project.name}`}
                  onClick={() => open({ kind: "note", projectId: project.id })}
                >
                  <Plus size={15} />{" "}
                  {tracking ? "Registrar avanço" : "Atualizar"}
                </Button>
              </li>
            ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          <p>
            Cadastre um projeto para acompanhar o prazo, o avanço e a próxima
            entrega.
          </p>
          <Button variant="primary" onClick={() => open({ kind: "project" })}>
            <Plus size={16} /> Novo projeto
          </Button>
        </div>
      )}
      {!!data.projects.length && (
        <div className={styles.footer}>
          <span>
            {Math.min(4, data.projects.length)} de {data.projects.length}{" "}
            projetos em aberto
          </span>
          <Button variant="ghost" onClick={() => navigate("projects")}>
            Ver todos os projetos <ArrowUpRight size={15} />
          </Button>
        </div>
      )}
    </section>
  );
}
