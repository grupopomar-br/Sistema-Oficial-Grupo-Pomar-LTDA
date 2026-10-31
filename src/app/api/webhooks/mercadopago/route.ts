import { parseBillingConfig } from "@/lib/config/billing";
import {
  verifyMercadoPagoSignature,
  fetchVerifiedPayment,
  ProviderError,
} from "@/lib/billing/mercadopago";
import { applyVerifiedPayment } from "@/lib/server/billing-worker";
import { boundedJson, json } from "@/lib/server/http";
// Public machine callback: authenticates the provider signature, never an owner cookie.
export async function POST(request: Request) {
  let config;
  try {
    config = parseBillingConfig(process.env);
  } catch {
    return json({ received: false }, 503);
  }
  if (!config.enabled) return json({ received: false }, 503);
  let paymentId: string;
  try {
    paymentId = verifyMercadoPagoSignature(request, config.webhookSecret);
  } catch {
    return json({ received: false }, 401);
  }
  let body;
  try {
    body = await boundedJson(request, 32768);
  } catch {
    return json({ received: false }, 400);
  }
  if (!body || typeof body !== "object" || !("type" in body))
    return json({ received: false }, 400);
  if (body.type !== "payment") return json({ received: true });
  const data = "data" in body ? body.data : null;
  if (
    !data ||
    typeof data !== "object" ||
    !("id" in data) ||
    String(data.id) !== paymentId
  )
    return json({ received: false }, 400);
  try {
    const payment = await fetchVerifiedPayment(config, paymentId);
    await applyVerifiedPayment(config, payment);
    return json({ received: true });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "billing_webhook_processing_failed",
        stage: error instanceof ProviderError ? "provider" : "storage",
      }),
    );
    return json(
      { received: false },
      error instanceof ProviderError && error.definitive ? 403 : 503,
    );
  }
}
