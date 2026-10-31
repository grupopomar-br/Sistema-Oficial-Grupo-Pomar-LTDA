"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  LayoutGrid,
  List,
  FolderKanban,
  ArrowUpRight,
} from "lucide-react";
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
import { ProjectCard } from "../project-card";
import type { ViewProps } from "../types";
import { labels } from "@/lib/domain/model";
import { shortDate } from "@/lib/domain/dates";

export default function Projects({ open, today }: ViewProps) {
  const { state } = useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("open");
  const [area, setArea] = useState("all");
  const [priority, setPriority] = useState("all");
  const [layout, setLayout] = useState("grid");
  const [page, setPage] = useState(1);
  const filtered = useMemo(
    () =>
      state.projects
        .filter(
          (item) =>
            (status === "all" ||
              (status === "open" &&
                !["completed", "cancelled"].includes(item.status)) ||
              item.status === status) &&
            (area === "all" || item.areaId === area) &&
            (priority === "all" || item.priority === priority) &&
            `${item.name} ${state.clients.find((client) => client.id === item.clientId)?.name ?? ""}`
              .toLocaleLowerCase("pt-BR")
              .includes(query.toLocaleLowerCase("pt-BR")),
        )
        .sort(
          (a, b) =>
            a.priority.localeCompare(b.priority) ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
    [state, query, status, area, priority],
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / 12)),
  );
  const list = filtered.slice((currentPage - 1) * 12, currentPage * 12);
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Compromissos que viram entregas.</h2>
          <p>Escopo claro, próximos passos e prazos em movimento.</p>
        </div>
        <Button variant="primary" onClick={() => open({ kind: "project" })}>
          <Plus size={17} />
          Novo projeto
        </Button>
      </div>
      <section className="panel filter-panel">
        <div className="filter-main">
          <SearchInput
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            placeholder="Buscar projeto ou cliente"
          />
          <select
            aria-label="Filtrar por prioridade"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">Todas as prioridades</option>
            {["P0", "P1", "P2", "P3"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="Filtrar por estado"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="open">Em aberto</option>
            <option value="all">Todos os estados</option>
            {Object.entries(labels.project).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <div className="segmented compact">
            <IconButton
              label="Mostrar cartões"
              className={layout === "grid" ? "selected" : ""}
              onClick={() => setLayout("grid")}
            >
              <LayoutGrid size={17} />
            </IconButton>
            <IconButton
              label="Mostrar lista"
              className={layout === "list" ? "selected" : ""}
              onClick={() => setLayout("list")}
            >
              <List size={17} />
            </IconButton>
          </div>
        </div>
        <div className="filter-tabs">
          <button
            type="button"
            className={area === "all" ? "active" : ""}
            onClick={() => {
              setArea("all");
              setPage(1);
            }}
          >
            Todas as frentes<small>{state.projects.length}</small>
          </button>
          {state.areas
            .filter((item) => !item.archived)
            .map((item) => (
              <button
                type="button"
                key={item.id}
                className={area === item.id ? "active" : ""}
                onClick={() => {
                  setArea(item.id);
                  setPage(1);
                }}
              >
                <span className={`area-dot dot-${item.color}`} />
                {item.name}
              </button>
            ))}
        </div>
      </section>
      <div className="results-heading">
        <span>
          {filtered.length} {filtered.length === 1 ? "projeto" : "projetos"}
        </span>
        <span>Responsável: {state.settings.displayName}</span>
      </div>
      {list.length ? (
        layout === "grid" ? (
          <div className="project-grid">
            {list.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                today={today}
                onOpen={() => open({ kind: "projectDetail", id: project.id })}
              />
            ))}
          </div>
        ) : (
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Projeto e cliente</th>
                  <th>Estado</th>
                  <th>Prioridade</th>
                  <th>Entrega</th>
                  <th>
                    <span className="sr-only">Abrir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <button
                        type="button"
                        className="table-title"
                        onClick={() =>
                          open({ kind: "projectDetail", id: project.id })
                        }
                      >
                        {project.name}
                      </button>
                      <small>
                        {state.clients.find(
                          (item) => item.id === project.clientId,
                        )?.name ?? "Projeto interno"}
                      </small>
                    </td>
                    <td>
                      <Badge
                        tone={project.status === "active" ? "green" : "neutral"}
                      >
                        {labels.project[project.status]}
                      </Badge>
                    </td>
                    <td>
                      <PriorityBadge value={project.priority} />
                    </td>
                    <td>{shortDate(project.dueOn)}</td>
                    <td>
                      <IconButton
                        label={`Abrir ${project.name}`}
                        onClick={() =>
                          open({ kind: "projectDetail", id: project.id })
                        }
                      >
                        <ArrowUpRight size={17} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="panel">
          <EmptyState
            icon={FolderKanban}
            title={
              state.projects.length
                ? "Nenhum projeto com esses filtros."
                : "Organize sua primeira entrega."
            }
            description={
              state.projects.length
                ? "Experimente outra busca ou mude os filtros."
                : "Comece com o nome, o cliente e uma próxima ação concreta."
            }
            action="Novo projeto"
            onAction={() => open({ kind: "project" })}
          />
        </div>
      )}
      <Pagination
        page={currentPage}
        total={filtered.length}
        size={12}
        onChange={setPage}
      />
    </div>
  );
}
