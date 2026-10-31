import { z } from "zod";
import { workspaceSchema, type Workspace } from "./model.ts";
import { parseWorkspace } from "./workspace.ts";

const backupSchema = z.strictObject({
  format: z.literal("pomar.workspace"),
  version: z.literal(1),
  exportedAt: z.iso.datetime({ offset: true }),
  workspace: workspaceSchema,
});
export function exportBackup(workspace: Workspace): string {
  return JSON.stringify(
    {
      format: "pomar.workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace,
    },
    null,
    2,
  );
}
export function importBackup(contents: string): Workspace {
  if (new TextEncoder().encode(contents).byteLength > 5 * 1024 * 1024)
    throw new Error("O backup excede o limite de 5 MB desta versão.");
  const parsed = backupSchema.parse(JSON.parse(contents));
  return parseWorkspace(parsed.workspace);
}

function csvCell(value: unknown): string {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function toCsv(headers: string[], rows: unknown[][]): string {
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")
  );
}

export function financialCsv(state: Workspace): string {
  return toCsv(
    [
      "Tipo",
      "Contrato ou descrição",
      "Cliente",
      "Data",
      "Valor em reais",
      "Estado",
    ],
    [
      ...state.receipts.map((receipt) => {
        const contract = state.contracts.find(
          (item) => item.id === receipt.contractId,
        );
        return [
          "Recebimento",
          contract?.title ?? "",
          state.clients.find((item) => item.id === contract?.clientId)?.name ??
            "",
          receipt.receivedOn ?? "Sem data",
          (receipt.amountCents / 100).toFixed(2).replace(".", ","),
          receipt.status === "confirmed" ? "Confirmado" : "Estornado",
        ];
      }),
      ...state.refunds.map((refund) => [
        "Devolução confirmada",
        state.contracts.find(
          (c) =>
            c.id ===
            state.receipts.find((r) => r.id === refund.receiptId)?.contractId,
        )?.title ?? "",
        "",
        refund.occurredOn,
        (-refund.amountCents / 100).toFixed(2).replace(".", ","),
        "Devolvido",
      ]),
      ...state.expenses.map((expense) => [
        "Despesa",
        expense.title,
        "",
        expense.paidOn ?? expense.dueOn ?? "Sem data",
        (expense.amountCents / 100).toFixed(2).replace(".", ","),
        expense.status,
      ]),
    ],
  );
}
