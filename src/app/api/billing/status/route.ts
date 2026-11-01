import { authorizedOwner } from "@/lib/server/access";
import { billingWorkerReady } from "@/lib/server/billing-worker";
import { pixWorkerReady } from "@/lib/server/pix-checkout";
import { parseBillingConfig } from "@/lib/config/billing";
import { ConfigurationError } from "@/lib/config/environment";
import {
  billingConfigurationFailure,
  billingReadiness,
  inspectBillingReadiness,
  type BillingReadiness,
} from "@/lib/billing/readiness";
import { json, errorResponse } from "@/lib/server/http";

function respond(status: BillingReadiness) {
  if (!status.enabled && status.code !== "disabled")
    console.warn("billing_readiness", { code: status.code });
  return json(status, status.enabled || status.code === "disabled" ? 200 : 503);
}

export async function GET() {
  let ownerAuthorized = false;
  try {
    const owner = await authorizedOwner(false);
    ownerAuthorized = true;
    const config = parseBillingConfig(process.env);
    if (!config.enabled) return respond(billingReadiness(null, "disabled"));
    return respond(
      await inspectBillingReadiness(config.mode, {
        ownerStatus: async () => owner.supabase.rpc("pomar_billing_status"),
        workerReady: () => billingWorkerReady(config, owner.user.id),
        pixReady: () => pixWorkerReady(config),
      }),
    );
  } catch (error) {
    if (!ownerAuthorized) return errorResponse(error);
    return respond(
      error instanceof ConfigurationError
        ? billingConfigurationFailure(error.fields)
        : billingReadiness(null, "status_unavailable"),
    );
  }
}
