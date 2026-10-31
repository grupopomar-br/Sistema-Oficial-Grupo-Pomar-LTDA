"use client";
import { useMemo, useState } from "react";
import { Plus, Users, ArrowUpRight, Building2 } from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge, Button, EmptyState, Pagination, SearchInput } from "../ui";
import type { ViewProps } from "../types";
import { labels } from "@/lib/domain/model";

export default function Clients({ open }: ViewProps) {
  const { state } = useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const list = useMemo(
    () =>
      state.clients
        .filter(
          (item) =>
            (status === "all" || item.status === status) &&
            `${item.name} ${item.city} ${item.segment} ${item.contactName}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [state, query, status],
  );
  const current = Math.min(page, Math.max(1, Math.ceil(list.length / 12)));
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Relacionamentos com contexto.</h2>
          <p>
            Uma visão de cada cliente e dos compromissos que vocês construíram.
          </p>
        </div>
        <Button variant="primary" onClick={() => open({ kind: "client" })}>
          <Plus size={17} />
          Novo cliente
        </Button>
      </div>
      <div className="panel filter-main">
        <SearchInput
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          placeholder="Buscar empresa, contato, cidade ou segmento"
        />
        <select
          aria-label="Filtrar relacionamento"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="all">Todos os relacionamentos</option>
          {Object.entries(labels.client).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="results-heading">
        <span>
          {list.length} {list.length === 1 ? "cliente" : "clientes"}
        </span>
      </div>
      {list.length ? (
        <div className="client-grid">
          {list.slice((current - 1) * 12, current * 12).map((client) => (
            <button
              type="button"
              className="client-card"
              key={client.id}
              onClick={() => open({ kind: "clientDetail", id: client.id })}
            >
              <div className="client-card-top">
                <span className="company-avatar avatar-green">
                  {client.name.slice(0, 1)}
                </span>
                <Badge
                  tone={
                    client.status === "active"
                      ? "green"
                      : client.status === "prospect"
                        ? "amber"
                        : "neutral"
                  }
                >
                  {labels.client[client.status]}
                </Badge>
              </div>
              <h3>{client.name}</h3>
              <p>
                {client.segment || "Segmento a definir"}
                {client.city ? ` · ${client.city}` : ""}
              </p>
              <div className="client-card-contact">
                <Users size={14} />
                {client.contactName || "Contato a definir"}
              </div>
              <div className="client-card-footer">
                <span>
                  <Building2 size={14} />
                  {
                    state.projects.filter((item) => item.clientId === client.id)
                      .length
                  }{" "}
                  projetos
                </span>
                <ArrowUpRight size={18} />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon={Users}
            title={
              state.clients.length
                ? "Nenhum relacionamento encontrado."
                : "Cada crescimento começa com uma relação."
            }
            description="Cadastre seu primeiro cliente para conectar oportunidades, projetos e contratos."
            action="Cadastrar cliente"
            onAction={() => open({ kind: "client" })}
          />
        </div>
      )}
      <Pagination
        page={current}
        total={list.length}
        size={12}
        onChange={setPage}
      />
    </div>
  );
}
