const failures = {
  POMAR_DATE_CONFIRMATION: {
    code: "reconciliation_date_rejected",
    message:
      "A data não pôde ser vinculada ao pagamento. Atualize a lista e confira a data no Mercado Pago antes de tentar novamente.",
    status: 409,
  },
  POMAR_PAYMENT_CHANGED: {
    code: "reconciliation_payment_changed",
    message:
      "Os dados do pagamento divergiram da cobrança. Atualize a lista e confira a movimentação no Mercado Pago.",
    status: 409,
  },
  POMAR_BAD_COMMAND: {
    code: "reconciliation_data_rejected",
    message:
      "Os dados da conferência foram recusados. Revise a data e atualize a lista.",
    status: 400,
  },
  POMAR_WORKER_ACCESS: {
    code: "reconciliation_worker_rejected",
    message:
      "A conexão de conciliação não foi autorizada. Confira a configuração da integração.",
    status: 503,
  },
} as const;

const databaseCodes = new Set([
  "22023",
  "23503",
  "23505",
  "23514",
  "28000",
  "28P01",
  "3F000",
  "40001",
  "40P01",
  "42501",
  "42883",
  "42P01",
  "P0001",
]);

// Project only fixed reasons and recognized SQLSTATEs. Driver messages, SQL,
// parameters, account IDs and connection strings must never reach logs/clients.
export function reconciliationStorageFailure(error: unknown) {
  const candidate = error && typeof error === "object" ? error : {};
  const { message, code } = candidate as { message?: unknown; code?: unknown };
  const known =
    typeof message === "string" && Object.hasOwn(failures, message)
      ? failures[message as keyof typeof failures]
      : null;
  return {
    ...(known ?? {
      code: "reconciliation_storage_failed",
      message:
        "Não foi possível registrar a conciliação. O pagamento permanece preservado; atualize a lista antes de tentar novamente.",
      status: 503,
    }),
    ...(typeof code === "string" && databaseCodes.has(code)
      ? { database_code: code }
      : {}),
  };
}
