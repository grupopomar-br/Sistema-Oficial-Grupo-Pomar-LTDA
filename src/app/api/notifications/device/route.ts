import { z } from "zod";
import {
  authorizedOwner,
  requireOrigin,
  AccessError,
} from "@/lib/server/access";
import { parseNotificationConfig } from "@/lib/config/notifications";
import { subscriptionSchema } from "@/lib/notifications/contracts";
import { databaseFailure } from "@/lib/server/workspace";
import { boundedJson, json, errorResponse } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    const { supabase, config } = await authorizedOwner(false);
    requireOrigin(request, config.appUrl);
    const input = z
      .strictObject({ enabled: z.boolean(), subscription: subscriptionSchema })
      .parse(await boundedJson(request, 8192));
    if (input.enabled && !parseNotificationConfig(process.env).enabled)
      throw new AccessError(
        "Os avisos no aparelho ainda aguardam configuração.",
        503,
      );
    const { error } = await supabase.rpc("pomar_push_device", {
      p_subscription: input.subscription,
      p_enabled: input.enabled,
    });
    if (error) throw databaseFailure(error);
    return json({ saved: true });
  } catch (error) {
    return errorResponse(error);
  }
}
