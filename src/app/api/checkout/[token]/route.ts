import { z } from "zod";
import {
  readPixCheckout,
  generatePix,
  refreshPix,
} from "@/lib/server/pix-checkout";
import { parseBillingConfig } from "@/lib/config/billing";
import { requireOrigin, AccessError } from "@/lib/server/access";
import { ProviderError } from "@/lib/billing/mercadopago";
import { providerErrorDetails } from "@/lib/billing/provider-diagnostics";
import { boundedJson, json } from "@/lib/server/http";
import {
  checkoutTokenPattern,
  pixPayerSchema,
} from "@/lib/billing/pix-contract";

type Context = { params: Promise<{ token: string }> };
const input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("generate"), payer: pixPayerSchema }),
  z.strictObject({ action: z.literal("refresh") }),
]);
const unavailable = () =>
  json({ error: "Este link de pagamento não está disponível." }, 404);
export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  if (!checkoutTokenPattern.test(token)) return unavailable();
  try {
    const checkout = await readPixCheckout(token);
    return checkout ? json({ checkout }) : unavailable();
  } catch {
    return json(
      {
        error: "Não foi possível consultar o pagamento agora. Tente novamente.",
      },
      503,
    );
  }
}
export async function POST(request: Request, context: Context) {
  const { token } = await context.params;
  if (!checkoutTokenPattern.test(token)) return unavailable();
  try {
    const config = parseBillingConfig(process.env);
    if (!config.enabled) return unavailable();
    requireOrigin(request, config.appUrl);
    const data = input.parse(await boundedJson(request, 4096));
    const checkout =
      data.action === "generate"
        ? await generatePix(config, token, data.payer)
        : await refreshPix(config, token);
    return checkout ? json({ checkout }) : unavailable();
  } catch (error) {
    if (error instanceof AccessError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues[0]?.message ?? "Confira os dados informados." },
        400,
      );
    const code = error instanceof Error ? error.message : "";
    if (code.includes("POMAR_PIX_EXPIRED"))
      return json(
        {
          error:
            "A validade deste link está terminando. Solicite um novo link ao Grupo Pomar.",
        },
        409,
      );
    if (code.includes("POMAR_PIX_BUSY"))
      return json(
        {
          error:
            "A geração está em processamento. Aguarde 20 segundos antes de tentar novamente.",
        },
        429,
      );
    // Do not expose provider bodies, identifiers, SQL messages or payer details.
    console.error(
      JSON.stringify({
        event: "pix_checkout_operation_failed",
        stage: error instanceof ProviderError ? "provider" : "storage",
        ...(error instanceof ProviderError ? providerErrorDetails(error) : {}),
      }),
    );
    return json(
      {
        error:
          "Não foi possível confirmar a operação agora. Aguarde alguns instantes e confira novamente neste mesmo link.",
      },
      503,
    );
  }
}
