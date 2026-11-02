export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const SENSITIVE_MFA_MAX_SECONDS = 300;
export type SessionPolicy = {
  idleTimeoutMs: number;
  sensitiveMfaSeconds: number;
};
export const LEGACY_SESSION_POLICY: SessionPolicy = {
  idleTimeoutMs: IDLE_TIMEOUT_MS,
  sensitiveMfaSeconds: SENSITIVE_MFA_MAX_SECONDS,
};
export function sessionPolicy(value: unknown): SessionPolicy | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.idleTimeoutMs === 3600000 && v.sensitiveMfaSeconds === 1800)
    return { idleTimeoutMs: 3600000, sensitiveMfaSeconds: 1800 };
  if (
    v.idleTimeoutMs === IDLE_TIMEOUT_MS &&
    v.sensitiveMfaSeconds === SENSITIVE_MFA_MAX_SECONDS
  )
    return { ...LEGACY_SESSION_POLICY };
  return null;
}
export async function touchOwnerSession(
  rpc: (
    name: "pomar_touch_session_v2" | "pomar_touch_session",
  ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>,
) {
  const result = await rpc("pomar_touch_session_v2");
  if (result.error?.code === "PGRST202") {
    const legacy = await rpc("pomar_touch_session");
    return {
      status: legacy.data,
      error: legacy.error,
      policy: LEGACY_SESSION_POLICY,
    };
  }
  const value = result.data as { status?: unknown; policy?: unknown } | null;
  return {
    status: value?.status,
    error: result.error,
    policy: sessionPolicy(value?.policy),
  };
}
export function hasRecentMfa(
  claims: Record<string, unknown>,
  now = Date.now(),
  maxSeconds = SENSITIVE_MFA_MAX_SECONDS,
): boolean {
  if (claims.aal !== "aal2" || !Array.isArray(claims.amr)) return false;
  const current = Math.floor(now / 1000);
  return claims.amr.some(
    (v) =>
      v &&
      typeof v === "object" &&
      v.method === "totp" &&
      Number.isSafeInteger(v.timestamp) &&
      v.timestamp >= current - maxSeconds &&
      v.timestamp <= current + 30,
  );
}
