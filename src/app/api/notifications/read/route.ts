import { z } from "zod";
import { authorizedOwner, requireOrigin } from "@/lib/server/access";
import { readNotifications } from "@/lib/server/notifications";
import { databaseFailure } from "@/lib/server/workspace";
import { boundedJson, json, errorResponse } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    const { supabase, config, user } = await authorizedOwner(false);
    requireOrigin(request, config.appUrl);
    const input = z
      .strictObject({ id: z.uuid().nullable() })
      .parse(await boundedJson(request, 2048));
    let query = supabase
      .from("pomar_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("owner_id", user.id)
      .is("read_at", null);
    if (input.id) query = query.eq("id", input.id);
    const { error } = await query;
    if (error) throw databaseFailure(error);
    return json(await readNotifications(supabase));
  } catch (error) {
    return errorResponse(error);
  }
}
