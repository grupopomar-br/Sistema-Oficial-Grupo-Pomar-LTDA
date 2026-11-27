"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Modal, Button, Field, Badge } from "../ui";
import { labels, type Command } from "@/lib/domain/model";
import { newId } from "@/lib/domain/id";
import {
  todayDate,
  fullDate,
  addMonthsClamped,
  isDateOnly,
} from "@/lib/domain/dates";
import { shiftDay } from "@/lib/domain/week";
import { contractPeriods } from "@/lib/domain/delivery/operations";
import {
  isTaskClosed,
  type RecurrenceRule,
} from "@/lib/domain/delivery/schema";
import type { ModalState } from "../types";
import styles from "./delivery.module.css";

type EditorModal = Extract<
  ModalState,
  {
    kind:
      | "deliveryPlan"
      | "deliveryTask"
      | "deliveryRecurrence"
      | "deliveryPlanStatus";
  }
>;
const value = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
function EditorFrame({
  title,
  subtitle,
  children,
  onClose,
  onSubmit,
  label = "Salvar",
  readOnly = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: (form: FormData) => Command;
  label?: string;
  readOnly?: boolean;
}) {
  const { execute, saving, operationError, clearOperationError } =
    useWorkspace();
  const [commandId] = useState(newId),
    [error, setError] = useState("");
  useEffect(() => clearOperationError(), [clearOperationError]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      if (await execute(onSubmit(new FormData(event.currentTarget)), commandId))
        onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Revise os campos da entrega.",
      );
    }
  };
  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <form onSubmit={submit} className={styles.form}>
        <fieldset disabled={saving || readOnly} className={styles.fields}>
          {children}
        </fieldset>
        {(error || operationError) && (
          <p className="form-error" role="alert">
            {error || operationError}
          </p>
        )}
        <div className="form-footer">
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          {!readOnly && (
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? "Salvando…" : label}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
function PlanEditor({
  projectId,
  onClose,
}: {
  projectId?: string;
  onClose: () => void;
}) {
  const { state } = useWorkspace();
  const [initial] = useState(state),
    [id] = useState(newId);
  const [projectKey, setProjectKey] = useState(projectId ?? ""),
    [starts, setStarts] = useState(todayDate),
    [months, setMonths] = useState("6");
  const projects = initial.projects.filter(
    (p) => !p.removedAt && !["completed", "cancelled"].includes(p.status),
  );
  const project = projects.find((p) => p.id === projectKey);
  const contracts = initial.contracts.filter(
    (c) =>
      c.projectId === projectKey &&
      (c.clientId === project?.clientId ||
        c.clientId === project?.contractorId) &&
      c.status === "active",
  );
  const [contractKey, setContractKey] = useState("");
  const selectedContract =
    contracts.find((c) => c.id === contractKey) ?? contracts[0];
  const canFillDuration =
    isDateOnly(starts) &&
    Number(starts.slice(0, 4)) +
      Math.floor((Number(starts.slice(5, 7)) - 1 + Number(months)) / 12) <=
      9999;
  const ends = canFillDuration
    ? shiftDay(addMonthsClamped(starts, Number(months)), -1)
    : "";
  return (
    <EditorFrame
      title="Criar plano de entrega"
      subtitle="Confirme o escopo vendido e a vigência operacional."
      onClose={onClose}
      label="Criar implantação"
      onSubmit={(form) => {
        const selectedProject = projects.find(
          (p) => p.id === value(form, "projectId"),
        );
        const contract = initial.contracts.find(
          (c) => c.id === value(form, "contractId"),
        );
        const [key, version] = value(form, "playbook").split(":");
        if (!selectedProject || !contract)
          throw new Error("Selecione um projeto com contrato ativo vinculado.");
        return {
          type: "createDeliveryPlan",
          id,
          projectId: selectedProject.id,
          expectedProjectVersion: selectedProject.version,
          contractId: contract.id,
          expectedContractVersion: contract.version,
          methodologyId: value(form, "methodologyId") || null,
          playbookKey: key,
          playbookVersion: Number(version),
          scopeReference: value(form, "scopeReference"),
          startsOn: value(form, "startsOn"),
          endsOn: value(form, "endsOn"),
          implementationDueOn: value(form, "implementationDueOn"),
        };
      }}
    >
      <div className="form-grid">
        <Field label="Projeto existente" wide>
          <select
            name="projectId"
            required
            value={projectKey}
            onChange={(e) => {
              setProjectKey(e.target.value);
              setContractKey("");
            }}
          >
            <option value="">Selecione o projeto</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contrato que define o escopo" wide>
          <select
            name="contractId"
            required
            value={selectedContract?.id ?? ""}
            onChange={(e) => setContractKey(e.target.value)}
          >
            <option value="">Selecione o contrato</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        {projectKey && !contracts.length && (
          <p className="form-error field-wide">
            Vincule um contrato ativo a este projeto e cliente antes de aplicar
            a metodologia.
          </p>
        )}
        {selectedContract && (
          <div className={`${styles.scope} field-wide`}>
            <strong>{selectedContract.title}</strong>
            <small>Fechado em {fullDate(selectedContract.signedOn)}</small>
            <p>
              {selectedContract.notes ||
                "Confira as condições no contrato antes de continuar."}
            </p>
          </div>
        )}
        <Field label="Metodologia executável" wide>
          <select name="playbook" required>
            {initial.servicePlaybooks.map((p) => (
              <option
                key={`${p.key}:${p.version}`}
                value={`${p.key}:${p.version}`}
              >
                {p.title} · versão {p.version} · {p.steps.length} entregas
              </option>
            ))}
          </select>
        </Field>
        <Field label="Documento de metodologia associado" wide>
          <select name="methodologyId">
            <option value="">Sem documento adicional</option>
            {initial.methodologies
              .filter((m) => !m.archived)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Início da vigência">
          <input
            type="date"
            name="startsOn"
            required
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </Field>
        <Field label="Preencher duração">
          <select value={months} onChange={(e) => setMonths(e.target.value)}>
            {[1, 2, 3, 4, 6, 12, 18, 24].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "mês" : "meses"}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Encerramento inclusivo"
          hint="Ajuste para a data efetivamente contratada."
        >
          <input
            key={ends}
            type="date"
            name="endsOn"
            defaultValue={ends}
            min={starts}
            required
          />
        </Field>
        <Field label="Prazo da implantação">
          <input
            type="date"
            name="implementationDueOn"
            min={starts}
            required
            defaultValue={todayDate()}
          />
        </Field>
        <Field label="Referência do escopo confirmado" wide>
          <textarea
            name="scopeReference"
            required
            minLength={5}
            maxLength={3000}
            rows={4}
            placeholder="Identifique o contrato, o que foi prometido, os limites e a vigência confirmada."
          />
        </Field>
      </div>
      <label className="checkbox-field">
        <input type="checkbox" required />
        <span>Conferi o escopo e as datas no contrato deste cliente.</span>
      </label>
    </EditorFrame>
  );
}
function TaskEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const { state } = useWorkspace();
  const [initial] = useState(state);
  const task = initial.tasks.find((t) => t.id === id),
    item = initial.deliveryItems.find((i) => i.id === id);
  const [status, setStatus] = useState<string>(
    task && isTaskClosed(task) ? "review" : (task?.status ?? "pending"),
  );
  const plan = initial.deliveryPlans.find((p) => p.id === item?.planId);
  if (!task || !item || !plan) return null;
  const readonly =
    plan.status !== "active" ||
    !!initial.projects.find((p) => p.id === plan.projectId)?.removedAt;
  const closed = isTaskClosed(task),
    today = todayDate();
  const evidence = initial.deliveryEvidence
    .filter((e) => e.itemId === id)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const dependencies = initial.deliveryItems.filter(
    (i) =>
      i.planId === plan.id &&
      i.id !== item.id &&
      i.phase === "implementation" &&
      (item.finalReview || item.dependsOn.includes(i.stepKey)),
  );
  const pending = dependencies.filter(
    (i) => !isTaskClosed(initial.tasks.find((t) => t.id === i.id)!),
  );
  const statuses = [
    "pending",
    "doing",
    "waiting_client",
    "blocked",
    "review",
    ...(task.status === "review" ? ["done"] : []),
    ...(!item.required && !closed ? ["not_applicable"] : []),
  ];
  return (
    <EditorFrame
      readOnly={readonly}
      title={closed ? "Consultar ou reabrir entrega" : "Executar entrega"}
      subtitle={task.title}
      onClose={onClose}
      label={
        status === "done"
          ? "Validar entrega"
          : closed
            ? "Reabrir entrega"
            : "Salvar acompanhamento"
      }
      onSubmit={(form) => {
        if (readonly)
          throw new Error(
            "Retome o plano e confira se o projeto está disponível.",
          );
        return {
          type: "recordDeliveryTask",
          id,
          expectedVersion: task.version,
          status: value(form, "status") as typeof task.status,
          dueOn: value(form, "dueOn"),
          completedQuantity:
            status === "not_applicable"
              ? 0
              : Number(value(form, "completedQuantity")),
          acceptedCriteria:
            status === "not_applicable"
              ? []
              : form.getAll("criteria").map(String),
          nextAction: value(form, "nextAction"),
          dependency: value(form, "dependency"),
          reason: value(form, "reason"),
          evidenceReference: value(form, "evidenceReference"),
          performedOn: value(form, "performedOn") || null,
        };
      }}
    >
      <div className="tag-row">
        <Badge tone={task.status === "done" ? "green" : "neutral"}>
          {labels.task[task.status]}
        </Badge>
        <Badge>
          {item.phase === "implementation" ? item.groupTitle : "Recorrência"}
        </Badge>
        {item.critical && <Badge tone="amber">Conferência crítica</Badge>}
      </div>
      {readonly && (
        <p className="inline-note">
          O plano está pausado, arquivado ou o projeto foi removido. Retome o
          plano para registrar alterações.
        </p>
      )}
      {closed && (
        <p className="inline-note">
          Uma reabertura exige motivo e devolve as entregas dependentes para
          validação.
        </p>
      )}
      {!!pending.length && (
        <details className={styles.scope}>
          <summary>
            {pending.length}{" "}
            {pending.length === 1
              ? "dependência pendente"
              : "dependências pendentes"}{" "}
            para validar
          </summary>
          <ul>
            {pending.map((i) => (
              <li key={i.id}>
                {initial.tasks.find((t) => t.id === i.id)?.title}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="form-grid">
        <Field label="Situação" wide>
          <select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {labels.task[s as typeof task.status]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prazo de acompanhamento">
          <input
            type="date"
            name="dueOn"
            required
            defaultValue={task.dueOn ?? item.originalDueOn}
          />
        </Field>
        <Field label={`Quantidade realizada de ${item.targetQuantity}`}>
          <input
            name="completedQuantity"
            type="number"
            min={0}
            max={item.targetQuantity}
            required
            defaultValue={item.completedQuantity}
          />
        </Field>
        <p className={`${styles.note} field-wide`}>
          Prazo original {fullDate(item.originalDueOn)}. A alteração exige
          justificativa e mantém o compromisso original no histórico.
        </p>
        <Field label="Próxima ação concreta" wide>
          <input
            name="nextAction"
            maxLength={1000}
            defaultValue={item.nextAction}
            required={["waiting_client", "blocked"].includes(status)}
            minLength={
              ["waiting_client", "blocked"].includes(status) ? 3 : undefined
            }
          />
        </Field>
        <Field label="Dependência ou informação que falta" wide>
          <textarea
            name="dependency"
            rows={2}
            maxLength={1000}
            defaultValue={item.dependency}
            required={["waiting_client", "blocked"].includes(status)}
            minLength={
              ["waiting_client", "blocked"].includes(status) ? 5 : undefined
            }
          />
        </Field>
      </div>
      <div className={styles.criteria}>
        <h3>Critérios de aceite</h3>
        {item.criteria.map((criterion) => (
          <label className="checkbox-field" key={criterion}>
            <input
              name="criteria"
              type="checkbox"
              value={criterion}
              defaultChecked={item.acceptedCriteria.includes(criterion)}
            />
            <span>{criterion}</span>
          </label>
        ))}
      </div>
      <div className="form-grid">
        <Field
          label="Nova evidência ou referência privada"
          wide
          hint="Link HTTPS ou localização identificável de um arquivo que você conferiu."
        >
          <textarea
            name="evidenceReference"
            rows={2}
            maxLength={2000}
            placeholder="Ex. link da publicação ou pasta/arquivo privado com o registro da conferência."
          />
        </Field>
        <Field label="Data real da execução">
          <input
            type="date"
            name="performedOn"
            max={today}
            defaultValue={today}
          />
        </Field>
        <Field
          label={
            closed ? "Motivo da reabertura" : "Justificativa ou observação"
          }
          wide
        >
          <textarea
            name="reason"
            rows={2}
            maxLength={2000}
            minLength={closed || status === "not_applicable" ? 5 : undefined}
            required={closed || status === "not_applicable"}
            placeholder={
              status === "not_applicable"
                ? "Explique por que esta entrega está fora do escopo ou não se aplica."
                : "Registre alterações de prazo, quantidade ou contexto."
            }
          />
        </Field>
      </div>
      {status === "review" && (
        <p className={styles.note}>
          Após conferir a entrega, abra novamente este registro e selecione
          Concluída para validar os critérios.
        </p>
      )}
      {!!evidence.length && (
        <details className={styles.scope}>
          <summary>
            {evidence.length}{" "}
            {evidence.length === 1
              ? "evidência registrada"
              : "evidências registradas"}
          </summary>
          {evidence.map((e) => (
            <div key={e.id}>
              <p>{e.reference}</p>
              <small>
                {fullDate(e.performedOn)} · {e.quantity} unidades
              </small>
            </div>
          ))}
        </details>
      )}
    </EditorFrame>
  );
}
function RecurrenceEditor({
  planId,
  onClose,
}: {
  planId: string;
  onClose: () => void;
}) {
  const { state } = useWorkspace();
  const [initial] = useState(state);
  const plan = initial.deliveryPlans.find((p) => p.id === planId);
  const [rules, setRules] = useState<RecurrenceRule[]>(() => [
    {
      key: newId(),
      title: "",
      targetQuantity: 1,
      criteria: [""],
      dueOffset: null,
    },
  ]);
  if (!plan) return null;
  const periods = contractPeriods(plan.startsOn, plan.endsOn);
  const update = (index: number, patch: Partial<RecurrenceRule>) =>
    setRules((list) =>
      list.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  return (
    <EditorFrame
      title="Programar recorrência contratual"
      subtitle={`${fullDate(plan.startsOn)} a ${fullDate(plan.endsOn)} · ${periods.length} competências`}
      onClose={onClose}
      label="Confirmar e gerar obrigações"
      onSubmit={() => ({
        type: "scheduleDeliveryRecurrence",
        planId,
        expectedVersion: plan.version,
        rules,
      })}
    >
      <div className={styles.scope}>
        <strong>
          {initial.contracts.find((c) => c.id === plan.contractId)?.title}
        </strong>
        <p>{plan.scopeReference}</p>
      </div>
      {rules.map((rule, index) => (
        <section className={styles.rule} key={rule.key}>
          <div className={styles.ruleHeading}>
            <h3>Obrigação por competência</h3>
            {rules.length > 1 && (
              <Button
                aria-label={`Remover obrigação ${index + 1}`}
                onClick={() =>
                  setRules((list) => list.filter((r) => r.key !== rule.key))
                }
              >
                <Trash2 size={16} />
              </Button>
            )}
          </div>
          <div className="form-grid">
            <Field label="O que foi contratado" wide>
              <input
                required
                minLength={3}
                maxLength={160}
                value={rule.title}
                onChange={(e) => update(index, { title: e.target.value })}
                placeholder="Ex. publicar conteúdos aprovados pelo cliente"
              />
            </Field>
            <Field label="Quantidade por competência">
              <input
                type="number"
                min={1}
                max={1000}
                required
                value={rule.targetQuantity}
                onChange={(e) =>
                  update(index, { targetQuantity: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Prazo dentro da competência">
              <select
                value={rule.dueOffset === null ? "end" : String(rule.dueOffset)}
                onChange={(e) =>
                  update(index, {
                    dueOffset:
                      e.target.value === "end" ? null : Number(e.target.value),
                  })
                }
              >
                <option value="end">Último dia da competência</option>
                {[0, 2, 6, 13, 20].map((n) => (
                  <option key={n} value={n}>
                    Até o {n + 1}º dia
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Critérios de aceite, um por linha" wide>
              <textarea
                required
                minLength={3}
                maxLength={5000}
                rows={3}
                value={rule.criteria.join("\n")}
                onChange={(e) =>
                  update(index, { criteria: e.target.value.split("\n") })
                }
              />
            </Field>
          </div>
        </section>
      ))}
      <Button
        disabled={rules.length >= 20}
        onClick={() =>
          setRules((list) => [
            ...list,
            {
              key: newId(),
              title: "",
              targetQuantity: 1,
              criteria: [""],
              dueOffset: null,
            },
          ])
        }
      >
        <Plus size={16} />
        Adicionar obrigação
      </Button>
      <p>
        {rules.length * periods.length} tarefas serão vinculadas ao calendário,
        com uma obrigação por regra e competência.
      </p>
      <label className="checkbox-field">
        <input type="checkbox" required />
        <span>
          Conferi essas atividades, quantidades, prazos e vigência no contrato.
        </span>
      </label>
    </EditorFrame>
  );
}
function PlanStatusEditor({
  planId,
  onClose,
}: {
  planId: string;
  onClose: () => void;
}) {
  const { state } = useWorkspace();
  const [plan] = useState(() =>
    state.deliveryPlans.find((p) => p.id === planId),
  );
  if (!plan) return null;
  return (
    <EditorFrame
      title="Gerenciar plano de entrega"
      onClose={onClose}
      onSubmit={(form) => ({
        type: "setDeliveryPlanStatus",
        id: planId,
        expectedVersion: plan.version,
        status: value(form, "status") as typeof plan.status,
        reason: value(form, "reason"),
      })}
    >
      <Field label="Situação do plano">
        <select name="status" defaultValue={plan.status}>
          <option value="active">Ativo</option>
          <option value="paused">Pausado</option>
          <option value="archived">Arquivado</option>
        </select>
      </Field>
      <p>
        Planos pausados e arquivados saem da fila diária. Suas entregas,
        evidências e prazos podem ser consultados na ficha.
      </p>
      <Field label="Motivo">
        <textarea
          name="reason"
          required
          minLength={5}
          maxLength={2000}
          rows={3}
        />
      </Field>
    </EditorFrame>
  );
}
export default function DeliveryEditor({
  modal,
  onClose,
}: {
  modal: EditorModal;
  onClose: () => void;
}) {
  if (modal.kind === "deliveryPlan")
    return <PlanEditor projectId={modal.projectId} onClose={onClose} />;
  if (modal.kind === "deliveryTask")
    return <TaskEditor id={modal.id} onClose={onClose} />;
  if (modal.kind === "deliveryRecurrence")
    return <RecurrenceEditor planId={modal.planId} onClose={onClose} />;
  return <PlanStatusEditor planId={modal.planId} onClose={onClose} />;
}
