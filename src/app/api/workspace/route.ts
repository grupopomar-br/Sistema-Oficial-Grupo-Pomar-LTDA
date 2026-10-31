import { authorizedOwner } from "@/lib/server/access";
import { readWorkspace } from "@/lib/server/workspace";
import { json, errorResponse } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { supabase } = await authorizedOwner(false);
    return json({ workspace: await readWorkspace(supabase) });
  } catch (error) {
    return errorResponse(error);
  }
}
