import "server-only";
import { hasRecentMfa } from "../domain/security";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../supabase/server";
import { parseEnvironment } from "../config/environment";
export class AccessError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 403, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "AccessError";
  }
}
export async function verifiedOwner(readOnlyCookies = true) {
  const config = parseEnvironment(process.env);
  const supabase = await createSupabaseServerClient(readOnlyCookies);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user)
    throw new AccessError("Sua sessão expirou. Entre novamente.", 401);
  if (data.user.id !== config.ownerUserId)
    throw new AccessError(
      "Este usuário não está autorizado a acessar a Central.",
      403,
    );
  const claims = await supabase.auth.getClaims();
  if (
    claims.error ||
    !claims.data?.claims ||
    claims.data.claims.sub !== data.user.id
  )
    throw new AccessError("Não foi possível validar a sessão.", 401);
  return { config, supabase, user: data.user, claims: claims.data.claims };
}
export async function authorizedOwner(readOnlyCookies = true) {
  const owner = await verifiedOwner(readOnlyCookies);
  if (owner.claims.aal !== "aal2")
    throw new AccessError("Conclua a verificação com seu autenticador.", 403);
  const session = await owner.supabase.rpc("pomar_touch_session");
  if (session.error)
    throw new AccessError(
      "O banco precisa das migrações de segurança desta versão.",
      503,
    );
  if (session.data === "needs_mfa")
    throw new AccessError("Confirme novamente o código do autenticador.", 403);
  if (session.data !== "granted")
    throw new AccessError(
      "Sua sessão expirou ou foi bloqueada por inatividade. Entre novamente.",
      401,
    );
  // The guarded touch already authorizes this session. Each data RPC/table read
  // also enforces RLS, so a second permission round trip adds no protection.
  return owner;
}
export async function ownerPage(requireMfa = true, next = "/central") {
  try {
    return requireMfa ? await authorizedOwner() : await verifiedOwner();
  } catch (error) {
    if (error instanceof AccessError && error.status === 401)
      redirect("/entrar");
    if (error instanceof AccessError && error.message.includes("autenticador"))
      redirect(`/seguranca?next=${encodeURIComponent(next)}`);
    throw error;
  }
}
export function requireOrigin(request: Request, appUrl: string) {
  if (request.headers.get("origin") !== new URL(appUrl).origin)
    throw new AccessError("Origem da requisição não autorizada.", 403);
}

export async function sensitiveOwner(readOnlyCookies = false) {
  const owner = await authorizedOwner(readOnlyCookies);
  if (!hasRecentMfa(owner.claims))
    throw new AccessError(
      "Confirme novamente o código do autenticador antes desta operação.",
      403,
      "MFA_REQUIRED",
    );
  return owner;
}
