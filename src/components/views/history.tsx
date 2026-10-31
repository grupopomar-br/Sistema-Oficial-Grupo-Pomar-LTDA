"use client";
import { useMemo, useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { EmptyState, Pagination, SearchInput } from "../ui";
import type { ViewProps } from "../types";
import { fullDate } from "@/lib/domain/dates";
import { relatedProjectId } from "@/lib/domain/selectors";

const types: Record<string, string> = {
  payment_test: "Simulações de pagamento",
  idea: "Ideias",
  collection: "Cobranças",
  installment: "Parcelas",
  client: "Clientes",
  project: "Projetos",
  task: "Tarefas",
  contract: "Contratos",
  receipt: "Recebimentos",
  expense: "Despesas",
  opportunity: "Comercial",
  settings: "Preferências",
  area: "Áreas",
};
export default function History({ open }: ViewProps) {
  const { state } = useWorkspace();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [page, setPage] = useState(1);
  const list = useMemo(
    () =>
      state.history.filter(
        (item) =>
          (type === "all" || item.entityType === type) &&
          item.summary.toLowerCase().includes(query.toLowerCase()),
      ),
    [state, type, query],
  );
  const current = Math.min(page, Math.max(1, Math.ceil(list.length / 25)));
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Uma operação que mantém contexto.</h2>
          <p>Decisões, mudanças e entregas registradas ao longo do trabalho.</p>
        </div>
        <span className="pill">{state.history.length} registros recentes</span>
      </div>
      <div className="panel filter-main">
        <SearchInput
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          placeholder="Buscar no histórico"
        />
        <select
          aria-label="Filtrar histórico por módulo"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
        >
          <option value="all">Todos os módulos</option>
          {Object.entries(types).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <section className="panel history-panel">
        {list.length ? (
          <div className="timeline">
            {list.slice((current - 1) * 25, current * 25).map((entry) => {
              const projectId = relatedProjectId(
                state,
                entry.entityType,
                entry.entityId,
              );
              return (
                <div className="timeline-entry" key={entry.id}>
                  <span className="timeline-point" />
                  <div>
                    <span className="eyebrow">
                      {types[entry.entityType] ?? "Operação"}
                    </span>
                    <p>{entry.summary}</p>
                    <span className="timeline-time">
                      {state.settings.displayName} · {fullDate(entry.createdAt)}{" "}
                      às{" "}
                      {new Intl.DateTimeFormat("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Fortaleza",
                      }).format(new Date(entry.createdAt))}
                    </span>
                    {projectId && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          open({ kind: "projectDetail", id: projectId })
                        }
                      >
                        Abrir projeto
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={HistoryIcon}
            title="As primeiras ações formarão seu histórico."
            description="Criar, atualizar, concluir ou registrar uma decisão mantém o contexto da operação."
          />
        )}
      </section>
      <Pagination
        page={current}
        total={list.length}
        size={25}
        onChange={setPage}
      />
    </div>
  );
}
