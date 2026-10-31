import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { parseBillingConfig, type BillingConfig } from "../config/billing";
import { billingDatabase, applyVerifiedPayment } from "./billing-worker";
import {
  createPixOrder,
  fetchVerifiedOrder,
  fetchVerifiedTransaction,
  orderIdPattern,
} from "../billing/orders";
import {
  checkoutTokenPattern,
  type PixPayer,
  type PixCheckout,
} from "../billing/pix-contract";

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function pixWorkerReady(config: BillingConfig) {
  const sql = billingDatabase(config);
  const rows =
    await sql`select pomar_private.pix_checkout_capabilities() as version`;
  return rows[0]?.version === 2;
}
export async function attachPixCheckout(
  config: BillingConfig,
  chargeId: string,
) {
  const token = randomBytes(32).toString("base64url");
  const url = new URL(`/pagar/${token}`, config.appUrl).toString();
  const sql = billingDatabase(config);
  await sql`select pomar_private.pix_checkout_create(${chargeId}::uuid,${hash(token)},${url},${config.collectorId},${config.mode})`;
}
async function read(config: BillingConfig, token: string) {
  if (!checkoutTokenPattern.test(token)) return null;
  const sql = billingDatabase(config);
  const rows =
    await sql`select pomar_private.pix_checkout_read(${hash(token)}) as checkout`;
  const row = rows[0]?.checkout;
  return row?.mode === config.mode && row?.collector_id === config.collectorId
    ? row
    : null;
}
// Deliberately projects a small payment view, never the operational workspace or payer PII.
function publicView(row: Awaited<ReturnType<typeof read>>): PixCheckout | null {
  if (!row) return null;
  return {
    status: row.status,
    amountCents: Number(row.amount_cents),
    description: "Serviços Grupo Pomar",
    reference: `POM-${String(row.charge_id).slice(0, 8).toUpperCase()}`,
    expiresAt: row.expires_at,
    isTest: row.mode === "test",
    qrCode: row.status === "pending" ? row.qr_code : null,
    qrBase64: row.status === "pending" ? row.qr_base64 : null,
  };
}
export async function readPixCheckout(
  token: string,
): Promise<PixCheckout | null> {
  const config = parseBillingConfig(process.env);
  if (!config.enabled) return null;
  return publicView(await read(config, token));
}
export async function generatePix(
  config: BillingConfig,
  token: string,
  payer: PixPayer,
) {
  if (!checkoutTokenPattern.test(token)) return null;
  const sql = billingDatabase(config);
  const rows =
    await sql`select pomar_private.pix_checkout_begin(${hash(token)},${JSON.stringify(payer)}::jsonb) as checkout`;
  const row = rows[0]?.checkout;
  if (row?.create === true) {
    if (row.mode !== config.mode || row.collector_id !== config.collectorId)
      throw new Error("Ambiente divergente.");
    const charge = {
      id: row.charge_id,
      amountCents: Number(row.amount_cents),
      expiresAt: row.expires_at,
      mode: row.mode,
      expirationSeconds: Number(row.expiration_seconds),
      createdAt: row.created_at,
    };
    const result = await createPixOrder(config, charge, row.payer);
    await sql`select pomar_private.pix_checkout_order(${hash(token)},${result.orderId})`;
    return refreshPix(config, token);
  }
  return publicView(await read(config, token));
}
export async function refreshPix(config: BillingConfig, token: string) {
  if (!checkoutTokenPattern.test(token)) return null;
  const sql = billingDatabase(config);
  const rows =
    await sql`select pomar_private.pix_checkout_refresh(${hash(token)}) as payment_id`;
  const id = rows[0]?.payment_id;
  if (id) {
    if (orderIdPattern.test(id)) {
      const result = await fetchVerifiedOrder(config, id);
      const current = await read(config, token);
      if (
        !current ||
        result.payment.externalReference !== current.charge_id ||
        result.payment.amountCents !== Number(current.amount_cents)
      )
        throw new Error("A order diverge desta cobrança.");
      if (result.qr)
        await sql`select pomar_private.pix_checkout_order_qr(${hash(token)},${id},${result.qr.qrCode},${result.qr.qrBase64},${result.qr.expiresAt}::timestamptz)`;
      await applyVerifiedPayment(config, result.payment);
    } else
      await applyVerifiedPayment(
        config,
        await fetchVerifiedTransaction(config, id),
      );
  }
  return publicView(await read(config, token));
}
