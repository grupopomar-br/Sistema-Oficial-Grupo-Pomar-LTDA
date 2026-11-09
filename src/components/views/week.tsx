"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  ListTodo,
  Plus,
} from "lucide-react";
import { fullDate } from "@/lib/domain/dates";
import { labels } from "@/lib/domain/model";
import { shiftDay, weekPlan, weekStart } from "@/lib/domain/week";
import type { ViewProps } from "../types";
import { useWorkspace } from "../workspace-provider";
import {
  Badge,
  Button,
  IconButton,
  Modal,
  PriorityBadge,
  SearchInput,
} from "../ui";
import styles from "./week.module.css";

const dayFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "long",
});

export default function Week({ open, today }: ViewProps) {
  const { state, execute, saving, operationError, clearOperationError } =
    useWorkspace();
  const { tasks, projects, meetings } = state;
  const [monday, setMonday] = useState(() => weekStart(today, true));
  const [placingOn, setPlacingOn] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const days = useMemo(
    () => weekPlan({ tasks, projects, meetings }, monday),
    [tasks, projects, meetings, monday],
  );
  const totals = days.reduce(
    (total, day) => ({
      tasks: total.tasks + day.tasks.length,
      done:
        total.done + day.tasks.filter((task) => task.status === "done").length,
      meetings: total.meetings + day.meetings.length,
      projects: total.projects + day.projects.length,
    }),
    { tasks: 0, done: 0, meetings: 0, projects: 0 },
  );
  const candidates = placingOn
    ? tasks
        .filter(
          (task) =>
            task.status !== "done" &&
            (task.focusOn ?? task.dueOn) !== placingOn &&
            task.title
              .toLocaleLowerCase("pt-BR")
              .includes(query.trim().toLocaleLowerCase("pt-BR")),
        )
        .slice(0, 20)
    : [];
  const hasPending = tasks.some((task) => task.status !== "done");

  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <span className="eyebrow">PLANEJAMENTO SEMANAL</span>
          <h2>Sua semana, dia por dia.</h2>
          <p>
            Reserve tempo para as tarefas e veja os prazos e compromissos de
            cada dia.
          </p>
        </div>
      </div>
      <section
        className={styles.summary}
        aria-label="Resumo e navegação da semana"
      >
        <div>
          <span>PERÍODO</span>
          <h3>
            {fullDate(monday)} a {fullDate(days[6].day)}
          </h3>
        </div>
        <div className={styles.controls}>
          <IconButton
            label="Semana anterior"
            onClick={() => setMonday(shiftDay(monday, -7))}
          >
            <ChevronLeft size={20} />
          </IconButton>
          <Button onClick={() => setMonday(weekStart(today))}>
            Esta semana
          </Button>
          <IconButton
            label="Próxima semana"
            onClick={() => setMonday(shiftDay(monday, 7))}
          >
            <ChevronRight size={20} />
          </IconButton>
        </div>
        <dl className={styles.totals}>
          <div>
            <dt>Tarefas concluídas</dt>
            <dd>
              {totals.done} de {totals.tasks}
            </dd>
          </div>
          <div>
            <dt>Entregas de projetos</dt>
            <dd>{totals.projects}</dd>
          </div>
          <div>
            <dt>Compromissos</dt>
            <dd>{totals.meetings}</dd>
          </div>
        </dl>
      </section>
      <div className={styles.grid}>
        {days.map(
          ({
            day,
            tasks: planned,
            deadlines,
            projects: deliveries,
            meetings: appointments,
          }) => (
            <section
              className={`panel ${styles.day} ${day === today ? styles.today : ""}`}
              key={day}
            >
              <div className={styles.dayHeading}>
                <div>
                  <h3>{dayFormatter.format(new Date(`${day}T12:00:00Z`))}</h3>
                  <time dateTime={day}>{fullDate(day)}</time>
                </div>
                {day === today && <Badge tone="green">Hoje</Badge>}
              </div>
              {appointments.length +
                planned.length +
                deadlines.length +
                deliveries.length >
              0 ? (
                <ul className={styles.items}>
                  {appointments.map(({ meeting, time }) => (
                    <li key={meeting.id}>
                      <button
                        type="button"
                        onClick={() =>
                          open({ kind: "meeting", id: meeting.id })
                        }
                      >
                        <CalendarClock size={16} />
                        <span>
                          <strong>{meeting.title}</strong>
                          <small>
                            {time} ·{" "}
                            {meeting.status === "completed"
                              ? "Realizado"
                              : "Compromisso"}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                  {deliveries.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() =>
                          open({ kind: "projectDetail", id: project.id })
                        }
                      >
                        <FolderKanban size={16} />
                        <span>
                          <strong>{project.name}</strong>
                          <small>Entrega de projeto</small>
                        </span>
                      </button>
                    </li>
                  ))}
                  {deadlines.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => open({ kind: "task", id: task.id })}
                      >
                        <ListTodo size={16} />
                        <span>
                          <strong>{task.title}</strong>
                          <small>
                            Prazo da tarefa · foco em {fullDate(task.focusOn)}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                  {planned.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => open({ kind: "task", id: task.id })}
                      >
                        <ListTodo size={16} />
                        <span>
                          <strong>{task.title}</strong>
                          <small>
                            {labels.task[task.status]}
                            {task.dueOn
                              ? ` · Prazo ${fullDate(task.dueOn)}`
                              : ""}
                          </small>
                        </span>
                        <PriorityBadge value={task.priority} />
                      </button>
                      {task.status !== "done" && (
                        <IconButton
                          label={`Concluir ${task.title}`}
                          disabled={saving}
                          onClick={() =>
                            void execute({
                              type: "setTaskStatus",
                              id: task.id,
                              status: "done",
                              expectedVersion: task.version,
                            })
                          }
                        >
                          <Check size={16} />
                        </IconButton>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>Dia livre para planejar.</p>
              )}
              <div className={styles.actions}>
                <Button onClick={() => open({ kind: "task", focusOn: day })}>
                  <Plus size={15} /> Nova tarefa
                </Button>
                {hasPending && (
                  <Button
                    onClick={() => {
                      clearOperationError();
                      setQuery("");
                      setPlacingOn(day);
                    }}
                  >
                    Encaixar tarefa
                  </Button>
                )}
                {state.meetingsReady && (
                  <Button onClick={() => open({ kind: "meeting", day })}>
                    <CalendarClock size={15} /> Compromisso
                  </Button>
                )}
              </div>
            </section>
          ),
        )}
      </div>
      {placingOn && (
        <Modal
          title="Encaixar tarefa existente"
          subtitle={`Dia planejado em ${fullDate(placingOn)}`}
          onClose={() => setPlacingOn(null)}
        >
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar tarefa aberta"
          />
          <p className={styles.empty}>
            Escolha a tarefa para reservar o dia. O prazo de entrega permanece
            registrado.
          </p>
          <ul className={styles.items}>
            {candidates.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    if (
                      await execute({
                        type: "saveTask",
                        value: { ...task, focusOn: placingOn },
                      })
                    )
                      setPlacingOn(null);
                  }}
                >
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.focusOn
                        ? `Foco atual em ${fullDate(task.focusOn)}`
                        : "Dia de foco a definir"}
                    </small>
                  </span>
                  <PriorityBadge value={task.priority} />
                </button>
              </li>
            ))}
          </ul>
          {!candidates.length && (
            <p className={styles.empty}>
              Nenhuma tarefa disponível para este dia.
            </p>
          )}
          {operationError && (
            <p className="form-error" role="alert">
              {operationError}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
