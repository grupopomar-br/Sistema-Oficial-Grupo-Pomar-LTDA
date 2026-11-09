import type { Expense, Workspace } from "./model.ts";

export const expensePurposes = [
  "tools",
  "paid_traffic",
  "investment",
  "personal",
] as const;
export const expenseGroups = {
  operation: "Custos da operação",
  tools: "Investimento em ferramentas",
  paid_traffic: "Investimento em tráfego pago",
  investment: "Outros investimentos",
  personal: "Despesas pessoais",
  withdrawal: "Retiradas",
  unclassified: "Despesas sem classificação",
} as const;
export type ExpenseGroup = keyof typeof expenseGroups;

export function expenseGroup(
  expense: Pick<Expense, "category" | "purpose">,
): ExpenseGroup {
  if (expense.purpose) return expense.purpose;
  if (expense.category === "withdrawal") return "withdrawal";
  return expense.category === "other" ? "unclassified" : "operation";
}

export function cashMovement(
  {
    receipts,
    expenses,
    refunds,
  }: Pick<Workspace, "receipts" | "expenses" | "refunds">,
  months: readonly string[],
) {
  const periods = months.map((month) => ({
    month,
    received: 0,
    refunded: 0,
    spending: {
      operation: 0,
      tools: 0,
      paid_traffic: 0,
      investment: 0,
      personal: 0,
      withdrawal: 0,
      unclassified: 0,
    } satisfies Record<ExpenseGroup, number>,
  }));
  const byMonth = new Map(periods.map((period) => [period.month, period]));
  for (const receipt of receipts) {
    if (receipt.status !== "confirmed" || !receipt.receivedOn) continue;
    const period = byMonth.get(receipt.receivedOn.slice(0, 7));
    if (period) period.received += receipt.amountCents;
  }
  for (const expense of expenses) {
    if (expense.status !== "paid" || !expense.paidOn) continue;
    const period = byMonth.get(expense.paidOn.slice(0, 7));
    if (period) period.spending[expenseGroup(expense)] += expense.amountCents;
  }
  for (const refund of refunds) {
    const period = byMonth.get(refund.occurredOn.slice(0, 7));
    if (period) period.refunded += refund.amountCents;
  }
  return periods.map((period) => {
    const { spending, received, refunded } = period;
    const invested =
      spending.tools + spending.paid_traffic + spending.investment;
    const paidExpenses =
      spending.operation +
      invested +
      spending.personal +
      spending.withdrawal +
      spending.unclassified;
    const outflow = paidExpenses + refunded;
    return {
      ...period,
      invested,
      paidExpenses,
      outflow,
      businessBalance:
        received -
        refunded -
        spending.operation -
        invested -
        spending.unclassified,
      cashBalance: received - outflow,
    };
  });
}
