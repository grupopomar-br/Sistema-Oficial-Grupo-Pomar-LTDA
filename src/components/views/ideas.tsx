"use client";
import { useState } from "react";
import { Lightbulb, Plus, ArrowUpRight, ListTodo } from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import {
  Badge,
  Button,
  EmptyState,
  Pagination,
  PriorityBadge,
  SearchInput,
} from "../ui";
import { ideaCategories, ideaStages } from "../idea-editor";
import type { ViewProps } from "../types";
import { newId } from "@/lib/domain/id";
import { shortDate } from "@/lib/domain/dates";
export default function Ideas({ open, navigate }: ViewProps) {
  const { state, execute, saving } = useWorkspace();
  const [query, setQuery] = useState(""),
    [stage, setStage] = useState("open"),
    [page, setPage] = useState(1);
  const filtered = state.ideas
    .filter(
      (i) =>
        (stage === "all" ||
          (stage === "open"
            ? !["done", "archived"].includes(i.stage)
            : i.stage === stage)) &&
        `${i.title} ${i.detail}`
          .toLocaleLowerCase("pt-BR")
          .includes(query.toLocaleLowerCase("pt-BR")),
    )
    .sort(
      (a, b) =>
        a.priority.localeCompare(b.priority) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 12)));
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Sua próxima melhoria começa com uma ideia.</h2>
          <p>
            Registre sem perder o ritmo. Depois transforme intenção em tarefa.
          </p>
        </div>
        <Button variant="primary" onClick={() => open({ kind: "idea" })}>
          <Plus size={16} />
          Registrar ideia
        </Button>
      </div>
      <div className="filters-bar">
        <SearchInput
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          placeholder="Buscar ideias e contexto"
        />
        <select
          aria-label="Filtrar etapa da ideia"
          value={stage}
          onChange={(e) => {
            setStage(e.target.value);
            setPage(1);
          }}
        >
          <option value="open">Em aberto</option>
          <option value="all">Todas</option>
          {Object.entries(ideaStages).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span className="result-count">{filtered.length} ideias</span>
      </div>
      {filtered.length ? (
        <div className="idea-grid">
          {filtered.slice((current - 1) * 12, current * 12).map((idea) => (
            <article className="panel idea-card" key={idea.id}>
              <div className="tag-row">
                <Badge>{ideaCategories[idea.category]}</Badge>
                <PriorityBadge value={idea.priority} />
              </div>
              <h3>{idea.title}</h3>
              <p className="idea-excerpt">
                {idea.detail ||
                  "Uma ideia registrada para voltar a ela na hora certa."}
              </p>
              <div className="idea-card-meta">
                <Badge tone={idea.stage === "done" ? "green" : "neutral"}>
                  {ideaStages[idea.stage]}
                </Badge>
                <small>{shortDate(idea.createdAt)}</small>
              </div>
              <div className="idea-card-actions">
                <Button onClick={() => open({ kind: "idea", id: idea.id })}>
                  Abrir
                  <ArrowUpRight size={14} />
                </Button>
                {idea.taskId ? (
                  <Button variant="ghost" onClick={() => navigate("tasks")}>
                    <ListTodo size={15} />
                    Ver tarefas
                  </Button>
                ) : (
                  !["done", "archived"].includes(idea.stage) && (
                    <Button
                      variant="ghost"
                      disabled={saving}
                      onClick={() =>
                        void execute({
                          type: "convertIdeaToTask",
                          id: idea.id,
                          taskId: newId(),
                          projectId: null,
                        })
                      }
                    >
                      <ListTodo size={15} />
                      Virar tarefa
                    </Button>
                  )
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon={Lightbulb}
            title="Libere espaço na sua memória."
            description="Capture uma ideia do sistema, da operação ou de uma nova oportunidade."
            action="Registrar primeira ideia"
            onAction={() => open({ kind: "idea" })}
          />
        </div>
      )}
      <Pagination
        page={current}
        total={filtered.length}
        size={12}
        onChange={setPage}
      />
    </div>
  );
}
