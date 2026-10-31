import "server-only";
import postgres from "postgres";
import type { BillingConfig } from "../config/billing";
import type { VerifiedPayment } from "../billing/mercadopago";
import { databaseCommand } from "../domain/transport";
let pool: { key: string; sql: ReturnType<typeof postgres> } | undefined;
function database(config: BillingConfig) {
  const key = config.databaseUrl + "\n" + (config.databaseCa ?? "");
  if (pool?.key !== key) {
    if (pool) void pool.sql.end({ timeout: 5 });
    pool = {
      key,
      sql: postgres(config.databaseUrl, {
        max: 1,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 20,
        max_lifetime: 300,
        ssl: {
          rejectUnauthorized: true,
          ...(config.databaseCa ? { ca: config.databaseCa } : {}),
        },
        onnotice: () => {},
      }),
    };
  }
  return pool.sql;
}
export async function attachPreference(
  config: BillingConfig,
  id: string,
  preference: { preferenceId: string; checkoutUrl: string },
) {
  const sql = database(config);
  await sql`select public.pomar_billing_attach(${id}::uuid,${preference.preferenceId},${preference.checkoutUrl},${config.collectorId},${config.mode})`;
}
export async function markCreationFailure(
  config: BillingConfig,
  id: string,
  definitive: boolean,
) {
  const sql = database(config);
  await sql`select public.pomar_billing_creation_failed(${id}::uuid,${definitive})`;
}
export async function applyVerifiedPayment(
  config: BillingConfig,
  payment: VerifiedPayment,
) {
  const sql = database(config);
  const result =
    await sql`select public.pomar_billing_apply_payment(${JSON.stringify(databaseCommand(payment))}::jsonb) as result`;
  return result[0]?.result;
}

export async function billingWorkerReady(
  config: BillingConfig,
  ownerId: string,
) {
  const sql = database(config);
  const rows = await sql`select public.pomar_billing_worker_status() as config`;
  const row = rows[0]?.config;
  return (
    row?.enabled === true &&
    row?.owner_id === ownerId &&
    row?.collector_id === config.collectorId &&
    row?.mode === config.mode
  );
}
