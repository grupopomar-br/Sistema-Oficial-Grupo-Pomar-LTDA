import { ConfigurationError, parseEnvironment } from "./environment.ts";

type Env = Record<string, string | undefined>;
const accountPattern = /^[a-f0-9]{32}$/i;

export function mediaR2Origin(env: Env) {
  const account = env.POMAR_R2_ACCOUNT_ID ?? "";
  return env.POMAR_MEDIA_ENABLED === "true" && accountPattern.test(account)
    ? `https://${account.toLowerCase()}.r2.cloudflarestorage.com`
    : "";
}

export function parseMediaConfig(env: Env) {
  if (env.POMAR_MEDIA_ENABLED !== "true") return { enabled: false } as const;
  const app = parseEnvironment(env);
  const origin = mediaR2Origin(env);
  const bucket = env.POMAR_R2_MEDIA_BUCKET ?? "";
  const accessKeyId = env.POMAR_R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = env.POMAR_R2_SECRET_ACCESS_KEY ?? "";
  const databaseUrl = env.POMAR_MEDIA_DATABASE_URL ?? "";
  const invalid: string[] = [];
  if (!origin) invalid.push("POMAR_R2_ACCOUNT_ID");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
    invalid.push("POMAR_R2_MEDIA_BUCKET");
  if (!accountPattern.test(accessKeyId)) invalid.push("POMAR_R2_ACCESS_KEY_ID");
  if (!/^[a-f0-9]{64}$/i.test(secretAccessKey))
    invalid.push("POMAR_R2_SECRET_ACCESS_KEY");
  if (!app.appUrl.startsWith("https://")) invalid.push("NEXT_PUBLIC_APP_URL");
  try {
    const db = new URL(databaseUrl);
    const project = new URL(app.supabaseUrl).hostname.split(".")[0];
    if (
      !["postgres:", "postgresql:"].includes(db.protocol) ||
      !db.hostname.endsWith(".pooler.supabase.com") ||
      !["5432", "6543"].includes(db.port) ||
      decodeURIComponent(db.username) !== `pomar_media_worker.${project}` ||
      !db.password ||
      db.pathname !== "/postgres" ||
      db.search ||
      db.hash
    )
      invalid.push("POMAR_MEDIA_DATABASE_URL");
  } catch {
    invalid.push("POMAR_MEDIA_DATABASE_URL");
  }
  let databaseCa: string | undefined;
  const ca = env.POMAR_MEDIA_DB_CA_BASE64 ?? env.POMAR_BILLING_DB_CA_BASE64;
  if (ca) {
    databaseCa = Buffer.from(ca, "base64").toString("utf8");
    if (
      databaseCa.length > 30000 ||
      !databaseCa.includes("-----BEGIN CERTIFICATE-----")
    )
      invalid.push("POMAR_MEDIA_DB_CA_BASE64");
  }
  if (invalid.length) throw new ConfigurationError(invalid);
  return {
    enabled: true,
    appUrl: app.appUrl,
    origin,
    bucket,
    accessKeyId,
    secretAccessKey,
    databaseUrl,
    databaseCa,
  } as const;
}

export type MediaConfig = Extract<
  ReturnType<typeof parseMediaConfig>,
  { enabled: true }
>;
