import { z } from "zod";
import type { BillingConfig } from "../config/billing.ts";
import type { PixPayer } from "./pix-contract.ts";
import { decimalCents } from "./safety.ts";
import { todayDate } from "../domain/dates.ts";
import type { ProviderFailureCode } from "./provider-diagnostics.ts";
import {
  ProviderError,
  providerRequest,
  fetchVerifiedPayment,
  type PreparedCharge,
  type VerifiedPayment,
  type VerifiedRefund,
} from "./mercadopago.ts";

export const orderIdPattern = /^ORD[0-9A-HJKMNP-TV-Z]{26}$/;
export const providerIdPattern = /^(?:\d{1,30}|ORD[0-9A-HJKMNP-TV-Z]{26})$/;
export const refundIdPattern = /^(?:\d{1,40}|REF[0-9A-HJKMNP-TV-Z]{26})$/;
const paymentIdPattern = /^PAY[0-9A-HJKMNP-TV-Z]{26}$/;
const bad = (code: ProviderFailureCode = "provider_order_response_invalid") =>
  new ProviderError(
    "Os dados da order não passaram na conferência.",
    true,
    undefined,
    code,
  );
const money = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{1,10}\.\d{2}$/.test(value))
    throw bad();
  return decimalCents(value);
};
const instant = (value: unknown) => {
  const result = z.iso.datetime({ offset: true }).safeParse(value);
  if (!result.success || new Date(result.data).valueOf() > Date.now() + 300000)
    throw bad();
  return result.data;
};

// Test tokens can also start APP_USR. Authenticate the seller account instead of
// guessing the environment from that prefix. Never retain the user's profile.
export async function verifyOrderAccount(
  config: BillingConfig,
  fetcher: typeof fetch = fetch,
) {
  const user = await providerRequest(
    config,
    "/users/me",
    "GET",
    undefined,
    fetcher,
    undefined,
    5000,
  );
  if (!user || typeof user !== "object" || Array.isArray(user))
    throw bad("provider_account_invalid");
  if (String(user.id) !== config.collectorId)
    throw bad("provider_collector_mismatch");
  if (user.site_id !== "MLB") throw bad("provider_country_mismatch");
  if (
    !Array.isArray(user.tags) ||
    !user.tags.every((t: unknown) => typeof t === "string")
  )
    throw bad("provider_environment_unverified");
  if (user.tags.includes("test_user") !== (config.mode === "test"))
    throw bad("provider_environment_mismatch");
}

export async function createPixOrder(
  config: BillingConfig,
  charge: PreparedCharge & { expirationSeconds: number; createdAt: string },
  payer: PixPayer,
  fetcher: typeof fetch = fetch,
) {
  if (
    charge.mode !== config.mode ||
    !Number.isSafeInteger(charge.amountCents) ||
    charge.amountCents <= 0 ||
    charge.amountCents > 100_000_000_000 ||
    !Number.isSafeInteger(charge.expirationSeconds) ||
    charge.expirationSeconds < 1800 ||
    charge.expirationSeconds > 30 * 86400 ||
    !Number.isFinite(Date.parse(charge.createdAt)) ||
    new Date(charge.expiresAt).valueOf() <= Date.now()
  )
    throw bad("provider_charge_invalid");
  // This check runs before a POST that could create a real payment.
  await verifyOrderAccount(config, fetcher);
  const names = payer.name.split(/\s+/);
  let raw;
  try {
    raw = await providerRequest(
      config,
      "/v1/orders",
      "POST",
      {
        type: "online",
        processing_mode: "automatic",
        total_amount: (charge.amountCents / 100).toFixed(2),
        external_reference: charge.id,
        description: "Serviços Grupo Pomar",
        transactions: {
          payments: [
            {
              amount: (charge.amountCents / 100).toFixed(2),
              payment_method: { id: "pix", type: "bank_transfer" },
              expiration_time: `PT${charge.expirationSeconds}S`,
            },
          ],
        },
        payer: {
          email: payer.email,
          first_name: names[0],
          last_name: names.slice(1).join(" ") || names[0],
          identification: {
            type: payer.document.length === 11 ? "CPF" : "CNPJ",
            number: payer.document,
          },
        },
      },
      fetcher,
      `pomar-order-${charge.id}`,
    );
  } catch (error) {
    if (
      !(error instanceof ProviderError) ||
      (error.definitive && error.status !== 409)
    )
      throw error;
    // A timed-out POST can have succeeded. A reused key can return 409.
    // Recover the exact existing order; never issue a different key.
    const query = new URLSearchParams({
      external_reference: charge.id,
      begin_date: new Date(Date.parse(charge.createdAt) - 300000).toISOString(),
      end_date: new Date().toISOString(),
      type: "online",
      page: "1",
      page_size: "2",
    });
    const found = await providerRequest(
      config,
      `/v1/orders/search?${query}`,
      "GET",
      undefined,
      fetcher,
      undefined,
      5000,
    );
    if (
      !Array.isArray(found.data) ||
      found.data.length !== 1 ||
      Number(found.paging?.total) !== 1 ||
      !orderIdPattern.test(found.data[0]?.id)
    )
      throw error;
    const existing = await fetchVerifiedOrder(
      config,
      found.data[0].id,
      fetcher,
    );
    if (
      existing.payment.externalReference !== charge.id ||
      existing.payment.amountCents !== charge.amountCents
    )
      throw bad();
    return { orderId: existing.payment.providerPaymentId };
  }
  if (!raw || !orderIdPattern.test(raw.id))
    throw bad("provider_order_id_invalid");
  // Persist this ID even when the asynchronous POST has no payment/QR yet.
  return { orderId: raw.id as string };
}

export type VerifiedOrder = {
  payment: VerifiedPayment;
  qr: { qrCode: string; qrBase64: string | null; expiresAt: string } | null;
};
export async function fetchVerifiedOrder(
  config: BillingConfig,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedOrder> {
  if (!orderIdPattern.test(id)) throw bad("provider_order_id_invalid");
  await verifyOrderAccount(config, fetcher);
  const raw = await providerRequest(
    config,
    `/v1/orders/${id}`,
    "GET",
    undefined,
    fetcher,
    undefined,
    5000,
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad();
  if (raw.id !== id) throw bad("provider_order_id_invalid");
  if (String(raw.user_id) !== config.collectorId)
    throw bad("provider_order_collector_mismatch");
  if (String(raw.integration_data?.application_id) !== config.applicationId)
    throw bad("provider_application_mismatch");
  if (raw.country_code !== "BRA") throw bad("provider_order_country_mismatch");
  if (
    (raw.currency !== undefined && raw.currency !== "BRL") ||
    (raw.currency_id !== undefined && raw.currency_id !== "BRL")
  )
    throw bad("provider_order_currency_mismatch");
  if (raw.live_mode !== undefined && raw.live_mode !== (config.mode === "live"))
    throw bad("provider_order_environment_mismatch");
  if (raw.type !== "online" || raw.processing_mode !== "automatic")
    throw bad("provider_order_type_mismatch");
  const amountCents = money(raw.total_amount),
    updated = instant(raw.last_updated_date);
  if (amountCents <= 0) throw bad();
  const entries = raw.transactions?.payments ?? [];
  // This product creates one Pix per order. Split/multiple payments need their
  // own ledger model and are deliberately rejected rather than summed blindly.
  if (!Array.isArray(entries) || entries.length > 1) throw bad();
  const p = entries[0];
  if (
    p &&
    (!paymentIdPattern.test(p.id) ||
      money(p.amount) !== amountCents ||
      p.payment_method?.id !== "pix" ||
      p.payment_method?.type !== "bank_transfer")
  )
    throw bad();
  let status = "unknown";
  if (["created", "processing"].includes(raw.status)) status = "in_process";
  else if (
    raw.status === "action_required" &&
    p?.status === "action_required" &&
    p.status_detail === "waiting_transfer"
  )
    status = "pending";
  else if (
    raw.status === "processed" &&
    p?.status === "processed" &&
    ["accredited", "partially_refunded"].includes(p.status_detail) &&
    ["accredited", "partially_refunded"].includes(raw.status_detail)
  )
    status = "approved";
  else if (
    (raw.status === "refunded" ||
      (raw.status === "processed" && raw.status_detail === "refunded")) &&
    p &&
    ["processed", "refunded"].includes(p.status)
  )
    status = "refunded";
  else if (raw.status === "failed" && p?.status === "failed")
    status = "rejected";
  else if (["canceled", "expired"].includes(raw.status)) status = "cancelled";
  const paid = money(raw.total_paid_amount ?? "0.00");
  if (
    ["approved", "refunded"].includes(status) &&
    (paid !== amountCents || money(p.paid_amount) !== amountCents)
  )
    throw bad();
  const chargebacks = raw.transactions?.chargebacks ?? [];
  if (!Array.isArray(chargebacks) || chargebacks.length > 500) throw bad();
  if (chargebacks.length) status = "in_mediation";

  // Orders' last_updated_date is NOT proof of the original approval/refund
  // date. Missing financial dates go to review; never invent historical cash.
  let paidOn: string | null = null;
  if (p?.date_approved) paidOn = todayDate(new Date(instant(p.date_approved)));
  const refunds: VerifiedRefund[] = [];
  const refundRows = raw.transactions?.refunds ?? [];
  if (!Array.isArray(refundRows) || refundRows.length > 500) throw bad();
  let refundedCents = 0,
    refundsComplete = true;
  const seen = new Set<string>();
  for (const r of refundRows) {
    if (!["processed", "approved"].includes(r.status)) {
      if (!["failed", "canceled"].includes(r.status)) refundsComplete = false;
      continue;
    }
    if (
      !refundIdPattern.test(r.id) ||
      seen.has(r.id) ||
      r.transaction_id !== p?.id
    )
      throw bad();
    seen.add(r.id);
    const amount = money(r.amount);
    if (amount <= 0) throw bad();
    refundedCents += amount;
    if (!r.created_date) {
      refundsComplete = false;
      continue;
    }
    refunds.push({
      providerRefundId: r.id,
      amountCents: amount,
      occurredOn: todayDate(new Date(instant(r.created_date))),
    });
  }
  if (
    p?.refunded_amount !== undefined &&
    money(p.refunded_amount) !== refundedCents
  )
    refundsComplete = false;
  if (refundedCents > amountCents) throw bad();
  if (status === "refunded" && refundedCents !== amountCents) {
    status = "unknown";
    refundsComplete = false;
  }
  if (raw.status_detail === "partially_refunded" && !refundedCents) {
    status = "unknown";
    refundsComplete = false;
  }

  let qr: VerifiedOrder["qr"] = null;
  if (status === "pending") {
    const method = p.payment_method;
    if (
      typeof method.qr_code === "string" &&
      method.qr_code.length >= 20 &&
      method.qr_code.length <= 4096
    ) {
      const expiry = z.iso
        .datetime({ offset: true })
        .safeParse(p.date_of_expiration);
      if (!expiry.success) throw bad();
      const base64 = method.qr_code_base64;
      if (
        base64 &&
        (typeof base64 !== "string" ||
          base64.length > 800000 ||
          !/^iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(base64))
      )
        throw bad();
      // Sandbox can return an empty image. Copia e Cola remains available.
      qr = {
        qrCode: method.qr_code,
        qrBase64: base64 || null,
        expiresAt: expiry.data,
      };
    }
  }
  return {
    payment: {
      providerPaymentId: id,
      externalReference:
        typeof raw.external_reference === "string"
          ? raw.external_reference.slice(0, 200)
          : "",
      collectorId: config.collectorId,
      mode: config.mode,
      amountCents,
      feeCents: null,
      refundedCents,
      currency: "BRL",
      status,
      paidOn,
      providerUpdatedAt: updated,
      refunds,
      refundsComplete,
    },
    qr,
  };
}
export async function fetchVerifiedTransaction(
  config: BillingConfig,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  return orderIdPattern.test(id)
    ? (await fetchVerifiedOrder(config, id, fetcher)).payment
    : fetchVerifiedPayment(config, id, fetcher);
}
