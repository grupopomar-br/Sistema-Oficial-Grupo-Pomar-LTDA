export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const SENSITIVE_MFA_MAX_SECONDS = 300;
export function hasRecentMfa(
  claims: Record<string, unknown>,
  now = Date.now(),
): boolean {
  if (claims.aal !== "aal2" || !Array.isArray(claims.amr)) return false;
  const current = Math.floor(now / 1000);
  return claims.amr.some(
    (v) =>
      v &&
      typeof v === "object" &&
      v.method === "totp" &&
      Number.isSafeInteger(v.timestamp) &&
      v.timestamp >= current - SENSITIVE_MFA_MAX_SECONDS &&
      v.timestamp <= current + 30,
  );
}
