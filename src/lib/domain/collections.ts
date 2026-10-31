import type { Workspace } from "./model.ts";
import { installmentPaid, installmentRemaining } from "./workspace.ts";
import { daysBetween, fullDate, money } from "./dates.ts";
export function collectionRows(state: Workspace, today: string) {
  const contracts = new Map(state.contracts.map((c) => [c.id, c]));
  const clients = new Map(state.clients.map((c) => [c.id, c]));
  const usedCharges = new Set(
    state.providerPayments.filter((p) => p.receiptId).map((p) => p.chargeId),
  );
  const agreements = new Map(
    state.collectionAgreements.map((a) => [a.contractId, a]),
  );
  const actionsByPart = new Map<string, Workspace["collectionActions"]>();
  for (const action of [...state.collectionActions].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )) {
    const list = actionsByPart.get(action.installmentId) ?? [];
    list.push(action);
    actionsByPart.set(action.installmentId, list);
  }
  const chargeByPart = new Map<string, Workspace["charges"][number]>();
  for (const charge of state.charges)
    chargeByPart.set(charge.installmentId, charge);
  return state.installments
    .flatMap((part) => {
      const contract = contracts.get(part.contractId);
      if (!contract || contract.status !== "active" || part.status !== "open")
        return [];
      const remaining = installmentRemaining(state, part.id);
      if (!remaining) return [];
      const agreement = agreements.get(contract.id);
      const age = Math.max(0, daysBetween(part.dueOn, today));
      const lastActions = actionsByPart.get(part.id) ?? [];
      const promise = lastActions.find((a) => a.kind === "promise");
      const latestCharge = chargeByPart.get(part.id);
      return [
        {
          part,
          contract,
          client: clients.get(contract.clientId),
          remaining,
          age,
          agreement,
          actions: lastActions,
          promise,
          latestCharge,
          chargeUsed: latestCharge ? usedCharges.has(latestCharge.id) : false,
          late: part.dueOn < today,
          afterGrace: age > (agreement?.graceDays ?? 0),
          bucket:
            age === 0
              ? "current"
              : age <= 7
                ? "1_7"
                : age <= 15
                  ? "8_15"
                  : age <= 30
                    ? "16_30"
                    : "31_plus",
        },
      ];
    })
    .sort((a, b) => b.age - a.age || a.part.dueOn.localeCompare(b.part.dueOn));
}
export function collectionSummary(state: Workspace, today: string) {
  const rows = collectionRows(state, today);
  return {
    rows,
    total: rows.reduce((s, r) => s + r.remaining, 0),
    overdue: rows.filter((r) => r.late).reduce((s, r) => s + r.remaining, 0),
    brokenPromises: rows.filter(
      (r) => r.promise?.promiseOn && r.promise.promiseOn < today,
    ).length,
    review: state.providerPayments
      .filter((p) => p.mode === "live" && p.reviewReason)
      .reduce((s, p) => s + p.amountCents, 0),
  };
}
export function contractGate(state: Workspace, contractId: string) {
  const agreement = state.collectionAgreements.find(
    (a) => a.contractId === contractId,
  );
  if (!agreement || agreement.gate === "none")
    return {
      state: "unconfigured" as const,
      label: "Sem bloqueio comercial definido",
    };
  if (!agreement.acceptedOn)
    return {
      state: "proposed" as const,
      label: "Condição proposta · aceite pendente",
    };
  const chargeIds = new Set(
    state.charges
      .filter((c) =>
        state.installments.some(
          (i) => i.id === c.installmentId && i.contractId === contractId,
        ),
      )
      .map((c) => c.id),
  );
  if (
    state.providerPayments.some(
      (p) =>
        p.mode === "live" &&
        p.chargeId &&
        chargeIds.has(p.chargeId) &&
        (p.reviewReason || ["in_mediation", "charged_back"].includes(p.status)),
    )
  )
    return { state: "review" as const, label: "Revisão financeira necessária" };
  const parts = state.installments.filter((i) => i.contractId === contractId);
  const paid = parts.reduce((s, i) => s + installmentPaid(state, i.id), 0);
  const target =
    agreement.gate === "full"
      ? (state.contracts.find((c) => c.id === contractId)?.totalCents ?? 0)
      : agreement.initialCents;
  return paid >= target
    ? { state: "released" as const, label: "Condição financeira atendida" }
    : {
        state: "waiting" as const,
        label:
          agreement.gate === "full"
            ? "Saldo pendente para entrega"
            : "Entrada pendente para início",
      };
}
export function reminderDraft(
  row: ReturnType<typeof collectionRows>[number],
  businessName: string,
  today: string,
) {
  const greeting = `Olá! Sobre o contrato ${row.contract.title}, parcela ${row.part.sequence}:`;
  const status = row.late
    ? `o saldo de ${money(row.remaining)} venceu em ${fullDate(row.part.dueOn)}.`
    : `o saldo de ${money(row.remaining)} tem vencimento em ${fullDate(row.part.dueOn)}.`;
  const charge = row.latestCharge;
  const ready =
    charge?.mode === "live" &&
    !row.chargeUsed &&
    charge?.status === "ready" &&
    new Date(charge.expiresAt).valueOf() > Date.now() &&
    charge.checkoutUrl &&
    charge.amountCents === row.remaining &&
    row.remaining > 0;
  const payment = ready
    ? `\nPagamento pelo checkout oficial: ${charge.checkoutUrl}\nEste link é válido até ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" }).format(new Date(charge.expiresAt))}.`
    : "\nPodemos confirmar a forma de pagamento e a previsão de regularização?";
  const condition =
    row.agreement?.acceptedOn && row.agreement.gate !== "none"
      ? "\nSeguimos as condições de pagamento e entrega registradas no nosso acordo."
      : "";
  return `${greeting}\n${status}${payment}${condition}\nSe já pagou, me avise para conferirmos a conciliação.\n${businessName}`;
}
