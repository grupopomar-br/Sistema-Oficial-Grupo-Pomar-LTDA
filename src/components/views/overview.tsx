"use client";
import { isVisibleDeliveryTask } from "@/lib/domain/delivery/selectors";
import { isTaskClosed } from "@/lib/domain/delivery/schema";

import {
  ArrowUpRight,
  ArrowRight,
  Check,
  Plus,
  Target,
  Clock,
  Wallet,
  ListTodo,
  FolderKanban,
  Calendar,
  Activity,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import {
  Badge,
  Button,
  EmptyState,
  MonthPicker,
  PriorityBadge,
  StatCard,
} from "../ui";
import { TaskAction } from "../delivery/task-action";
import { DeliveryFocus } from "../delivery/focus";
import { ProjectRadar } from "./project-radar";
import type { ViewProps } from "../types";
import {
  getDailyFocus,
  getAlerts,
  getFinanceSummary,
} from "@/lib/domain/selectors";
import { projectRadar } from "@/lib/domain/project-radar";
import { money, shortDate } from "@/lib/domain/dates";
import { useMemo } from "react";

export default function Overview(props: ViewProps) {
  const { state, execute, saving, mode } = useWorkspace();
  const { today, month, open, navigate, hiddenValues } = props;
  const finance = useMemo(
    () => getFinanceSummary(state, month),
    [state, month],
  );
  const alerts = useMemo(() => getAlerts(state, today), [state, today]);
  const focus = useMemo(
    () => getDailyFocus(state, today, alerts),
    [state, today, alerts],
  );
  const radar = useMemo(() => projectRadar(state, today), [state, today]);
  const openTasks = state.tasks.filter(
    (item) => !isTaskClosed(item) && isVisibleDeliveryTask(state, item),
  );
  const format = (value: number) => (hiddenValues ? "••••" : money(value));
  const openFocus = (item: (typeof focus)[number]) => {
    if (item.category === "billing") navigate("collections");
    else if (item.category === "task")
      open({ kind: "task", id: item.entityId });
    else if (item.category === "finance")
      open({ kind: "receipt", installmentId: item.entityId });
    else if (item.category === "opportunity")
      open({ kind: "opportunity", id: item.entityId });
    else open({ kind: "projectDetail", id: item.entityId });
  };
  return (
    <div className="view-stack">
      <div className="overview-intro">
        <div>
          <h2>Painel da operação</h2>
        </div>
        <MonthPicker value={month} onChange={props.setMonth} />
      </div>
      <div className="stats-grid">
        <StatCard
          title="Projetos em movimento"
          value={radar.projects.length}
          detail={`${radar.projects.filter(({ project }) => project.status === "waiting").length} aguardando terceiros`}
          icon={FolderKanban}
          accent
          onClick={() => navigate("projects")}
        />
        <StatCard
          title="Tarefas abertas"
          value={openTasks.length}
          detail={`${openTasks.filter((item) => item.dueOn && item.dueOn < today).length} com prazo vencido`}
          icon={ListTodo}
          onClick={() => navigate("tasks")}
        />
        <StatCard
          title="Recebido no mês"
          value={format(finance.received)}
          detail="Valores brutos confirmados no período"
          icon={Wallet}
          onClick={() => navigate("finance")}
        />
        <StatCard
          title="A receber no mês"
          value={format(finance.expected)}
          detail="Saldo das parcelas com vencimento no mês"
          icon={Calendar}
          onClick={() => navigate("finance")}
        />
      </div>
      <DeliveryFocus open={open} navigate={navigate} today={today} />
      <ProjectRadar
        data={radar}
        open={open}
        navigate={navigate}
        tracking={mode === "local" || state.projectUpdatesReady}
      />
      <div className="dashboard-main">
        <section className="panel focus-panel">
          <div className="panel-heading">
            <div>
              <h2>Prioridades de hoje</h2>
            </div>
            <Button variant="ghost" onClick={() => open({ kind: "task" })}>
              <Plus size={16} />
              Tarefa
            </Button>
          </div>
          {focus.length ? (
            <div className="focus-list">
              {focus.map((item, index) => {
                const task =
                  item.category === "task"
                    ? state.tasks.find((task) => task.id === item.entityId)
                    : null;
                return (
                  <div
                    key={item.id}
                    className={`focus-row ${index === 0 ? "focus-row-first" : ""}`}
                  >
                    <span className="focus-number">{index + 1}</span>
                    <div className="focus-content">
                      <div className="focus-title">
                        <h3>{item.title}</h3>
                        <PriorityBadge value={item.priority} />
                      </div>
                      <p>{item.detail}</p>
                      <div className="focus-meta">
                        {item.dueOn ? (
                          <span
                            className={item.dueOn < today ? "text-danger" : ""}
                          >
                            <Clock size={12} />
                            {item.dueOn < today ? "Vencido em " : ""}
                            {shortDate(item.dueOn)}
                          </span>
                        ) : (
                          <span>Próxima ação do projeto</span>
                        )}
                        <button type="button" onClick={() => openFocus(item)}>
                          Abrir{" "}
                          {item.category === "billing"
                            ? "cobranças"
                            : item.category === "project"
                              ? "projeto"
                              : item.category === "finance"
                                ? "parcela"
                                : item.category === "opportunity"
                                  ? "oportunidade"
                                  : "tarefa"}
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </div>
                    {task && <TaskAction task={task} open={open} />}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Target}
              title="Seu foco começa com uma próxima ação."
              description="Cadastre um projeto ou reserve uma tarefa para o dia. As prioridades aparecerão aqui."
              action="Criar primeira tarefa"
              onAction={() => open({ kind: "task" })}
            />
          )}
          <div className="panel-footer">
            <span>
              Até {state.settings.dailyFocusLimit} ações para proteger seu foco.
            </span>
            <button type="button" onClick={() => navigate("tasks")}>
              Todas as tarefas
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <aside className="dashboard-side">
          <section className="attention-card">
            <div>
              <span className="attention-icon">
                <Activity size={19} />
              </span>
              <Badge tone="lime">
                {alerts.length} {alerts.length === 1 ? "ponto" : "pontos"}
              </Badge>
            </div>
            <span className="eyebrow">CENTRAL DE ATENÇÃO</span>
            <h3>
              {alerts.length
                ? "Antecipe o que pode travar."
                : "Espaço para avançar."}
            </h3>
            <p>
              {alerts.length
                ? "Prazos, cobranças e acompanhamentos reunidos para você decidir."
                : "Novos alertas surgirão a partir dos prazos e compromissos cadastrados."}
            </p>
            <Button onClick={() => navigate("alerts")}>
              Ver pontos de atenção
              <ArrowRight size={16} />
            </Button>
          </section>
          <section className="panel area-panel">
            <div className="small-panel-heading">
              <h3>Frentes da operação</h3>
              <button
                type="button"
                aria-label="Ver projetos"
                onClick={() => navigate("projects")}
              >
                <ArrowUpRight size={17} />
              </button>
            </div>
            {state.areas
              .filter((item) => !item.archived)
              .map((area) => (
                <button
                  type="button"
                  className="area-row"
                  key={area.id}
                  onClick={() => navigate("projects")}
                >
                  <span className={`area-dot dot-${area.color}`} />
                  <span>{area.name}</span>
                  <strong>{radar.areas.get(area.id) ?? 0}</strong>
                </button>
              ))}
          </section>
        </aside>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CONTINUIDADE</span>
            <h2>O que mudou na operação</h2>
          </div>
          <Button variant="ghost" onClick={() => navigate("history")}>
            Ver histórico
            <ArrowUpRight size={16} />
          </Button>
        </div>
        {state.history.length ? (
          <div className="recent-history">
            {state.history.slice(0, 4).map((entry) => (
              <div key={entry.id}>
                <span className="history-dot" />
                <div>
                  <p>{entry.summary}</p>
                  <span>
                    {shortDate(entry.createdAt)} · {state.settings.displayName}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="quiet-empty">
            As primeiras decisões e entregas ficarão registradas aqui.
          </p>
        )}
      </section>
    </div>
  );
}
