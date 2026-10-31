import { z } from "zod";
import {
  sensitiveOwner,
  requireOrigin,
  AccessError,
} from "@/lib/server/access";
import { parseEnvironment } from "@/lib/config/environment";
import { parseBillingConfig } from "@/lib/config/billing";
import { createPreference, ProviderError } from "@/lib/billing/mercadopago";
import {
  attachPreference,
  markCreationFailure,
  billingWorkerReady,
} from "@/lib/server/billing-worker";
import { json, errorResponse, boundedJson } from "@/lib/server/http";
import { camelize } from "@/lib/domain/transport";
import { chargeSchema } from "@/lib/domain/extensions";
import { databaseFailure, readWorkspace } from "@/lib/server/workspace";
const schema = z.strictObject({
  commandId: z.uuid(),
  installmentId: z.uuid(),
  expiresHours: z.number().int().min(1).max(168),
});
export async function POST(request: Request) {
  let preparedId: string | undefined;
  let config: ReturnType<typeof parseBillingConfig> | undefined;
  try {
    const app = parseEnvironment(process.env);
    requireOrigin(request, app.appUrl);
    const owner = await sensitiveOwner(false);
    config = parseBillingConfig(process.env);
    if (!config.enabled)
      throw new AccessError(
        "A integração de pagamentos ainda não foi ativada.",
        503,
      );
    const input = schema.parse(await boundedJson(request, 32768));
    const result = await owner.supabase.rpc("pomar_prepare_charge", {
      p_key: input.commandId,
      p_installment_id: input.installmentId,
      p_expires_hours: input.expiresHours,
    });
    if (result.error) throw databaseFailure(result.error);
    const charge = chargeSchema.parse(camelize(result.data.charge));
    if (!result.data.created) {
      if (charge.status === "ready")
        return json({ workspace: await readWorkspace(owner.supabase) });
      throw new AccessError(
        "A criação deste link está em processamento ou precisa de conferência. Atualize os registros antes de repetir.",
        409,
      );
    }
    preparedId = charge.id;
    if (
      charge.mode !== config.mode ||
      String(result.data.collector_id) !== config.collectorId ||
      !(await billingWorkerReady(config, owner.user.id))
    )
      throw new ProviderError(
        "A configuração de cobrança está divergente.",
        true,
      );
    const preference = await createPreference(config, charge);
    await attachPreference(config, charge.id, preference);
    return json({ workspace: await readWorkspace(owner.supabase) });
  } catch (error) {
    if (preparedId && config?.enabled)
      await markCreationFailure(
        config,
        preparedId,
        error instanceof ProviderError && error.definitive,
      ).catch(() => {});
    if (error instanceof ProviderError)
      return json(
        {
          error:
            "O link não foi confirmado. Confira o estado da cobrança antes de gerar outra tentativa.",
        },
        503,
      );
    return errorResponse(error);
  }
}
