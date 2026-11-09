import { useMemo } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import type { Workspace } from "@/lib/domain/model";
import {
  cashMovement,
  expenseGroups,
  type ExpenseGroup,
} from "@/lib/domain/cash-movement";
import { money, monthLabel, shiftMonth } from "@/lib/domain/dates";
import { Badge, Button } from "../ui";
import styles from "./cash-dashboard.module.css";

const shortMonth = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  timeZone: "UTC",
});

export default function CashDashboard({
  state,
  month,
  unpaid,
  hiddenValues,
  onExpenses,
  onAddExpense,
}: {
  state: Workspace;
  month: string;
  unpaid: number;
  hiddenValues: boolean;
  onExpenses: () => void;
  onAddExpense: () => void;
}) {
  const periods = useMemo(
    () =>
      cashMovement(
        state,
        Array.from({ length: 6 }, (_, index) => shiftMonth(month, index - 5)),
      ),
    [state, month],
  );
  const selected = periods[periods.length - 1];
  const scale = Math.max(
    1,
    ...periods.map((period) => Math.max(period.received, period.outflow)),
  );
  const groups = (Object.keys(expenseGroups) as ExpenseGroup[])
    .map((key) => ({ key, amount: selected.spending[key] }))
    .filter(({ amount }) => amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const format = (value: number) => (hiddenValues ? "••••" : money(value));

  return (
    <div className={styles.layout}>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CAIXA REALIZADO</span>
            <h2>Entradas e saídas</h2>
          </div>
          <Badge tone="green">6 meses</Badge>
        </div>
        <div className={styles.body}>
          {hiddenValues ? (
            <p className={styles.note}>Valores ocultos.</p>
          ) : (
            <>
              <div className={styles.legend}>
                <span className={styles.inflow}>Entradas</span>
                <span className={styles.outflow}>Saídas e devoluções</span>
              </div>
              <div className={styles.chart} aria-hidden="true">
                {periods.map((period) => (
                  <div className={styles.column} key={period.month}>
                    <div className={styles.bars}>
                      <span
                        className={styles.inflow}
                        style={{
                          height: `${(period.received / scale) * 100}%`,
                        }}
                      />
                      <span
                        className={styles.outflow}
                        style={{ height: `${(period.outflow / scale) * 100}%` }}
                      />
                    </div>
                    <span>
                      {shortMonth.format(
                        new Date(`${period.month}-15T12:00:00Z`),
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <details className={styles.details}>
                <summary>Ver valores por mês</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Mês</th>
                        <th>Entradas</th>
                        <th>Saídas</th>
                        <th>Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((period) => (
                        <tr key={period.month}>
                          <th scope="row">{monthLabel(period.month)}</th>
                          <td>{money(period.received)}</td>
                          <td>{money(period.outflow)}</td>
                          <td>{money(period.cashBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
          <p className={styles.note}>
            Entradas, despesas e devoluções pela data registrada de cada
            movimento.
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CONTROLE DO MÊS</span>
            <h2>{monthLabel(month)}</h2>
          </div>
        </div>
        <div className={styles.body}>
          <dl className={styles.movement}>
            <div>
              <dt>Recebido</dt>
              <dd>{format(selected.received)}</dd>
            </div>
            <div>
              <dt>Despesas pagas</dt>
              <dd>{format(selected.paidExpenses)}</dd>
            </div>
            <div>
              <dt>Investido nas despesas pagas</dt>
              <dd>{format(selected.invested)}</dd>
            </div>
            <div>
              <dt>Pessoais e retiradas</dt>
              <dd>
                {format(
                  selected.spending.personal + selected.spending.withdrawal,
                )}
              </dd>
            </div>
            {selected.refunded > 0 && (
              <div>
                <dt>Devoluções</dt>
                <dd>{format(selected.refunded)}</dd>
              </div>
            )}
            <div>
              <dt>Saldo antes de pessoais e retiradas</dt>
              <dd>{format(selected.businessBalance)}</dd>
            </div>
            <div className={styles.balance}>
              <dt>Saldo gerencial</dt>
              <dd>{format(selected.cashBalance)}</dd>
            </div>
            <div>
              <dt>A pagar no mês</dt>
              <dd>{format(unpaid)}</dd>
            </div>
          </dl>
          <Button variant="primary" onClick={onAddExpense}>
            <Plus size={16} /> Registrar despesa
          </Button>
        </div>
      </section>
      <section className={`panel ${styles.distribution}`}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DESTINO DO DINHEIRO</span>
            <h2>Despesas pagas por grupo</h2>
          </div>
          <Button onClick={onExpenses}>
            Ver despesas <ArrowUpRight size={15} />
          </Button>
        </div>
        <div className={styles.body}>
          {hiddenValues ? (
            <p className={styles.note}>Valores ocultos.</p>
          ) : groups.length ? (
            <ul className={styles.groups}>
              {groups.map(({ key, amount }) => (
                <li key={key}>
                  <div>
                    <span>{expenseGroups[key]}</span>
                    <strong>{money(amount)}</strong>
                  </div>
                  <progress
                    aria-label={`Participação de ${expenseGroups[key]} nas despesas pagas`}
                    value={amount}
                    max={selected.paidExpenses}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.note}>
              As despesas pagas no mês aparecerão aqui.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
