import type postgres from "postgres";
import type { PixPayer } from "./pix-contract.ts";
import type { VerifiedPayment } from "./mercadopago.ts";
import { databaseCommand } from "../domain/transport.ts";

type WorkerSql = ReturnType<typeof postgres>;

export async function beginPixAttempt(
  sql: WorkerSql,
  tokenHash: string,
  payer: PixPayer,
) {
  // Postgres.js serializes JSONB itself. Pre-stringifying produces a JSON string,
  // which the database correctly rejects instead of accepting as a payer object.
  const rows =
    await sql`select pomar_private.pix_checkout_begin(${tokenHash},${sql.json(payer)}::jsonb) as checkout`;
  return rows[0]?.checkout;
}

export async function applyPaymentEvent(
  sql: WorkerSql,
  payment: VerifiedPayment & { ownerConfirmedBy?: string },
) {
  const event = databaseCommand(payment) as postgres.JSONValue;
  const rows =
    await sql`select public.pomar_billing_apply_payment(${sql.json(event)}::jsonb) as result`;
  return rows[0]?.result;
}
