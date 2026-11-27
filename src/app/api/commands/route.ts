import { parseEnvironment } from "@/lib/config/environment";
import {
  AccessError,
  authorizedOwner,
  requireOrigin,
} from "@/lib/server/access";
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
    if (
      [
        "createDeliveryPlan",
        "recordDeliveryTask",
        "scheduleDeliveryRecurrence",
        "setDeliveryPlanStatus",
      ].includes(command.type)
    ) {
      const { error } = await supabase.rpc("pomar_delivery_command", {
        p_key: commandId,
        p_command: databaseCommand(command),
      });
      if (error?.code === "PGRST202")
        throw new AccessError(
          "Ative a Central de Entregas no ambiente de homologação para salvar.",
          503,
        );
      if (error) throw databaseFailure(error);
      return json({ workspace: await readWorkspace(supabase) });
    }
    if (command.type === "recordProjectUpdate") {
      const { error } = await supabase.rpc("pomar_record_project_update", {
        p_key: commandId,
        p_project: command.projectId,
        p_version: command.expectedVersion,
        p_message: command.message,
        p_progress: command.progressPercent,
        p_next_action: command.nextAction,
        p_next_action_on: command.nextActionOn,
      });
      if (error?.code === "PGRST202")
        throw new AccessError(
          "Ative o acompanhamento de projetos no Supabase para salvar o avanço.",
          503,
        );
      if (error) throw databaseFailure(error);
      return json({ workspace: await readWorkspace(supabase) });
    }
    const { error } =
      command.type === "setProjectRemoved"
        ? await supabase.rpc("pomar_set_project_removed", {
            p_key: commandId,
            p_id: command.id,
            p_version: command.expectedVersion,
            p_removed: command.removed,
          })
        : command.type === "removeTestContract"
          ? await supabase.rpc("pomar_remove_test_contract", {
              p_key: commandId,
              p_id: command.id,
            })
          : await supabase.rpc("pomar_command", {
              p_key: commandId,
              p_command: databaseCommand(command),
            });
    if (command.type === "removeTestContract" && error?.code === "PGRST202")
      throw new AccessError(
        "A remoção de cobranças de teste precisa ser ativada no Supabase.",
        503,
      );
    if (command.type === "setProjectRemoved" && error?.code === "PGRST202")
      throw new AccessError(
        "A remoção de projetos precisa ser ativada no Supabase.",
        503,
      );
    if (error) throw databaseFailure(error);
    // A retry keeps commandId, so a successful commit followed by a lost response cannot double a payment.
    return json({ workspace: await readWorkspace(supabase) });
  } catch (error) {
    return errorResponse(error);
  }
}
