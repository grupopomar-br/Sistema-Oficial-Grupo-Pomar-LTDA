"use client";
import { useMemo, useState } from "react";
import {
  Plus,
  Download,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  FileText,
  Banknote,
  RotateCcw,
  Check,
  Receipt,
  CircleDollarSign,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  MonthPicker,
  Pagination,
  StatCard,
} from "../ui";
import type { ViewProps } from "../types";
import { getFinanceSummary } from "@/lib/domain/selectors";
import { installmentRemaining } from "@/lib/domain/workspace";
import { money, fullDate, shiftMonth, monthLabel } from "@/lib/domain/dates";
import { financialCsv } from "@/lib/domain/backup";
import { labels } from "@/lib/domain/model";

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Finance({
  open,
  navigate,
  month,
  setMonth,
  today,
  hiddenValues,
}: ViewProps) {
  const { state } = useWorkspace();
  const [tab, setTab] = useState("overview");
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState("month");
  const summary = useMemo(
    () => getFinanceSummary(state, month),
    [state, month],
  );
  const format = (value: number) => (hiddenValues ? "••••" : money(value));
  const openInstallments = state.installments.filter(
    (item) =>
      item.status === "open" &&
      state.contracts.find((contract) => contract.id === item.contractId)
        ?.status === "active" &&
      installmentRemaining(state, item.id) > 0,
  );
  const installments = openInstallments
    .filter((item) => scope === "all" || item.dueOn.startsWith(month))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const receipts = [...state.receipts]
    .filter(
      (item) =>
        scope === "all" ||
        item.receivedOn === null ||
        item.receivedOn.startsWith(month),
    )
    .sort((a, b) =>
      (b.receivedOn ?? "9999").localeCompare(a.receivedOn ?? "9999"),
    );
  const expenses = [...state.expenses]
    .filter(
      (item) =>
        scope === "all" || (item.paidOn ?? item.dueOn)?.startsWith(month),
    )
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  const contractName = (id: string) =>
    state.contracts.find((item) => item.id === id)?.title ?? "Contrato";
  const clientName = (contractId: string) =>
    state.clients.find(
      (item) =>
        item.id ===
        state.contracts.find((contract) => contract.id === contractId)
          ?.clientId,
    )?.name ?? "";
  const undated = state.receipts.filter(
    (item) => item.status === "confirmed" && item.receivedOn === null,
  );
  const collection =
    tab === "receivables"
      ? installments
      : tab === "receipts"
        ? receipts
        : expenses;
  const current = Math.min(
    page,
    Math.max(1, Math.ceil(collection.length / 15)),
  );
  const months = Array.from({ length: 6 }, (_, index) =>
    shiftMonth(month, index - 5),
  );
  const chart = months.map((value) => ({
    month: value,
    amount: getFinanceSummary(state, value).received,
  }));
  const chartMax = Math.max(1, ...chart.map((item) => item.amount));
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Clareza sobre o dinheiro.</h2>
          <p>Contratado, a receber e recebido, cada um no seu lugar.</p>
        </div>
        <div className="button-group">
          <Button
            onClick={() =>
              downloadFile(
                `pomar-financeiro-${month}.csv`,
                financialCsv(state),
                "text/csv;charset=utf-8",
              )
            }
          >
            <Download size={16} />
            Exportar CSV
          </Button>
          <Button
            variant="primary"
            disabled={!state.clients.length}
            title={
              !state.clients.length ? "Cadastre um cliente primeiro" : undefined
            }
            onClick={() => open({ kind: "contract" })}
          >
            <Plus size={16} />
            Contrato
          </Button>
        </div>
      </div>
      <div className="finance-toolbar">
        <MonthPicker value={month} onChange={setMonth} />
        <span>Valores em reais · recebimentos por data real</span>
      </div>
      <div className="stats-grid">
        <StatCard
          title="Contratado no mês"
          value={format(summary.signed)}
          detail="Pela data de fechamento"
          icon={FileText}
        />
        <StatCard
          title="Recebido no mês"
          value={format(summary.received)}
          detail="Pagamentos confirmados com data"
          icon={ArrowDownLeft}
          accent
        />
        <StatCard
          title="A receber no mês"
          value={format(summary.expected)}
          detail="Saldo das parcelas do mês"
          icon={Calendar}
        />
        <StatCard
          title="Saldo dos contratos"
          value={format(summary.contractBalance)}
          detail="Contratos ativos · todos os meses"
          icon={Wallet}
        />
      </div>
      <div className="page-tabs">
        {[
          ["overview", "Visão financeira"],
          ["contracts", "Contratos"],
          ["receivables", "A receber"],
          ["receipts", "Recebimentos"],
          ["expenses", "Despesas"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
          >
            {label}
            {key === "receivables" && openInstallments.length > 0 && (
              <span>{openInstallments.length}</span>
            )}
          </button>
        ))}
      </div>
      {summary.refunded > 0 && (
        <div className="inline-note">
          Devoluções confirmadas no mês:{" "}
          <strong>{format(summary.refunded)}</strong>. Elas reduzem o saldo de
          caixa e preservam os recebimentos originais.
        </div>
      )}
      {tab === "overview" && (
        <>
          <div className="finance-overview">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">CAIXA REALIZADO</span>
                  <h2>Recebimentos dos últimos meses</h2>
                </div>
                <Badge tone="green">6 meses</Badge>
              </div>
              {hiddenValues ? (
                <div className="chart-hidden">Valores ocultos</div>
              ) : (
                <div
                  className="cash-chart"
                  role="img"
                  aria-label="Recebimentos mensais confirmados"
                >
                  <div className="chart-bars">
                    {chart.map((item) => (
                      <div className="chart-column" key={item.month}>
                        <span>{money(item.amount)}</span>
                        <div className="chart-bar-space">
                          <div
                            className={
                              item.month === month
                                ? "chart-bar current"
                                : "chart-bar"
                            }
                            style={{
                              height: item.amount
                                ? `${Math.max(3, (item.amount / chartMax) * 100)}%`
                                : "2px",
                            }}
                            title={`${monthLabel(item.month)}: ${money(item.amount)}`}
                          />
                        </div>
                        <small>
                          {new Intl.DateTimeFormat("pt-BR", {
                            month: "short",
                          }).format(new Date(`${item.month}-15T12:00:00Z`))}
                        </small>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
            <section className="panel cash-summary">
              <span className="eyebrow">MOVIMENTO DO MÊS</span>
              <div>
                <span>Entradas confirmadas</span>
                <strong className="text-green">
                  {format(summary.received)}
                </strong>
              </div>
              <div>
                <span>Despesas pagas</span>
                <strong>{format(summary.paidExpenses)}</strong>
              </div>
              {summary.refunded > 0 && (
                <div>
                  <span>Devoluções confirmadas</span>
                  <strong>{format(summary.refunded)}</strong>
                </div>
              )}
              <div className="cash-total">
                <span>Saldo gerencial do mês</span>
                <strong>{format(summary.cashBalance)}</strong>
              </div>
              <p>
                Recebimentos brutos menos despesas e devoluções registradas. Não
                é saldo bancário nem disponibilidade de saque do provedor.
              </p>
              <Button
                onClick={() => {
                  setTab("expenses");
                  setPage(1);
                }}
              >
                Ver despesas
                <ArrowUpRight size={15} />
              </Button>
            </section>
          </div>
          {undated.length > 0 && (
            <section className="panel reconciliation">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">CONCILIAÇÃO</span>
                  <h2>Recebimentos com data a confirmar</h2>
                </div>
                <Badge tone="amber">{format(summary.undated)}</Badge>
              </div>
              <p>
                Os valores estão preservados e ainda não compõem o caixa mensal.
              </p>
              {undated.slice(0, 5).map((item) => (
                <div className="reconcile-row" key={item.id}>
                  <div>
                    <strong>{contractName(item.contractId)}</strong>
                    <span>
                      {format(item.amountCents)} · sem data real confirmada
                    </span>
                  </div>
                  <Button
                    onClick={() => open({ kind: "dateReceipt", id: item.id })}
                  >
                    Informar data
                  </Button>
                </div>
              ))}
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>Próximos recebimentos</h2>
              <Button
                variant="ghost"
                onClick={() => {
                  setTab("receivables");
                  setScope("all");
                }}
              >
                Ver todos
                <ArrowUpRight size={15} />
              </Button>
            </div>
            {openInstallments.length ? (
              <div className="simple-list">
                {[...openInstallments]
                  .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
                  .slice(0, 5)
                  .map((item) => (
                    <div key={item.id}>
                      <span className="list-icon">
                        <Calendar size={17} />
                      </span>
                      <div>
                        <strong>{contractName(item.contractId)}</strong>
                        <small>
                          {clientName(item.contractId)} · parcela{" "}
                          {item.sequence}
                        </small>
                      </div>
                      <span className={item.dueOn < today ? "text-danger" : ""}>
                        {fullDate(item.dueOn)}
                      </span>
                      <strong>
                        {format(installmentRemaining(state, item.id))}
                      </strong>
                      <Button
                        onClick={() =>
                          open({ kind: "receipt", installmentId: item.id })
                        }
                      >
                        Registrar
                      </Button>
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyState
                icon={Receipt}
                title="Seus compromissos financeiros aparecerão aqui."
                description="Comece pelo cliente e pelo contrato para organizar as parcelas."
                action={
                  state.clients.length
                    ? "Registrar contrato"
                    : "Cadastrar cliente"
                }
                onAction={() =>
                  state.clients.length
                    ? open({ kind: "contract" })
                    : navigate("clients")
                }
              />
            )}
          </section>
        </>
      )}
      {tab === "contracts" && (
        <div className="view-stack">
          {state.contracts.length ? (
            <div className="contract-grid">
              {[...state.contracts]
                .sort((a, b) => b.signedOn.localeCompare(a.signedOn))
                .map((contract) => {
                  const received = state.receipts
                    .filter(
                      (item) =>
                        item.contractId === contract.id &&
                        item.status === "confirmed",
                    )
                    .reduce((sum, item) => sum + item.amountCents, 0);
                  const balance = state.installments
                    .filter((item) => item.contractId === contract.id)
                    .reduce(
                      (sum, item) => sum + installmentRemaining(state, item.id),
                      0,
                    );
                  return (
                    <section className="panel contract-card" key={contract.id}>
                      <div className="contract-heading">
                        <span className="list-icon">
                          <FileText size={20} />
                        </span>
                        <Badge
                          tone={
                            contract.status === "active" ? "green" : "neutral"
                          }
                        >
                          {contract.status === "active"
                            ? "Ativo"
                            : contract.status === "cancelled"
                              ? "Cancelado"
                              : "Encerrado"}
                        </Badge>
                      </div>
                      <h3>{contract.title}</h3>
                      <p>{clientName(contract.id)}</p>
                      <div className="contract-values">
                        <div>
                          <span>Contratado</span>
                          <strong>{format(contract.totalCents)}</strong>
                        </div>
                        <div>
                          <span>Recebido</span>
                          <strong>{format(received)}</strong>
                        </div>
                        <div>
                          <span>Saldo</span>
                          <strong>{format(balance)}</strong>
                        </div>
                      </div>
                      <div className="contract-footer">
                        <span>Fechado em {fullDate(contract.signedOn)}</span>
                        {contract.status === "active" && (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              open({ kind: "cancelContract", id: contract.id })
                            }
                          >
                            Cancelar contrato
                          </Button>
                        )}
                      </div>
                    </section>
                  );
                })}
            </div>
          ) : (
            <div className="panel">
              <EmptyState
                icon={FileText}
                title="Registre o compromisso antes do pagamento."
                description="O contrato organiza o valor total, as condições e os vencimentos."
                action={
                  state.clients.length
                    ? "Registrar contrato"
                    : "Cadastrar cliente"
                }
                onAction={() =>
                  state.clients.length
                    ? open({ kind: "contract" })
                    : navigate("clients")
                }
              />
            </div>
          )}
        </div>
      )}
      {["receivables", "receipts", "expenses"].includes(tab) && (
        <>
          <div className="results-heading">
            <span>{collection.length} registros</span>
            <div className="button-group">
              <select
                aria-label="Período dos registros financeiros"
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value);
                  setPage(1);
                }}
              >
                <option value="month">Mês selecionado</option>
                <option value="all">Todos os meses</option>
              </select>
              {tab === "expenses" && (
                <Button
                  variant="primary"
                  onClick={() => open({ kind: "expense" })}
                >
                  <Plus size={15} />
                  Despesa
                </Button>
              )}
            </div>
          </div>
          <div className="panel table-scroll">
            {collection.length ? (
              <table>
                <thead>
                  <tr>
                    <th>{tab === "expenses" ? "Descrição" : "Contrato"}</th>
                    <th>
                      {tab === "receivables"
                        ? "Vencimento"
                        : tab === "receipts"
                          ? "Recebido em"
                          : "Data / vencimento"}
                    </th>
                    <th>Estado</th>
                    <th className="numeric">Valor</th>
                    <th>
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tab === "receivables" &&
                    installments
                      .slice((current - 1) * 15, current * 15)
                      .map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{contractName(item.contractId)}</strong>
                            <small>
                              {clientName(item.contractId)} · parcela{" "}
                              {item.sequence}
                            </small>
                          </td>
                          <td
                            className={item.dueOn < today ? "text-danger" : ""}
                          >
                            {fullDate(item.dueOn)}
                          </td>
                          <td>
                            <Badge
                              tone={item.dueOn < today ? "danger" : "amber"}
                            >
                              {item.dueOn < today ? "Vencida" : "Em aberto"}
                            </Badge>
                          </td>
                          <td className="numeric">
                            <strong>
                              {format(installmentRemaining(state, item.id))}
                            </strong>
                          </td>
                          <td>
                            <Button
                              onClick={() =>
                                open({
                                  kind: "receipt",
                                  installmentId: item.id,
                                })
                              }
                            >
                              <Check size={14} />
                              Receber
                            </Button>
                          </td>
                        </tr>
                      ))}
                  {tab === "receipts" &&
                    receipts
                      .slice((current - 1) * 15, current * 15)
                      .map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{contractName(item.contractId)}</strong>
                            <small>{clientName(item.contractId)}</small>
                          </td>
                          <td>
                            {fullDate(item.receivedOn)}
                            {item.receivedOn === null &&
                              item.status === "confirmed" && (
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() =>
                                    open({ kind: "dateReceipt", id: item.id })
                                  }
                                >
                                  Conciliar data
                                </button>
                              )}
                          </td>
                          <td>
                            <Badge
                              tone={
                                item.status === "confirmed"
                                  ? "green"
                                  : "neutral"
                              }
                            >
                              {item.status === "confirmed"
                                ? "Confirmado"
                                : "Estornado"}
                            </Badge>
                          </td>
                          <td className="numeric">
                            <strong>{format(item.amountCents)}</strong>
                          </td>
                          <td>
                            {item.status === "confirmed" &&
                              !state.providerPayments.some(
                                (p) => p.receiptId === item.id,
                              ) && (
                                <IconButton
                                  label="Estornar recebimento"
                                  onClick={() =>
                                    open({ kind: "voidReceipt", id: item.id })
                                  }
                                >
                                  <RotateCcw size={16} />
                                </IconButton>
                              )}
                          </td>
                        </tr>
                      ))}
                  {tab === "expenses" &&
                    expenses
                      .slice((current - 1) * 15, current * 15)
                      .map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.title}</strong>
                            <small>{labels.category[item.category]}</small>
                          </td>
                          <td>{fullDate(item.paidOn ?? item.dueOn)}</td>
                          <td>
                            <Badge
                              tone={
                                item.status === "paid"
                                  ? "green"
                                  : item.status === "pending"
                                    ? "amber"
                                    : "neutral"
                              }
                            >
                              {labels.expense[item.status]}
                            </Badge>
                          </td>
                          <td className="numeric">
                            <strong>{format(item.amountCents)}</strong>
                          </td>
                          <td>
                            <Button
                              onClick={() =>
                                open({ kind: "expense", id: item.id })
                              }
                            >
                              Editar
                            </Button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                icon={tab === "expenses" ? Wallet : Banknote}
                title="Nenhum registro neste período."
                description="Mude o filtro de período ou registre um novo compromisso."
                action={tab === "expenses" ? "Nova despesa" : undefined}
                onAction={() => open({ kind: "expense" })}
              />
            )}
          </div>
          <Pagination
            page={current}
            total={collection.length}
            size={15}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
