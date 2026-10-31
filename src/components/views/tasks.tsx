"use client";
import { useMemo, useState } from "react";
import { Check, Edit3, ListTodo, Plus, Target, Clock } from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Pagination,
  PriorityBadge,
  SearchInput,
} from "../ui";
import type { ViewProps } from "../types";
import { labels } from "@/lib/domain/model";
import { shortDate } from "@/lib/domain/dates";

export default function Tasks({ open, today }: ViewProps) {
  const { state, execute, saving } = useWorkspace();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const [project, setProject] = useState("all");
  const [page, setPage] = useState(1);
  const list = useMemo(
    () =>
      state.tasks
        .filter(
          (item) =>
            (filter === "all" ||
              (filter === "open" && item.status !== "done") ||
              (filter === "done" && item.status === "done") ||
              (filter === "today" &&
                item.status !== "done" &&
                (item.focusOn === today || item.dueOn === today)) ||
              (filter === "late" &&
                item.status !== "done" &&
                !!item.dueOn &&
                item.dueOn < today)) &&
            (project === "all" || item.projectId === project) &&
            `${item.title} ${item.description}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort(
          (a, b) =>
            a.priority.localeCompare(b.priority) ||
            (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"),
        ),
    [state, query, filter, project, today],
  );
  const current = Math.min(page, Math.max(1, Math.ceil(list.length / 20)));
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Uma ação bem concluída de cada vez.</h2>
          <p>Conecte o trabalho de hoje aos compromissos da operação.</p>
        </div>
        <Button variant="primary" onClick={() => open({ kind: "task" })}>
          <Plus size={17} />
          Nova tarefa
        </Button>
      </div>
      <div className="panel filter-panel">
        <div className="filter-main">
          <SearchInput
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            placeholder="Buscar tarefa"
          />
          <select
            aria-label="Filtrar tarefas por projeto"
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">Todos os projetos</option>
            {state.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-tabs">
          {[
            ["open", "Em aberto"],
            ["today", "Hoje"],
            ["late", "Atrasadas"],
            ["done", "Concluídas"],
            ["all", "Todas"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={filter === key ? "active" : ""}
              onClick={() => {
                setFilter(key);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="results-heading">
        <span>
          {list.length} {list.length === 1 ? "tarefa" : "tarefas"}
        </span>
        <span>Marque o alvo para reservar uma tarefa no foco de hoje.</span>
      </div>
      <section className="panel">
        {list.length ? (
          <div className="task-list">
            {list.slice((current - 1) * 20, current * 20).map((task) => {
              const late =
                !!task.dueOn && task.dueOn < today && task.status !== "done";
              return (
                <div
                  className={`task-row ${task.status === "done" ? "task-row-done" : ""}`}
                  key={task.id}
                >
                  <button
                    type="button"
                    className={`task-check ${task.status === "done" ? "checked" : ""}`}
                    aria-label={`${task.status === "done" ? "Reabrir" : "Concluir"} ${task.title}`}
                    disabled={saving}
                    onClick={() =>
                      void execute({
                        type: "setTaskStatus",
                        id: task.id,
                        status: task.status === "done" ? "pending" : "done",
                        expectedVersion: task.version,
                      })
                    }
                  >
                    {task.status === "done" && <Check size={15} />}
                  </button>
                  <div className="task-row-content">
                    <div className="tag-row">
                      <PriorityBadge value={task.priority} />
                      {late && <Badge tone="danger">Atrasada</Badge>}
                      {task.status !== "pending" && (
                        <Badge
                          tone={task.status === "done" ? "green" : "neutral"}
                        >
                          {labels.task[task.status]}
                        </Badge>
                      )}
                    </div>
                    <button
                      type="button"
                      className="task-title"
                      onClick={() => open({ kind: "task", id: task.id })}
                    >
                      {task.title}
                    </button>
                    <div className="task-subtitle">
                      <span>
                        {state.projects.find(
                          (item) => item.id === task.projectId,
                        )?.name ?? "Operação geral"}
                      </span>
                      {task.dueOn && (
                        <span className={late ? "text-danger" : ""}>
                          <Clock size={12} />
                          {shortDate(task.dueOn)}
                        </span>
                      )}
                    </div>
                    {task.description && <p>{task.description}</p>}
                  </div>
                  <div className="row-actions">
                    <IconButton
                      label={
                        task.focusOn === today
                          ? "Retirar do foco de hoje"
                          : "Reservar no foco de hoje"
                      }
                      className={task.focusOn === today ? "focus-selected" : ""}
                      disabled={saving || task.status === "done"}
                      onClick={() =>
                        void execute({
                          type: "saveTask",
                          value: {
                            ...task,
                            focusOn: task.focusOn === today ? null : today,
                          },
                        })
                      }
                    >
                      <Target size={17} />
                    </IconButton>
                    <IconButton
                      label={`Editar ${task.title}`}
                      onClick={() => open({ kind: "task", id: task.id })}
                    >
                      <Edit3 size={16} />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={ListTodo}
            title={
              state.tasks.length
                ? "Nenhuma tarefa nessa visão."
                : "Tire o próximo passo da cabeça."
            }
            description="Registre a ação, o prazo e o projeto. O sistema reúne o que exige atenção."
            action="Nova tarefa"
            onAction={() => open({ kind: "task" })}
          />
        )}
      </section>
      <Pagination
        page={current}
        total={list.length}
        size={20}
        onChange={setPage}
      />
    </div>
  );
}
