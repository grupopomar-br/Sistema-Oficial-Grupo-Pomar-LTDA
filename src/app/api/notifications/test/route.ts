import { z } from "zod";
import {
  authorizedOwner,
  requireOrigin,
  AccessError,
} from "@/lib/server/access";
import { parseNotificationConfig } from "@/lib/config/notifications";
import { safePushEndpoint } from "@/lib/notifications/contracts";
import { boundedJson, json, errorResponse } from "@/lib/server/http";
import { databaseFailure } from "@/lib/server/workspace";
export async function POST(request: Request) {
  try {
    const { supabase, config } = await authorizedOwner(false);
    requireOrigin(request, config.appUrl);
    if (!parseNotificationConfig(process.env).enabled)
      throw new AccessError("Avisos no aparelho aguardam configuração.", 503);
    const { endpoint } = z
      .strictObject({ endpoint: z.string().refine(safePushEndpoint) })
      .parse(await boundedJson(request, 4096));
    const { error } = await supabase.rpc("pomar_notification_test", {
      p_endpoint: endpoint,
    });
    if (error) throw databaseFailure(error);
    return json({ queued: true });
  } catch (error) {
    return errorResponse(error);
  }
}
