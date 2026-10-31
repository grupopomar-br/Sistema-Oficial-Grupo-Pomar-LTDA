import { ConfigurationError, parseEnvironment } from "./environment.ts";
export type BillingConfig = {
  enabled: true;
  mode: "test" | "live";
  accessToken: string;
  webhookSecret: string;
  collectorId: string;
  databaseUrl: string;
  databaseCa?: string;
  appUrl: string;
};
export function parseBillingConfig(
  env: Record<string, string | undefined>,
): BillingConfig | { enabled: false } {
  if (env.POMAR_BILLING_ENABLED !== "true") return { enabled: false };
  const app = parseEnvironment(env);
  const invalid: string[] = [];
  const mode = env.POMAR_PAYMENT_MODE;
  if (!["test", "live"].includes(mode ?? ""))
    invalid.push("POMAR_PAYMENT_MODE");
  if (!app.appUrl.startsWith("https://")) invalid.push("NEXT_PUBLIC_APP_URL");
  if (
    mode === "live" &&
    (app.environment !== "production" ||
      env.POMAR_BILLING_LIVE_CONFIRMED !== "yes")
  )
    invalid.push("POMAR_BILLING_LIVE_CONFIRMED");
  const accessToken = env.POMAR_MP_ACCESS_TOKEN ?? "",
    webhookSecret = env.POMAR_MP_WEBHOOK_SECRET ?? "",
    collectorId = env.POMAR_MP_COLLECTOR_ID ?? "",
    databaseUrl = env.POMAR_BILLING_DATABASE_URL ?? "";
  if (accessToken.length < 20 || /[\r\n]/.test(accessToken))
    invalid.push("POMAR_MP_ACCESS_TOKEN");
  if (webhookSecret.length < 32 || /[\r\n]/.test(webhookSecret))
    invalid.push("POMAR_MP_WEBHOOK_SECRET");
  if (!/^\d{1,30}$/.test(collectorId)) invalid.push("POMAR_MP_COLLECTOR_ID");
  try {
    const db = new URL(databaseUrl);
    const project = new URL(app.supabaseUrl).hostname.split(".")[0];
    if (
      !["postgres:", "postgresql:"].includes(db.protocol) ||
      !db.hostname.endsWith(".pooler.supabase.com") ||
      !["5432", "6543"].includes(db.port) ||
      decodeURIComponent(db.username) !== `pomar_billing_worker.${project}` ||
      !db.password ||
      db.pathname !== "/postgres" ||
      db.search ||
      db.hash
    )
      invalid.push("POMAR_BILLING_DATABASE_URL");
  } catch {
    invalid.push("POMAR_BILLING_DATABASE_URL");
  }
  let databaseCa: string | undefined;
  if (env.POMAR_BILLING_DB_CA_BASE64) {
    databaseCa = Buffer.from(env.POMAR_BILLING_DB_CA_BASE64, "base64").toString(
      "utf8",
    );
    if (
      databaseCa.length > 30000 ||
      !databaseCa.includes("-----BEGIN CERTIFICATE-----")
    )
      invalid.push("POMAR_BILLING_DB_CA_BASE64");
  }
  if (invalid.length) throw new ConfigurationError(invalid);
  return {
    enabled: true,
    mode: mode as "test" | "live",
    accessToken,
    webhookSecret,
    collectorId,
    databaseUrl,
    databaseCa,
    appUrl: app.appUrl,
  };
}
