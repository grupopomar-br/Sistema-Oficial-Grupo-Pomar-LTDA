import { parseEnvironment } from "@/lib/config/environment";
import { authorizedOwner, requireOrigin } from "@/lib/server/access";
import {
  databaseCommand,
  databaseFailure,
  readWorkspace,
} from "@/lib/server/workspace";
import { json, errorResponse, boundedJson } from "@/lib/server/http";
import { envelopeSchema } from "@/lib/domain/model";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const config = parseEnvironment(process.env);
    requireOrigin(request, config.appUrl);
    const { supabase } = await authorizedOwner(false);
    const { commandId, command } = envelopeSchema.parse(
      await boundedJson(request),
    );
    const { error } = await supabase.rpc("pomar_command", {
      p_key: commandId,
      p_command: databaseCommand(command),
    });
    if (error) throw databaseFailure(error);
    // A retry keeps commandId, so a successful commit followed by a lost response cannot double a payment.
    return json({ workspace: await readWorkspace(supabase) });
  } catch (error) {
    return errorResponse(error);
  }
}
