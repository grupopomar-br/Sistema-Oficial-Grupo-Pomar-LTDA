import { authorizedOwner } from "@/lib/server/access";
import { readNotifications } from "@/lib/server/notifications";
import { json, errorResponse } from "@/lib/server/http";
export async function GET() {
  try {
    const { supabase } = await authorizedOwner(false);
    return json(await readNotifications(supabase));
  } catch (error) {
    return errorResponse(error);
  }
}
