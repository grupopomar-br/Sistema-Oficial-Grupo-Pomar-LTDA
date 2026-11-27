"use client";
import { useMemo, useState } from "react";
import { ClipboardCheck, Plus, CalendarDays } from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Button, EmptyState, SearchInput, Pagination } from "../ui";
import type { ViewProps } from "../types";
import { deliveryQueue } from "@/lib/domain/delivery/selectors";
import { isTaskClosed } from "@/lib/domain/delivery/schema";
import { DeliveryRow } from "../delivery/item-row";
import styles from "../delivery/delivery.module.css";

export default function Deliveries({ open, navigate, today }: ViewProps) {
  const { state } = useWorkspace();
  const [filter, setFilter] = useState("attention"),
    [query, setQuery] = useState(""),
    [project, setProject] = useState("all"),
    [page, setPage] = useState(1);
  const rows = useMemo(() => deliveryQueue(state, today), [state, today]);
  const openRows = rows.filter((row) => !isTaskClosed(row.task));
  const filters = [
    ["attention", "Para executar"],
    ["late", "Vencidas"],
    ["soon", "Até 7 dias"],
    ["waiting_client", "Aguardando cliente"],
    ["blocked", "Bloqueadas"],
    ["review", "Em validação"],
    ["closed", "Finalizadas"],
    ["all", "Todas"],
  ];
  const filtered = rows.filter((row) => {
    const closed = isTaskClosed(row.task);
    const match =
      filter === "all" ||
      (filter === "attention" &&
        !closed &&
        (row.ready || row.task.status !== "pending") &&
        (row.item.originalDueOn <= today ||
          row.dueSoon ||
          row.task.status === "review" ||
          row.task.status === "blocked" ||
          row.task.status === "waiting_client")) ||
      (filter === "late" && row.late) ||
      (filter === "soon" && row.dueSoon) ||
      (filter === "closed" && closed) ||
      row.task.status === filter;
    return (
      match &&
      (project === "all" || row.project.id === project) &&
      `${row.task.title} ${row.project.name} ${row.client?.name ?? ""} ${row.item.nextAction}`
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR"))
    );
  });
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Central de entregas</h2>
          <p>
            Escopo, prazos e evidências para conduzir o trabalho de cada
            cliente.
          </p>
        </div>
        <div className="button-group">
          <Button onClick={() => navigate("week")}>
            <CalendarDays size={16} />
            Calendário semanal
          </Button>
          <Button
            variant="primary"
            disabled={!state.deliveryReady}
            onClick={() => open({ kind: "deliveryPlan" })}
          >
            <Plus size={16} />
            Criar plano
          </Button>
        </div>
      </div>
      {!state.deliveryReady && (
        <p className="inline-note">
          A Central de Entregas está aguardando ativação no ambiente de
          homologação.
        </p>
      )}
      <div className={styles.counts}>
        {[
          ["late", "Vencidas", openRows.filter((r) => r.late).length],
          [
            "soon",
            "Vencem em até 7 dias",
            openRows.filter((r) => r.dueSoon).length,
          ],
          [
            "waiting_client",
            "Aguardando cliente",
            openRows.filter((r) => r.task.status === "waiting_client").length,
          ],
          [
            "review",
            "Para validar",
            openRows.filter((r) => r.task.status === "review").length,
          ],
        ].map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setFilter(String(key));
              setPage(1);
            }}
          >
            <strong>{count}</strong>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <section className="panel filter-panel">
        <div className="filter-main">
          <SearchInput
            placeholder="Buscar entrega, projeto ou cliente"
            value={query}
            onChange={(text) => {
              setQuery(text);
              setPage(1);
            }}
          />
          <select
            aria-label="Filtrar entregas por projeto"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Todos os projetos</option>
            {state.projects
              .filter((p) => !p.removedAt)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
        <div className="filter-tabs">
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
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
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h3>
            {filtered.length} {filtered.length === 1 ? "entrega" : "entregas"}
          </h3>
        </div>
        {filtered.length ? (
          <ul className={styles.list}>
            {filtered
              .slice((current - 1) * 20, current * 20)
              .map(({ task, item, project, client }) => (
                <DeliveryRow
                  key={item.id}
                  task={task}
                  item={item}
                  today={today}
                  open={open}
                  context={`${client?.name ?? "Projeto interno"} · ${project.name} · ${item.phase === "implementation" ? item.groupTitle : "Recorrência"}`}
                />
              ))}
          </ul>
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title={
              state.deliveryPlans.length
                ? "Nenhuma entrega nesta visão."
                : "Transforme o escopo em um plano de execução."
            }
            description={
              state.deliveryPlans.length
                ? "Ajuste o período, o projeto ou o estado para consultar as outras entregas."
                : "Abra um projeto com contrato, confirme a metodologia e acompanhe as entregas por aqui."
            }
            action={
              state.deliveryReady && !state.deliveryPlans.length
                ? "Criar plano"
                : undefined
            }
            onAction={() => open({ kind: "deliveryPlan" })}
          />
        )}
      </section>
      {!!state.deliveryPlans.length && (
        <section className="panel">
          <div className="panel-heading">
            <h3>Planos dos clientes</h3>
          </div>
          <ul className={styles.list}>
            {state.deliveryPlans
              .filter(
                (p) =>
                  p.status !== "archived" &&
                  !state.projects.find((project) => project.id === p.projectId)
                    ?.removedAt,
              )
              .map((plan) => (
                <li className={styles.item} key={plan.id}>
                  <div>
                    <strong>
                      {
                        state.projects.find((p) => p.id === plan.projectId)
                          ?.name
                      }
                    </strong>
                    <p>
                      {
                        state.servicePlaybooks.find(
                          (p) =>
                            p.key === plan.playbookKey &&
                            p.version === plan.playbookVersion,
                        )?.title
                      }{" "}
                      · versão {plan.playbookVersion}
                    </p>
                  </div>
                  <Button
                    onClick={() =>
                      open({
                        kind: "deliveryProject",
                        projectId: plan.projectId,
                      })
                    }
                  >
                    Abrir plano
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      )}
      <Pagination
        page={current}
        total={filtered.length}
        size={20}
        onChange={setPage}
      />
    </div>
  );
}
