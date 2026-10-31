import { z } from "zod";
import { parseEnvironment } from "@/lib/config/environment";
import { parseBillingConfig } from "@/lib/config/billing";
import {
  sensitiveOwner,
  requireOrigin,
  AccessError,
} from "@/lib/server/access";
import { fetchVerifiedPayment, ProviderError } from "@/lib/billing/mercadopago";
import {
  applyVerifiedPayment,
  billingWorkerReady,
} from "@/lib/server/billing-worker";
import { boundedJson, json, errorResponse } from "@/lib/server/http";
import { readWorkspace, databaseFailure } from "@/lib/server/workspace";
export async function POST(request: Request) {
  try {
    const app = parseEnvironment(process.env);
    requireOrigin(request, app.appUrl);
    const owner = await sensitiveOwner(false);
    const config = parseBillingConfig(process.env);
    if (!config.enabled)
      throw new AccessError(
        "A integração de cobrança ainda não foi ativada.",
        503,
      );
    const input = z
      .strictObject({ paymentId: z.string().regex(/^\d{1,30}$/) })
      .parse(await boundedJson(request, 8192));
    const { data, error } = await owner.supabase
      .from("pomar_provider_payments")
      .select("id")
      .eq("provider_payment_id", input.paymentId)
      .eq("mode", config.mode)
      .maybeSingle();
    if (error) throw databaseFailure(error);
    if (!data)
      throw new AccessError("Pagamento não localizado nesta operação.", 404);
    if (!(await billingWorkerReady(config, owner.user.id)))
      throw new AccessError(
        "A configuração do processador precisa ser conferida.",
        503,
      );
    const payment = await fetchVerifiedPayment(config, input.paymentId);
    await applyVerifiedPayment(config, payment);
    return json({ workspace: await readWorkspace(owner.supabase) });
  } catch (error) {
    if (error instanceof ProviderError)
      return json(
        {
          error:
            "O provedor não confirmou a consulta. Tente novamente depois de conferir o ambiente.",
        },
        503,
      );
    return errorResponse(error);
  }
}
