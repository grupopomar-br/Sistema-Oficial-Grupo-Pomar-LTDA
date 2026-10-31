"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  CreditCard,
  FileCheck,
  MessageSquare,
  Plus,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Pagination,
  SearchInput,
  StatCard,
} from "../ui";
import type { ViewProps } from "../types";
import {
  collectionSummary,
  contractGate,
  reminderDraft,
} from "@/lib/domain/collections";
import { newBase } from "@/lib/domain/model";
import { parseWorkspace } from "@/lib/domain/workspace";
import { money, fullDate } from "@/lib/domain/dates";
import { parseBRL } from "@/lib/domain/finance";
import type { CollectionAgreement } from "@/lib/domain/extensions";
type Row = ReturnType<typeof collectionSummary>["rows"][number];
type Dialog = { kind: "terms" | "contact" | "message" | "link"; row: Row };
export default function Collections(props: ViewProps) {
  const { state, mode, reload } = useWorkspace();
  const [query, setQuery] = useState(""),
    [age, setAge] = useState("all"),
    [page, setPage] = useState(1),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [reconciling, setReconciling] = useState<string | null>(null),
    [reconcileError, setReconcileError] = useState(""),
    [integration, setIntegration] = useState({
      enabled: false,
      mode: null as "test" | "live" | null,
    });
  useEffect(() => {
    if (mode !== "cloud") return;
    const controller = new AbortController();
    void fetch("/api/billing/status", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) setIntegration(await response.json());
      })
      .catch(() => {});
    return () => controller.abort();
  }, [mode]);
  const summary = useMemo(
    () => collectionSummary(state, props.today),
    [state, props.today],
  );
  const format = (v: number) => (props.hiddenValues ? "••••" : money(v));
  const rows = summary.rows.filter(
    (row) =>
      (age === "all" ||
        (age === "overdue" && row.late) ||
        age === row.bucket) &&
      `${row.client?.name ?? ""} ${row.contract.title}`
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR")),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 10)));
  const reconcile = async (paymentId: string) => {
    setReconciling(paymentId);
    setReconcileError("");
    try {
      const response = await fetch("/api/billing/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Não foi possível conferir.");
      await reload();
    } catch (error) {
      setReconcileError(
        error instanceof Error ? error.message : "Falha na consulta.",
      );
    } finally {
      setReconciling(null);
    }
  };
  const reviews = state.providerPayments.filter(
    (p) => p.mode === "live" && p.reviewReason,
  );
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <span className="eyebrow">DISCIPLINA DE RECEBIMENTO</span>
          <h2>Condições claras. Cobrança consistente.</h2>
          <p>Valor, vencimento e próximo contato no mesmo lugar.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => props.open({ kind: "contract" })}
          disabled={!state.clients.length}
        >
          <Plus size={16} />
          Novo contrato
        </Button>
      </div>
      <div className="stats-grid">
        <StatCard
          title="Saldo vencido"
          value={format(summary.overdue)}
          detail="Parcelas abertas após o vencimento"
          icon={Clock}
          accent
        />
        <StatCard
          title="Saldo total a receber"
          value={format(summary.total)}
          detail="Inclui os próximos vencimentos"
          icon={Wallet}
        />
        <StatCard
          title="Promessas vencidas"
          value={summary.brokenPromises}
          detail="Contatos para retomar hoje"
          icon={MessageSquare}
        />
        <StatCard
          title="Pagamentos em revisão"
          value={reviews.length}
          detail={
            reviews.length
              ? `${format(summary.review)} para conferir`
              : "Sem divergências registradas"
          }
          icon={ShieldCheck}
        />
      </div>
      <section className="integration-strip">
        <span className="list-icon">
          <CreditCard size={21} />
        </span>
        <div>
          <strong>Checkout oficial · Mercado Pago</strong>
          <p>
            {integration.enabled
              ? integration.mode === "test"
                ? "Ambiente de teste ativo. Estes links não representam cobrança de produção."
                : "Integração habilitada. Cada link é conferido no servidor e confirmado pelo provedor."
              : mode === "local"
                ? "Gestão de cobrança disponível neste navegador. O checkout será habilitado na conexão segura da nuvem."
                : "Integração ainda não ativada. A gestão de vencimentos e acompanhamentos continua disponível."}
          </p>
        </div>
        <Badge tone={integration.enabled ? "green" : "amber"}>
          {integration.enabled
            ? integration.mode === "test"
              ? "Teste"
              : "Ativo"
            : "Configuração pendente"}
        </Badge>
      </section>
      {reviews.length > 0 && (
        <section className="panel collection-review">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">CONCILIAÇÃO</span>
              <h2>Confira antes de considerar resolvido.</h2>
            </div>
            <Button onClick={() => void reload()}>Atualizar</Button>
          </div>
          {reviews.slice(0, 8).map((payment) => (
            <div className="review-row" key={payment.id}>
              <div>
                <strong>Pagamento #{payment.providerPaymentId}</strong>
                <p>{payment.reviewReason}</p>
                <small>
                  {payment.mode === "test" ? "Teste · " : ""}
                  {fullDate(payment.paidOn)}
                </small>
              </div>
              <div className="review-amount">
                <strong>{format(payment.amountCents)}</strong>
                <Button
                  disabled={!!reconciling}
                  onClick={() => void reconcile(payment.providerPaymentId)}
                >
                  {reconciling === payment.providerPaymentId
                    ? "Conferindo..."
                    : "Conferir agora"}
                </Button>
              </div>
            </div>
          ))}
          {reconcileError && (
            <p className="form-error" role="alert">
              {reconcileError}{" "}
              <a href="/seguranca?next=/central">Confirmar autenticador</a>
            </p>
          )}
          <p className="helper-text">
            Divergências não geram baixa duplicada. Confira a movimentação no
            provedor e o histórico financeiro antes de corrigir.
          </p>
        </section>
      )}
      <div className="filters-bar">
        <SearchInput
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          placeholder="Buscar cliente ou contrato"
        />
        <select
          aria-label="Faixa de atraso"
          value={age}
          onChange={(e) => {
            setAge(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Todos os vencimentos</option>
          <option value="overdue">Somente vencidos</option>
          <option value="current">No prazo</option>
          <option value="1_7">1 a 7 dias</option>
          <option value="8_15">8 a 15 dias</option>
          <option value="16_30">16 a 30 dias</option>
          <option value="31_plus">Mais de 30 dias</option>
        </select>
        <span className="result-count">{rows.length} parcelas</span>
      </div>
      {rows.length ? (
        <div className="collection-list">
          {rows.slice((current - 1) * 10, current * 10).map((row) => {
            const gate = contractGate(state, row.contract.id);
            const link = row.latestCharge;
            const validLink =
              link?.status === "ready" &&
              new Date(link.expiresAt).valueOf() > Date.now() &&
              link.amountCents === row.remaining &&
              !state.providerPayments.some(
                (p) => p.chargeId === link.id && p.receiptId,
              );
            return (
              <article
                className={`panel collection-card ${row.late ? "collection-late" : ""}`}
                key={row.part.id}
              >
                <div className="collection-card-main">
                  <div className="collection-card-title">
                    <div>
                      <span className="eyebrow">
                        {row.client?.name ?? "Cliente do contrato"}
                      </span>
                      <h3>{row.contract.title}</h3>
                      <p>
                        Parcela {row.part.sequence} · vencimento{" "}
                        {fullDate(row.part.dueOn)}
                      </p>
                    </div>
                    <div className="collection-amount">
                      <strong>{format(row.remaining)}</strong>
                      <Badge tone={row.late ? "danger" : "green"}>
                        {row.late
                          ? `${row.age} ${row.age === 1 ? "dia" : "dias"} de atraso`
                          : "No prazo"}
                      </Badge>
                    </div>
                  </div>
                  <div className="collection-context">
                    <span>
                      <FileCheck size={15} />
                      {gate.label}
                    </span>
                    {row.promise?.promiseOn && (
                      <span
                        className={
                          row.promise.promiseOn < props.today
                            ? "text-danger"
                            : ""
                        }
                      >
                        <MessageSquare size={15} />
                        Previsão informada: {fullDate(row.promise.promiseOn)}
                      </span>
                    )}
                    {link && (
                      <span>
                        <CreditCard size={15} />
                        {validLink
                          ? `Link válido até ${fullDate(link.expiresAt)}`
                          : link.status === "creation_unknown"
                            ? "Criação do link precisa de conferência"
                            : link.status === "creating"
                              ? "Criação de link em andamento"
                              : link.status === "failed"
                                ? "Última criação não concluída"
                                : "Link anterior sem validade para este saldo"}
                      </span>
                    )}
                  </div>
                  {row.actions[0] && (
                    <p className="last-contact">
                      Último registro: {row.actions[0].note}
                    </p>
                  )}
                </div>
                <div className="collection-card-actions">
                  <Button onClick={() => setDialog({ kind: "message", row })}>
                    <Copy size={15} />
                    Preparar mensagem
                  </Button>
                  <Button onClick={() => setDialog({ kind: "contact", row })}>
                    <MessageSquare size={15} />
                    Registrar contato
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDialog({ kind: "terms", row })}
                  >
                    Condições
                    <ArrowUpRight size={14} />
                  </Button>
                  {validLink ? (
                    <a
                      href={link.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="button button-primary"
                    >
                      {link.mode === "test"
                        ? "Testar checkout"
                        : "Abrir checkout"}
                      <ArrowUpRight size={15} />
                    </a>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => setDialog({ kind: "link", row })}
                      disabled={!integration.enabled}
                    >
                      <CreditCard size={15} />
                      Gerar link
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon={FileCheck}
            title="Nenhuma parcela aberta neste filtro."
            description="Cadastre contratos e vencimentos para acompanhar entrada, entrega e recebimento com clareza."
            action="Ver financeiro"
            onAction={() => props.navigate("finance")}
          />
        </div>
      )}
      <Pagination
        page={current}
        total={rows.length}
        size={10}
        onChange={setPage}
      />
      {dialog && (
        <CollectionDialog
          dialog={dialog}
          today={props.today}
          onClose={() => setDialog(null)}
          onUpdated={() => void reload()}
        />
      )}
    </div>
  );
}
function CollectionDialog({
  dialog,
  today,
  onClose,
  onUpdated,
}: {
  dialog: Dialog;
  today: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { state, execute, saving, operationError, clearOperationError } =
    useWorkspace();
  const [base] = useState(() => newBase());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mfa, setMfa] = useState(false),
    [copied, setCopied] = useState(false);
  const [initial] = useState<CollectionAgreement>(
    () =>
      state.collectionAgreements.find(
        (a) => a.contractId === dialog.row.contract.id,
      ) ?? {
        ...newBase(),
        contractId: dialog.row.contract.id,
        initialCents: dialog.row.part.amountCents,
        gate: "initial",
        graceDays: 0,
        acceptedOn: null,
        termsReference: "",
        notes: "",
      },
  );
  useEffect(() => {
    clearOperationError();
  }, [clearOperationError]);
  const message = reminderDraft(dialog.row, state.settings.businessName, today);
  const footer = (label: string) => (
    <div className="form-footer">
      {(error || operationError) && (
        <p className="form-error" role="alert">
          {error || operationError}
        </p>
      )}
      {mfa && (
        <a className="button button-secondary" href="/seguranca?next=/central">
          Confirmar autenticador
        </a>
      )}
      <Button onClick={onClose}>Fechar</Button>
      <Button variant="primary" type="submit" disabled={saving || busy}>
        <Check size={16} />
        {busy ? "Conferindo..." : label}
      </Button>
    </div>
  );
  if (dialog.kind === "message")
    return (
      <Modal
        title="Preparar mensagem de cobrança"
        subtitle="Confira os dados e envie pelo canal combinado com o cliente."
        onClose={onClose}
      >
        <Field label="Rascunho editável">
          <textarea id="collection-message" rows={10} defaultValue={message} />
        </Field>
        <p className="helper-text">
          O sistema não envia esta mensagem nem registra contato
          automaticamente. Não inclua urgência ou condições que não foram
          combinadas.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="form-footer">
          <Button onClick={onClose}>Fechar</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const field = document.getElementById(
                "collection-message",
              ) as HTMLTextAreaElement | null;
              try {
                await navigator.clipboard.writeText(field?.value ?? message);
                setCopied(true);
              } catch {
                setError(
                  "Selecione o texto acima e copie pelo seu dispositivo.",
                );
              }
            }}
          >
            <Copy size={16} />
            {copied ? "Copiado" : "Copiar mensagem"}
          </Button>
        </div>
      </Modal>
    );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMfa(false);
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    try {
      if (dialog.kind === "terms") {
        if (
          await execute(
            {
              type: "saveCollectionAgreement",
              value: {
                ...initial,
                initialCents: parseBRL(text("initial")),
                gate: text("gate") as CollectionAgreement["gate"],
                graceDays: Number(text("grace")),
                acceptedOn: text("accepted") || null,
                termsReference: text("reference"),
                notes: text("notes"),
              },
            },
            base.id,
          )
        )
          onClose();
      } else if (dialog.kind === "contact") {
        if (
          await execute(
            {
              type: "addCollectionAction",
              value: {
                ...base,
                installmentId: dialog.row.part.id,
                kind: text("kind") as
                  "contact" | "reminder" | "promise" | "dispute",
                channel: text("channel") as
                  "manual" | "email" | "whatsapp" | "phone",
                note: text("note"),
                promiseOn: text("promise") || null,
              },
            },
            base.id,
          )
        )
          onClose();
      } else {
        setBusy(true);
        const response = await fetch("/api/billing/charges", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commandId: base.id,
            installmentId: dialog.row.part.id,
            expiresHours: Number(text("hours")),
          }),
        });
        const data = await response.json();
        if (response.status === 401)
          window.location.replace("/entrar?motivo=sessao");
        if (!response.ok) {
          setMfa(
            data.code === "MFA_REQUIRED" ||
              String(data.error).includes("autenticador"),
          );
          throw new Error(data.error ?? "Não foi possível gerar o link.");
        }
        parseWorkspace(data.workspace);
        onUpdated();
        onClose();
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Confira os dados.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        dialog.kind === "terms"
          ? "Condições de pagamento e entrega"
          : dialog.kind === "contact"
            ? "Registrar acompanhamento"
            : "Gerar checkout oficial"
      }
      subtitle={`${dialog.row.contract.title} · ${dialog.row.client?.name ?? "Cliente"}`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {dialog.kind === "terms" ? (
          <>
            <div className="inline-note">
              Registre condições reais do contrato. Sem data e referência de
              aceite, o sistema apresenta a condição como proposta.
            </div>
            <div className="form-grid">
              <Field label="Entrada combinada (R$)">
                <input
                  name="initial"
                  inputMode="decimal"
                  defaultValue={(initial.initialCents / 100)
                    .toFixed(2)
                    .replace(".", ",")}
                  required
                />
              </Field>
              <Field label="Condição operacional">
                <select name="gate" defaultValue={initial.gate}>
                  <option value="none">Somente acompanhar</option>
                  <option value="initial">Entrada antes do início</option>
                  <option value="full">Quitação antes da entrega final</option>
                </select>
              </Field>
              <Field label="Dias de tolerância combinados">
                <input
                  name="grace"
                  type="number"
                  min={0}
                  max={30}
                  defaultValue={initial.graceDays}
                  required
                />
              </Field>
              <Field label="Data do aceite confirmado">
                <input
                  name="accepted"
                  type="date"
                  max={today}
                  defaultValue={initial.acceptedOn ?? ""}
                />
              </Field>
              <Field label="Referência do contrato ou aceite" wide>
                <input
                  name="reference"
                  maxLength={500}
                  defaultValue={initial.termsReference}
                  placeholder="Ex.: contrato assinado ou confirmação registrada"
                />
              </Field>
              <Field label="Observações da condição" wide>
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  defaultValue={initial.notes}
                />
              </Field>
            </div>
            <p className="helper-text">
              Essas condições sinalizam sua decisão operacional. Não suspendem
              serviços de clientes nem aplicam multas automaticamente.
            </p>
          </>
        ) : dialog.kind === "contact" ? (
          <div className="form-grid">
            <Field label="Tipo de registro">
              <select name="kind">
                <option value="contact">Contato realizado</option>
                <option value="reminder">Lembrete enviado por você</option>
                <option value="promise">Promessa de pagamento informada</option>
                <option value="dispute">Divergência ou contestação</option>
              </select>
            </Field>
            <Field label="Canal">
              <select name="channel">
                <option value="manual">Registro manual</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">E-mail</option>
                <option value="phone">Telefone</option>
              </select>
            </Field>
            <Field label="Data prometida, se houver" wide>
              <input name="promise" type="date" />
            </Field>
            <Field label="O que ficou combinado?" wide>
              <textarea
                name="note"
                rows={5}
                minLength={3}
                maxLength={2000}
                required
                autoFocus
              />
            </Field>
          </div>
        ) : (
          <>
            <div className="payment-summary">
              <span>Saldo atual da parcela {dialog.row.part.sequence}</span>
              <strong>{money(dialog.row.remaining)}</strong>
              <small>
                O valor será conferido no banco no momento da geração.
              </small>
            </div>
            <Field label="Validade real do link">
              <select name="hours" defaultValue="24">
                <option value="12">12 horas</option>
                <option value="24">24 horas</option>
                <option value="48">48 horas</option>
                <option value="72">72 horas</option>
              </select>
            </Field>
            <div className="inline-note">
              Este link é para o saldo desta parcela. Não cria assinatura nem
              recorrência. Cartão e dados bancários do cliente são tratados pelo
              provedor. A cobrança não é enviada automaticamente.
            </div>
          </>
        )}
        {dialog.kind === "contact" && dialog.row.actions.length > 0 && (
          <section className="contact-history">
            <h3>Últimos acompanhamentos</h3>
            {dialog.row.actions.slice(0, 5).map((action) => (
              <div key={action.id}>
                <small>
                  {fullDate(action.createdAt)} · {action.channel}
                </small>
                <p>{action.note}</p>
                {action.promiseOn && (
                  <Badge>Previsão: {fullDate(action.promiseOn)}</Badge>
                )}
              </div>
            ))}
          </section>
        )}
        {footer(
          dialog.kind === "terms"
            ? "Salvar condições"
            : dialog.kind === "contact"
              ? "Salvar acompanhamento"
              : "Gerar link seguro",
        )}
      </form>
    </Modal>
  );
}
