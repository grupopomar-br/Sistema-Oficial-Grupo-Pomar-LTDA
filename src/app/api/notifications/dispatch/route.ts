import { createHash, timingSafeEqual } from "node:crypto";
import { parseNotificationConfig } from "@/lib/config/notifications";
import { dispatchNotifications } from "@/lib/server/notification-worker";
import { json } from "@/lib/server/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const config = parseNotificationConfig(process.env);
    if (!config.enabled) return json({ error: "Serviço indisponível." }, 503);
    const provided = request.headers.get("authorization") ?? "";
    const hash = (s: string) => createHash("sha256").update(s).digest();
    if (!timingSafeEqual(hash(provided), hash(`Bearer ${config.secret}`)))
      return json({ error: "Acesso não autorizado." }, 401);
    if (new URL(request.url).origin !== new URL(config.appUrl).origin)
      return json({ error: "Destino não autorizado." }, 403);
    return json(await dispatchNotifications(config));
  } catch {
    return json(
      { error: "Não foi possível concluir o envio de notificações." },
      503,
    );
  }
}
