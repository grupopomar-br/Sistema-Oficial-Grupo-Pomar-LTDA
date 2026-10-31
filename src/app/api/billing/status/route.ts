import { authorizedOwner } from "@/lib/server/access";
import { billingWorkerReady } from "@/lib/server/billing-worker";
import { pixWorkerReady } from "@/lib/server/pix-checkout";
import { parseBillingConfig } from "@/lib/config/billing";
import { json, errorResponse } from "@/lib/server/http";
export async function GET() {
  try {
    const owner = await authorizedOwner(false);
    const config = parseBillingConfig(process.env);
    if (!config.enabled) return json({ enabled: false, mode: null });
    const { data, error } = await owner.supabase.rpc("pomar_billing_status");
    return json({
      enabled:
        !error &&
        data?.configured === true &&
        data?.mode === config.mode &&
        (await billingWorkerReady(config, owner.user.id)) &&
        (await pixWorkerReady(config)),
      mode: config.mode,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
