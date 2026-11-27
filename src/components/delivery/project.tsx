"use client";
import { useState } from "react";
import { Plus, CalendarDays } from "lucide-react";
import { labels } from "@/lib/domain/model";
import { useWorkspace } from "../workspace-provider";
import { Modal, Button, Badge } from "../ui";
import type { ModalState } from "../types";
import { fullDate } from "@/lib/domain/dates";
import { recurrencePeriods } from "@/lib/domain/delivery/selectors";
import { googleMetrics } from "@/lib/domain/google-results";
import { DeliverySummary } from "./summary";
import { DeliveryRow } from "./item-row";
import styles from "./delivery.module.css";

export default function DeliveryProject({
  projectId,
  today,
  open,
  onClose,
  onResults,
}: {
  projectId: string;
  today: string;
  open: (modal: ModalState) => void;
  onClose: () => void;
  onResults: () => void;
}) {
  const { state } = useWorkspace();
  const [historyLimit, setHistoryLimit] = useState(30);
  const plans = state.deliveryPlans
    .filter((p) => p.projectId === projectId)
    .toSorted(
      (a, b) =>
        Number(a.status === "archived") - Number(b.status === "archived") ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const [selected, setSelected] = useState(plans[0]?.id ?? ""),
    [tab, setTab] = useState("implementation"),
    [period, setPeriod] = useState("");
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const plan = plans.find((p) => p.id === selected) ?? plans[0];
  const periods = plan ? recurrencePeriods(state, plan.id) : [];
  const currentPeriod =
    periods.find((p) => p.start === period) ??
    periods.find((p) => p.start <= today && p.end >= today) ??
    periods.at(-1);
  const items = state.deliveryItems.filter((i) => i.planId === plan?.id);
  const steps = items.filter((i) => i.phase === "implementation");
  const playbook = state.servicePlaybooks.find(
    (p) => p.key === plan?.playbookKey && p.version === plan?.playbookVersion,
  );
  const stepOrder = new Map(
    playbook?.steps.map((step, index) => [step.key, index]),
  );
  steps.sort(
    (a, b) => (stepOrder.get(a.stepKey) ?? 0) - (stepOrder.get(b.stepKey) ?? 0),
  );
  const groups = [...new Set(steps.map((i) => i.groupKey))];
  const evidence = state.deliveryEvidence
    .filter((e) => items.some((i) => i.id === e.itemId))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const events = state.deliveryEvents
    .filter((e) => e.planId === plan?.id)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const results = state.googleResults
    .filter((r) => r.clientId === project.clientId && !r.archived)
    .toSorted((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  return (
    <Modal
      title="Entregas do projeto"
      subtitle={project.name}
      onClose={onClose}
      drawer
    >
      {!plan ? (
        <div className={styles.empty}>
          <p>
            Confirme o contrato e aplique uma metodologia para começar a
            acompanhar as entregas.
          </p>
          <Button
            variant="primary"
            disabled={!state.deliveryReady || !!project.removedAt}
            onClick={() => open({ kind: "deliveryPlan", projectId })}
          >
            <Plus size={16} />
            Criar plano de entrega
          </Button>
        </div>
      ) : (
        <>
          {plans.length > 1 && (
            <label className="field">
              <span>Plano de entrega</span>
              <select
                value={plan.id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setPeriod("");
                }}
              >
                {plans.map((p) => (
                  <option value={p.id} key={p.id}>
                    {
                      state.servicePlaybooks.find(
                        (m) =>
                          m.key === p.playbookKey &&
                          m.version === p.playbookVersion,
                      )?.title
                    }{" "}
                    · v{p.playbookVersion} ·{" "}
                    {p.status === "archived"
                      ? "arquivado"
                      : p.status === "paused"
                        ? "pausado"
                        : "ativo"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className={styles.planHeading}>
            <div>
              <strong>{playbook?.title}</strong>
              <small>
                Versão {plan.playbookVersion} · {fullDate(plan.startsOn)} a{" "}
                {fullDate(plan.endsOn)}
              </small>
            </div>
            <Button
              onClick={() =>
                open({ kind: "deliveryPlanStatus", planId: plan.id })
              }
            >
              {plan.status === "active"
                ? "Gerenciar plano"
                : plan.status === "paused"
                  ? "Plano pausado"
                  : "Plano arquivado"}
            </Button>
          </div>
          <DeliverySummary state={state} planId={plan.id} today={today} />
          <details className={styles.scope}>
            <summary>Escopo confirmado e contrato</summary>
            <p>{plan.scopeReference}</p>
            <p>
              {state.contracts.find((c) => c.id === plan.contractId)?.title}
            </p>
          </details>
          <div className="filter-tabs" aria-label="Seções das entregas">
            {[
              ["implementation", "Implantação"],
              ["recurring", "Recorrência"],
              ["evidence", "Evidências"],
              ["history", "Histórico"],
              ["results", "Resultados"],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "implementation" &&
            groups.map((group) => (
              <section key={group} className={styles.group}>
                <h3>{steps.find((i) => i.groupKey === group)?.groupTitle}</h3>
                <ul className={styles.list}>
                  {steps
                    .filter((i) => i.groupKey === group)
                    .map((item) => (
                      <DeliveryRow
                        key={item.id}
                        item={item}
                        task={state.tasks.find((t) => t.id === item.id)!}
                        today={today}
                        open={open}
                      />
                    ))}
                </ul>
              </section>
            ))}
          {tab === "recurring" && (
            <section className={styles.group}>
              {!periods.length ? (
                <>
                  <p>
                    Confira no contrato quais obrigações se repetem, em que
                    quantidade e em quais prazos.
                  </p>
                  <Button
                    variant="primary"
                    disabled={plan.status !== "active"}
                    onClick={() =>
                      open({ kind: "deliveryRecurrence", planId: plan.id })
                    }
                  >
                    <CalendarDays size={16} />
                    Programar recorrência
                  </Button>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Competência contratual</span>
                    <select
                      value={currentPeriod?.start ?? ""}
                      onChange={(e) => setPeriod(e.target.value)}
                    >
                      {periods.map((p) => (
                        <option key={p.start} value={p.start}>
                          {fullDate(p.start)} a {fullDate(p.end)} ·{" "}
                          {p.progress.completed}/{p.progress.total} validadas
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className={styles.note}>
                    Quantidades realizadas aguardam conferência até a validação
                    da obrigação completa.
                  </p>
                  <ul className={styles.list}>
                    {currentPeriod?.items.map((item) => (
                      <DeliveryRow
                        key={item.id}
                        item={item}
                        task={state.tasks.find((t) => t.id === item.id)!}
                        today={today}
                        open={open}
                      />
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {tab === "evidence" && (
            <section className={styles.group}>
              {evidence.length ? (
                <ul className={styles.list}>
                  {evidence.map((e) => (
                    <li key={e.id} className={styles.record}>
                      <strong>
                        {state.tasks.find((t) => t.id === e.itemId)?.title}
                      </strong>
                      <p>
                        {e.reference.startsWith("https://") ? (
                          <a
                            href={e.reference}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {e.reference}
                          </a>
                        ) : (
                          e.reference
                        )}
                      </p>
                      <small>
                        Executada em {fullDate(e.performedOn)} · {e.quantity}{" "}
                        {e.quantity === 1
                          ? "unidade registrada"
                          : "unidades registradas"}{" "}
                        · Registro {fullDate(e.createdAt)}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  As referências das entregas serão reunidas aqui após a
                  gravação.
                </p>
              )}
            </section>
          )}
          {tab === "history" && (
            <section className={styles.group}>
              <ul className={styles.list}>
                {events.slice(0, historyLimit).map((e) => (
                  <li className={styles.record} key={e.id}>
                    <strong>{e.summary}</strong>
                    <small>
                      {fullDate(e.createdAt)} ·{" "}
                      {new Intl.DateTimeFormat("pt-BR", {
                        timeZone: "America/Fortaleza",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(e.createdAt))}{" "}
                      · {state.settings.displayName}
                    </small>
                    {e.reason && <p>{e.reason}</p>}
                    {e.beforeState && e.afterState && (
                      <p>
                        {labels.task[
                          e.beforeState.status as keyof typeof labels.task
                        ] ?? e.beforeState.status}{" "}
                        →{" "}
                        {labels.task[
                          e.afterState.status as keyof typeof labels.task
                        ] ?? e.afterState.status}{" "}
                        · Quantidade {e.beforeState.completedQuantity} →{" "}
                        {e.afterState.completedQuantity} · Prazo{" "}
                        {fullDate(e.beforeState.dueOn)} →{" "}
                        {fullDate(e.afterState.dueOn)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {events.length > historyLimit && (
                <Button onClick={() => setHistoryLimit((n) => n + 30)}>
                  Ver mais registros
                </Button>
              )}
            </section>
          )}
          {tab === "results" && (
            <section className={styles.group}>
              <p>
                Resultados registrados para este cliente, com seus períodos e
                fontes.
              </p>
              {results.slice(0, 3).map((result) => (
                <article className={styles.record} key={result.id}>
                  <strong>{result.profileName}</strong>
                  <small>
                    {fullDate(result.periodStart)} a{" "}
                    {fullDate(result.periodEnd)}
                  </small>
                  <Badge tone={result.verified ? "green" : "amber"}>
                    {result.verified ? "Conferido no Google" : "A conferir"}
                  </Badge>
                  <dl className={styles.metrics}>
                    {googleMetrics
                      .filter((m) => result[m.key] !== null)
                      .map((m) => (
                        <div key={m.key}>
                          <dt>{m.label}</dt>
                          <dd>
                            {new Intl.NumberFormat("pt-BR").format(
                              result[m.key]!,
                            )}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </article>
              ))}
              {!results.length && (
                <p>Ainda não há métricas desse cliente na Central.</p>
              )}
              <Button onClick={onResults}>Abrir Resultados</Button>
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
