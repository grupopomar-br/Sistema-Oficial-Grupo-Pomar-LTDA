"use client";
import { useMemo, useState } from "react";
import { Bell, ArrowUpRight, Calendar, Wallet, Clock } from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge, Button, EmptyState, Pagination, PriorityBadge } from "../ui";
import type { ViewProps } from "../types";
import { getAlerts, type AlertItem } from "@/lib/domain/selectors";
import { fullDate } from "@/lib/domain/dates";

export default function Alerts({ open, today, navigate }: ViewProps) {
  const { state } = useWorkspace();
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const alerts = useMemo(() => getAlerts(state, today), [state, today]);
  const list = alerts.filter(
    (item) => filter === "all" || item.category === filter,
  );
  const current = Math.min(page, Math.max(1, Math.ceil(list.length / 20)));
  const go = (item: AlertItem) => {
    if (item.category === "billing") navigate("collections");
    else if (item.category === "finance")
      open({ kind: "receipt", installmentId: item.entityId });
    else if (item.category === "task")
      open({ kind: "task", id: item.entityId });
    else if (item.category === "opportunity")
      open({ kind: "opportunity", id: item.entityId });
    else open({ kind: "projectDetail", id: item.entityId });
  };
  return (
    <div className="view-stack">
      <section className="attention-banner">
        <span className="attention-icon">
          <Bell size={23} />
        </span>
        <div>
          <span className="eyebrow">CENTRAL DE ATENÇÃO</span>
          <h2>
            {alerts.length
              ? `${alerts.length} pontos para acompanhar.`
              : "Sua operação está sem alertas."}
          </h2>
          <p>
            Os alertas vêm dos compromissos cadastrados e se atualizam quando
            você resolve a origem.
          </p>
        </div>
      </section>
      <div className="filter-tabs standalone">
        {[
          ["all", "Todos"],
          ["task", "Tarefas"],
          ["finance", "Financeiro"],
          ["billing", "Conciliação"],
          ["project", "Projetos"],
          ["opportunity", "Comercial"],
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
            <small>
              {key === "all"
                ? alerts.length
                : alerts.filter((item) => item.category === key).length}
            </small>
          </button>
        ))}
      </div>
      <div className="results-heading">
        <span>
          {list.length} de {alerts.length} pontos
        </span>
        <span>
          Gravidade do alerta e prioridade da ação são informações distintas.
        </span>
      </div>
      <section className="panel">
        {list.length ? (
          <div className="alert-list">
            {list.slice((current - 1) * 20, current * 20).map((item) => (
              <button
                type="button"
                key={item.id}
                className="alert-row"
                onClick={() => go(item)}
              >
                <span className={`alert-icon alert-${item.severity}`}>
                  {item.category === "finance" ? (
                    <Wallet size={19} />
                  ) : item.category === "task" ? (
                    <Calendar size={19} />
                  ) : (
                    <Clock size={19} />
                  )}
                </span>
                <div>
                  <div className="tag-row">
                    <Badge
                      tone={
                        item.severity === "danger"
                          ? "danger"
                          : item.severity === "warning"
                            ? "amber"
                            : "blue"
                      }
                    >
                      {item.severity === "danger"
                        ? "Exige atenção"
                        : item.severity === "warning"
                          ? "Acompanhar"
                          : "Próximo contato"}
                    </Badge>
                    <PriorityBadge value={item.priority} />
                  </div>
                  <h3>{item.title}</h3>
                  <p>
                    {item.detail}
                    {item.dueOn ? ` · ${fullDate(item.dueOn)}` : ""}
                  </p>
                </div>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Bell}
            title="Nenhum ponto nessa categoria."
            description="Mantenha prazos e próximas ações atualizados. A atenção é gerada a partir desses registros."
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
