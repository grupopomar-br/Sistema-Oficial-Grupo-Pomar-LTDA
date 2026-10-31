"use client";

import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import { Check, Loader2, ArrowRight } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button, Field, Modal, Badge } from "./ui";
import type { ModalState } from "./types";
import {
  newBase,
  labels,
  type Client,
  type Project,
  type Task,
  type Expense,
  type Opportunity,
  type Command,
} from "@/lib/domain/model";
import { todayDate, money, fullDate } from "@/lib/domain/dates";
import { parseBRL } from "@/lib/domain/finance";
import { installmentRemaining } from "@/lib/domain/workspace";

const value = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
const nullable = (form: FormData, key: string) => value(form, key) || null;
const decimal = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export default function EntityModal({
  modal,
  onClose,
}: {
  modal: Exclude<
    ModalState,
    { kind: "projectDetail" | "clientDetail" | "search" | "import" | "idea" }
  >;
  onClose: () => void;
}) {
  const { state, execute, saving, operationError, clearOperationError } =
    useWorkspace();
  useEffect(() => {
    clearOperationError();
  }, [clearOperationError]);
  const [initialState] = useState(state);
  const [base] = useState(() => newBase());
  const [error, setError] = useState("");
  const today = todayDate();
  const submit =
    (create: (data: FormData) => Command) =>
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError("");
      try {
        if (await execute(create(new FormData(event.currentTarget)), base.id))
          onClose();
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Revise os campos informados.",
        );
      }
    };
  const footer = (label = "Salvar") => (
    <div className="form-footer">
      {(error || operationError) && (
        <p className="form-error" role="alert">
          {error || operationError}
        </p>
      )}
      <Button onClick={onClose}>Cancelar</Button>
      <Button variant="primary" type="submit" disabled={saving}>
        {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}{" "}
        {label}
      </Button>
    </div>
  );
  const selectClients = (
    name: string,
    selected: string | null,
    optional = true,
  ) => (
    <select name={name} defaultValue={selected ?? ""} required={!optional}>
      <option value="">
        {optional ? "Sem vínculo externo" : "Selecione um cliente"}
      </option>
      {state.clients
        .filter((item) => item.status !== "archived" || item.id === selected)
        .map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
    </select>
  );
  const selectProjects = (selected: string | null) => (
    <select name="projectId" defaultValue={selected ?? ""}>
      <option value="">Sem projeto específico</option>
      {state.projects.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
  const priority = (selected = "P2") => (
    <select name="priority" defaultValue={selected}>
      <option value="P0">P0 · Incidente crítico</option>
      <option value="P1">P1 · Alta prioridade</option>
      <option value="P2">P2 · Prioridade normal</option>
      <option value="P3">P3 · Evolução futura</option>
    </select>
  );
  const content = (title: string, children: ReactNode, subtitle?: string) => (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      {children}
    </Modal>
  );

  if (modal.kind === "client") {
    const initial: Client = initialState.clients.find(
      (item) => item.id === modal.id,
    ) ?? {
      ...base,
      name: "",
      kind: "business",
      city: "",
      segment: "",
      contactName: "",
      email: "",
      phone: "",
      website: "",
      notes: "",
      status: "active",
    };
    return content(
      modal.id ? "Editar cliente" : "Novo cliente",
      <form
        onSubmit={submit((form) => ({
          type: "saveClient",
          value: {
            ...initial,
            name: value(form, "name"),
            kind: value(form, "kind") as Client["kind"],
            status: value(form, "status") as Client["status"],
            city: value(form, "city"),
            segment: value(form, "segment"),
            contactName: value(form, "contactName"),
            email: value(form, "email"),
            phone: value(form, "phone"),
            website: value(form, "website"),
            notes: value(form, "notes"),
          },
        }))}
      >
        <div className="form-grid">
          <Field label="Nome da empresa ou pessoa" wide>
            <input
              name="name"
              defaultValue={initial.name}
              required
              minLength={2}
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Tipo">
            <select name="kind" defaultValue={initial.kind}>
              <option value="business">Empresa</option>
              <option value="person">Pessoa física</option>
            </select>
          </Field>
          <Field label="Relacionamento">
            <select name="status" defaultValue={initial.status}>
              {Object.entries(labels.client).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cidade / UF">
            <input name="city" defaultValue={initial.city} maxLength={100} />
          </Field>
          <Field label="Segmento">
            <input
              name="segment"
              defaultValue={initial.segment}
              maxLength={100}
            />
          </Field>
          <Field label="Pessoa de contato">
            <input
              name="contactName"
              defaultValue={initial.contactName}
              maxLength={100}
            />
          </Field>
          <Field label="Telefone">
            <input
              name="phone"
              type="tel"
              defaultValue={initial.phone}
              maxLength={40}
            />
          </Field>
          <Field label="E-mail">
            <input name="email" type="email" defaultValue={initial.email} />
          </Field>
          <Field label="Site">
            <input
              name="website"
              type="url"
              defaultValue={initial.website}
              placeholder="https://"
            />
          </Field>
          <Field label="Contexto e observações" wide>
            <textarea
              name="notes"
              defaultValue={initial.notes}
              rows={3}
              maxLength={5000}
            />
          </Field>
        </div>
        {footer()}
      </form>,
      "Um cadastro único para conectar relacionamento, projetos e contratos.",
    );
  }
  if (modal.kind === "project") {
    const initial: Project = initialState.projects.find(
      (item) => item.id === modal.id,
    ) ?? {
      ...base,
      name: "",
      clientId: null,
      contractorId: null,
      areaId: state.areas.find((item) => !item.archived)?.id ?? "",
      status: "planning",
      priority: "P2",
      startedOn: today,
      dueOn: null,
      nextAction: "",
      nextActionOn: null,
      waitingFor: "",
      notes: "",
    };
    return content(
      modal.id ? "Editar projeto" : "Novo projeto",
      <form
        onSubmit={submit((form) => ({
          type: "saveProject",
          value: {
            ...initial,
            name: value(form, "name"),
            clientId: nullable(form, "clientId"),
            contractorId: nullable(form, "contractorId"),
            areaId: value(form, "areaId"),
            status: value(form, "status") as Project["status"],
            priority: value(form, "priority") as Project["priority"],
            startedOn: nullable(form, "startedOn"),
            dueOn: nullable(form, "dueOn"),
            nextAction: value(form, "nextAction"),
            nextActionOn: nullable(form, "nextActionOn"),
            waitingFor: value(form, "waitingFor"),
            notes: value(form, "notes"),
          },
        }))}
      >
        <div className="form-grid">
          <Field label="Nome do projeto" wide>
            <input
              name="name"
              defaultValue={initial.name}
              required
              minLength={2}
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Cliente final">
            {selectClients("clientId", initial.clientId)}
          </Field>
          <Field label="Contratante, se diferente">
            {selectClients("contractorId", initial.contractorId)}
          </Field>
          <Field label="Área da operação">
            <select name="areaId" defaultValue={initial.areaId} required>
              {state.areas
                .filter((item) => !item.archived || item.id === initial.areaId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Prioridade">{priority(initial.priority)}</Field>
          <Field label="Estado">
            <select name="status" defaultValue={initial.status}>
              {Object.entries(labels.project).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Início">
            <input
              name="startedOn"
              type="date"
              defaultValue={initial.startedOn ?? ""}
            />
          </Field>
          <Field label="Entrega prevista">
            <input
              name="dueOn"
              type="date"
              defaultValue={initial.dueOn ?? ""}
            />
          </Field>
          <Field label="Data da próxima ação">
            <input
              name="nextActionOn"
              type="date"
              defaultValue={initial.nextActionOn ?? ""}
            />
          </Field>
          <Field label="Próxima ação concreta" wide>
            <textarea
              name="nextAction"
              defaultValue={initial.nextAction}
              rows={2}
              maxLength={1000}
              placeholder="O próximo passo que destrava este projeto"
            />
          </Field>
          <Field label="Aguardando quem ou o quê?" wide>
            <input
              name="waitingFor"
              defaultValue={initial.waitingFor}
              maxLength={500}
            />
          </Field>
          <Field label="Escopo e contexto" wide>
            <textarea
              name="notes"
              defaultValue={initial.notes}
              rows={3}
              maxLength={10000}
            />
          </Field>
        </div>
        {footer()}
      </form>,
    );
  }
  if (modal.kind === "task") {
    const initial: Task = initialState.tasks.find(
      (item) => item.id === modal.id,
    ) ?? {
      ...base,
      title: "",
      projectId: modal.projectId ?? null,
      priority: "P2",
      status: "pending",
      dueOn: today,
      focusOn: null,
      description: "",
      completedAt: null,
    };
    return content(
      modal.id ? "Editar tarefa" : "Nova tarefa",
      <form
        onSubmit={submit((form) => ({
          type: "saveTask",
          value: {
            ...initial,
            title: value(form, "title"),
            projectId: nullable(form, "projectId"),
            priority: value(form, "priority") as Task["priority"],
            status: value(form, "status") as Task["status"],
            dueOn: nullable(form, "dueOn"),
            focusOn: nullable(form, "focusOn"),
            description: value(form, "description"),
          },
        }))}
      >
        <div className="form-grid">
          <Field label="O que precisa ser feito?" wide>
            <input
              name="title"
              defaultValue={initial.title}
              required
              minLength={2}
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Projeto" wide>
            {selectProjects(initial.projectId)}
          </Field>
          <Field label="Prioridade">{priority(initial.priority)}</Field>
          <Field label="Estado">
            <select name="status" defaultValue={initial.status}>
              {Object.entries(labels.task).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prazo">
            <input
              name="dueOn"
              type="date"
              defaultValue={initial.dueOn ?? ""}
            />
          </Field>
          <Field label="Reservar no foco do dia">
            <input
              name="focusOn"
              type="date"
              defaultValue={initial.focusOn ?? ""}
            />
          </Field>
          <Field label="Detalhes da execução" wide>
            <textarea
              name="description"
              defaultValue={initial.description}
              rows={4}
              maxLength={5000}
            />
          </Field>
        </div>
        {footer()}
      </form>,
    );
  }
  if (modal.kind === "contract") {
    const project = initialState.projects.find(
      (item) => item.id === modal.projectId,
    );
    return content(
      "Registrar contrato",
      <form
        onSubmit={submit((form) => ({
          type: "createContract",
          value: {
            ...base,
            title: value(form, "title"),
            clientId: value(form, "clientId"),
            projectId: nullable(form, "projectId"),
            totalCents: parseBRL(value(form, "total")),
            signedOn: value(form, "signedOn"),
            status: "active",
            notes: value(form, "notes"),
          },
          count: Number(value(form, "count")),
          firstDueOn: value(form, "firstDueOn"),
        }))}
      >
        <div className="form-grid">
          <Field label="Descrição do contrato" wide>
            <input
              name="title"
              defaultValue={project?.name ?? ""}
              required
              minLength={2}
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Contratante">
            {selectClients(
              "clientId",
              project?.contractorId ?? project?.clientId ?? null,
              false,
            )}
          </Field>
          <Field label="Projeto">{selectProjects(project?.id ?? null)}</Field>
          <Field label="Valor total (R$)">
            <input
              name="total"
              inputMode="decimal"
              placeholder="0,00"
              required
            />
          </Field>
          <Field label="Data do fechamento">
            <input name="signedOn" type="date" defaultValue={today} required />
          </Field>
          <Field label="Número de parcelas">
            <input
              name="count"
              type="number"
              defaultValue={1}
              min={1}
              max={120}
              required
            />
          </Field>
          <Field label="Primeiro vencimento">
            <input
              name="firstDueOn"
              type="date"
              defaultValue={today}
              required
            />
          </Field>
          <Field label="Escopo financeiro e condições" wide>
            <textarea name="notes" rows={3} maxLength={5000} />
          </Field>
        </div>
        <div className="inline-note">
          Registrar o contrato cria o compromisso e as parcelas. Os recebimentos
          serão informados quando o dinheiro entrar.
        </div>
        {footer("Registrar contrato")}
      </form>,
    );
  }
  if (modal.kind === "receipt") {
    const installment = state.installments.find(
      (item) => item.id === modal.installmentId,
    );
    if (!installment)
      return content(
        "Parcela indisponível",
        <p>Atualize os dados e tente novamente.</p>,
      );
    const remaining = installmentRemaining(state, installment.id);
    const contract = state.contracts.find(
      (item) => item.id === installment.contractId,
    );
    return content(
      "Registrar recebimento",
      <form
        onSubmit={submit((form) => ({
          type: "postReceipt",
          installmentId: installment.id,
          amountCents: parseBRL(value(form, "amount")),
          receivedOn: form.has("undated") ? null : value(form, "receivedOn"),
        }))}
      >
        {state.charges.some(
          (charge) =>
            charge.installmentId === installment.id &&
            charge.mode === "live" &&
            ["creating", "ready", "creation_unknown"].includes(charge.status) &&
            new Date(charge.expiresAt).valueOf() > Date.now(),
        ) && (
          <div className="inline-note inline-note-warning">
            Existe um checkout em andamento para esta parcela. Se o pagamento
            foi pelo provedor, confira a conciliação antes de registrar outra
            entrada manual.
          </div>
        )}
        <div className="payment-summary">
          <span>
            {contract?.title} · parcela {installment.sequence}
          </span>
          <strong>{money(remaining)}</strong>
          <small>
            Saldo da parcela · vencimento {fullDate(installment.dueOn)}
          </small>
        </div>
        <div className="form-grid">
          <Field label="Valor que efetivamente entrou (R$)">
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={decimal(remaining)}
              required
              autoFocus
            />
          </Field>
          <Field label="Data real do recebimento">
            <input
              name="receivedOn"
              type="date"
              max={today}
              defaultValue={today}
            />
          </Field>
          <label className="checkbox-field field-wide">
            <input name="undated" type="checkbox" />
            <span>
              Recebimento antigo cuja data ainda precisa ser confirmada
            </span>
          </label>
        </div>
        <p className="helper-text">
          Um recebimento sem data permanece fora do caixa mensal até ser
          conciliado.
        </p>
        {footer("Confirmar recebimento")}
      </form>,
    );
  }
  if (modal.kind === "expense") {
    const initial: Expense = initialState.expenses.find(
      (item) => item.id === modal.id,
    ) ?? {
      ...base,
      title: "",
      category: "infrastructure",
      projectId: null,
      amountCents: 0,
      dueOn: today,
      paidOn: null,
      status: "pending",
      notes: "",
    };
    return content(
      modal.id ? "Editar despesa" : "Nova despesa",
      <form
        onSubmit={submit((form) => ({
          type: "saveExpense",
          value: {
            ...initial,
            title: value(form, "title"),
            category: value(form, "category") as Expense["category"],
            projectId: nullable(form, "projectId"),
            amountCents: parseBRL(value(form, "amount")),
            dueOn: nullable(form, "dueOn"),
            paidOn: nullable(form, "paidOn"),
            status: value(form, "status") as Expense["status"],
            notes: value(form, "notes"),
          },
        }))}
      >
        <div className="form-grid">
          <Field label="Descrição" wide>
            <input
              name="title"
              defaultValue={initial.title}
              required
              minLength={2}
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Valor (R$)">
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={
                initial.amountCents ? decimal(initial.amountCents) : ""
              }
              required
            />
          </Field>
          <Field label="Categoria">
            <select name="category" defaultValue={initial.category}>
              {Object.entries(labels.category).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Projeto" wide>
            {selectProjects(initial.projectId)}
          </Field>
          <Field label="Vencimento">
            <input
              name="dueOn"
              type="date"
              defaultValue={initial.dueOn ?? ""}
            />
          </Field>
          <Field label="Estado">
            <select name="status" defaultValue={initial.status}>
              {Object.entries(labels.expense).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data do pagamento" wide>
            <input
              name="paidOn"
              type="date"
              defaultValue={initial.paidOn ?? ""}
            />
          </Field>
          <Field label="Observações" wide>
            <textarea
              name="notes"
              defaultValue={initial.notes}
              rows={3}
              maxLength={5000}
            />
          </Field>
        </div>
        {footer()}
      </form>,
    );
  }
  if (modal.kind === "opportunity") {
    const initial: Opportunity = initialState.opportunities.find(
      (item) => item.id === modal.id,
    ) ?? {
      ...base,
      title: "",
      clientId: "",
      stage: "identified",
      valueCents: 0,
      nextAction: "",
      nextContactOn: today,
      notes: "",
      lostReason: "",
      projectId: null,
    };
    return content(
      modal.id ? "Editar oportunidade" : "Nova oportunidade",
      <form
        onSubmit={submit((form) => ({
          type: "saveOpportunity",
          value: {
            ...initial,
            title: value(form, "title"),
            clientId: value(form, "clientId"),
            stage: value(form, "stage") as Opportunity["stage"],
            valueCents: value(form, "amount")
              ? parseBRL(value(form, "amount"))
              : 0,
            nextAction: value(form, "nextAction"),
            nextContactOn: nullable(form, "nextContactOn"),
            notes: value(form, "notes"),
            lostReason: value(form, "lostReason"),
          },
        }))}
      >
        <div className="form-grid">
          <Field label="Oportunidade" wide>
            <input
              name="title"
              defaultValue={initial.title}
              required
              minLength={2}
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Empresa / cliente">
            {selectClients("clientId", initial.clientId || null, false)}
          </Field>
          <Field label="Etapa">
            <select name="stage" defaultValue={initial.stage}>
              {Object.entries(labels.stage).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor estimado (R$)">
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={
                initial.valueCents ? decimal(initial.valueCents) : ""
              }
            />
          </Field>
          <Field label="Próximo contato">
            <input
              name="nextContactOn"
              type="date"
              defaultValue={initial.nextContactOn ?? ""}
            />
          </Field>
          <Field label="Próxima ação" wide>
            <textarea
              name="nextAction"
              defaultValue={initial.nextAction}
              rows={2}
              maxLength={1000}
            />
          </Field>
          <Field label="Motivo, se perdida" wide>
            <input
              name="lostReason"
              defaultValue={initial.lostReason}
              maxLength={1000}
            />
          </Field>
          <Field label="Contexto da conversa" wide>
            <textarea
              name="notes"
              defaultValue={initial.notes}
              rows={3}
              maxLength={5000}
            />
          </Field>
        </div>
        {footer()}
      </form>,
    );
  }
  if (modal.kind === "note")
    return content(
      "Registrar atualização",
      <form
        onSubmit={submit((form) => ({
          type: "addUpdate",
          projectId: modal.projectId,
          message: value(form, "message"),
        }))}
      >
        <Field label="Decisão, entrega ou próximo passo">
          <textarea
            name="message"
            rows={6}
            required
            minLength={3}
            maxLength={5000}
            autoFocus
            placeholder="O que mudou? O que foi validado? O que fica pendente?"
          />
        </Field>
        {footer("Registrar atualização")}
      </form>,
    );
  if (modal.kind === "dateReceipt")
    return content(
      "Conciliar data de recebimento",
      <form
        onSubmit={submit((form) => ({
          type: "dateReceipt",
          id: modal.id,
          receivedOn: value(form, "receivedOn"),
        }))}
      >
        <p className="helper-text">
          O mesmo recebimento será atualizado. O total histórico não será somado
          novamente.
        </p>
        <Field label="Data real em que o dinheiro entrou">
          <input
            name="receivedOn"
            type="date"
            max={today}
            defaultValue={today}
            required
            autoFocus
          />
        </Field>
        {footer("Confirmar data")}
      </form>,
    );
  if (modal.kind === "voidReceipt" || modal.kind === "cancelContract")
    return content(
      modal.kind === "voidReceipt"
        ? "Estornar recebimento"
        : "Cancelar contrato",
      <form
        onSubmit={submit((form) =>
          modal.kind === "voidReceipt"
            ? {
                type: "voidReceipt",
                id: modal.id,
                reason: value(form, "reason"),
              }
            : {
                type: "cancelContract",
                id: modal.id,
                reason: value(form, "reason"),
              },
        )}
      >
        <div className="inline-note inline-note-warning">
          {modal.kind === "voidReceipt"
            ? "O recebimento será preservado como estornado e a parcela voltará a apresentar seu saldo."
            : "Os recebimentos existentes serão preservados. As parcelas deixarão de compor o saldo a receber."}
        </div>
        <Field label="Motivo da correção">
          <textarea
            name="reason"
            rows={4}
            required
            minLength={5}
            maxLength={1000}
            autoFocus
          />
        </Field>
        {footer("Confirmar correção")}
      </form>,
    );
  if (modal.kind === "convert") {
    const opportunity = initialState.opportunities.find(
      (item) => item.id === modal.id,
    );
    return content(
      "Converter oportunidade em projeto",
      <form
        onSubmit={submit((form) => ({
          type: "convertOpportunity",
          id: modal.id,
          projectId: base.id,
          areaId: value(form, "areaId"),
          dueOn: nullable(form, "dueOn"),
        }))}
      >
        <div className="inline-note">
          {opportunity?.title}
          <br />O cliente será reaproveitado. O contrato e os pagamentos serão
          registrados separadamente.
        </div>
        <div className="form-grid">
          <Field label="Área da operação">
            <select name="areaId" required>
              {state.areas
                .filter((item) => !item.archived)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Entrega prevista">
            <input name="dueOn" type="date" />
          </Field>
        </div>
        {footer("Criar projeto")}
      </form>,
    );
  }
  return null;
}
