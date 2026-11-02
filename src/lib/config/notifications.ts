import { createECDH } from "node:crypto";
import { ConfigurationError, parseEnvironment } from "./environment.ts";
export function parseNotificationConfig(
  env: Record<string, string | undefined>,
) {
  if (env.POMAR_NOTIFICATIONS_ENABLED !== "true")
    return { enabled: false } as const;
  const app = parseEnvironment(env),
    invalid: string[] = [];
  const databaseUrl = env.POMAR_NOTIFICATIONS_DATABASE_URL ?? "",
    publicKey = env.POMAR_VAPID_PUBLIC_KEY ?? "",
    privateKey = env.POMAR_VAPID_PRIVATE_KEY ?? "",
    secret = env.POMAR_NOTIFICATIONS_CRON_SECRET ?? "";
  if (!app.appUrl.startsWith("https://")) invalid.push("NEXT_PUBLIC_APP_URL");
  try {
    const db = new URL(databaseUrl),
      project = new URL(app.supabaseUrl).hostname.split(".")[0];
    if (
      !["postgres:", "postgresql:"].includes(db.protocol) ||
      !db.hostname.endsWith(".pooler.supabase.com") ||
      !["5432", "6543"].includes(db.port) ||
      decodeURIComponent(db.username) !==
        `pomar_notification_worker.${project}` ||
      !db.password ||
      db.pathname !== "/postgres" ||
      db.search ||
      db.hash
    )
      invalid.push("POMAR_NOTIFICATIONS_DATABASE_URL");
  } catch {
    invalid.push("POMAR_NOTIFICATIONS_DATABASE_URL");
  }
  try {
    const ec = createECDH("prime256v1");
    ec.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(privateKey) ||
      !/^[A-Za-z0-9_-]{87}$/.test(publicKey) ||
      ec.getPublicKey().toString("base64url") !== publicKey
    )
      throw Error();
  } catch {
    invalid.push("POMAR_VAPID_KEYS");
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret))
    invalid.push("POMAR_NOTIFICATIONS_CRON_SECRET");
  let databaseCa: string | undefined;
  const ca =
    env.POMAR_NOTIFICATIONS_DB_CA_BASE64 ?? env.POMAR_BILLING_DB_CA_BASE64;
  if (ca) {
    databaseCa = Buffer.from(ca, "base64").toString("utf8");
    if (
      databaseCa.length > 30000 ||
      !databaseCa.includes("-----BEGIN CERTIFICATE-----")
    )
      invalid.push("POMAR_NOTIFICATIONS_DB_CA_BASE64");
  }
  if (invalid.length) throw new ConfigurationError(invalid);
  return {
    enabled: true,
    databaseUrl,
    databaseCa,
    publicKey,
    privateKey,
    secret,
    appUrl: app.appUrl,
  } as const;
}
export type NotificationConfig = Extract<
  ReturnType<typeof parseNotificationConfig>,
  { enabled: true }
>;
