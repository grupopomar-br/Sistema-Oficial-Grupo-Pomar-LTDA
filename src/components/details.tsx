"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  Plus,
  Edit3,
  Check,
  Calendar,
  Mail,
  Phone,
  Globe,
  FileText,
  Search,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  PriorityBadge,
  SearchInput,
} from "./ui";
import { ProjectCard } from "./project-card";
import type { ModalState } from "./types";
import { labels } from "@/lib/domain/model";
import { money, fullDate, shortDate } from "@/lib/domain/dates";
import { projectProgress, relatedProjectId } from "@/lib/domain/selectors";

export function EntityDetails({
  modal,
  open,
  onClose,
  today,
  hiddenValues,
}: {
  modal: { kind: "projectDetail" | "clientDetail"; id: string };
  open: (modal: ModalState) => void;
  onClose: () => void;
  today: string;
  hiddenValues: boolean;
}) {
  const { state, execute, saving } = useWorkspace();
  if (modal.kind === "clientDetail") {
    const client = state.clients.find((item) => item.id === modal.id);
    if (!client) return null;
    const projects = state.projects.filter(
      (item) => item.clientId === client.id || item.contractorId === client.id,
    );
    return (
      <Modal
        title={client.name}
        subtitle={client.segment || "Relacionamento da operação"}
        onClose={onClose}
        drawer
      >
        <div className="detail-actions">
          <Badge tone={client.status === "active" ? "green" : "neutral"}>
            {labels.client[client.status]}
          </Badge>
          <Button onClick={() => open({ kind: "client", id: client.id })}>
            <Edit3 size={15} />
            Editar cliente
          </Button>
        </div>
        <div className="contact-details">
          {client.contactName && (
            <p>
              <strong>Contato</strong>
              <span>{client.contactName}</span>
            </p>
          )}
          {client.city && (
            <p>
              <strong>Cidade</strong>
              <span>{client.city}</span>
            </p>
          )}
          {client.email && (
            <p>
              <Mail size={15} />
              <a href={`mailto:${client.email}`}>{client.email}</a>
            </p>
          )}
          {client.phone && (
            <p>
              <Phone size={15} />
              <span>{client.phone}</span>
            </p>
          )}
          {client.website && (
            <p>
              <Globe size={15} />
              <a
                href={client.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                Visitar site
                <ArrowUpRight size={13} />
              </a>
            </p>
          )}
        </div>
        {client.notes && (
          <div className="detail-note">
            <span className="eyebrow">CONTEXTO</span>
            <p>{client.notes}</p>
          </div>
        )}
        <div className="detail-section-heading">
          <h3>Projetos relacionados</h3>
          <Badge>{projects.length}</Badge>
        </div>
        {projects.length ? (
          projects.map((project) => (
            <button
              type="button"
              className="related-project"
              key={project.id}
              onClick={() => open({ kind: "projectDetail", id: project.id })}
            >
              <div>
                <strong>{project.name}</strong>
                <small>
                  {labels.project[project.status]} · entrega{" "}
                  {shortDate(project.dueOn)}
                </small>
              </div>
              <ArrowUpRight size={18} />
            </button>
          ))
        ) : (
          <p className="quiet-empty">
            Ainda não há projetos vinculados a este cliente.
          </p>
        )}
      </Modal>
    );
  }
  const project = state.projects.find((item) => item.id === modal.id);
  if (!project) return null;
  const client = state.clients.find((item) => item.id === project.clientId);
  const contractor = state.clients.find(
    (item) => item.id === project.contractorId,
  );
  const tasks = state.tasks.filter((item) => item.projectId === project.id);
  const history = state.history
    .filter(
      (item) =>
        relatedProjectId(state, item.entityType, item.entityId) === project.id,
    )
    .slice(0, 8);
  const contracts = state.contracts.filter(
    (item) => item.projectId === project.id,
  );
  const updates = state.updates
    .filter((item) => item.projectId === project.id)
    .slice()
    .reverse();
  return (
    <Modal
      title={project.name}
      subtitle={client?.name ?? "Projeto interno"}
      onClose={onClose}
      drawer
    >
      <div className="detail-actions">
        <div className="tag-row">
          <Badge
            tone={
              project.status === "active"
                ? "green"
                : project.status === "waiting"
                  ? "amber"
                  : "neutral"
            }
          >
            {labels.project[project.status]}
          </Badge>
          <PriorityBadge value={project.priority} />
        </div>
        <Button onClick={() => open({ kind: "project", id: project.id })}>
          <Edit3 size={15} />
          Editar
        </Button>
      </div>
      <div className="detail-metrics">
        <div>
          <span>Início</span>
          <strong>{fullDate(project.startedOn)}</strong>
        </div>
        <div>
          <span>Entrega</span>
          <strong>{fullDate(project.dueOn)}</strong>
        </div>
        <div>
          <span>Tarefas concluídas</span>
          <strong>
            {tasks.filter((item) => item.status === "done").length}/
            {tasks.length}
          </strong>
        </div>
      </div>
      <div className="progress-track">
        <span style={{ width: `${projectProgress(state, project.id)}%` }} />
      </div>
      {contractor && (
        <p className="helper-text">Contratante: {contractor.name}</p>
      )}
      <div className="detail-next">
        <span className="eyebrow">PRÓXIMA AÇÃO</span>
        <h3>
          {!["completed", "cancelled"].includes(project.status)
            ? project.nextAction || "Definir o próximo passo."
            : labels.project[project.status]}
        </h3>
        {project.nextActionOn && (
          <span>
            <Calendar size={14} />
            {fullDate(project.nextActionOn)}
          </span>
        )}
        {project.status === "waiting" && project.waitingFor && (
          <p>Aguardando: {project.waitingFor}</p>
        )}
      </div>
      {project.notes && (
        <div className="detail-note">
          <span className="eyebrow">ESCOPO E CONTEXTO</span>
          <p>{project.notes}</p>
        </div>
      )}
      <div className="detail-section-heading">
        <h3>Execução</h3>
        <Button
          variant="ghost"
          onClick={() => open({ kind: "task", projectId: project.id })}
        >
          <Plus size={15} />
          Tarefa
        </Button>
      </div>
      {tasks.length ? (
        <div className="detail-task-list">
          {tasks.map((task) => (
            <div key={task.id}>
              <button
                type="button"
                className={`task-check ${task.status === "done" ? "checked" : ""}`}
                aria-label={`${task.status === "done" ? "Reabrir" : "Concluir"} ${task.title}`}
                disabled={saving}
                onClick={() =>
                  void execute({
                    type: "setTaskStatus",
                    id: task.id,
                    expectedVersion: task.version,
                    status: task.status === "done" ? "pending" : "done",
                  })
                }
              >
                {task.status === "done" && <Check size={14} />}
              </button>
              <button
                type="button"
                className="detail-task-title"
                onClick={() => open({ kind: "task", id: task.id })}
              >
                {task.title}
                <small>
                  {labels.task[task.status]} · {shortDate(task.dueOn)}
                </small>
              </button>
              <PriorityBadge value={task.priority} />
            </div>
          ))}
        </div>
      ) : (
        <p className="quiet-empty">
          Divida a próxima entrega em ações concretas.
        </p>
      )}
      <div className="detail-section-heading">
        <h3>Contratos</h3>
        <Button
          variant="ghost"
          onClick={() => open({ kind: "contract", projectId: project.id })}
        >
          <Plus size={15} />
          Contrato
        </Button>
      </div>
      {contracts.map((contract) => (
        <div className="related-project" key={contract.id}>
          <div>
            <strong>{contract.title}</strong>
            <small>Fechado em {fullDate(contract.signedOn)}</small>
          </div>
          <strong>{hiddenValues ? "••••" : money(contract.totalCents)}</strong>
        </div>
      ))}
      {!contracts.length && (
        <p className="quiet-empty">Nenhum contrato vinculado.</p>
      )}
      <div className="detail-section-heading">
        <h3>Contexto e decisões</h3>
        <Button
          variant="ghost"
          onClick={() => open({ kind: "note", projectId: project.id })}
        >
          <Plus size={15} />
          Atualização
        </Button>
      </div>
      <div className="detail-history">
        {updates.map((entry) => (
          <div key={entry.id}>
            <span className="history-dot" />
            <div>
              <p style={{ whiteSpace: "pre-wrap" }}>{entry.message}</p>
              <small>{fullDate(entry.createdAt)}</small>
            </div>
          </div>
        ))}
        {history
          .filter((entry) => entry.action !== "note")
          .map((entry) => (
            <div key={entry.id}>
              <span className="history-dot" />
              <div>
                <p>{entry.summary}</p>
                <small>{fullDate(entry.createdAt)}</small>
              </div>
            </div>
          ))}
      </div>
    </Modal>
  );
}

export function GlobalSearch({
  open,
  onClose,
}: {
  open: (modal: ModalState) => void;
  onClose: () => void;
}) {
  const { state } = useWorkspace();
  const [query, setQuery] = useState("");
  const matches = (value: string) =>
    value
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .includes(
        query
          .toLocaleLowerCase("pt-BR")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, ""),
      );
  const results = [
    ...state.projects
      .filter((item) => matches(item.name))
      .map((item) => ({
        id: item.id,
        label: item.name,
        type: "Projeto",
        modal: { kind: "projectDetail" as const, id: item.id },
      })),
    ...state.clients
      .filter((item) => matches(`${item.name} ${item.contactName}`))
      .map((item) => ({
        id: item.id,
        label: item.name,
        type: "Cliente",
        modal: { kind: "clientDetail" as const, id: item.id },
      })),
    ...state.tasks
      .filter((item) => matches(item.title))
      .map((item) => ({
        id: item.id,
        label: item.title,
        type: "Tarefa",
        modal: { kind: "task" as const, id: item.id },
      })),
    ...state.ideas
      .filter((item) => matches(`${item.title} ${item.detail}`))
      .map((item) => ({
        id: item.id,
        label: item.title,
        type: "Ideia",
        modal: { kind: "idea" as const, id: item.id },
      })),
  ].slice(0, 15);
  return (
    <Modal title="Buscar na operação" onClose={onClose}>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Projeto, cliente, contato ou tarefa"
      />
      <div className="global-results">
        {results.map((item) => (
          <button
            type="button"
            key={`${item.type}:${item.id}`}
            onClick={() => open(item.modal)}
          >
            <div>
              <span className="eyebrow">{item.type}</span>
              <strong>{item.label}</strong>
            </div>
            <ArrowUpRight size={16} />
          </button>
        ))}
        {!results.length && (
          <EmptyState
            icon={Search}
            title="Nenhum resultado encontrado."
            description="Experimente uma palavra do nome do cliente, projeto ou tarefa."
          />
        )}
      </div>
    </Modal>
  );
}
