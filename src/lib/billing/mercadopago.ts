import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { decimalCents, isSafeCheckoutUrl } from "./safety.ts";
import { todayDate } from "../domain/dates.ts";
import type { BillingConfig } from "../config/billing.ts";
export class ProviderError extends Error {
  definitive: boolean;
  constructor(
    message = "Não foi possível confirmar a operação com o provedor.",
    definitive = false,
  ) {
    super(message);
    this.definitive = definitive;
  }
}
const opaqueId = (value: unknown) => {
  const id = String(value ?? "");
  if (!/^\d{1,40}$/.test(id))
    throw new ProviderError("O provedor retornou um identificador inválido.");
  return id;
};
export function verifyMercadoPagoSignature(
  request: Request,
  secret: string,
  now = Date.now(),
): string {
  const url = new URL(request.url),
    ids = url.searchParams.getAll("data.id");
  if (ids.length !== 1 || !/^\d{1,30}$/.test(ids[0]))
    throw new ProviderError("Notificação inválida.", true);
  const requestId = request.headers.get("x-request-id") ?? "",
    signature = request.headers.get("x-signature") ?? "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(requestId) || signature.length > 300)
    throw new ProviderError("Assinatura inválida.", true);
  const pieces = signature.split(",").map((p) => p.trim().split("="));
  if (pieces.length !== 2 || new Set(pieces.map((p) => p[0])).size !== 2)
    throw new ProviderError("Assinatura inválida.", true);
  const ts = pieces.find((p) => p[0] === "ts")?.[1],
    mac = pieces.find((p) => p[0] === "v1")?.[1];
  if (
    !ts ||
    !/^\d{10}(?:\d{3})?$/.test(ts) ||
    !mac ||
    !/^\w{64}$/.test(mac) ||
    !/^[a-fA-F0-9]{64}$/.test(mac)
  )
    throw new ProviderError("Assinatura inválida.", true);
  const timestamp = Number(ts) * (ts.length === 10 ? 1000 : 1);
  if (timestamp > now + 300000)
    throw new ProviderError("Assinatura inválida.", true);
  const expected = createHmac("sha256", secret)
    .update(`id:${ids[0]};request-id:${requestId};ts:${ts};`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(mac, "hex")))
    throw new ProviderError("Assinatura inválida.", true);
  return ids[0];
}
async function providerRequest(
  config: BillingConfig,
  path: string,
  method = "GET",
  body?: unknown,
  fetcher: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetcher(`https://api.mercadopago.com${path}`, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ProviderError();
  }
  if (!response.ok)
    throw new ProviderError(
      "O provedor recusou ou não confirmou a operação.",
      response.status >= 400 &&
        response.status < 500 &&
        ![408, 429].includes(response.status),
    );
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new ProviderError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ProviderError();
  }
}
export type PreparedCharge = {
  id: string;
  amountCents: number;
  expiresAt: string;
  mode: "test" | "live";
};
export async function createPreference(
  config: BillingConfig,
  charge: PreparedCharge,
  fetcher: typeof fetch = fetch,
) {
  if (charge.mode !== config.mode)
    throw new ProviderError("Ambiente de cobrança divergente.", true);
  const callback = new URL("/pagamento/retorno", config.appUrl).toString();
  const payload = {
    items: [
      {
        id: charge.id,
        title: "Serviços Grupo Pomar",
        quantity: 1,
        currency_id: "BRL",
        unit_price: Number((charge.amountCents / 100).toFixed(2)),
      },
    ],
    external_reference: charge.id,
    expires: true,
    expiration_date_to: charge.expiresAt,
    notification_url: new URL(
      "/api/webhooks/mercadopago",
      config.appUrl,
    ).toString(),
    back_urls: { success: callback, pending: callback, failure: callback },
    payment_methods: { installments: 1 },
    statement_descriptor: "GRUPO POMAR",
  };
  const result = await providerRequest(
    config,
    "/checkout/preferences",
    "POST",
    payload,
    fetcher,
  );
  const url =
    config.mode === "test" ? result.sandbox_init_point : result.init_point;
  if (
    String(result.collector_id) !== config.collectorId ||
    result.external_reference !== charge.id ||
    typeof result.id !== "string" ||
    !isSafeCheckoutUrl(url) ||
    new URL(url).searchParams.get("pref_id") !== result.id
  )
    throw new ProviderError(
      "Os dados de cobrança retornados não passaram na validação.",
    );
  if (
    result.expires !== true ||
    new Date(result.expiration_date_to).valueOf() !==
      new Date(charge.expiresAt).valueOf()
  )
    throw new ProviderError("A validade do checkout não foi confirmada.");
  return { preferenceId: result.id, checkoutUrl: url };
}
const statuses = new Set([
  "pending",
  "in_process",
  "authorized",
  "approved",
  "rejected",
  "cancelled",
  "in_mediation",
  "refunded",
  "charged_back",
]);
export type VerifiedRefund = {
  providerRefundId: string;
  amountCents: number;
  occurredOn: string;
};
export type VerifiedPayment = {
  providerPaymentId: string;
  externalReference: string;
  collectorId: string;
  mode: "test" | "live";
  amountCents: number;
  feeCents: number | null;
  refundedCents: number;
  currency: "BRL";
  status: string;
  paidOn: string | null;
  providerUpdatedAt: string;
  refunds: VerifiedRefund[];
  refundsComplete: boolean;
};
export async function fetchVerifiedPayment(
  config: BillingConfig,
  paymentId: string,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedPayment> {
  if (!/^\d{1,30}$/.test(paymentId))
    throw new ProviderError("Identificador de pagamento inválido.", true);
  const raw = await providerRequest(
    config,
    `/v1/payments/${paymentId}`,
    "GET",
    undefined,
    fetcher,
  );
  if (
    opaqueId(raw.id) !== paymentId ||
    String(raw.collector_id) !== config.collectorId ||
    raw.currency_id !== "BRL" ||
    typeof raw.live_mode !== "boolean" ||
    raw.live_mode !== (config.mode === "live")
  )
    throw new ProviderError(
      "O pagamento não pertence à conta, moeda ou ambiente esperados.",
      true,
    );
  const amountCents = decimalCents(raw.transaction_amount),
    refundedCents = decimalCents(raw.transaction_amount_refunded ?? 0);
  if (amountCents <= 0 || refundedCents > amountCents)
    throw new ProviderError("Valor de pagamento inconsistente.", true);
  const updated = z.iso
    .datetime({ offset: true })
    .safeParse(raw.date_last_updated);
  if (
    !updated.success ||
    new Date(updated.data).valueOf() > Date.now() + 300000
  )
    throw new ProviderError("Data do provedor inválida.");
  let paidOn: string | null = null;
  if (raw.date_approved) {
    const date = z.iso.datetime({ offset: true }).safeParse(raw.date_approved);
    if (!date.success) throw new ProviderError();
    paidOn = todayDate(new Date(date.data));
    if (paidOn > todayDate()) throw new ProviderError();
  }
  let feeCents: number | null = null;
  try {
    if (Array.isArray(raw.fee_details))
      feeCents = raw.fee_details.reduce(
        (sum: number, item: { amount: unknown }) =>
          sum + decimalCents(item.amount),
        0,
      );
  } catch {
    feeCents = null;
  }
  if (
    feeCents !== null &&
    (!Number.isSafeInteger(feeCents) ||
      feeCents < 0 ||
      feeCents > 100_000_000_000)
  )
    feeCents = null;
  const refunds: VerifiedRefund[] = [];
  let refundsComplete = refundedCents === 0;
  if (refundedCents > 0) {
    const list = await providerRequest(
      config,
      `/v1/payments/${paymentId}/refunds`,
      "GET",
      undefined,
      fetcher,
    );
    if (!Array.isArray(list) || list.length > 500) throw new ProviderError();
    for (const item of list) {
      if (item.status !== "approved") continue;
      if (opaqueId(item.payment_id) !== paymentId) throw new ProviderError();
      const at = z.iso.datetime({ offset: true }).parse(item.date_created);
      const amount = decimalCents(item.amount);
      if (amount <= 0) throw new ProviderError();
      refunds.push({
        providerRefundId: opaqueId(item.id),
        amountCents: amount,
        occurredOn: todayDate(new Date(at)),
      });
    }
    refundsComplete =
      refunds.reduce((sum, r) => sum + r.amountCents, 0) === refundedCents;
  }
  return {
    providerPaymentId: paymentId,
    externalReference:
      typeof raw.external_reference === "string"
        ? raw.external_reference.slice(0, 200)
        : "",
    collectorId: config.collectorId,
    mode: config.mode,
    amountCents,
    feeCents,
    refundedCents,
    currency: "BRL",
    status: statuses.has(raw.status) ? raw.status : "unknown",
    paidOn,
    providerUpdatedAt: updated.data,
    refunds,
    refundsComplete,
  };
}
