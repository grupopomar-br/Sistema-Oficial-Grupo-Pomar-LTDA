export type Environment = "development" | "staging" | "production";
export type AppConfig = {
  supabaseUrl: string;
  publishableKey: string;
  appUrl: string;
  environment: Environment;
  ownerUserId: string;
};
export class ConfigurationError extends Error {
  fields: readonly string[];
  constructor(fields: readonly string[]) {
    super(`Configuração ausente ou inválida: ${fields.join(", ")}`);
    this.name = "ConfigurationError";
    this.fields = fields;
  }
}
function validOrigin(value: string, allowLocal: boolean): boolean {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      ((url.protocol === "https:" && !local) ||
        (allowLocal && local && ["http:", "https:"].includes(url.protocol))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}
export function parsePublicSupabaseEnvironment(
  env: Record<string, string | undefined>,
) {
  const fields: string[] = [];
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!validOrigin(supabaseUrl, env.NODE_ENV === "development"))
    fields.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(publishableKey))
    fields.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (fields.length) throw new ConfigurationError(fields);
  return { supabaseUrl, publishableKey };
}
export function parseEnvironment(
  env: Record<string, string | undefined>,
): AppConfig {
  const fields: string[] = [];
  const environment = env.POMAR_ENVIRONMENT;
  if (
    !["development", "staging", "production"].includes(environment ?? "") ||
    (env.NODE_ENV === "production" && environment === "development")
  )
    fields.push("POMAR_ENVIRONMENT");
  let publicConfig = { supabaseUrl: "", publishableKey: "" };
  try {
    publicConfig = parsePublicSupabaseEnvironment({
      ...env,
      NODE_ENV: environment === "development" ? "development" : "production",
    });
  } catch (error) {
    if (error instanceof ConfigurationError) fields.push(...error.fields);
    else throw error;
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  const ownerUserId = env.POMAR_OWNER_USER_ID ?? "";
  if (!validOrigin(appUrl, environment === "development"))
    fields.push("NEXT_PUBLIC_APP_URL");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      ownerUserId,
    )
  )
    fields.push("POMAR_OWNER_USER_ID");
  if (fields.length) throw new ConfigurationError(fields);
  return {
    ...publicConfig,
    appUrl,
    environment: environment as Environment,
    ownerUserId,
  };
}
export function localModeAllowed(
  env: Record<string, string | undefined>,
): boolean {
  return (
    env.NODE_ENV === "development" && env.POMAR_ENVIRONMENT !== "production"
  );
}
export function hasCloudConfiguration(
  env: Record<string, string | undefined>,
): boolean {
  return !!(
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.POMAR_OWNER_USER_ID
  );
}
export function safeNext(value: unknown): "/central" | "/nova-senha" {
  return value === "/nova-senha" ? "/nova-senha" : "/central";
}
