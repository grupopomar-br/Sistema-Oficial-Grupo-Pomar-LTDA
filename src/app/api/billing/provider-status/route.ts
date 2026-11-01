import { authorizedOwner } from "@/lib/server/access";
import { parseBillingConfig } from "@/lib/config/billing";
import { ConfigurationError } from "@/lib/config/environment";
import {
  billingConfigurationFailure,
  billingReadiness,
} from "@/lib/billing/readiness";
import { inspectProviderAccount } from "@/lib/billing/provider-diagnostics";
import { json, errorResponse } from "@/lib/server/http";

export async function GET() {
  let ownerAuthorized = false;
  try {
    await authorizedOwner(false);
    ownerAuthorized = true;
    const config = parseBillingConfig(process.env);
    if (!config.enabled) return json(billingReadiness(null, "disabled"));
    // Authenticated GET /users/me only. Never create an order or read a payer.
    const status = await inspectProviderAccount(config);
    return json(status, status.enabled ? 200 : 503);
  } catch (error) {
    if (!ownerAuthorized) return errorResponse(error);
    return json(
      error instanceof ConfigurationError
        ? billingConfigurationFailure(error.fields)
        : {
            enabled: false,
            mode: null,
            code: "provider_unavailable",
            message: "Não foi possível conferir o Mercado Pago neste momento.",
          },
      503,
    );
  }
}
